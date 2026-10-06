import { db } from '../_shared/runtime.ts';
import { loadWhatsAppConfig, connectionStatus } from '../_shared/notifications.ts';
import { runQueue } from '../_shared/notification-processor.ts';

Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const client = db();
  const key = req.headers.get('x-worker-key') ?? '';
  const { data, error } = await client.rpc('barber_worker_authorized', { p_key: key });
  if (error || !data) return new Response('Unauthorized', { status: 401 });
  try {
    const config = await loadWhatsAppConfig(client);
    const status = connectionStatus(config).whatsapp;
    if (!status.reminder_configured && !status.owner_configured) return Response.json({ configured: false, processed: 0 });
    // pg_net tem timeout curto. A fila continua em segundo plano no servidor.
    EdgeRuntime.waitUntil(runQueue(client, config, fetch, Deno.env.get('PUBLIC_SITE_URL') || 'https://teste-gpt-autonomo.vercel.app/').catch(() => console.error('WhatsApp: falha no processamento; consulte a fila.')));
    return Response.json({ accepted: true, automatic_enabled: config.automatic_enabled !== false }, { status: 202 });
  }
  catch { return Response.json({ error: 'Falha no processamento. A fila foi preservada.' }, { status: 500 }); }
});
