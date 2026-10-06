import { db } from './runtime.ts';
import { runQueue } from './notification-processor.ts';
import { mergeConfig, publicConfig, type WhatsAppConfig } from './whatsapp-config.ts';
import { notificationStatus } from './notification-status.ts';

export async function loadWhatsAppConfig(client = db()) {
  const { data, error } = await client.rpc('barber_whatsapp_config', { p_action: 'read' });
  if (error) throw new Error('Não foi possível consultar a conexão do WhatsApp.');
  return mergeConfig(data ?? {}, key => Deno.env.get(key));
}
export function connectionStatus(config: WhatsAppConfig) {
  const env: Record<string,string | undefined> = {
    WHATSAPP_ACCESS_TOKEN: config.access_token, WHATSAPP_PHONE_NUMBER_ID: config.phone_number_id,
    WHATSAPP_SENDER_PHONE: config.sender_phone, WHATSAPP_GRAPH_VERSION: config.graph_version,
    WHATSAPP_REMINDER_TEMPLATE: config.reminder_template, WHATSAPP_OWNER_TEMPLATE: config.owner_template,
    WHATSAPP_APP_SECRET: config.app_secret, WHATSAPP_VERIFY_TOKEN: config.verify_token,
  };
  return { whatsapp: { ...notificationStatus(key => env[key]).whatsapp, ...publicConfig(config) } };
}
export async function processQueue(client = db()) {
  return runQueue(client, await loadWhatsAppConfig(client), fetch, Deno.env.get('PUBLIC_SITE_URL') || 'https://teste-gpt-autonomo.vercel.app/');
}
