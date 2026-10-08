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
  const ready = whatsapp.configured;
  const missing = [
    ...new Set([
      ...(whatsapp.missing || []),
      ...(whatsapp.owner_missing || []),
      ...(whatsapp.delivery_missing || []),
    ]),
  ];
  const headline = ready
    ? "WhatsApp: dados de envio configurados"
    : whatsapp.owner_configured
      ? "WhatsApp: avisos ao barbeiro configurados; lembretes pendentes"
      : "WhatsApp: configuração pendente";
  return `<section class="integration-status ${ready && !stale && !worker?.last_error ? "configured" : "unconfigured"}" aria-label="Situação do WhatsApp">${icon("bell", 22)}<div><strong>${headline}</strong><p>${ready ? `${whatsapp.automatic_enabled === false ? "Lembretes automáticos pausados." : "Lembretes automáticos 30 minutos antes, com autorização do cliente."} Acompanhe Enviado, Entregue e Lido nas notificações.` : whatsapp.owner_configured ? "As reservas são salvas. Lembretes ao cliente ainda não podem ser enviados." : "Os agendamentos são salvos, mas as mensagens ainda não podem ser enviadas."}${pending ? ` ${pending} ${pending === 1 ? "mensagem" : "mensagens"} aguardando processamento.` : ""}${failed ? ` ${failed} com falha ou expiradas.` : ""}${unknown ? ` ${unknown} aguardando conferência no provedor.` : ""}</p>${worker ? `<p class="fine-print">Última verificação do processamento: ${escape(new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(worker.last_checked_at)))}.${stale ? " Atenção: sem verificação recente. O processamento pode estar interrompido." : ""}${worker.last_error ? ` ${escape(worker.last_error)}` : ""}</p>` : '<p class="fine-print">O processamento ainda não registrou uma verificação de saúde.</p>'}${missing.length ? `<details><summary>O que falta configurar</summary><ul>${missing.map((label) => `<li>${escape(label)}</li>`).join("")}</ul></details>` : ""}</div></section>`;
}
