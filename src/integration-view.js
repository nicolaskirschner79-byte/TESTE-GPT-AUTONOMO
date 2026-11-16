import { escape } from "./utils.js";
import { icon } from "./ui.js";

export function integrationStatusMarkup(
  status,
  notifications = [],
  now = new Date(),
) {
  const whatsapp = status?.whatsapp;
  if (!whatsapp) return "";
  if (whatsapp.configured == null)
    return `<section class="integration-status unconfigured" aria-label="Situação do WhatsApp">${icon("bell", 22)}<div><strong>WhatsApp: verificação indisponível</strong><p>Não foi possível consultar a configuração agora. Tente atualizar esta página antes de solicitar um lembrete.</p></div></section>`;

  const queue = status.health?.queue;
  const pending =
    queue?.pending ??
    notifications.filter((n) => ["pending", "processing"].includes(n.status))
      .length;
  const failed =
    queue?.failed ?? notifications.filter((n) => n.status === "failed").length;
  const unknown =
    queue?.unknown ??
    notifications.filter((n) => n.status === "unknown").length;
  const worker = status.health?.worker;
  const stale = worker && now - new Date(worker.last_checked_at) > 180000;
  const ready = whatsapp.configured === true;
  const requiredMissing = [...new Set(whatsapp.missing || [])];
  const ownerMissing = [...new Set(whatsapp.owner_missing || [])];
  const deliveryMissing = [...new Set(whatsapp.delivery_missing || [])];

  const headline = ready
    ? "WhatsApp: conexão de lembretes configurada"
    : whatsapp.owner_configured
      ? "WhatsApp: avisos ao barbeiro configurados; lembretes pendentes"
      : "WhatsApp: configuração pendente";
  const summary = ready
    ? `${whatsapp.automatic_enabled === false ? "Lembretes automáticos pausados." : "Lembretes automáticos programados para 30 minutos antes, somente para clientes que autorizaram."} Acompanhe os estados reais em Notificações.`
    : "Os agendamentos continuam sendo salvos normalmente, mas os lembretes não serão enviados até concluir os itens obrigatórios abaixo.";
  const healthMessage = worker
    ? `<p class="fine-print">Última verificação do processamento: ${escape(new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(worker.last_checked_at)))}.${stale ? " Atenção: sem verificação recente. Confira o agendador do Supabase." : ""}${worker.last_error ? ` ${escape(worker.last_error)}` : ""}</p>`
    : '<p class="fine-print">O processamento ainda não registrou uma verificação de saúde.</p>';

  const queueMessage = [
    pending ? `${pending} ${pending === 1 ? "mensagem aguardando" : "mensagens aguardando"} processamento.` : "",
    failed ? `${failed} com falha ou expiradas.` : "",
    unknown ? `${unknown} aguardando conferência no provedor para evitar duplicidade.` : "",
  ].filter(Boolean).join(" ");

  const requiredDetails = !ready && requiredMissing.length
    ? `<details open><summary>Configuração obrigatória para enviar lembretes</summary><ul>${requiredMissing.map((label) => `<li>${escape(label)}</li>`).join("")}</ul><p class="fine-print">Abra Configurações → Conectar WhatsApp. Os dados de acesso são obtidos no Meta for Developers; não compartilhe o token em mensagens ou no código do projeto.</p></details>`
    : "";

  const optionalItems = [
    ...ownerMissing.map((label) => ({ label, group: "Avisos ao barbeiro" })),
    ...deliveryMissing.map((label) => ({ label, group: "Confirmação de entrega e leitura" })),
  ];
  const optionalDetails = optionalItems.length
    ? `<details><summary>Recursos opcionais ${ready ? "ainda não configurados" : "(não impedem a conexão básica)"}</summary>${ownerMissing.length ? `<p><strong>Avisos ao barbeiro</strong></p><ul>${ownerMissing.map((label) => `<li>${escape(label)}</li>`).join("")}</ul><p class="fine-print">O modelo de aviso permite receber atualizações de novos agendamentos, cancelamentos e reagendamentos.</p>` : ""}${deliveryMissing.length ? `<p><strong>Retorno de entrega e leitura</strong></p><ul>${deliveryMissing.map((label) => `<li>${escape(label)}</li>`).join("")}</ul><p class="fine-print">Configure o webhook na Meta para validar os eventos e atualizar os estados Entregue e Lido. Sem ele, o sistema ainda pode registrar o aceite de envio da Meta.</p>` : ""}</details>`
    : "";

  return `<section class="integration-status ${ready && !stale && !worker?.last_error ? "configured" : "unconfigured"}" aria-label="Situação do WhatsApp">${icon("bell", 22)}<div><strong>${headline}</strong><p>${summary}${queueMessage ? ` ${queueMessage}` : ""}</p>${healthMessage}${requiredDetails}${optionalDetails}</div></section>`;
}
