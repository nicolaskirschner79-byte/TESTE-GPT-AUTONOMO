import { addDays, dayKey, localInstant, TIMEZONE } from './utils.js';

export const PENDING_STATUSES = Object.freeze(['agendado', 'confirmado']);
export const ACTIVE_STATUSES = Object.freeze([...PENDING_STATUSES, 'em_atendimento']);
export function agendaRange(day, view = 'day') {
  if (view !== 'week') return { from: day, to: day, days: [day] };
  const weekday = new Date(`${day}T12:00:00-03:00`).getUTCDay();
  const from = addDays(day, -(weekday + 6) % 7), days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  return { from, to: days[6], days };
}
export const agendaDateLabel = (day, now = new Date()) => `${day === dayKey(now) ? 'Hoje, ' : ''}${new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', timeZone: TIMEZONE }).format(new Date(`${day}T12:00:00-03:00`))}`;
const searchable = value => String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
export function matchesBooking(booking, search = '', status = '') {
  const query = searchable(search.trim()), words = searchable(`${booking.customer_name} ${booking.customer_phone}`);
  return (!status || booking.status === status) && (!query || words.includes(query) || (/^[+\d\s().-]+$/.test(query) && String(booking.customer_phone).includes(query.replace(/\D/g, ''))));
}
export function scheduleFor(data, barberId, day) {
  const special = data.special_hours.find(h => h.barber_id === barberId && h.day === day);
  const weekday = new Date(`${day}T12:00:00-03:00`).getUTCDay();
  const weekly = data.hours.find(h => h.barber_id === barberId && h.weekday === weekday);
  const hours = special || weekly;
  return !hours || special?.closed ? { closed: true } : { ...hours, closed: false };
}
export function dayBookings(data, day, barber = '') {
  return data.bookings.filter(b => dayKey(b.starts_at) === day && (!barber || b.barber_id === barber)).sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at));
}
export function freeSlots(data, day, barber = '', now = new Date()) {
  return (data.agenda_slots || []).filter(g => g.day === day && (!barber || g.barber_id === barber)).flatMap(g => g.slots.filter(s => new Date(s.start) > now).map(s => ({ ...s, barber_id: g.barber_id, minimum_duration: g.minimum_duration })));
}
export function timelineRows(data, day, barberId, { search = '', status = '' } = {}, now = new Date()) {
  const rows = dayBookings(data, day, barberId).filter(b => matchesBooking(b, search, status)).map(booking => ({ kind: 'booking', start: booking.starts_at, end: booking.ends_at, booking }));
  if (!search.trim() && !status) {
    const hours = scheduleFor(data, barberId, day);
    if (!hours.closed && hours.lunch_start && hours.lunch_end) rows.push({ kind: 'lunch', start: localInstant(day, hours.lunch_start.slice(0, 5)), end: localInstant(day, hours.lunch_end.slice(0, 5)) });
    const start = localInstant(day, '00:00'), end = localInstant(addDays(day, 1), '00:00');
    data.blocks.filter(b => b.barber_id === barberId && new Date(b.starts_at) < new Date(end) && new Date(b.ends_at) > new Date(start)).forEach(block => rows.push({ kind: 'block', start: new Date(Math.max(+new Date(start), +new Date(block.starts_at))).toISOString(), end: new Date(Math.min(+new Date(end), +new Date(block.ends_at))).toISOString(), block }));
    freeSlots(data, day, barberId, now).forEach(slot => rows.push({ kind: 'free', ...slot }));
  }
  return rows.sort((a, b) => +new Date(a.start) - +new Date(b.start) || (a.kind === 'booking' ? -1 : b.kind === 'booking' ? 1 : 0));
}
export function primaryBookingAction(booking, now = new Date()) {
  if (booking.status === 'agendado') return { action: 'confirm', label: 'Confirmar', tone: 'confirm' };
  if (booking.status === 'confirmado') return dayKey(booking.starts_at) < dayKey(now)
    ? { action: 'finish', label: 'Concluir', tone: 'finish' }
    : { action: 'start', label: 'Iniciar', tone: 'start', disabled: dayKey(booking.starts_at) !== dayKey(now) };
  if (booking.status === 'em_atendimento') return { action: 'finish', label: 'Concluir', tone: 'finish' };
  if (booking.status === 'concluido' && Number(booking.paid) < Number(booking.total)) return { action: 'finish', label: 'Receber', tone: 'confirm' };
  return null;
}
export function nextBooking(data, day, barber = '', selected = '') {
  const bookings = dayBookings(data, day, barber);
  return bookings.find(b => b.id === selected) || bookings.find(b => PENDING_STATUSES.includes(b.status)) || bookings.find(b => b.status === 'em_atendimento') || null;
}
export function agendaStats(data, range, barber = '', now = new Date()) {
  const bookings = data.bookings.filter(b => dayKey(b.starts_at) >= range.from && dayKey(b.starts_at) <= range.to && (!barber || b.barber_id === barber));
  return {
    booked: bookings.filter(b => !['cancelado', 'nao_compareceu'].includes(b.status)).length,
    completed: bookings.filter(b => b.status === 'concluido').length,
    free: range.days.reduce((n, day) => n + freeSlots(data, day, barber, now).length, 0),
    cancelled: bookings.filter(b => b.status === 'cancelado').length,
    absent: bookings.filter(b => b.status === 'nao_compareceu').length,
  };
}
