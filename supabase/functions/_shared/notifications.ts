import { db } from './runtime.ts';

type Job = { id: string; recipient: string; kind: string; attempts: number; payload: any };
const displayDate = (instant: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(instant));
const money = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);

export function templateParameters(job: Job) {
  const b = job.payload.booking;
  const services = (b.items ?? []).map((i: any) => i.name).join(', ');
  if (job.kind === 'reminder') return [b.customer_name, job.payload.shop_name, displayDate(b.starts_at), services, b.barber_name, Deno.env.get('PUBLIC_SITE_URL') ?? 'Consulte Meus agendamentos no mesmo dispositivo.'];
  return [({ new: 'Novo agendamento', cancel: 'Cancelamento', reschedule: 'Reagendamento', transfer: 'Transferência' } as Record<string,string>)[job.payload.event] ?? job.kind, b.customer_name, b.customer_phone, services || 'Consulte o painel', displayDate(b.starts_at), money(Number(b.total)), b.id, job.payload.day, job.payload.day_summary];
}
export async function processQueue(client = db()) {
  const token = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  const phoneId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
  const ownerTemplate = Deno.env.get('WHATSAPP_OWNER_TEMPLATE');
  const reminderTemplate = Deno.env.get('WHATSAPP_REMINDER_TEMPLATE');
  const version = Deno.env.get('WHATSAPP_GRAPH_VERSION');
  // Não retirar da fila enquanto a integração externa ainda não foi configurada.
  if (!token || !phoneId || !ownerTemplate || !reminderTemplate || !version) return { configured: false, processed: 0 };
  const { data, error } = await client.rpc('barber_queue', { p_action: 'claim' });
  if (error) throw error;
  let processed = 0;
  for (const job of (data ?? []) as Job[]) {
    let result: Record<string, unknown>;
    if (job.recipient === Deno.env.get('WHATSAPP_SENDER_PHONE')) {
      result = { status: 'failed', error: 'O remetente da API deve ser diferente do destinatário.' };
    } else {
      try {
        const response = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
          method: 'POST', signal: AbortSignal.timeout(15000),
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messaging_product: 'whatsapp', to: job.recipient, type: 'template', biz_opaque_callback_data: job.id, template: { name: job.kind === 'reminder' ? reminderTemplate : ownerTemplate, language: { code: 'pt_BR' }, components: [{ type: 'body', parameters: templateParameters(job).map(text => ({ type: 'text', text: String(text).replace(/[\n\r\t]+/g, ' ').slice(0,900) })) }] } }),
        });
        const payload = await response.json();
        if (response.ok && payload.messages?.[0]?.id) result = { status: 'sent', provider_id: payload.messages[0].id };
        else if (response.status >= 500) result = { status: 'unknown', error: 'Resposta ambígua do provedor. Conferir antes de repetir.' };
        else result = { status: (response.status === 429 && job.attempts < 6) ? 'pending' : 'failed', error: `Meta ${payload.error?.code ?? response.status}: ${String(payload.error?.message ?? 'Falha no envio').slice(0,600)}` };
      } catch {
        // Timeout pode ter ocorrido após o envio: repetir automaticamente poderia duplicá-lo.
        result = { status: 'unknown', error: 'Conexão interrompida. O envio pode ter ocorrido; aguarde o webhook ou confira o provedor.' };
      }
    }
    const saved = await client.rpc('barber_queue', { p_action: 'result', p_payload: { id: job.id, ...result } });
    if (saved.error) throw saved.error;
    processed++;
  }
  return { configured: true, processed };
}
