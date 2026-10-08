import { db, json, cors, sha, rpc, publicKeyAllowed } from '../_shared/runtime.ts';
import { processQueue, loadWhatsAppConfig, connectionStatus } from '../_shared/notifications.ts';
import { configFromInput, validateConnection } from '../_shared/whatsapp-config.ts';
import { requiresSecondFactor } from '../_shared/auth-policy.ts';

const actions = new Set(['catalog','slots','session','restore','mine','book','cancel','reschedule','whoami','admin_data','admin_export','notifications','reserve_extra','integration_status','whatsapp_connect','whatsapp_automation','status','pay','refund','remind','save_barber','save_service','block','delete_block','special_hours','delete_special','expense','settings']);
const publicActions = new Set(['catalog','slots','session','restore','mine','book','cancel','reschedule']);

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
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return json({ error: 'Dados inválidos.' }, 400);
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
      const jwt = authorization.replace(/^Bearer /i, '');
      const { data, error } = await client.auth.getUser(jwt);
      if (error || !data.user) return json({ error: 'Sua sessão expirou. Entre novamente.' }, 401);
      const { data: validated, error: claimsError } = await client.auth.getClaims(jwt);
      if (claimsError || !validated?.claims) return json({ error: 'Sua sessão expirou. Entre novamente.' }, 401);
      if (requiresSecondFactor(data.user, validated.claims)) return json({ error: 'Confirme o código do aplicativo autenticador.', code: 'MFA_REQUIRED' }, 403);
      adminId = data.user.id;
    }
    if (!publicActions.has(action) && !adminId) return json({ error: 'Faça login para acessar o painel.' }, 401);
    if (!adminId) {
      const caps: Record<string, number> = { book: 10, session: 30, restore: 15, cancel: 30, reschedule: 30, slots: 120 };
      if (caps[action]) {
        const { data, error } = await client.rpc('barber_action_rate_limit', { p_key: await sha(`action:${action}:${ip}`), p_limit: caps[action] });
        if (error) throw error;
        if (!data) return json({ error: 'Muitas solicitações desta operação. Aguarde alguns minutos.' }, 429);
      }
    }
    if (action === 'integration_status') {
      await rpc(client, 'whoami', {}, null, adminId);
      const { data: health, error } = await client.rpc('barber_health', { p_action: 'read', p_admin_id: adminId });
      if (error) throw error;
      return json({ data: { ...connectionStatus(await loadWhatsAppConfig(client)), health } });
    }
    if (action === 'whatsapp_connect' || action === 'whatsapp_automation') {
      await rpc(client, 'whoami', {}, null, adminId);
      const existing = await loadWhatsAppConfig(client);
      const config = action === 'whatsapp_connect'
        ? await validateConnection(configFromInput(payload, existing))
        : { ...existing, automatic_enabled: payload.enabled === true };
      const saved = await client.rpc('barber_whatsapp_config', { p_action: 'write', p_payload: config, p_admin_id: adminId });
      if (saved.error) throw new Error('Não foi possível salvar a conexão do WhatsApp.');
      return json({ data: connectionStatus(config) });
    }
    if (action === 'remind' && !connectionStatus(await loadWhatsAppConfig(client)).whatsapp.configured) {
      await rpc(client, 'whoami', {}, null, adminId);
      return json({ error: 'O WhatsApp ainda não está configurado. O lembrete não foi colocado na fila.' }, 409);
    }
    if (action === 'book' && payload.consent === true) {
      const config = await loadWhatsAppConfig(client);
      payload.consent = connectionStatus(config).whatsapp.reminder_configured && config.automatic_enabled !== false;
    }
    const result = await rpc(client, action, payload, deviceToken ? await sha(deviceToken) : null, adminId);
    if (action === 'catalog') {
      const config = await loadWhatsAppConfig(client), status = connectionStatus(config).whatsapp;
      result.whatsapp = { reminder_available: status.reminder_configured && config.automatic_enabled !== false };
    }
    if (['book','cancel','reschedule','remind'].includes(action)) EdgeRuntime.waitUntil(processQueue(client).catch(() => { /* fila persiste; cron tentará novamente */ }));
    return json({ data: result });
  } catch (e: any) {
    const code = e?.code;
    const status = code === '42501' ? 403 : ['23P01','23505'].includes(code) ? 409 : 400;
    const message = code === '23505' ? 'A solicitação já foi recebida. Consulte seu histórico antes de tentar novamente.' : code === '23P01' ? (e.message || 'Este horário ficou indisponível. Escolha outro.') : String(e.message ?? 'Não foi possível concluir. Tente novamente.');
    return json({ error: message, code }, status);
  }
});
