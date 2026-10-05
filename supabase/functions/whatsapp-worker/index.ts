import { db } from '../_shared/runtime.ts';
import { processQueue } from '../_shared/notifications.ts';

Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const client = db();
  const key = req.headers.get('x-worker-key') ?? '';
  const { data, error } = await client.rpc('barber_worker_authorized', { p_key: key });
  if (error || !data) return new Response('Unauthorized', { status: 401 });
  try { return Response.json(await processQueue(client)); }
  catch { return Response.json({ error: 'Falha no processamento. A fila foi preservada.' }, { status: 500 }); }
});
