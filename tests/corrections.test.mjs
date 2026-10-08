import test from 'node:test';
import assert from 'node:assert/strict';
import { adminDataRequests, validateFinancialPeriod, currentMonthRange } from '../src/admin-data.js';
import { metrics } from '../src/utils.js';
import { viewFromPath, viewPath } from '../src/client-navigation.js';
import { requestJson } from '../src/transport.js';
import { notificationStatus } from '../supabase/functions/_shared/notification-status.ts';
import { integrationStatusMarkup } from '../src/integration-view.js';

test('período passado não limita os recebimentos de hoje nem os últimos sete dias', async () => {
  const state={page:'overview',from:'2026-09-01',to:'2026-09-30',barber:'a'};
  const requests=adminDataRequests(state,new Date('2026-10-06T01:57:00Z'));
  assert.deepEqual(requests.period,{from:'2026-09-01',to:'2026-09-30',barber_id:'a',include_notifications:true});
  assert.deepEqual(requests.recent,{from:'2026-09-29',to:'2026-10-05',barber_id:'a',include_notifications:false});
  const data={bookings:[],payments:[{created_at:'2026-10-05T15:00:00Z',kind:'payment',amount:35}],expenses:[]};
  const fetched=await Promise.all(Object.values(requests).map(async r=>({...data,payments:data.payments.filter(p=>p.created_at.slice(0,10)>=r.from&&p.created_at.slice(0,10)<=r.to)})));
  assert.equal(metrics(fetched[0],state.from,state.to).received,0);assert.equal(metrics(fetched[1],'2026-10-05','2026-10-05').received,35);
  assert.equal(adminDataRequests(state,new Date('2026-10-06T03:01:00Z')).recent.to,'2026-10-06');
});
test('consultas da agenda e do financeiro mantêm intervalos independentes e rejeitam período inválido',()=>{
  const plan=adminDataRequests({page:'bookings',agenda:{day:'2026-12-31',view:'week',barber:'a'}});
  assert.deepEqual(plan,{period:{from:'2026-12-28',to:'2027-01-03',barber_id:'a',include_agenda:true,include_notifications:true}});
  assert.throws(()=>validateFinancialPeriod('2026-10-06','2026-10-05'));
  assert.throws(()=>validateFinancialPeriod('','2026-10-05'));
  assert.throws(()=>validateFinancialPeriod('2024-01-01','2026-10-05'));
});
test('mês automático respeita São Paulo, anos bissextos e virada do ano',()=>{
  assert.deepEqual(currentMonthRange(new Date('2027-01-01T01:30:00Z')),{from:'2026-12-01',to:'2026-12-31'});
  assert.deepEqual(currentMonthRange(new Date('2027-01-01T03:30:00Z')),{from:'2027-01-01',to:'2027-01-31'});
  assert.deepEqual(currentMonthRange(new Date('2028-02-15T15:00:00Z')),{from:'2028-02-01',to:'2028-02-29'});
});
test('endereços de agendamento e histórico sobrevivem a recarregamento e navegação do navegador',()=>{
  for(const view of ['booking','history'])assert.equal(viewFromPath(viewPath(view)),view);
  assert.equal(viewFromPath('/meus-agendamentos/'),'history');assert.equal(viewPath('booking'),'/');
});
test('timeout aborta a requisição sem repetir uma operação que pode ter sido recebida',async()=>{
  let calls=0,aborted=false;
  const fetcher=(_url,{signal})=>new Promise((_resolve,reject)=>{calls++;signal.addEventListener('abort',()=>{aborted=true;reject(new DOMException('Aborted','AbortError'));});});
  await assert.rejects(requestJson('https://example.test',{method:'POST'},{fetcher,timeout:5}),/Confira seu histórico/);
  assert.equal(calls,1);assert.equal(aborted,true);
});
test('erros HTTP mantêm status de autenticação e a resposta inválida gera erro legível',async()=>{
  await assert.rejects(requestJson('https://example.test',{}, {fetcher:async()=>Response.json({error:'Sessão expirada'},{status:401})}),e=>e.status===401&&e.message==='Sessão expirada');
  await assert.rejects(requestJson('https://example.test',{}, {fetcher:async()=>new Response('invalid')}),/respondeu corretamente/);
});
test('diagnóstico de WhatsApp informa campos faltantes sem expor valores de credenciais',()=>{
  const empty=notificationStatus(()=>undefined);assert.equal(empty.whatsapp.configured,false);assert.equal(empty.whatsapp.missing.length,5);
  const ready=notificationStatus(()=>'segredo-nao-pode-aparecer');assert.equal(ready.whatsapp.configured,true);assert.equal(ready.whatsapp.delivery_configured,true);
  assert.ok(!JSON.stringify(ready).includes('segredo'));assert.ok(!JSON.stringify(ready).includes('TOKEN'));
  const markup=integrationStatusMarkup(empty,[{status:'pending'},{status:'sent'}]);assert.ok(markup.includes('configuração pendente'));assert.ok(markup.includes('1 mensagem aguardando'));assert.ok(!markup.includes('segredo'));
  const unknown=integrationStatusMarkup({whatsapp:{configured:null}});assert.ok(unknown.includes('verificação indisponível'));assert.ok(!unknown.includes('configuração pendente'));
});
