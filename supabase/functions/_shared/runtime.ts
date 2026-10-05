import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-device-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
};
export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
function envKey(name: string, fallback: string) {
  const raw = Deno.env.get(name);
  if (raw) { try { return JSON.parse(raw).default; } catch { /* legacy env */ } }
  return Deno.env.get(fallback) ?? '';
}
export function db() {
  return createClient(Deno.env.get('SUPABASE_URL')!, envKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
}
export function publicKeyAllowed(key: string) {
  const keys = [Deno.env.get('SUPABASE_ANON_KEY')];
  try { keys.push(...Object.values(JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}')) as string[]); } catch { /* no new keys */ }
  return key.length > 0 && keys.some(k => k === key);
}
export async function sha(text: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...bytes].map(x => x.toString(16).padStart(2, '0')).join('');
}
export async function rpc(client: ReturnType<typeof db>, action: string, payload = {}, tokenHash: string | null = null, adminId: string | null = null) {
  const { data, error } = await client.rpc('barber_rpc', { p_action: action, p_payload: payload, p_token_hash: tokenHash, p_admin_id: adminId });
  if (error) throw error;
  return data;
}
