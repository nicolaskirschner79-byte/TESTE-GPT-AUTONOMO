import { addDays, dayKey, localInstant, TIMEZONE } from './utils.js';

export const PENDING_STATUSES = Object.freeze(['agendado', 'confirmado']);
export const ACTIVE_STATUSES = Object.freeze([...PENDING_STATUSES, 'em_atendimento']);
export const canFinishBooking = booking => (ACTIVE_STATUSES.includes(booking.status) && (Number(booking.paid) < Number(booking.total) || Number(booking.total) === 0)) || (booking.status === 'concluido' && Number(booking.paid) < Number(booking.total));
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

export const CALENDAR_MIN_EVENT = 20;
const clockMinutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
const localClock = new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function minuteInDay(instant, day) {
  const key = dayKey(instant);
  return key < day ? 0 : key > day ? 1440 : clockMinutes(localClock.format(new Date(instant)));
}
export const minuteLabel = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
export function calendarBarbers(data, day, barber = '') {
  return data.barbers.filter(b => (!barber || b.id === barber) && (b.active || dayBookings(data, day, b.id).length));
}
export function calendarColumns(data, filters, range) {
  if (filters.view === 'week') return range.days.map(day => ({ key: day, day, barbers: calendarBarbers(data, day, filters.barber) }));
  const barbers = calendarBarbers(data, filters.day, filters.barber);
  return barbers.length ? barbers.map(barber => ({ key: barber.id, day: filters.day, barbers: [barber] })) : [{ key: filters.day, day: filters.day, barbers: [] }];
}
export function calendarWindow(data, filters, range) {
  const limits = [];
  for (const day of range.days) {
    for (const barber of calendarBarbers(data, day, filters.barber)) {
      const hours = scheduleFor(data, barber.id, day);
      if (!hours.closed) limits.push([clockMinutes(hours.opens), clockMinutes(hours.closes)]);
    }
    for (const booking of dayBookings(data, day, filters.barber)) {
      const start = minuteInDay(booking.starts_at, day);
      limits.push([start, Math.max(minuteInDay(booking.ends_at, day), start + CALENDAR_MIN_EVENT)]);
    }
  }
  const start = Math.max(0, Math.floor((limits.length ? Math.min(...limits.map(x => x[0])) : 540) / 60) * 60);
  const end = Math.min(1440, Math.max(start + 60, Math.ceil((limits.length ? Math.max(...limits.map(x => x[1])) : 1140) / 60) * 60));
  return { start, end, minutes: end - start, ticks: Array.from({ length: (end - start) / 60 }, (_, i) => start + i * 60) };
}
// Reservas sobrepostas, inclusive canceladas e de outros profissionais, ocupam faixas próprias.
export function calendarBookings(data, day, barberIds, filters) {
  const entries = dayBookings(data, day).filter(b => barberIds.includes(b.barber_id) && matchesBooking(b, filters.search, filters.status)).map(booking => {
    const start = minuteInDay(booking.starts_at, day), actualEnd = minuteInDay(booking.ends_at, day);
    return { booking, start, end: Math.min(1440, Math.max(actualEnd, start + CALENDAR_MIN_EVENT)) };
  });
  const result = [];
  let group = [], groupEnd = -1;
  const flush = () => {
    const occupied = [];
    for (const entry of group) {
      let lane = occupied.findIndex(end => end <= entry.start);
      if (lane < 0) lane = occupied.length;
      occupied[lane] = entry.end; entry.lane = lane;
    }
    result.push(...group.map(entry => ({ ...entry, lanes: occupied.length })));
    group = []; groupEnd = -1;
  };
  for (const entry of entries) {
    if (entry.start >= groupEnd && group.length) flush();
    group.push(entry); groupEnd = Math.max(groupEnd, entry.end);
  }
  if (group.length) flush();
  return result;
}
export function calendarIntervals(data, column, window) {
  const intervals = [], dayStart = localInstant(column.day, '00:00'), dayEnd = localInstant(addDays(column.day, 1), '00:00');
  for (const barber of column.barbers) {
    const h = scheduleFor(data, barber.id, column.day), label = column.barbers.length > 1 ? `${barber.name} · ` : '';
    if (h.closed) intervals.push({ start: window.start, end: window.end, label: label + 'Fechado', kind: 'closed' });
    else {
      const opens = clockMinutes(h.opens), closes = clockMinutes(h.closes);
      if (opens > window.start) intervals.push({ start: window.start, end: opens, label: label + 'Fora do expediente', kind: 'closed' });
      if (closes < window.end) intervals.push({ start: closes, end: window.end, label: label + 'Fora do expediente', kind: 'closed' });
      if (h.lunch_start && h.lunch_end) intervals.push({ start: clockMinutes(h.lunch_start), end: clockMinutes(h.lunch_end), label: label + 'Almoço', kind: 'lunch' });
    }
    data.blocks.filter(b => b.barber_id === barber.id && new Date(b.starts_at) < new Date(dayEnd) && new Date(b.ends_at) > new Date(dayStart)).forEach(b => intervals.push({ start: minuteInDay(b.starts_at, column.day), end: minuteInDay(b.ends_at, column.day), label: label + b.reason, kind: 'block' }));
  }
  if (!column.barbers.length) intervals.push({ start: window.start, end: window.end, label: 'Sem profissional disponível', kind: 'closed' });
  return intervals.map(interval => ({ ...interval, start: Math.max(window.start, interval.start), end: Math.min(window.end, interval.end) })).filter(x => x.end > x.start);
}
