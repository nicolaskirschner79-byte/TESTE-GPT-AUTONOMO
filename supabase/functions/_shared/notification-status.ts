type ReadEnv = (name: string) => string | undefined;
const required = [
  ['WHATSAPP_ACCESS_TOKEN', 'Autorização de envio'],
  ['WHATSAPP_PHONE_NUMBER_ID', 'Remetente do WhatsApp'],
  ['WHATSAPP_SENDER_PHONE', 'Número remetente'],
  ['WHATSAPP_OWNER_TEMPLATE', 'Modelo de aviso ao barbeiro'],
  ['WHATSAPP_REMINDER_TEMPLATE', 'Modelo de lembrete ao cliente'],
  ['WHATSAPP_GRAPH_VERSION', 'Versão da integração'],
] as const;
const delivery = [
  ['WHATSAPP_APP_SECRET', 'Validação do retorno de entrega'],
  ['WHATSAPP_VERIFY_TOKEN', 'Confirmação do retorno de entrega'],
] as const;

export function notificationStatus(read: ReadEnv = name => Deno.env.get(name)) {
  const missing = required.filter(([key]) => !read(key)?.trim()).map(([, label]) => label);
  const deliveryMissing = delivery.filter(([key]) => !read(key)?.trim()).map(([, label]) => label);
  return { whatsapp: { configured: missing.length === 0, delivery_configured: deliveryMissing.length === 0, missing, delivery_missing: deliveryMissing } };
}
