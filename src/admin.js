import "./styles.css";
import "./branding.css";
import "./hero.css";
import "./agenda.css";
import {
  adminDataRequests,
  validateFinancialPeriod,
  currentMonthRange,
} from "./admin-data.js";
import { integrationStatusMarkup } from "./integration-view.js";
import {
  whatsappSettingsMarkup,
  whatsappConnectionFields,
} from "./whatsapp-editor.js";
import { agendaPageMarkup } from "./agenda-view.js";
import { bindAgendaControls } from "./agenda-controller.js";
import { additionalBookingMinutes } from "./booking-policy.js";
import {
  securitySettingsMarkup,
  bindSecuritySettings,
  needsOwnerChallenge,
  ownerChallenge,
} from "./owner-security.js";
import { canFinishBooking } from "./agenda-model.js";
import {
  initBranding,
  applyBranding,
  brandMarkup,
  getBranding,
  initials,
} from "./branding.js";
import {
  brandingSettingsMarkup,
  bindBrandingSettings,
} from "./brand-editor.js";
import { heroSettingsMarkup, bindHeroSettings } from "./hero-editor.js";
import { auth, api, watchChanges } from "./api.js";
import {
  $,
  icon,
  toast,
  busy,
  modal as createModal,
  bookingSummary,
  badge,
  profileAvatar,
} from "./ui.js";
import {
  money,
  time,
  date,
  dayKey,
  addDays,
  localInstant,
  escape,
  normalizePhone,
  phoneMask,
  notificationNames,
  metrics,
} from "./utils.js";

const OWNER = "nicolaskirschner79@gmail.com";
const initialDay = dayKey(),
  initialMonth = currentMonthRange();
const state = {
  notificationPage: 0,
  notificationInfo: null,
  page: "overview",
  from: initialMonth.from,
  to: initialMonth.to,
  followFinancialMonth: true,
  barber: "",
  data: null,
  recentData: null,
  integrations: null,
  connected: false,
  agenda: {
    day: initialDay,
    followToday: true,
    view: "day",
    barber: "",
    search: "",
    status: "",
    selected: "",
    showFree: true,
  },
};
const pages = {
  overview: ["Visão geral", "grid"],
  bookings: ["Agendamentos", "calendar"],
  barbers: ["Barbeiros", "user"],
  services: ["Serviços", "scissors"],
  expenses: ["Despesas", "wallet"],
  notifications: ["Notificações", "bell"],
  settings: ["Configurações", "settings"],
};
let stopWatch,
  refreshing = false,
  refreshPending,
  refreshAgain = false,
  dataSource = "",
  loginMode = "login",
  disposeSettingsEditors;
const settingsDirty = new Set();
const admin = (action, payload = {}) => api(action, payload, true);
function modal(...args) {
  const dialog = createModal(...args);
  dialog.addEventListener("close", () => refresh(), { once: true });
  return dialog;
}
function adminDataRequest() {
  if (state.followFinancialMonth) {
    const month = currentMonthRange();
    state.from = month.from;
    state.to = month.to;
  }
  if (state.agenda.followToday && state.agenda.day !== dayKey()) {
    state.agenda.day = dayKey();
    state.agenda.selected = "";
    state.agenda.scrollTop = 0;
  }
  return adminDataRequests(state);
}

