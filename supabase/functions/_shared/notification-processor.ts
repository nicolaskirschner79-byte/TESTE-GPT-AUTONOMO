import type { WhatsAppConfig } from './whatsapp-config.ts';
type Job = { id: string; recipient: string; kind: string; attempts: number; payload: any };
const displayDate = (instant: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(instant));
const money = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);

export function templateParameters(job: Job, siteUrl = 'https://teste-gpt-autonomo.vercel.app/') {
  const b = job.payload.booking;
  const services = (b.items ?? []).map((i: any) => i.name).join(', ');
  if (job.kind === 'reminder') return [b.customer_name, job.payload.shop_name, displayDate(b.starts_at), services, b.barber_name, siteUrl];
  return [({ new: 'Novo agendamento', cancel: 'Cancelamento', reschedule: 'Reagendamento', transfer: 'Transferência' } as Record<string,string>)[job.payload.event] ?? job.kind, b.customer_name, b.customer_phone, services || 'Consulte o painel', displayDate(b.starts_at), money(Number(b.total)), b.id, job.payload.day, job.payload.day_summary];
}

export async function runQueue(client: any, config: WhatsAppConfig, fetcher: typeof fetch = fetch, siteUrl?: string) {
  const common = config.access_token && config.phone_number_id && config.sender_phone && config.graph_version;
  const kinds = common ? [...(config.reminder_template ? ['reminder'] : []), ...(config.owner_template ? ['new','cancel','reschedule'] : [])] : [];
  async function queue(action: string, payload: any = {}) {
    const { data, error } = await client.rpc('barber_queue', { p_action: action, p_payload: payload });
    if (error) throw error;return data;
  }
  await queue('maintenance');
  if (!kinds.length) return { configured: false, processed: 0 };
  if (kinds.includes('reminder') && config.automatic_enabled !== false) await queue('enqueue_reminders');
  const jobs = await queue('claim', { kinds, automatic_enabled: config.automatic_enabled !== false });
  let processed = 0;
  for (const claimed of jobs ?? []) {
    const job: Job | null = await queue('prepare', { id: claimed.id });
    if (!job) continue;
    let result: Record<string, unknown>;
    if (job.recipient === config.sender_phone) result = { status: 'failed', error: 'O remetente não pode enviar uma mensagem para o próprio número.' };
    else {
      try {
        const response = await fetcher(`https://graph.facebook.com/${config.graph_version}/${config.phone_number_id}/messages`, {
          method: 'POST', signal: AbortSignal.timeout(15000),
          headers: { Authorization: `Bearer ${config.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messaging_product: 'whatsapp', to: job.recipient, type: 'template', biz_opaque_callback_data: job.id,
            template: { name: job.kind === 'reminder' ? config.reminder_template : config.owner_template, language: { code: 'pt_BR' },
              components: [{ type: 'body', parameters: templateParameters(job, siteUrl).map(text => ({ type: 'text', text: String(text).replace(/[\n\r\t]+/g, ' ').slice(0,900) })) }] } }),
        });
        const payload = await response.json();
        if (response.ok && payload.messages?.[0]?.id) result = { status: 'sent', provider_id: payload.messages[0].id };
        else if (response.status >= 500 || response.ok) result = { status: 'unknown', error: 'Resposta ambígua do provedor. Conferir antes de repetir.' };
        else result = { status: response.status === 429 && job.attempts < 6 ? 'pending' : 'failed', error: `Meta ${payload.error?.code ?? response.status}: falha no envio. Confira o remetente, a autorização e o modelo na Meta.` };
      } catch {
        result = { status: 'unknown', error: 'Conexão interrompida. O envio pode ter ocorrido; aguarde o webhook ou confira o provedor.' };
      }
    }
    await queue('result', { id: job.id, ...result });processed++;
  }
  return { configured: true, processed };
}
