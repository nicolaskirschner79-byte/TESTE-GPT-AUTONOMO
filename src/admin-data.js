import { addDays, dayKey } from './utils.js';
import { agendaRange } from './agenda-model.js';

export function currentMonthRange(now = new Date()) {
  const day = dayKey(now), [year, month] = day.split('-').map(Number);
  return { from: day.slice(0, 8) + '01', to: new Date(Date.UTC(year, month, 0, 12)).toISOString().slice(0, 10) };
}

export function adminDataRequests(state, now = new Date()) {
  const barber_id = state.barber || null;
  if (state.page === 'bookings') {
    const range = agendaRange(state.agenda.day, state.agenda.view);
    return { period: { from: range.from, to: range.to, barber_id: state.agenda.barber || null, include_agenda: true, include_notifications: true } };
  }
  const requests = { period: { from: state.from, to: state.to, barber_id, include_notifications: state.page === 'overview' } };
  if (state.page === 'overview') requests.recent = { from: addDays(dayKey(now), -6), to: dayKey(now), barber_id, include_notifications: false };
  return requests;
}

export function validateFinancialPeriod(from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) throw new Error('Escolha as duas datas do período.');
  if (from > to) throw new Error('A data inicial deve ser anterior ou igual à data final.');
  if ((new Date(to + 'T12:00:00-03:00') - new Date(from + 'T12:00:00-03:00')) / 86400000 > 366) throw new Error('Escolha um período de até 366 dias.');
  return { from, to };
}
