import { escape } from './utils.js';
import { icon } from './ui.js';

export function integrationStatusMarkup(status, notifications = []) {
  const whatsapp = status?.whatsapp;
  if (!whatsapp) return '';
  if (whatsapp.configured == null) return `<section class="integration-status unconfigured" aria-label="Situação do WhatsApp">${icon('bell', 22)}<div><strong>WhatsApp: verificação indisponível</strong><p>Não foi possível consultar a configuração agora. Tente atualizar esta página antes de solicitar um lembrete.</p></div></section>`;
  const pending = notifications.filter(n => ['pending', 'processing'].includes(n.status)).length;
  const ready = whatsapp.configured;
  const missing = [...(whatsapp.missing || []), ...(whatsapp.delivery_missing || [])];
  return `<section class="integration-status ${ready ? 'configured' : 'unconfigured'}" aria-label="Situação do WhatsApp">${icon('bell', 22)}<div><strong>${ready ? 'WhatsApp: dados de envio configurados' : 'WhatsApp: configuração pendente'}</strong><p>${ready ? `${whatsapp.automatic_enabled === false ? 'Lembretes automáticos pausados.' : 'Lembretes automáticos 30 minutos antes, com autorização do cliente.'} Acompanhe Enviado, Entregue e Lido nas notificações.` : 'Os agendamentos são salvos, mas as mensagens ainda não podem ser enviadas.'}${pending ? ` ${pending} mensagem${pending === 1 ? '' : 's'} aguardando processamento.` : ''}</p>${missing.length ? `<details><summary>O que falta configurar</summary><ul>${missing.map(label => `<li>${escape(label)}</li>`).join('')}</ul></details>` : ''}</div></section>`;
}
