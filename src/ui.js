import { escape, money, time, date, statusNames } from "./utils.js";
import { forecastMinutes } from "./booking-policy.js";
export const $ = (s) => document.querySelector(s);
const paths = {
  play: "m8 5 11 7-11 7Z",
  more: "M12 5h.01M12 12h.01M12 19h.01",
  search: "M21 21l-6-6M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  phone:
    "M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 3.1 5.2 2 2 0 0 1 5.1 3h3a2 2 0 0 1 2 1.7l.4 2.8a2 2 0 0 1-.6 1.7l-1.3 1.3a16 16 0 0 0 5.9 5.9l1.3-1.3a2 2 0 0 1 1.7-.6l2.8.4a2 2 0 0 1 1.7 2Z",
  utensils: "M4 3v6a3 3 0 0 0 6 0V3M7 3v19M20 22V3c-4 1-5 6-5 10h5",
  trash: "M3 6h18M8 6V3h8v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
  "chevron-left": "m15 5-7 7 7 7",
  "chevron-right": "m9 5 7 7-7 7",
  scissors:
    "M4 4l16 16M4 20L20 4M9 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm0 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  calendar:
    "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z",
  arrow: "M5 12h14M13 6l6 6-6 6",
  check: "m5 12 4 4L19 6",
  clock: "M12 7v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
  user: "M20 21v-2a7 7 0 0 0-14 0v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  shield: "M12 2 3 6v6c0 6 9 10 9 10s9-4 9-10V6l-9-4Zm-4 10 3 3 5-5",
  wallet: "M20 8V4H4v16h16V8ZM20 8h-6v6h6M17 11h.01",
  grid: "M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2",
  bell: "M18 8a6 6 0 0 0-12 0v6l-2 3h16l-2-3ZM9 21h6",
  logout: "M9 4H4v16h5M12 12h9M17 8l4 4-4 4",
  plus: "M12 4v16M4 12h16",
  close: "M5 5l14 14M19 5 5 19",
  trend: "m3 17 6-6 4 4 8-10M16 5h5v5",
};
export const icon = (name, size = 20) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.calendar}"/></svg>`;
export function toast(message, error = false) {
  let el = $("#toast");
  el.textContent = message;
  el.className = `toast show ${error ? "error" : ""}`;
  clearTimeout(el.timer);
  el.timer = setTimeout(() => el.classList.remove("show"), 6000);
}
export function busy(button, promise) {
  const old = button.innerHTML;
  button.disabled = true;
  button.innerHTML = "Aguarde…";
  return promise.finally(() => {
    if (button.isConnected) {
      button.disabled = false;
      button.innerHTML = old;
    }
  });
}
export function modal(
  title,
  body,
  { confirm = "Confirmar", onConfirm, wide = false } = {},
) {
  const dialog = document.createElement("dialog");
  dialog.className = `dialog ${wide ? "wide" : ""}`;
  dialog.innerHTML = `<div class="dialog-head"><h2>${escape(title)}</h2><button class="icon-btn" aria-label="Fechar">${icon("close")}</button></div><div class="dialog-body">${body}</div>${onConfirm ? `<div class="dialog-foot"><button class="btn secondary" data-close>Voltar</button><button class="btn primary" data-confirm>${escape(confirm)}</button></div>` : ""}`;
  document.body.append(dialog);
  const close = () => {
    dialog.close();
    dialog.remove();
  };
  dialog.querySelector(".icon-btn").onclick = close;
  dialog.querySelector("[data-close]")?.addEventListener("click", close);
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) close();
  });
  dialog.addEventListener("cancel", () => dialog.remove());
  dialog
    .querySelector("[data-confirm]")
    ?.addEventListener("click", async (e) => {
      try {
        await busy(e.currentTarget, onConfirm(dialog));
        close();
      } catch (err) {
        toast(err.message, true);
      }
    });
  dialog.showModal();
  return dialog;
}
export function durationNotice(b) {
  const forecast = forecastMinutes(b.items);
  return forecast > 60
    ? `<div class="duration-notice" role="note"><strong>Previsão dos serviços: ${forecast} minutos.</strong><p>A reserva ocupa uma hora na agenda. ${b.extra_block ? `A barbearia bloqueou tempo adicional até ${time(b.extra_block.ends_at)}.` : "Confirme o tempo adicional com a barbearia antes da visita."}</p></div>`
    : "";
}
export function bookingSummary(b) {
  return `<div class="summary-line"><span>Serviços</span><strong>${escape(b.items.map((i) => i.name).join(" + "))}</strong></div><div class="summary-line"><span>Barbeiro</span><strong>${escape(b.barber_name)}</strong></div><div class="summary-line"><span>Quando</span><strong>${date(b.starts_at)} · ${time(b.starts_at)}–${time(b.ends_at)}</strong></div><div class="summary-line"><span>Cliente</span><strong>${escape(b.customer_name)}</strong></div><div class="summary-line"><span>Celular</span><strong>${escape(b.customer_phone)}</strong></div><div class="summary-line total"><span>Total</span><strong>${money(b.total)}</strong></div>${durationNotice(b)}`;
}
export const badge = (s) =>
  `<span class="badge ${escape(s)}">${escape(statusNames[s] || s)}</span>`;

export function profileAvatar(b, size = "") {
  return `<span class="avatar ${size}">${b.photo_url?.startsWith("https://") ? `<img src="${escape(b.photo_url)}" alt="${escape(b.name)}" loading="lazy" referrerpolicy="no-referrer">` : escape(b.name?.[0] || "?")}</span>`;
}
