import test from 'node:test';
import assert from 'node:assert/strict';
import { agendaRange, agendaStats, timelineRows, nextBooking, primaryBookingAction, matchesBooking, scheduleFor, freeSlots, calendarWindow, calendarColumns, calendarBookings, calendarIntervals, minuteInDay, canFinishBooking } from '../src/agenda-model.js';
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
test('calendário mantém horário, cliente e status acessíveis sem cartões laterais', () => {
  const data=agendaFixture(),markup=agendaPageMarkup(data,fixtureFilters,fixtureNow);
  for(const label of ['Agenda do dia','Horários livres','Almoço','Confirmado','A confirmar','Em atendimento'])assert.ok(markup.includes(label),label);
  assert.ok(markup.includes('data-booking="rafael"'));assert.ok(markup.includes('id="agenda-search"'));assert.ok(markup.includes('data-agenda-view="week"'));
  assert.ok(!markup.includes('agenda-aside'));assert.ok(!markup.includes('class="agenda-stat '));assert.ok(!markup.includes('Próximo cliente'));
  assert.ok(markup.includes('14:00–14:40 · João Costa · Barba · Confirmado'));
  data.bookings[3].customer_name='<script>alert(1)</script>';const escaped=agendaPageMarkup(data,fixtureFilters,fixtureNow);
  assert.ok(!escaped.includes('<script>'));assert.ok(escaped.includes('&lt;script&gt;'));
});
test('vagas são opcionais, usam o servidor e status curtos mantêm símbolo e descrição', () => {
  const data=agendaFixture();
  const defaultMarkup=agendaPageMarkup(data,fixtureFilters,fixtureNow);
  assert.ok(!defaultMarkup.includes('data-agenda-slot='));
  const expanded=agendaPageMarkup(data,{...fixtureFilters,showFree:true},fixtureNow);
  assert.equal((expanded.match(/data-agenda-slot=/g)||[]).length,3);
  assert.ok(!agendaPageMarkup(data,{...fixtureFilters,showFree:true,search:'João'},fixtureNow).includes('data-agenda-slot='));
  data.bookings[3].ends_at='2026-10-05T14:10:00-03:00';
  const short=agendaPageMarkup(data,fixtureFilters,fixtureNow);
  assert.match(short,/agenda-event confirmado compact[\s\S]*?agenda-event-marker" aria-hidden="true">✓/);
  assert.ok(short.includes('14:00–14:10 · João Costa · Barba · Confirmado'));
  data.bookings=[];
  assert.ok(agendaPageMarkup(data,fixtureFilters,fixtureNow).includes('Nenhum agendamento neste dia.'));
});
test('conclusão gratuita e recebimento de saldo respeitam status e não repetem pagamento', () => {
  for (const status of ['agendado','confirmado','em_atendimento']) {
    assert.equal(canFinishBooking({status,total:35,paid:35}),true);
    assert.equal(canFinishBooking({status,total:35,paid:20}),true);
    assert.equal(canFinishBooking({status,total:0,paid:0}),true);
  }
  assert.equal(canFinishBooking({status:'concluido',total:35,paid:20}),true);
  assert.equal(canFinishBooking({status:'concluido',total:35,paid:35}),false);
  assert.equal(canFinishBooking({status:'cancelado',total:35,paid:0}),false);
  assert.equal(canFinishBooking({status:'nao_compareceu',total:35,paid:0}),false);
  assert.equal(canFinishBooking({status:'em_atendimento',total:0,paid:0}),true);
});
test('visão semanal alinha sete dias na mesma escala de horários', () => {
  const markup=agendaPageMarkup(agendaFixture(),{...fixtureFilters,view:'week'},fixtureNow);
  assert.equal((markup.match(/class="agenda-column-heading/g)||[]).length,7);assert.equal((markup.match(/class="agenda-calendar-column/g)||[]).length,7);assert.ok(markup.includes('Agenda da semana'));assert.ok(markup.includes('--calendar-columns:7'));
  assert.ok(markup.includes('data-agenda-day="2026-10-11"'));assert.equal((markup.match(/class="agenda-time-axis"/g)||[]).length,1);
});
test('escala acompanha expediente editado, almoço, fechamento e eventos fora da data selecionada', () => {
  const data=agendaFixture(),range=agendaRange(fixtureFilters.day);
  assert.deepEqual(calendarWindow(data,fixtureFilters,range),{start:540,end:1140,minutes:600,ticks:[540,600,660,720,780,840,900,960,1020,1080]});
  data.special_hours.push({barber_id:'barber-a',day:fixtureFilters.day,opens:'07:30:00',closes:'20:15:00',lunch_start:null,lunch_end:null,closed:false});
  const window=calendarWindow(data,fixtureFilters,range);assert.equal(window.start,420);assert.equal(window.end,1260);
  const column=calendarColumns(data,fixtureFilters,range)[0];assert.ok(!calendarIntervals(data,column,window).some(x=>x.kind==='lunch'));
  data.special_hours[0].closed=true;assert.ok(calendarIntervals(data,column,window).some(x=>x.kind==='closed'));
  assert.equal(minuteInDay('2026-10-06T01:30:00Z',fixtureFilters.day),1350);
  assert.equal(minuteInDay('2026-10-06T04:00:00Z',fixtureFilters.day),1440);
  const outside={...data.bookings[2],id:'earlier',starts_at:'2026-10-04T15:00:00-03:00',ends_at:'2026-10-04T15:40:00-03:00'};data.bookings.push(outside);
  const markup=agendaPageMarkup(data,fixtureFilters,fixtureNow);assert.match(markup,/class="agenda-outside"[^>]*data-booking="earlier"/);
});
test('sobreposições em tela preservam reservas canceladas e de outros profissionais em faixas separadas', () => {
  const data=agendaFixture();
  data.bookings.push({...data.bookings[3],id:'cancelled',status:'cancelado'}, {...data.bookings[3],id:'other',barber_id:'barber-b'});
  const events=calendarBookings(data,fixtureFilters.day,['barber-a','barber-b'],fixtureFilters);
  const overlapping=events.filter(x=>['joao','cancelled','other'].includes(x.booking.id));
  assert.equal(new Set(overlapping.map(x=>x.lane)).size,3);assert.ok(overlapping.every(x=>x.lanes===3));
  assert.equal(events.find(x=>x.booking.id==='matheus').lanes,1);
  assert.equal(calendarBookings(data,fixtureFilters.day,['barber-a'],{...fixtureFilters,status:'confirmado'}).length,1);
});
