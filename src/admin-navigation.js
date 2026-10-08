// The same navigation becomes a drawer on tablets and small screens.
export function bindAdminNavigation() {
  const sidebar = document.querySelector("#admin-navigation");
  const main = document.querySelector(".admin-main");
  const trigger = document.querySelector("#menu");
  const closeButton = document.querySelector("#close-menu");
  const backdrop = document.querySelector("#menu-backdrop");
  const compact = window.matchMedia("(max-width: 1024px)");
  let open = false;
  let previousOverflow = null;

  function close({ restoreFocus = true } = {}) {
    const wasOpen = open;
    open = false;
    sidebar.classList.remove("open");
    sidebar.inert = compact.matches;
    sidebar.removeAttribute("aria-modal");
    sidebar.removeAttribute("role");
    main.inert = false;
    backdrop.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    if (previousOverflow !== null) {
      document.body.style.overflow = previousOverflow;
      previousOverflow = null;
    }
    if (wasOpen && restoreFocus && compact.matches) trigger.focus();
  }

  function show() {
    if (!compact.matches) return;
    open = true;
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    sidebar.inert = false;
    sidebar.classList.add("open");
    sidebar.setAttribute("role", "dialog");
    sidebar.setAttribute("aria-modal", "true");
    main.inert = true;
    backdrop.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    closeButton.focus();
  }

  function keydown(event) {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") {
      const controls = [
        ...sidebar.querySelectorAll("a[href], button:not(:disabled)"),
      ].filter((element) => element.getClientRects().length);
      const first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  const change = () => close();
  trigger.onclick = () => (open ? close() : show());
  closeButton.onclick = () => close();
  backdrop.onclick = () => close();
  compact.addEventListener("change", change);
  document.addEventListener("keydown", keydown);
  close({ restoreFocus: false });
  return {
    close,
    destroy() {
      close({ restoreFocus: false });
      compact.removeEventListener("change", change);
      document.removeEventListener("keydown", keydown);
    },
  };
}
