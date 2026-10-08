export const RESERVED_MINUTES = 60;
export function forecastMinutes(items = []) {
  return items.reduce((sum, item) => sum + Math.max(0, Number(item.duration) || 0), 0);
}
export function additionalBookingMinutes(items = []) {
  return Math.max(0, Math.ceil(forecastMinutes(items) / RESERVED_MINUTES) - 1) * RESERVED_MINUTES;
}
export function cancellationDeadline(booking, minutes) {
  return new Date(new Date(booking.starts_at).getTime() - Math.max(0, Number(minutes) || 0) * 60000);
}
export function canCustomerChange(booking, minutes, now = new Date()) {
  return ['agendado', 'confirmado'].includes(booking.status)
    && new Date(booking.starts_at) > now
    && cancellationDeadline(booking, minutes) >= now;
}
export function reminderAvailable(catalog) {
  return catalog?.whatsapp?.reminder_available === true;
}
export function parseAccessKey(value) {
  const key = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(key)) throw new Error('Informe a chave de acesso salva, com 43 caracteres.');
  return key;
}