function login() {
  stopWatch?.();
  disposeSettingsEditors?.();
  settingsDirty.clear();
  state.data = null;
  dataSource = "";
  $("#app").innerHTML =
    `<div class="login-layout"><section class="login-story"><a class="brand" href="/">${brandMarkup()}</a><div><span class="eyebrow"><span class="red-line"></span> SUA BARBEARIA, EM ORDEM</span><h1>Mais cuidado.<br><span>Menos correria.</span></h1><p>Agenda, clientes e financeiro.<br>Tudo no seu ritmo, em um só lugar.</p><div class="login-features">${icon("calendar", 18)} Agenda em tempo real <span></span>${icon("wallet", 18)} Gestão financeira</div></div><small>Uma experiência <span data-shop-name>${escape(getBranding().shop_name)}</span>.</small></section><section class="login-side"><a href="/" class="login-back">← Voltar ao agendamento</a><div class="login-card"><span class="eyebrow dark">ÁREA DO PROPRIETÁRIO</span><h2>${loginMode === "recovery" ? "Defina uma nova senha." : "Bem-vindo de volta."}</h2><p>${loginMode === "recovery" ? "Escolha uma senha segura para continuar." : "Entre para cuidar do seu negócio."}</p><form id="login-form"><label>E-mail do proprietário<input id="login-email" type="email" value="${OWNER}" readonly autocomplete="username"></label><label>Senha<input id="login-password" type="password" required minlength="${loginMode === "login" ? 1 : 12}" autocomplete="${loginMode === "login" ? "current-password" : "new-password"}" placeholder="${loginMode === "login" ? "Sua senha" : "No mínimo 12 caracteres"}"></label><button class="btn primary full" type="submit">${loginMode === "recovery" ? "Salvar nova senha" : "Entrar no painel"} ${icon("arrow", 18)}</button></form><div class="login-actions"><button id="recover" class="text-btn">Esqueci minha senha</button></div><div class="login-secure">${icon("shield", 15)} Acesso exclusivo ao proprietário autorizado.</div></div><small class="login-foot">Organização que dá espaço ao seu talento.</small></section></div>`;
  stopWatch = watchChanges(async () => {
    try {
      applyBranding(await api("catalog"));
    } catch {
      /* A marca será consultada na próxima sincronização. */
    }
  });
  $("#recover").onclick = async (e) => {
    try {
      await busy(
        e.currentTarget,
        (async () => {
          const { error } = await auth.auth.resetPasswordForEmail(OWNER, {
            redirectTo: location.origin + "/admin.html",
          });
          if (error) throw error;
          toast("Se o acesso existir, enviaremos as instruções ao seu e-mail.");
        })(),
      );
    } catch (err) {
      toast(err.message, true);
    }
  };
  $("#login-form").onsubmit = async (e) => {
    e.preventDefault();
    const button = e.target.querySelector("[type=submit]");
    try {
      await busy(
        button,
        (async () => {
          const password = $("#login-password").value;
          if (loginMode === "recovery") {
            if (await needsOwnerChallenge())
              return await ownerChallenge(
                () => {
                  loginMode = "recovery";
                  login();
                },
                async () => {
                  await auth.auth.signOut();
                  loginMode = "login";
                  login();
                },
              );
            const { error } = await auth.auth.updateUser({ password });
            if (error) throw error;
            loginMode = "login";
            await openPanel();
          } else {
            const { error } = await auth.auth.signInWithPassword({
              email: OWNER,
              password,
            });
            if (error)
              throw new Error(
                "E-mail ou senha inválidos. Confira e tente novamente.",
              );
            await openPanel();
          }
        })(),
      );
    } catch (err) {
      toast(err.message, true);
    }
  };
}
function panelShell() {
  $("#app").innerHTML =
    `<div class="admin-layout"><aside class="sidebar"><a href="/" class="brand">${brandMarkup("PAINEL DO PROPRIETÁRIO")}</a><div class="workspace"><span class="avatar" data-shop-initials>${escape(initials(getBranding().shop_name))}</span><span><span data-shop-name>${escape(getBranding().shop_name)}</span><small>Seu espaço de gestão</small></span><i></i></div><span class="nav-label">SEU NEGÓCIO</span><nav>${Object.entries(
      pages,
    )
      .map(
        ([id, [label, i]]) =>
          `<button class="side-link ${id === state.page ? "active" : ""}" data-page="${id}">${icon(i, 18)}<span>${label}</span>${id === "overview" ? "<i></i>" : ""}</button>`,
      )
      .join(
        "",
      )}</nav><div class="sidebar-bottom"><a href="/" class="side-link">${icon("arrow", 18)} Abrir página de agendamento</a><button id="logout" class="side-link">${icon("logout", 18)} Sair do painel</button><div class="owner-card"><span class="avatar">N</span><span>Nicolas<small>Proprietário</small></span>${icon("shield", 15)}</div></div></aside><div class="admin-main"><header class="admin-header"><button id="menu" class="icon-btn mobile-only" aria-label="Abrir menu">${icon("grid")}</button><span class="breadcrumb">Seu negócio <span>/</span> <b id="crumb">${pages[state.page][0]}</b></span><div class="header-right"><span id="admin-live" class="live-status"><i></i><span>Sincronizando</span></span><a href="/" class="header-booking">Ver página pública ${icon("arrow", 14)}</a></div></header><main class="admin-content" id="admin-content"><div class="skeleton-line"></div><div class="skeleton-line"></div></main></div></div>`;
  document.querySelectorAll("[data-page]").forEach(
    (el) =>
      (el.onclick = () => {
        disposeSettingsEditors?.();
        disposeSettingsEditors = null;
        settingsDirty.clear();
        state.page = el.dataset.page;
        state.notificationPage = 0;
        document.querySelector(".sidebar").classList.remove("open");
        renderPanel();
        document
          .querySelectorAll("[data-page]")
          .forEach((x) =>
            x.classList.toggle("active", x.dataset.page === state.page),
          );
        $("#crumb").textContent = pages[state.page][0];
        refresh();
      }),
  );
  $("#menu").onclick = () =>
    document.querySelector(".sidebar").classList.toggle("open");
  $("#logout").onclick = async () => {
    stopWatch?.();
    await auth.auth.signOut();
    login();
  };
}
async function refresh() {
  if (!$("#admin-content")) return;
  if (refreshing) {
    refreshAgain = true;
    return refreshPending;
  }
  refreshing = true;
  refreshPending = (async () => {
    do {
      refreshAgain = false;
      const request = adminDataRequest(),
        source = JSON.stringify(request),
        page = state.page;
      try {
        const [data, recent, integrations, notifications] = await Promise.all([
          admin("admin_data", request.period),
          request.recent ? admin("admin_data", request.recent) : null,
          ["overview", "notifications", "settings"].includes(page)
            ? admin("integration_status").catch((error) => {
                if (error.status === 401 || error.status === 403) throw error;
                return { whatsapp: { configured: null } };
              })
            : null,
          page === "notifications"
            ? admin("notifications", { page: state.notificationPage })
            : null,
        ]);
        if (!$("#admin-content")) break;
        if (
          page !== state.page ||
          source !== JSON.stringify(adminDataRequest())
        ) {
          refreshAgain = true;
          continue;
        }
        state.data = data;
        state.notificationInfo = notifications;
        if (notifications) state.data.notifications = notifications.items;
        state.recentData = recent;
        state.integrations = integrations || state.integrations;
        dataSource = source;
        applyBranding(data.settings);
        if (
          !document.querySelector("dialog") &&
          !(state.page === "settings" && settingsDirty.size)
        )
          renderPanel();
      } catch (e) {
        if (e.code === "MFA_REQUIRED") {
          stopWatch?.();
          await ownerChallenge(openPanel, async () => {
            await auth.auth.signOut();
            login();
          });
        } else if (e.status === 401 || e.status === 403) {
          await auth.auth.signOut();
          login();
        } else {
          toast(e.message, true);
          if (!state.data || source !== dataSource)
            $("#admin-content").innerHTML =
              `<div class="inline-error">${escape(e.message)} <button class="text-btn" id="retry-admin">Tentar novamente</button></div>`;
          $("#retry-admin")?.addEventListener("click", refresh);
        }
      }
    } while (refreshAgain && $("#admin-content"));
  })().finally(() => {
    refreshing = false;
  });
  return refreshPending;
}
async function openPanel() {
  const { data, error } = await auth.auth.getUser();
  if (error || !data.user) return login();
  try {
    if (await needsOwnerChallenge()) {
      stopWatch?.();
      return await ownerChallenge(openPanel, async () => {
        await auth.auth.signOut();
        login();
      });
    }
    await admin("whoami");
  } catch (e) {
    await auth.auth.signOut();
    login();
    toast(e.message, true);
    return;
  }
  stopWatch?.();
  panelShell();
  await refresh();
  stopWatch?.();
  stopWatch = watchChanges(refresh, (connected) => {
    state.connected = connected;
    const el = $("#admin-live");
    if (el)
      el.innerHTML = `<i class="${connected ? "connected" : ""}"></i><span>${connected ? "Ao vivo" : "Sincronizando"}</span>`;
  });
}
function title(kicker, title, subtitle, action = "") {
  return `<div class="admin-title"><div><span class="eyebrow dark">${kicker}</span><h1>${title}<span>.</span></h1><p>${subtitle}</p></div>${action}</div>`;
}
const filteredBookings = () =>
  state.data.bookings.filter(
    (b) =>
      dayKey(b.starts_at) >= state.from &&
      dayKey(b.starts_at) <= state.to &&
      (!state.barber || b.barber_id === state.barber),
  );
