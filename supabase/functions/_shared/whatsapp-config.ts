export type WhatsAppConfig = {
  access_token?: string; phone_number_id?: string; sender_phone?: string;
  waba_id?: string; graph_version?: string; reminder_template?: string;
  owner_template?: string; app_secret?: string; verify_token?: string;
  automatic_enabled?: boolean; verified_at?: string; verified_name?: string;
};

const keys = {
  access_token: 'WHATSAPP_ACCESS_TOKEN', phone_number_id: 'WHATSAPP_PHONE_NUMBER_ID',
  sender_phone: 'WHATSAPP_SENDER_PHONE', waba_id: 'WHATSAPP_WABA_ID',
  graph_version: 'WHATSAPP_GRAPH_VERSION', reminder_template: 'WHATSAPP_REMINDER_TEMPLATE',
  owner_template: 'WHATSAPP_OWNER_TEMPLATE', app_secret: 'WHATSAPP_APP_SECRET',
  verify_token: 'WHATSAPP_VERIFY_TOKEN',
} as const;

export function mergeConfig(saved: WhatsAppConfig, read: (key: string) => string | undefined) {
  const config: WhatsAppConfig = { automatic_enabled: true, ...saved };
  for (const [key, env] of Object.entries(keys)) {
    if (!(config as any)[key]) (config as any)[key] = read(env)?.trim();
  }
  return config;
}

// Somente dados públicos e indicadores de presença podem voltar ao navegador.
export function publicConfig(config: WhatsAppConfig) {
  return {
    phone_number_id: config.phone_number_id ?? '', sender_phone: config.sender_phone ?? '',
    waba_id: config.waba_id ?? '', graph_version: config.graph_version ?? '',
    reminder_template: config.reminder_template ?? 'barber_booking_reminder',
    owner_template: config.owner_template ?? '', automatic_enabled: config.automatic_enabled !== false,
    has_token: !!config.access_token, has_app_secret: !!config.app_secret,
    has_verify_token: !!config.verify_token, verified_at: config.verified_at ?? null,
    verified_name: config.verified_name ?? '', reminder_minutes: 30,
  };
}

export function configFromInput(input: Record<string, unknown>, existing: WhatsAppConfig) {
  const config: WhatsAppConfig = { ...existing };
  for (const key of ['access_token','phone_number_id','waba_id','graph_version','reminder_template','owner_template','app_secret','verify_token'] as const) {
    const value = String(input[key] ?? '').trim();
    if (['access_token','app_secret','verify_token'].includes(key) && !value) continue;
    if (value.length > (key === 'access_token' ? 4096 : 200)) throw new Error('Um dos campos excedeu o tamanho permitido.');
    config[key] = value;
  }
  config.automatic_enabled = input.automatic_enabled !== false;
  if (config.access_token && !/^[A-Za-z0-9._|\-]+$/.test(config.access_token)) throw new Error('A autorização de envio contém caracteres inválidos. Copie apenas o token da Meta.');
  if (!config.access_token || !/^\d{5,30}$/.test(config.phone_number_id ?? '') || !/^\d{5,30}$/.test(config.waba_id ?? '')) throw new Error('Informe a autorização de envio, o ID do telefone e o ID da conta WhatsApp Business.');
  if (!/^v\d{1,3}\.0$/.test(config.graph_version ?? '')) throw new Error('Informe a versão da API exibida na Meta, por exemplo vXX.0.');
  if (!/^[a-z0-9_]{1,100}$/.test(config.reminder_template ?? '') || (config.owner_template && !/^[a-z0-9_]{1,100}$/.test(config.owner_template))) throw new Error('Use os nomes exatos dos modelos aprovados, com letras minúsculas, números e sublinhado.');
  return config;
}

function checkTemplate(template: any, count: number) {
  if (!template || template.status !== 'APPROVED') throw new Error('O modelo em português ainda não está aprovado na Meta.');
  if (template.parameter_format === 'NAMED') throw new Error('O modelo precisa usar parâmetros numerados, na ordem indicada no painel.');
  const components = template.components ?? [];
  if (components.some((c: any) => !['BODY','FOOTER','HEADER'].includes(c.type) || (c.type === 'HEADER' && (c.format !== 'TEXT' || /{{/.test(c.text ?? ''))))) throw new Error('Use um modelo de texto sem mídia, botões ou parâmetros no cabeçalho.');
  const text = components.find((c: any) => c.type === 'BODY')?.text ?? '';
  const parameters = [...new Set([...text.matchAll(/{{\s*(\d+)\s*}}/g)].map((m: any) => Number(m[1])))].sort((a: any,b: any) => a-b);
  if (parameters.length !== count || parameters.some((n, i) => n !== i+1)) throw new Error(`O corpo do modelo precisa ter ${count} parâmetros numerados, de {{1}} a {{${count}}}.`);
}

// Consultas de validação: não enviam mensagens e não registram/migram telefones.
export async function validateConnection(config: WhatsAppConfig, fetcher: typeof fetch = fetch) {
  const base = `https://graph.facebook.com/${config.graph_version}`;
  async function get(path: string) {
    const response = await fetcher(`${base}/${path}`, { headers: { Authorization: `Bearer ${config.access_token}` }, signal: AbortSignal.timeout(8000) });
    const body = await response.json();
    if (!response.ok) throw new Error(`A Meta recusou a validação (código ${body.error?.code ?? response.status}). Confira a autorização, a versão da API e os IDs da conta.`);
    return body;
  }
  const names = [[config.reminder_template,6], [config.owner_template,9]] as const;
  const [phones, ...templates] = await Promise.all([
    get(`${config.waba_id}/phone_numbers?fields=id,display_phone_number,verified_name&limit=100`),
    ...names.map(([name]) => name ? get(`${config.waba_id}/message_templates?name=${encodeURIComponent(name)}&fields=name,status,language,components,parameter_format&limit=100`) : null),
  ]);
  const phone = phones.data?.find((p: any) => p.id === config.phone_number_id);
  if (!phone) throw new Error('O telefone informado não pertence à conta WhatsApp Business indicada.');
  for (const [index, [name, count]] of names.entries()) {
    if (!name) continue;
    checkTemplate(templates[index]?.data?.find((t: any) => t.name === name && t.language === 'pt_BR'), count);
  }
  return { ...config, sender_phone: String(phone.display_phone_number).replace(/\D/g,''), verified_name: String(phone.verified_name ?? ''), verified_at: new Date().toISOString() };
}
