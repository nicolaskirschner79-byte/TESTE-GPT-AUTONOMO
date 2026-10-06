import { db } from '../_shared/runtime.ts';
import { loadWhatsAppConfig } from '../_shared/notifications.ts';

Deno.serve(async req => {
  const url = new URL(req.url);
  let config;
  try { config = await loadWhatsAppConfig(db()); } catch { return new Response('Webhook unavailable', { status: 503 }); }
  if (req.method === 'GET') {
    const token = config.verify_token;
    if (token && url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === token) return new Response(url.searchParams.get('hub.challenge'));
    return new Response('Unauthorized', { status: 401 });
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const secret = config.app_secret;
  if (!secret) return new Response('Webhook not configured', { status: 503 });
  const raw = await req.text();
  if (raw.length > 1000000) return new Response('Too large', { status: 413 });
  const provided = req.headers.get('x-hub-signature-256') ?? '';
  if (!/^sha256=[0-9a-f]{64}$/.test(provided)) return new Response('Invalid signature', { status: 401 });
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const signature = new Uint8Array(provided.slice(7).match(/../g)!.map(x => parseInt(x,16)));
  if (!await crypto.subtle.verify('HMAC', key, signature, new TextEncoder().encode(raw))) return new Response('Invalid signature', { status: 401 });
  try {
    const body = JSON.parse(raw);const client = db();
    for (const entry of body.entry ?? []) for (const change of entry.changes ?? []) for (const status of change.value?.statuses ?? []) {
      const { error } = await client.rpc('barber_queue', { p_action: 'webhook', p_payload: { provider_id: status.id, job_id: status.biz_opaque_callback_data, status: status.status, error: status.errors?.map((x:any) => `${x.code}: ${x.title}`).join('; ') } });
      if (error) throw error;
    }
    return new Response('EVENT_RECEIVED');
  } catch { return new Response('Webhook processing failed', { status: 500 }); }
});