function filters() {
  return `<div class="filter-bar"><label>De<input id="from" type="date" value="${state.from}"></label><label>Até<input id="to" type="date" value="${state.to}"></label><label>Profissional<select id="filter-barber"><option value="">Todos os barbeiros</option>${state.data.barbers.map((b) => `<option value="${b.id}" ${b.id === state.barber ? "selected" : ""}>${escape(b.name)}</option>`).join("")}</select></label><button id="filter-submit" class="btn secondary small">Aplicar</button></div>`;
}
function bindFilters() {
  const apply = () => {
    try {
      const period = validateFinancialPeriod($("#from").value, $("#to").value);
      state.from = period.from;
      state.to = period.to;
      const month = currentMonthRange();
      state.followFinancialMonth =
        state.from === month.from && state.to === month.to;
      state.barber = $("#filter-barber").value;
      refresh();
    } catch (error) {
      toast(error.message, true);
    }
  };
  $("#filter-submit")?.addEventListener("click", apply);
}
function stat(label, value, foot, i = "wallet", accent = false) {
  return `<article class="stat-card ${accent ? "accent" : ""}"><div><span>${label}</span>${icon(i, 17)}</div><strong>${value}</strong><small>${foot}</small></article>`;
}
function overview() {
  const today = dayKey(),
    recent = state.recentData || { bookings: [], payments: [], expenses: [] };
  const dm = metrics(recent, today, today, state.barber),
    mm = metrics(state.data, state.from, state.to, state.barber);
  const upcoming = state.data.bookings
    .filter(
      (b) =>
        ["agendado", "confirmado"].includes(b.status) &&
        new Date(b.starts_at) > new Date(),
    )
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .slice(0, 5);
  const revenue = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(today, i - 6);
    return { day, value: metrics(recent, day, day, state.barber).received };
  });
  const max = Math.max(1, ...revenue.map((x) => x.value));
  const serviceCounts = {};
  filteredBookings()
    .filter((b) => b.status === "concluido")
    .forEach((b) =>
      b.items.forEach(
        (s) => (serviceCounts[s.name] = (serviceCounts[s.name] || 0) + 1),
      ),
    );
  $("#admin-content").innerHTML =
    title(
      "VISÃO GERAL",
      "Seu negócio, no seu ritmo",
      `${new Intl.DateTimeFormat("pt-BR", { dateStyle: "full", timeZone: "America/Sao_Paulo" }).format(new Date())}. Confira o que acontece na sua barbearia.`,
      `<button class="btn primary" id="manual">${icon("plus", 17)} Novo agendamento</button>`,
    ) +
    filters() +
    integrationStatusMarkup(state.integrations, state.data.notifications) +
    `<div class="stat-grid">${stat("Receita recebida hoje", money(dm.received), "Pagamentos menos estornos", "wallet")}${stat("Receita prevista hoje", money(dm.forecast), "Reservas ativas ainda não pagas", "calendar")}${stat("Lucro de hoje", money(dm.profit), "Receita recebida menos despesas", "trend", true)}${stat("Lucro no período", money(mm.profit), "Considera somente despesas cadastradas", "trend")}</div><div class="dashboard-grid"><section class="panel-card"><div class="panel-heading"><div><h3>Receita dos últimos 7 dias</h3><p>Pagamentos registrados, descontando estornos.</p></div><span class="tiny-label">RECEBIDA</span></div><div class="revenue-chart" role="img" aria-label="Receita recebida dos últimos sete dias">${revenue.map((x) => `<div class="chart-column"><span>${money(x.value)}</span><div class="chart-track"><div class="chart-bar ${x.day === today ? "today" : ""}" style="height:${Math.max(3, (Math.max(0, x.value) / max) * 100)}%"></div></div><small>${new Intl.DateTimeFormat("pt-BR", { weekday: "short" }).format(new Date(x.day + "T12:00:00-03:00")).replace(".", "")}</small></div>`).join("")}</div></section><section class="panel-card"><div class="panel-heading"><div><h3>Resumo do período</h3><p>${date(state.from + "T12:00:00-03:00")} até ${date(state.to + "T12:00:00-03:00")}</p></div>${icon("wallet", 22)}</div><div class="finance-row"><span>Receita prevista</span><strong>${money(mm.forecast)}</strong></div><div class="finance-row"><span>Receita recebida</span><strong>${money(mm.received)}</strong></div><div class="finance-row"><span>Despesas cadastradas</span><strong>${money(mm.spent)}</strong></div><div class="finance-row"><span>Ticket médio pago</span><strong>${money(mm.ticket)}</strong></div><div class="finance-row"><span>Cancelamentos</span><strong>${mm.cancelled}</strong></div><p class="fine-print">Reservas canceladas saem da previsão. Pagamentos só mudam quando um estorno é registrado.</p></section><section class="panel-card next-panel"><div class="panel-heading"><div><h3>Próximos atendimentos</h3><p>Seu próximo cuidado começa aqui.</p></div><button class="text-btn" id="view-bookings">Ver agenda ${icon("arrow", 14)}</button></div>${upcoming.length ? upcoming.map((b) => `<button class="appointment-row" data-detail="${b.id}"><span class="appointment-time">${time(b.starts_at)}<small>${date(b.starts_at)}</small></span><span class="avatar">${escape(b.customer_name[0])}</span><span class="appointment-customer">${escape(b.customer_name)}<small>${escape(b.items.map((s) => s.name).join(" + "))} · ${escape(b.barber_name)}</small></span>${badge(b.status)}<strong>${money(b.total)}</strong></button>`).join("") : '<div class="mini-empty">' + icon("calendar", 25) + "<p>Nenhum atendimento futuro neste período.</p></div>"}</section><section class="panel-card"><div class="panel-heading"><div><h3>Serviços realizados</h3><p>Atendimentos concluídos no período.</p></div>${icon("scissors", 20)}</div>${
      Object.keys(serviceCounts).length
        ? Object.entries(serviceCounts)
            .sort((a, b) => b[1] - a[1])
            .map(
              ([name, count]) =>
                `<div class="finance-row"><span>${escape(name)}</span><strong>${count}</strong></div>`,
            )
            .join("")
        : '<div class="mini-empty"><p>Os serviços concluídos aparecerão aqui.</p></div>'
    }<div class="today-count"><strong>${dm.count}</strong><span>agendamentos hoje<small>${dm.cancelled} cancelados</small></span></div></section></div>`;
  $("#manual").onclick = manualBooking;
  $("#view-bookings").onclick = () =>
    document.querySelector("[data-page=bookings]").click();
  bindDetails();
  bindFilters();
}
function bookingsPage({
  focusSearch = false,
  selectionStart,
  selectionEnd,
} = {}) {
  const active = document.activeElement;
  focusSearch = focusSearch || active?.id === "agenda-search";
  selectionStart ??= active?.selectionStart;
  selectionEnd ??= active?.selectionEnd;
  const root = $("#admin-content");
  root.innerHTML = agendaPageMarkup(state.data, state.agenda);
  bindAgendaControls(root, state.data, state.agenda, {
    onReload: () => {
      renderPanel();
      refresh();
    },
    onRender: bookingsPage,
    onNew: manualBooking,
    onAction: agendaAction,
  });
  if (focusSearch) {
    const input = $("#agenda-search");
    input.focus({ preventScroll: true });
    input.setSelectionRange(selectionStart, selectionEnd);
  }
}
async function agendaAction(action, b) {
  if (action === "confirm" || action === "start") {
    await actionAndRefresh("status", {
      id: b.id,
      status: action === "start" ? "em_atendimento" : "confirmado",
      expected_version: b.version,
    });
    toast(
      action === "start" ? "Atendimento iniciado." : "Agendamento confirmado.",
    );
  } else if (action === "finish") await paymentDialog(b);
  else if (action === "reschedule") rescheduleAdmin(b);
  else if (action === "remind") reminderDialog(b);
  else if (action === "cancel") cancelDialog(b);
  else bookingDetail(b);
}
function bindDetails() {
  document
    .querySelectorAll("[data-detail]")
    .forEach(
      (el) =>
        (el.onclick = () =>
          bookingDetail(
            state.data.bookings.find((b) => b.id === el.dataset.detail),
          )),
    );
}
async function actionAndRefresh(action, payload) {
  const result = await admin(action, payload);
  await refresh();
  return result;
}
async function paymentDialog(
  b,
  isRefund = false,
  onSaved = () => {},
  complete = true,
) {
  const balance =
    Math.round(
      (isRefund
        ? Number(b.paid)
        : Math.max(0, Number(b.total) - Number(b.paid))) * 100,
    ) / 100;
  if (!isRefund && balance === 0) {
    if (!complete) throw new Error("Este atendimento já está totalmente pago.");
    await actionAndRefresh("status", {
      id: b.id,
      status: "concluido",
      expected_version: b.version,
    });
    onSaved();
    toast("Atendimento concluído.");
    return;
  }
  const operationKey = crypto.randomUUID();
  formDialog(
    isRefund
      ? "Registrar devolução"
      : complete
        ? "Concluir atendimento"
        : "Receber adiantamento",
    `<div class="payment-client"><strong>${escape(b.customer_name)}</strong><p>${escape(b.items.map((s) => s.name).join(" + "))} · ${money(b.total)}</p></div><p>${isRefund ? "O estorno será descontado da receita recebida." : "Registre o valor recebido. A conclusão do atendimento é uma escolha separada."}</p><label>Valor (R$)<input name="amount" type="number" min="0.01" step="0.01" max="${balance}" value="${balance}" required></label><label>Forma de pagamento<select name="method">${["pix", "dinheiro", "debito", "credito", "outro"].map((x) => `<option value="${x}">${{ pix: "Pix", dinheiro: "Dinheiro", debito: "Débito", credito: "Crédito", outro: "Outro" }[x]}</option>`).join("")}</select></label>${!isRefund ? `<label class="checkbox-inline"><input name="complete" type="checkbox" ${complete ? "checked" : ""}> Concluir o atendimento ao registrar este pagamento</label>` : ""}`,
    async (f) => {
      await actionAndRefresh(isRefund ? "refund" : "pay", {
        id: b.id,
        amount: Number(f.get("amount")),
        method: f.get("method"),
        idempotency_key: operationKey,
        complete: f.has("complete"),
      });
      onSaved();
      toast(
        isRefund
          ? "Estorno registrado."
          : f.has("complete")
            ? "Atendimento concluído e pagamento registrado."
            : "Pagamento registrado. O atendimento continua ativo.",
      );
    },
    isRefund ? "Confirmar estorno" : "Salvar pagamento",
  );
}
function reminderDialog(b, onSaved = () => {}) {
  if (state.integrations?.whatsapp?.configured === false) {
    modal(
      "WhatsApp ainda não configurado",
      integrationStatusMarkup(state.integrations, state.data.notifications),
    );
    return;
  }
  modal(
    "Enviar lembrete ao cliente?",
    `<p>${escape(b.customer_name)}, lembramos do seu atendimento na ${escape(getBranding().shop_name)} em ${date(b.starts_at)} às ${time(b.starts_at)}. Serviços: ${escape(b.items.map((s) => s.name).join(" + "))}. Profissional: ${escape(b.barber_name)}. Acesse Meus agendamentos no dispositivo da reserva.</p><p class="fine-print">${b.reminder_consent ? "O cliente autorizou lembretes pelo WhatsApp." : "O cliente não autorizou lembretes. O envio será bloqueado."}</p>`,
    {
      confirm: "Solicitar envio",
      onConfirm: async () => {
        await actionAndRefresh("remind", { id: b.id });
        onSaved();
        toast("Lembrete solicitado. Consulte o status nas notificações.");
      },
    },
  );
}
function cancelDialog(b, onSaved = () => {}) {
  formDialog(
    "Cancelar este atendimento",
    `<p>${escape(b.customer_name)} · ${date(b.starts_at)} às ${time(b.starts_at)}.</p><p>O horário será liberado. Pagamentos já recebidos serão preservados.</p><label>Motivo (opcional)<textarea name="reason" maxlength="500"></textarea></label>`,
    async (f) => {
      await actionAndRefresh("cancel", { id: b.id, reason: f.get("reason") });
      onSaved();
      toast("Atendimento cancelado.");
    },
    "Confirmar cancelamento",
  );
}
function bookingDetail(b) {
  if (!b) return;
  const active = ["agendado", "confirmado"].includes(b.status),
    notes = state.data.notifications.filter((n) => n.booking_id === b.id);
  const dialog = modal(
    "Gerenciar atendimento",
    `<div class="detail-status">${badge(b.status)}<span>#${escape(b.id.slice(0, 8).toUpperCase())}</span></div>${bookingSummary(b)}<div class="summary-line"><span>Já recebido</span><strong>${money(b.paid)}</strong></div><div class="detail-actions">${b.status === "agendado" ? '<button class="btn secondary small" data-action="status">Confirmar</button>' : ""}${b.status === "confirmado" && dayKey(b.starts_at) === dayKey() ? '<button class="btn primary small" data-action="start">Iniciar atendimento</button>' : ""}${canFinishBooking(b) ? `<button class="btn primary small" data-action="pay">${b.status === "concluido" ? "Receber saldo" : Number(b.paid) >= Number(b.total) ? "Concluir atendimento" : "Concluir e registrar pagamento"}</button>` : ""}${["agendado", "confirmado", "em_atendimento"].includes(b.status) && Number(b.paid) < Number(b.total) ? '<button class="btn secondary small" data-action="deposit">Receber adiantamento</button>' : ""}${["agendado", "confirmado", "em_atendimento"].includes(b.status) && additionalBookingMinutes(b.items) > 0 && !b.extra_block ? '<button class="btn secondary small" data-action="reserve-extra">Bloquear tempo adicional</button>' : ""}${Number(b.paid) > 0 ? '<button class="btn secondary small" data-action="refund">Registrar estorno</button>' : ""}${active ? '<button class="btn secondary small" data-action="reschedule">Reagendar</button><button class="btn secondary small" data-action="remind">Enviar lembrete</button><button class="btn secondary small" data-action="no-show">Não compareceu</button>' : ""}${active || ["em_atendimento", "concluido"].includes(b.status) ? '<button class="text-btn danger" data-action="cancel">Cancelar atendimento</button>' : ""}<a class="btn secondary small" href="https://wa.me/${escape(b.customer_phone)}" target="_blank" rel="noopener noreferrer">Abrir WhatsApp</a></div><h3 class="subheading">Histórico de notificações</h3>${notes.length ? notes.map((n) => `<div class="notification-item"><span>${n.kind === "reminder" ? "Lembrete ao cliente" : "Atualização ao barbeiro"}<small>${date(n.created_at)} · ${time(n.created_at)}</small>${n.last_error ? `<small class="danger">${escape(n.last_error)}</small>` : ""}</span><span class="badge ${escape(n.status)}">${notificationNames[n.status]}</span></div>`).join("") : '<p class="fine-print">Nenhuma notificação registrada.</p>'}<p class="fine-print">Cancelamento preserva o pagamento. Se houver devolução, registre um estorno separado.</p>`,
    { wide: true },
  );
  const done = () => {
    dialog.close();
    dialog.remove();
  };
  dialog.querySelectorAll("[data-action]").forEach(
    (el) =>
      (el.onclick = async () => {
        const action = el.dataset.action;
        if (action === "reserve-extra") {
          done();
          modal(
            "Bloquear tempo adicional?",
            `<p>A previsão dos serviços exige ${additionalBookingMinutes(b.items)} minutos adicionais após a reserva de uma hora. O bloqueio será criado somente se o período estiver livre e dentro do expediente. Cancelar ou reagendar libera esse bloqueio.</p>`,
            {
              confirm: "Bloquear tempo adicional",
              onConfirm: async () => {
                await actionAndRefresh("reserve_extra", { id: b.id });
                toast("Tempo adicional bloqueado.");
              },
            },
          );
        } else if (
          action === "pay" ||
          action === "refund" ||
          action === "deposit"
        ) {
          done();
          try {
            await paymentDialog(
              b,
              action === "refund",
              () => {},
              action !== "deposit",
            );
          } catch (error) {
            toast(error.message, true);
          }
        } else if (action === "reschedule") {
          done();
          rescheduleAdmin(b);
        } else if (action === "remind") {
          done();
          reminderDialog(b);
        } else if (action === "cancel") {
          done();
          cancelDialog(b);
        } else {
          modal(
            action === "no-show"
              ? "Registrar ausência?"
              : action === "start"
                ? "Iniciar atendimento?"
                : "Confirmar atendimento?",
            "<p>Essa mudança será registrada no histórico da barbearia.</p>",
            {
              onConfirm: async () => {
                await actionAndRefresh("status", {
                  id: b.id,
                  status:
                    action === "no-show"
                      ? "nao_compareceu"
                      : action === "start"
                        ? "em_atendimento"
                        : "confirmado",
                  expected_version: b.version,
                });
                done();
                toast("Status atualizado.");
              },
            },
          );
        }
      }),
  );
}
function formDialog(title, fields, onSave, label = "Salvar") {
  const dialog = modal(title, `<form class="admin-form">${fields}</form>`, {
    confirm: label,
    onConfirm: async (d) => {
      const form = d.querySelector("form");
      if (!form.reportValidity())
        throw new Error("Confira os campos destacados.");
      await onSave(new FormData(form), form);
    },
  });
  return dialog;
}
function manualBooking(preset = {}) {
  const today = dayKey();
  const selectedDay =
    preset.day && preset.day >= dayKey() && preset.day <= addDays(dayKey(), 180)
      ? preset.day
      : dayKey();
  const services = state.data.services.filter((s) => s.active),
    barbers = state.data.barbers.filter((b) => b.active),
    operationKey = crypto.randomUUID();
  const d = formDialog(
    "Criar agendamento manual",
    `<div class="form-row"><label>Nome do cliente<input name="name" required minlength="2" maxlength="100"></label><label>Celular com DDD<input name="phone" inputmode="tel" required placeholder="(15) 99999-9999"></label></div><label>Serviços</label><div class="checkbox-grid">${services.map((s) => `<label><input name="services" type="checkbox" value="${s.id}"><span>${escape(s.name)} · ${money(s.price)}</span></label>`).join("")}</div><div class="form-row"><label>Barbeiro<select name="barber_id">${barbers.map((b) => `<option value="${b.id}" ${b.id === preset.barber_id ? "selected" : ""}>${escape(b.name)}</option>`).join("")}</select></label><label>Data<input name="day" type="date" min="${today}" max="${addDays(today, 180)}" value="${selectedDay}" required></label></div><button class="btn secondary small" type="button" id="manual-slots-load">Consultar horários</button><div id="manual-slots" class="slot-grid"></div><input name="start" type="hidden"><label class="checkbox-inline"><input name="consent" type="checkbox"> O cliente autorizou lembretes pelo WhatsApp</label>`,
    async (f) => {
      if (!f.get("start")) throw new Error("Consulte e selecione um horário.");
      await actionAndRefresh("book", {
        name: f.get("name"),
        phone: normalizePhone(f.get("phone")),
        services: f.getAll("services"),
        barber_id: f.get("barber_id"),
        start: f.get("start"),
        consent: f.has("consent"),
        idempotency_key: operationKey,
      });
      toast("Agendamento manual confirmado.");
    },
    "Confirmar agendamento",
  );
  const form = d.querySelector("form"),
    loadButton = d.querySelector("#manual-slots-load"),
    loadLabel = loadButton.innerHTML;
  let generation = 0;
  form
    .querySelectorAll("[name=services],[name=barber_id],[name=day]")
    .forEach((el) =>
      el.addEventListener("change", () => {
        generation++;
        form.elements.start.value = "";
        d.querySelector("#manual-slots").innerHTML = "";
        if (form.querySelector("[name=services]:checked")) loadSlots();
        else {
          loadButton.disabled = false;
          loadButton.innerHTML = loadLabel;
        }
      }),
    );
  form.elements.phone.addEventListener(
    "input",
    (e) => (e.target.value = phoneMask(e.target.value)),
  );
  async function loadSlots() {
    const f = new FormData(form);
    if (!f.getAll("services").length)
      return toast("Selecione pelo menos um serviço.", true);
    const n = ++generation;
    loadButton.disabled = true;
    loadButton.innerHTML = "Consultando…";
    try {
      const slots = await admin("slots", {
        services: f.getAll("services"),
        barber_id: f.get("barber_id"),
        day: f.get("day"),
      });
      if (n !== generation || !d.isConnected) return;
      const el = d.querySelector("#manual-slots");
      el.innerHTML = slots.length
        ? slots
            .map(
              (s) =>
                `<button type="button" class="slot" data-time="${escape(s.start)}">${time(s.start)}–${time(s.end)}</button>`,
            )
            .join("")
        : "<p>Nenhum horário disponível.</p>";
      el.querySelectorAll("button").forEach(
        (b) =>
          (b.onclick = () => {
            form.elements.start.value = b.dataset.time;
            el.querySelectorAll("button").forEach((x) =>
              x.classList.toggle("selected", x === b),
            );
          }),
      );
      if (preset.start) {
        const preferred = [...el.querySelectorAll("button")].find(
          (x) =>
            new Date(x.dataset.time).getTime() ===
            new Date(preset.start).getTime(),
        );
        if (preferred) preferred.click();
      }
    } catch (err) {
      if (n === generation) toast(err.message, true);
    } finally {
      if (n === generation) {
        loadButton.disabled = false;
        loadButton.innerHTML = loadLabel;
      }
    }
  }
  loadButton.onclick = loadSlots;
}
function rescheduleAdmin(b) {
  const today = dayKey();
  const d = formDialog(
    "Reagendar atendimento",
    `<p>O agendamento original só será liberado após a nova reserva ser confirmada.</p><label>Barbeiro<select name="barber_id">${state.data.barbers
      .filter((x) => x.active)
      .map(
        (x) =>
          `<option value="${x.id}" ${x.id === b.barber_id ? "selected" : ""}>${escape(x.name)}</option>`,
      )
      .join(
        "",
      )}</select></label><label>Nova data<input name="day" type="date" min="${today}" value="${dayKey(b.starts_at)}" max="${addDays(today, 180)}" required></label><div class="slot-grid" id="new-slots"></div><input name="start" type="hidden">`,
    async (f) => {
      if (!f.get("start")) throw new Error("Escolha o novo horário.");
      await actionAndRefresh("reschedule", {
        id: b.id,
        start: f.get("start"),
        barber_id: f.get("barber_id"),
      });
      toast("Agendamento atualizado.");
    },
    "Confirmar novo horário",
  );
  const form = d.querySelector("form");
  let request = 0;
  const load = async () => {
    const n = ++request;
    form.elements.start.value = "";
    const el = d.querySelector("#new-slots");
    el.innerHTML = "<p>Consultando horários…</p>";
    try {
      const slots = await admin("slots", {
        booking_id: b.id,
        barber_id: form.elements.barber_id.value,
        day: form.elements.day.value,
      });
      if (n !== request) return;
      el.innerHTML =
        slots
          .map(
            (s) =>
              `<button class="slot" type="button" data-time="${escape(s.start)}">${time(s.start)}–${time(s.end)}</button>`,
          )
          .join("") || "<p>Nenhum horário disponível.</p>";
      el.querySelectorAll("button").forEach(
        (x) =>
          (x.onclick = () => {
            form.elements.start.value = x.dataset.time;
            el.querySelectorAll("button").forEach((y) =>
              y.classList.toggle("selected", y === x),
            );
          }),
      );
    } catch (e) {
      el.textContent = e.message;
    }
  };
  form.elements.barber_id.onchange = load;
  form.elements.day.onchange = load;
  load();
}
function barbersPage() {
  $("#admin-content").innerHTML =
    title(
      "SEUS PROFISSIONAIS",
      "Talento que faz a diferença",
      "Cada barbeiro tem sua própria agenda e seus serviços.",
      `<button id="new-barber" class="btn primary">${icon("plus", 17)} Cadastrar barbeiro</button>`,
    ) +
    `<div class="manage-grid">${state.data.barbers
      .map(
        (b) =>
          `<article class="manage-card"><div class="manage-card-top">${profileAvatar(b, "large")}<span class="badge ${b.active ? "confirmado" : "cancelado"}">${b.active ? "Ativo" : "Inativo"}</span></div><h3>${escape(b.name)}</h3><p>${escape(phoneMask(b.phone || ""))}</p><div class="manage-services">${state.data.barber_services
            .filter((x) => x.barber_id === b.id)
            .map(
              (x) =>
                `<span>${escape(state.data.services.find((s) => s.id === x.service_id)?.name)}</span>`,
            )
            .join(
              "",
            )}</div><p class="fine-print">${state.data.hours.filter((h) => h.barber_id === b.id).length} dias de funcionamento por semana</p><button class="btn secondary full" data-edit-barber="${b.id}">Editar profissional ${icon("arrow", 15)}</button></article>`,
      )
      .join("")}</div>`;
  $("#new-barber").onclick = () => editBarber();
  document
    .querySelectorAll("[data-edit-barber]")
    .forEach(
      (el) =>
        (el.onclick = () =>
          editBarber(
            state.data.barbers.find((b) => b.id === el.dataset.editBarber),
          )),
    );
}
function editBarber(b = {}) {
  const weekdays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  formDialog(
    b.id ? "Editar profissional" : "Cadastrar profissional",
    `<div class="form-row"><label>Nome<input name="name" required minlength="2" maxlength="100" value="${escape(b.name)}"></label><label>Celular para notificações<input name="phone" required inputmode="tel" value="${escape(phoneMask(b.phone || ""))}"></label></div><label>URL da foto (opcional)<input name="photo_url" type="url" placeholder="https://..." value="${escape(b.photo_url)}"></label><label class="checkbox-inline"><input name="active" type="checkbox" ${b.active !== false ? "checked" : ""}> Profissional ativo</label><label>Serviços realizados</label><div class="checkbox-grid">${state.data.services.map((s) => `<label><input name="services" type="checkbox" value="${s.id}" ${!b.id || state.data.barber_services.some((x) => x.barber_id === b.id && x.service_id === s.id) ? "checked" : ""}><span>${escape(s.name)}</span></label>`).join("")}</div><h3 class="subheading">Horários da semana</h3><p class="fine-print">Todos os agendamentos reservam 1 hora, independentemente dos serviços. Desmarque os dias fechados.</p><div class="hours-editor">${weekdays
      .map((day, i) => {
        const h = state.data.hours.find(
          (h) => h.barber_id === b.id && h.weekday === i,
        );
        return `<div class="hours-row"><label><input type="checkbox" name="day_${i}" ${h || (!b.id && i > 0) ? "checked" : ""}>${day}</label><input aria-label="Abertura ${day}" type="time" name="open_${i}" value="${h?.opens.slice(0, 5) || "09:00"}"><input aria-label="Fechamento ${day}" type="time" name="close_${i}" value="${h?.closes.slice(0, 5) || "19:00"}"><input aria-label="Início almoço ${day}" type="time" name="lunch_start_${i}" value="${h?.lunch_start?.slice(0, 5) || "12:00"}"><input aria-label="Fim almoço ${day}" type="time" name="lunch_end_${i}" value="${h?.lunch_end?.slice(0, 5) || "13:00"}"><input aria-label="Intervalo ${day}" type="number" min="60" max="60" name="slot_${i}" value="60" readonly></div>`;
      })
      .join(
        "",
      )}</div><p class="fine-print">Alterações não movem reservas existentes. Resolva reservas afetadas antes de desativar o barbeiro.</p>`,
    async (f) => {
      await actionAndRefresh("save_barber", {
        id: b.id || null,
        name: f.get("name"),
        phone: normalizePhone(f.get("phone")),
        photo_url: f.get("photo_url"),
        active: f.has("active"),
        services: f.getAll("services"),
        hours: weekdays.flatMap((_, i) =>
          f.has(`day_${i}`)
            ? [
                {
                  weekday: i,
                  opens: f.get(`open_${i}`),
                  closes: f.get(`close_${i}`),
                  lunch_start: f.get(`lunch_start_${i}`),
                  lunch_end: f.get(`lunch_end_${i}`),
                  slot_minutes: Number(f.get(`slot_${i}`)),
                },
              ]
            : [],
        ),
      });
      toast("Profissional salvo.");
    },
  );
}
function servicesPage() {
  $("#admin-content").innerHTML =
    title(
      "SEU CATÁLOGO",
      "Cuidado em cada serviço",
      "Preços e durações atualizados, com o histórico preservado.",
      `<button class="btn primary" id="new-service">${icon("plus", 17)} Cadastrar serviço</button>`,
    ) +
    `<div class="manage-grid">${state.data.services.map((s) => `<article class="manage-card"><div class="manage-card-top"><span class="service-icon">${icon("scissors", 27)}</span><span class="badge ${s.active ? "confirmado" : "cancelado"}">${s.active ? "Ativo" : "Inativo"}</span></div><h3>${escape(s.name)}</h3><p>${escape(s.description) || "Sem descrição."}</p><div class="service-price"><strong>${money(s.price)}</strong><span>${s.duration} min</span></div><button class="btn secondary full" data-edit-service="${s.id}">Editar serviço ${icon("arrow", 15)}</button></article>`).join("")}</div><p class="fine-print spaced">A duração dos serviços é apenas uma previsão. Cada agendamento reserva sempre 1 hora, mesmo com vários serviços.</p>`;
  $("#new-service").onclick = () => editService();
  document
    .querySelectorAll("[data-edit-service]")
    .forEach(
      (el) =>
        (el.onclick = () =>
          editService(
            state.data.services.find((s) => s.id === el.dataset.editService),
          )),
    );
}
function editService(s = {}) {
  formDialog(
    s.id ? "Editar serviço" : "Cadastrar serviço",
    `<label>Nome<input name="name" required minlength="2" maxlength="100" value="${escape(s.name)}"></label><label>Descrição<textarea name="description" maxlength="500">${escape(s.description)}</textarea></label><div class="form-row"><label>Preço (R$)<input name="price" type="number" required min="0" step="0.01" value="${s.price ?? 35}"></label><label>Previsão do serviço (minutos)<input name="duration" type="number" required min="5" max="480" value="${s.duration || 40}"></label></div><label class="checkbox-inline"><input name="active" type="checkbox" ${s.active !== false ? "checked" : ""}> Serviço ativo</label><label>Profissionais habilitados</label><div class="checkbox-grid">${state.data.barbers.map((b) => `<label><input type="checkbox" name="barbers" value="${b.id}" ${!s.id || state.data.barber_services.some((x) => x.service_id === s.id && x.barber_id === b.id) ? "checked" : ""}>${escape(b.name)}</label>`).join("")}</div>`,
    async (f) => {
      await actionAndRefresh("save_service", {
        id: s.id || null,
        name: f.get("name"),
        description: f.get("description"),
        price: Number(f.get("price")),
        duration: Number(f.get("duration")),
        active: f.has("active"),
        barbers: f.getAll("barbers"),
      });
      toast(
        "Serviço salvo. Reservas existentes mantiveram os valores originais.",
      );
    },
  );
}
function expensesPage() {
  const today = dayKey();
  const expenses = state.data.expenses.filter(
    (e) => e.day >= state.from && e.day <= state.to,
  );
  $("#admin-content").innerHTML =
    title(
      "GESTÃO FINANCEIRA",
      "Seu lucro começa na organização",
      "Registre despesas para acompanhar o resultado real.",
      `<button id="new-expense" class="btn primary">${icon("plus", 17)} Registrar despesa</button>`,
    ) +
    filters() +
    `<section class="panel-card"><div class="panel-heading"><h3>Despesas do período</h3><strong>${money(expenses.reduce((s, e) => s + Number(e.amount), 0))}</strong></div>${expenses.length ? `<div class="table-scroll"><table><thead><tr><th>Descrição</th><th>Data</th><th>Profissional</th><th>Valor</th></tr></thead><tbody>${expenses.map((e) => `<tr><td>${escape(e.description)}</td><td>${date(e.day + "T12:00:00-03:00")}</td><td>${escape(state.data.barbers.find((b) => b.id === e.barber_id)?.name || "Barbearia")}</td><td><strong>${money(e.amount)}</strong></td></tr>`).join("")}</tbody></table></div>` : '<div class="mini-empty"><p>Nenhuma despesa cadastrada neste período.</p></div>'}</section><p class="fine-print spaced">O lucro exibido considera somente as despesas que você registrou.</p>`;
  bindFilters();
  $("#new-expense").onclick = () =>
    formDialog(
      "Registrar despesa",
      `<label>Descrição<input name="description" required minlength="2" maxlength="200" placeholder="Ex.: materiais de trabalho"></label><div class="form-row"><label>Valor (R$)<input name="amount" type="number" min="0.01" step="0.01" required></label><label>Data<input name="day" type="date" value="${today}" required></label></div><label>Profissional (opcional)<select name="barber_id"><option value="">Despesa da barbearia</option>${state.data.barbers.map((b) => `<option value="${b.id}">${escape(b.name)}</option>`).join("")}</select></label>`,
      async (f) => {
        await actionAndRefresh("expense", {
          description: f.get("description"),
          amount: Number(f.get("amount")),
          day: f.get("day"),
          barber_id: f.get("barber_id"),
        });
        toast("Despesa registrada.");
      },
    );
}
function notificationsPage() {
  const n = state.data.notifications,
    info = state.notificationInfo || {
      total: n.length,
      page: 0,
      page_size: 50,
    };
  $("#admin-content").innerHTML =
    title(
      "COMUNICAÇÃO",
      "Cada mensagem, acompanhada",
      "Consulte os estados reais de envio e entrega.",
    ) +
    integrationStatusMarkup(state.integrations, state.data.notifications) +
    `<div class="notification-info">${icon("bell", 22)}<p>Mensagens pendentes permanecem na fila. O envio exige que o WhatsApp Business esteja configurado. “Verificar envio” indica uma resposta ambígua do provedor, que precisa ser conferida antes de repetir.</p></div><section class="panel-card"><div class="panel-heading"><h3>Últimos 30 dias</h3><span class="tiny-label">${info.total} REGISTROS · PÁGINA ${info.page + 1}</span></div>${n.length ? `<div class="table-scroll"><table><thead><tr><th>Mensagem</th><th>Destinatário</th><th>Status</th><th>Tentativas</th><th>Última atualização / erro</th></tr></thead><tbody>${n.map((x) => `<tr><td>${x.kind === "reminder" ? "Lembrete ao cliente" : "Atualização ao barbeiro"}<small>#${escape(x.booking_id.slice(0, 8))}</small></td><td>${escape(phoneMask(x.recipient))}</td><td><span class="badge ${escape(x.status)}">${notificationNames[x.status]}</span></td><td>${x.attempts}</td><td>${date(x.updated_at)} · ${time(x.updated_at)}${x.last_error ? `<small class="danger">${escape(x.last_error)}</small>` : ""}</td></tr>`).join("")}</tbody></table></div>` : '<div class="mini-empty"><p>Ainda não há notificações na fila.</p></div>'}</section><div class="notification-pagination"><button class="btn secondary small" id="notifications-prev" ${info.page === 0 ? "disabled" : ""}>Página anterior</button><button class="btn secondary small" id="notifications-next" ${(info.page + 1) * info.page_size >= info.total ? "disabled" : ""}>Próxima página</button></div>`;
  $("#notifications-prev").onclick = () => {
    state.notificationPage--;
    refresh();
  };
  $("#notifications-next").onclick = () => {
    state.notificationPage++;
    refresh();
  };
}
function settingsPage() {
  const today = dayKey();
  $("#admin-content").innerHTML =
    title(
      "SUA BARBEARIA",
      "Seu sistema, do seu jeito",
      "Personalize a marca e ajuste as regras da agenda.",
    ) +
    integrationStatusMarkup(state.integrations, state.data.notifications) +
    `<div class="settings-grid">${brandingSettingsMarkup(state.data.settings)}${heroSettingsMarkup(state.data.settings)}${whatsappSettingsMarkup(state.integrations)}${securitySettingsMarkup()}<section class="panel-card"><div class="panel-heading"><div><h3>Bloqueios da agenda</h3><p>Indisponibilidade por profissional.</p></div><button class="btn secondary small" id="new-block">${icon("plus", 14)} Adicionar</button></div>${state.data.blocks.map((b) => `<div class="settings-list"><span>${escape(b.reason)}<small>${escape(state.data.barbers.find((x) => x.id === b.barber_id)?.name)} · ${date(b.starts_at)} ${time(b.starts_at)}–${time(b.ends_at)}</small></span><button class="text-btn danger" data-delete-block="${b.id}">Remover</button></div>`).join("") || '<p class="fine-print">Nenhum bloqueio cadastrado.</p>'}</section><section class="panel-card special-panel"><div class="panel-heading"><div><h3>Feriados, folgas e horários especiais</h3><p>As regras deste dia substituem o funcionamento semanal.</p></div><button class="btn secondary small" id="new-special">${icon("plus", 14)} Adicionar data</button></div>${state.data.special_hours.map((s) => `<div class="settings-list"><span>${date(s.day + "T12:00:00-03:00")} · ${escape(state.data.barbers.find((b) => b.id === s.barber_id)?.name)}<small>${s.closed ? "Fechado" : `${s.opens.slice(0, 5)}–${s.closes.slice(0, 5)}`}</small></span><button class="text-btn danger" data-delete-special="${s.id}">Remover</button></div>`).join("") || '<p class="fine-print">Cadastre os feriados e as folgas que a barbearia vai respeitar.</p>'}</section></div>`;
  bindSecuritySettings({
    exportData: exportOperationalData,
    onChanged: refresh,
  });
  $("#connect-whatsapp").onclick = connectWhatsApp;
  $("#toggle-whatsapp")?.addEventListener("click", async (e) => {
    try {
      await busy(
        e.currentTarget,
        (async () => {
          state.integrations = await admin("whatsapp_automation", {
            enabled: state.integrations.whatsapp.automatic_enabled === false,
          });
          await refresh();
          toast(
            state.integrations.whatsapp.automatic_enabled
              ? "Lembretes automáticos ativados."
              : "Lembretes automáticos pausados.",
          );
        })(),
      );
    } catch (error) {
      toast(error.message, true);
    }
  });
  const callbacks = (key) => ({
    onDirty: (value) =>
      value ? settingsDirty.add(key) : settingsDirty.delete(key),
    onSaved: refresh,
  });
  const disposeBranding = bindBrandingSettings(
      state.data.settings,
      callbacks("branding"),
    ),
    disposeHero = bindHeroSettings(state.data.settings, callbacks("hero"));
  disposeSettingsEditors = () => {
    disposeBranding();
    disposeHero();
  };
  const barberSelect = `<label>Barbeiro<select name="barber_id">${state.data.barbers
    .filter((b) => b.active)
    .map((b) => `<option value="${b.id}">${escape(b.name)}</option>`)
    .join("")}</select></label>`;
  $("#new-block").onclick = () =>
    formDialog(
      "Bloquear um intervalo",
      barberSelect +
        `<label>Data<input name="day" type="date" value="${today}" required></label><div class="form-row"><label>Início<input name="start" type="time" value="09:00" required></label><label>Fim<input name="end" type="time" value="10:00" required></label></div><label>Motivo<input name="reason" value="Indisponível" maxlength="100" required></label>`,
      async (f) => {
        await actionAndRefresh("block", {
          barber_id: f.get("barber_id"),
          start: localInstant(f.get("day"), f.get("start")),
          end: localInstant(f.get("day"), f.get("end")),
          reason: f.get("reason"),
        });
        toast("Intervalo bloqueado.");
      },
    );
  $("#new-special").onclick = () =>
    formDialog(
      "Cadastrar horário especial",
      barberSelect +
        `<label>Data<input name="day" type="date" value="${today}" required></label><label class="checkbox-inline"><input name="closed" type="checkbox" checked> Dia fechado (feriado ou folga)</label><div class="form-row"><label>Abertura<input name="opens" type="time" value="09:00"></label><label>Fechamento<input name="closes" type="time" value="19:00"></label></div><div class="form-row"><label>Início do almoço<input name="lunch_start" type="time" value="12:00"></label><label>Fim do almoço<input name="lunch_end" type="time" value="13:00"></label></div><label>Intervalo fixo (60 minutos)<input name="slot_minutes" type="number" value="60" min="60" max="60" readonly></label>`,
      async (f) => {
        await actionAndRefresh("special_hours", {
          barber_id: f.get("barber_id"),
          day: f.get("day"),
          closed: f.has("closed"),
          opens: f.get("opens"),
          closes: f.get("closes"),
          lunch_start: f.get("lunch_start"),
          lunch_end: f.get("lunch_end"),
          slot_minutes: Number(f.get("slot_minutes")),
        });
        toast("Data especial salva.");
      },
    );
  document
    .querySelectorAll("[data-delete-block],[data-delete-special]")
    .forEach(
      (el) =>
        (el.onclick = () =>
          modal(
            "Remover esta regra?",
            `<p>O intervalo voltará a seguir o funcionamento padrão.</p>`,
            {
              onConfirm: async () => {
                await actionAndRefresh(
                  el.dataset.deleteBlock ? "delete_block" : "delete_special",
                  { id: el.dataset.deleteBlock || el.dataset.deleteSpecial },
                );
                toast("Regra removida.");
              },
            },
          )),
    );
}
async function exportOperationalData() {
  const data = await admin("admin_export"),
    blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json;charset=utf-8",
    }),
    url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = `registros-barbearia-${dayKey()}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Registros preparados para download.");
}
function connectWhatsApp() {
  formDialog(
    "Conectar WhatsApp Business",
    whatsappConnectionFields(state.integrations),
    async (f) => {
      const payload = Object.fromEntries(f.entries());
      payload.automatic_enabled = f.has("automatic_enabled");
      state.integrations = await admin("whatsapp_connect", payload);
      toast(
        payload.automatic_enabled
          ? "Conexão validada. Lembretes automáticos ativados."
          : "Conexão validada. Lembretes automáticos pausados.",
      );
      await refresh();
    },
    "Conectar e ativar",
  );
}
function renderPanel() {
  if (!state.data) return;
  disposeSettingsEditors?.();
  disposeSettingsEditors = null;
  if (dataSource !== JSON.stringify(adminDataRequest())) {
    $("#admin-content").innerHTML =
      '<div class="skeleton-line"></div><div class="skeleton-line short"></div><p class="fine-print">Atualizando sua agenda…</p>';
    return;
  }
  ({
    overview,
    bookings: bookingsPage,
    barbers: barbersPage,
    services: servicesPage,
    expenses: expensesPage,
    notifications: notificationsPage,
    settings: settingsPage,
  })[state.page]();
}
initBranding();
api("catalog")
  .then(applyBranding)
  .catch(() => {});
auth.auth.onAuthStateChange((event) => {
  if (event === "PASSWORD_RECOVERY") {
    loginMode = "recovery";
    login();
  } else if (event === "SIGNED_OUT" && $("#admin-content")) {
    loginMode = "login";
    login();
  }
});
if (location.hash.includes("type=recovery")) {
  loginMode = "recovery";
  login();
} else openPanel();
