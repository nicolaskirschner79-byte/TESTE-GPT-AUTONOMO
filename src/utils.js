export const TIMEZONE = 'America/Sao_Paulo';
export const money = n => new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' }).format(Number(n || 0));
export const time = d => new Intl.DateTimeFormat('pt-BR', {timeZone:TIMEZONE,hour:'2-digit',minute:'2-digit'}).format(new Date(d));
export const date = d => new Intl.DateTimeFormat('pt-BR', {timeZone:TIMEZONE,day:'2-digit',month:'short',year:'numeric'}).format(new Date(d));
export const dayKey = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone:TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit' }).format(d instanceof Date ? d : new Date(d));
export const addDays = (day,n) => dayKey(new Date(new Date(`${day}T12:00:00-03:00`).getTime()+n*86400000));
export const localInstant = (day,hour) => new Date(`${day}T${hour}:00-03:00`).toISOString();
export const escape = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function normalizePhone(value) {
  let digits = String(value).replace(/\D/g,'');
  if ((digits.length===12 || digits.length===13) && digits.startsWith('55')) digits=digits.slice(2);
  if (!/^[1-9][0-9]{9,10}$/.test(digits)) throw new Error('Informe um celular válido com DDD.');
  return `55${digits}`;
}
export function phoneMask(value) {
  let n=String(value).replace(/\D/g,'');
  if(n.length>11&&n.startsWith('55'))n=n.slice(2);
  n=n.slice(0,11);if(n.length<3)return n;
  return `(${n.slice(0,2)}) ${n.slice(2,n.length>10?7:6)}${n.length>6?'-'+n.slice(n.length>10?7:6):''}`;
}
export const statusNames={agendado:'Agendado',confirmado:'Confirmado',concluido:'Concluído',cancelado:'Cancelado',nao_compareceu:'Não compareceu'};
export const notificationNames={pending:'Na fila',processing:'Processando',sent:'Enviado',delivered:'Entregue',read:'Lido',failed:'Falhou',unknown:'Verificar envio'};
export function metrics(data, from, to, barber='') {
  const bookings=data.bookings.filter(b=>dayKey(b.starts_at)>=from&&dayKey(b.starts_at)<=to&&(!barber||b.barber_id===barber));
  const payments=data.payments.filter(p=>dayKey(p.created_at)>=from&&dayKey(p.created_at)<=to);
  const expenses=data.expenses.filter(e=>e.day>=from&&e.day<=to&&(!barber||e.barber_id===barber));
  const received=payments.reduce((s,p)=>s+(p.kind==='refund'?-1:1)*Number(p.amount),0);
  const spent=expenses.reduce((s,e)=>s+Number(e.amount),0);
  const forecast=bookings.filter(b=>['agendado','confirmado'].includes(b.status)).reduce((s,b)=>s+Math.max(0,Number(b.total)-Number(b.paid)),0);
  const paidBookings=bookings.filter(b=>Number(b.paid)>0);
  return {count:bookings.length,cancelled:bookings.filter(b=>b.status==='cancelado').length,forecast,received,spent,profit:received-spent,ticket:paidBookings.length?paidBookings.reduce((s,b)=>s+Number(b.paid),0)/paidBookings.length:0};
}
