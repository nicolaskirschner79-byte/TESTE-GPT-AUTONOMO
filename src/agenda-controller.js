import { addDays, dayKey } from './utils.js';
import { busy, toast } from './ui.js';

export function bindAgendaControls(root, data, filters, { onReload, onRender, onNew, onAction }) {
  const resetScroll = () => { filters.scrollTop = 0; filters.scrollLeft = 0; };
  const chooseDay = (day, view = filters.view) => { filters.day = day; filters.followToday = day === dayKey(); filters.view = view; filters.selected = ''; resetScroll(); onReload(); };
  root.querySelectorAll('[data-agenda-shift]').forEach(button => button.onclick = () => chooseDay(addDays(filters.day, Number(button.dataset.agendaShift) * (filters.view === 'week' ? 7 : 1))));
  root.querySelector('[data-agenda-today]').onclick = () => chooseDay(dayKey());
  root.querySelector('#agenda-date').onchange = event => { if (event.target.value) chooseDay(event.target.value); };
  root.querySelectorAll('[data-agenda-view]').forEach(button => button.onclick = () => { filters.view = button.dataset.agendaView; filters.selected = ''; resetScroll(); onReload(); });
  root.querySelectorAll('[data-agenda-day]').forEach(button => button.onclick = () => chooseDay(button.dataset.agendaDay, 'day'));
  root.querySelector('#agenda-search').oninput = event => {
    filters.search = event.target.value; filters.selected = '';
    onRender({ focusSearch: true, selectionStart: event.target.selectionStart, selectionEnd: event.target.selectionEnd });
  };
  root.querySelector('#agenda-status').onchange = event => { filters.status = event.target.value; filters.selected = ''; onRender(); };
  root.querySelector('[data-agenda-free-toggle]').onclick = () => { filters.showFree = !filters.showFree; onRender(); root.querySelector('[data-agenda-free-toggle]').focus({ preventScroll: true }); };
  const barber = root.querySelector('#agenda-barber');
  if (barber) barber.onchange = event => { filters.barber = event.target.value; filters.selected = ''; resetScroll(); onReload(); };
  root.querySelectorAll('[data-agenda-select]').forEach(button => button.onclick = () => {
    filters.selected = button.dataset.agendaSelect;
    const booking = data.bookings.find(b => b.id === filters.selected);
    onRender();
    root.querySelectorAll('[data-agenda-select]').forEach(el => { if (el.dataset.agendaSelect === filters.selected) el.focus({ preventScroll: true }); });
    if (booking) Promise.resolve(onAction('details', booking)).catch(error => toast(error.message, true));
  });
  root.querySelector('[data-agenda-clear]')?.addEventListener('click', () => { filters.selected = ''; onRender(); });
  root.querySelectorAll('[data-agenda-new]').forEach(button => button.onclick = () => onNew({ day: filters.day, barber_id: filters.barber }));
  root.querySelectorAll('[data-agenda-slot]').forEach(button => button.onclick = () => onNew({ day: filters.day, barber_id: button.dataset.barber, start: button.dataset.agendaSlot }));
  const pending = new Set();
  root.querySelectorAll('[data-agenda-action]').forEach(button => button.onclick = async () => {
    const id = button.dataset.booking, booking = data.bookings.find(b => b.id === id);
    if (!booking || pending.has(id)) return;
    pending.add(id);
    try { await busy(button, Promise.resolve(onAction(button.dataset.agendaAction, booking))); }
    catch (error) { toast(error.message, true); }
    finally { pending.delete(id); }
  });
  const scroll = root.querySelector('.agenda-calendar-scroll');
  if (scroll) {
    scroll.scrollTop = filters.scrollTop || 0; scroll.scrollLeft = filters.scrollLeft || 0;
    scroll.addEventListener('scroll', () => { filters.scrollTop = scroll.scrollTop; filters.scrollLeft = scroll.scrollLeft; }, { passive: true });
  }
}
