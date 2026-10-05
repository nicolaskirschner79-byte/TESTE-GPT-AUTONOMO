import { db, json, cors, sha, rpc, publicKeyAllowed } from '../_shared/runtime.ts';
import { processQueue } from '../_shared/notifications.ts';

const actions = new Set(['catalog','slots','session','mine','book','cancel','reschedule','whoami','admin_data','status','pay','refund','remind','save_barber','save_service','block','delete_block','special_hours','delete_special','expense','settings']);
const publicActions = new Set(['catalog','slots','session','mine','book','cancel','reschedule']);

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
  // verify_jwt=false: autorização explícita por chave pública + sessão Auth ou chave do dispositivo.
  if (!publicKeyAllowed(req.headers.get('apikey') ?? '')) return json({ error: 'Chave de aplicação inválida.' }, 401);
  try {
    const raw = await req.text();
    if (raw.length > 32000) return json({ error: 'Solicitação muito grande.' }, 413);
    const { action, payload = {} } = JSON.parse(raw);
    if (!actions.has(action)) return json({ error: 'Operação inválida.' }, 400);
    const client = db();
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
    const limit = await client.rpc('barber_rate_limit', { p_key: await sha(`barber:${ip}`) });
    if (limit.error) throw limit.error;
    if (!limit.data) return json({ error: 'Muitas solicitações. Aguarde alguns minutos.' }, 429);
    const deviceToken = req.headers.get('x-device-token');
    if (deviceToken && !/^[A-Za-z0-9_-]{43}$/.test(deviceToken)) return json({ error: 'Identidade do dispositivo inválida.' }, 401);
    let adminId: string | null = null;
    const authorization = req.headers.get('authorization');
    if (authorization) {
      const { data, error } = await client.auth.getUser(authorization.replace(/^Bearer /i, ''));
      if (error || !data.user) return json({ error: 'Sua sessão expirou. Entre novamente.' }, 401);
      adminId = data.user.id;
    }
    if (!publicActions.has(action) && !adminId) return json({ error: 'Faça login para acessar o painel.' }, 401);
    const result = await rpc(client, action, payload, deviceToken ? await sha(deviceToken) : null, adminId);
    if (['book','cancel','reschedule','remind'].includes(action)) EdgeRuntime.waitUntil(processQueue(client).catch(() => { /* fila persiste; cron tentará novamente */ }));
    return json({ data: result });
  } catch (e: any) {
    const code = e?.code;
    const status = code === '42501' ? 403 : ['23P01','23505'].includes(code) ? 409 : 400;
    const message = code === '23505' ? 'A solicitação já foi recebida. Consulte seu histórico antes de tentar novamente.' : code === '23P01' ? (e.message || 'Este horário ficou indisponível. Escolha outro.') : String(e.message ?? 'Não foi possível concluir. Tente novamente.');
    return json({ error: message, code }, status);
  }
});
