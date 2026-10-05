import test from 'node:test';
import assert from 'node:assert/strict';
import { agendaRange, agendaStats, timelineRows, nextBooking, primaryBookingAction, matchesBooking, scheduleFor, freeSlots } from '../src/agenda-model.js';
import { agendaPageMarkup } from '../src/agenda-view.js';
import { metrics } from '../src/utils.js';
import { agendaFixture, fixtureFilters, fixtureNow } from './fixtures/agenda.mjs';

test('dia e semana respeitam segunda a domingo e a virada de ano em São Paulo', () => {
  assert.deepEqual(agendaRange('2026-10-05').days,['2026-10-05']);
  assert.deepEqual(agendaRange('2026-10-11','week'),{from:'2026-10-05',to:'2026-10-11',days:['2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09','2026-10-10','2026-10-11']});
  assert.equal(agendaRange('2026-12-31','week').to,'2027-01-03');
});
test('contadores usam o período e as vagas reais; horários passados saem das vagas', () => {
  const data=agendaFixture(),range=agendaRange(fixtureFilters.day);
  assert.deepEqual(agendaStats(data,range,'',fixtureNow),{booked:5,completed:2,free:3,cancelled:0,absent:0});
  assert.equal(freeSlots(data,fixtureFilters.day,'',new Date('2026-10-05T16:01:00-03:00')).length,1);
  data.bookings.push({...data.bookings[0],id:'old',starts_at:'2026-10-04T10:00:00-03:00',status:'em_atendimento'});
  assert.equal(agendaStats(data,range,'',fixtureNow).booked,5);
});
test('linha do tempo mostra almoço, bloqueios e apenas vagas retornadas pelo servidor', () => {
  const data=agendaFixture();
  data.blocks.push({barber_id:'barber-a',starts_at:'2026-10-05T18:00:00-03:00',ends_at:'2026-10-05T19:00:00-03:00',reason:'Compromisso'});
  const rows=timelineRows(data,fixtureFilters.day,'barber-a',{},fixtureNow);
  assert.equal(rows.filter(r=>r.kind==='booking').length,5);assert.equal(rows.filter(r=>r.kind==='free').length,3);
  assert.equal(rows.find(r=>r.kind==='lunch').start,'2026-10-05T15:00:00.000Z');assert.equal(rows.filter(r=>r.kind==='block').length,1);
  assert.ok(!rows.some(r=>r.kind==='free'&&r.start.includes('12:00:00-03:00')));
});
test('busca ignora acentos, aceita telefone formatado e não mistura vagas com resultados', () => {
  const data=agendaFixture(),joao=data.bookings.find(b=>b.id==='joao');
  assert.equal(matchesBooking(joao,'joao'),true);assert.equal(matchesBooking(joao,'(11) 99999-0000'),true);assert.equal(matchesBooking(joao,'Cliente 99999'),false);
  assert.equal(matchesBooking(joao,'','concluido'),false);
  const rows=timelineRows(data,fixtureFilters.day,'barber-a',{search:'Joao'},fixtureNow);
  assert.equal(rows.length,1);assert.equal(rows[0].booking.id,'joao');
});
test('feriado substitui o horário semanal; almoço usa o funcionamento específico do dia', () => {
  const data=agendaFixture();data.special_hours.push({barber_id:'barber-a',day:fixtureFilters.day,closed:true});
  assert.equal(scheduleFor(data,'barber-a',fixtureFilters.day).closed,true);
  data.special_hours[0]={barber_id:'barber-a',day:fixtureFilters.day,closed:false,opens:'10:00:00',closes:'17:00:00',lunch_start:null,lunch_end:null};
  assert.equal(scheduleFor(data,'barber-a',fixtureFilters.day).opens,'10:00:00');
  assert.equal(timelineRows(data,fixtureFilters.day,'barber-a',{},fixtureNow).some(r=>r.kind==='lunch'),false);
});
test('próximo cliente segue a agenda e a seleção; ações correspondem ao estado real', () => {
  const data=agendaFixture();
  assert.equal(nextBooking(data,fixtureFilters.day).id,'joao');assert.equal(nextBooking(data,fixtureFilters.day,'','rafael').id,'rafael');
  assert.equal(primaryBookingAction(data.bookings[4],fixtureNow).action,'confirm');assert.equal(primaryBookingAction(data.bookings[2],fixtureNow).action,'finish');
  assert.equal(primaryBookingAction(data.bookings[3],fixtureNow).action,'start');
  assert.equal(primaryBookingAction({...data.bookings[3],starts_at:'2026-10-06T14:00:00-03:00'},fixtureNow).disabled,true);
  assert.equal(primaryBookingAction(data.bookings[0],fixtureNow),null);
});
test('começar atendimento não apaga a previsão e mantém pagamentos e estornos', () => {
  const data=agendaFixture();data.payments=[{created_at:'2026-10-05T12:00:00-03:00',kind:'payment',amount:35}];
  assert.equal(metrics(data,fixtureFilters.day,fixtureFilters.day).forecast,90);assert.equal(metrics(data,fixtureFilters.day,fixtureFilters.day).received,35);
});
test('agenda renderiza controles claros, ações e cartão do próximo cliente com HTML seguro', () => {
  const data=agendaFixture(),markup=agendaPageMarkup(data,fixtureFilters,fixtureNow);
  for(const label of ['Agenda do dia','Próximo cliente','Horário livre','Intervalo de almoço','Confirmar','Iniciar','Concluir','Enviar lembrete','Reagendar'])assert.ok(markup.includes(label),label);
  assert.ok(markup.includes('data-booking="rafael"'));assert.ok(markup.includes('id="agenda-search"'));assert.ok(markup.includes('data-agenda-view="week"'));
  data.bookings[3].customer_name='<script>alert(1)</script>';const escaped=agendaPageMarkup(data,fixtureFilters,fixtureNow);
  assert.ok(!escaped.includes('<script>'));assert.ok(escaped.includes('&lt;script&gt;'));
  data.bookings[3].reminder_consent=false;
  assert.match(agendaPageMarkup(data,fixtureFilters,fixtureNow),/data-agenda-action="remind"[^>]+disabled/);
});
test('visão semanal sempre tem sete dias e oferece acesso à agenda completa', () => {
  const markup=agendaPageMarkup(agendaFixture(),{...fixtureFilters,view:'week'},fixtureNow);
  assert.equal((markup.match(/class="agenda-week-heading"/g)||[]).length,7);assert.ok(markup.includes('Agenda da semana'));assert.ok(markup.includes('Ver dia'));
});
