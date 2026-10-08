import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fullDatabase, rpc, ownerId, futureDay } from './helpers/full-database.mjs';

test('migrations completas, reservas, financeiro e permissões no Postgres isolado', async t => {
  const db = await fullDatabase(); t.after(() => db.close());
  const catalog = await rpc(db, 'catalog'), barber = catalog.barbers[0].id;
  const corte = catalog.services.find(s => s.name === 'Corte').id, luzes = catalog.services.find(s => s.name === 'Luzes').id;
  const day = await futureDay(db);
  let tokenNumber = 0;
  const token = async () => { const value = String(++tokenNumber).padStart(64, '0'); await rpc(db, 'session', {}, value); return value; };
  const book = async (hour, services = [corte], hash = null, phone = '5511888888888') => rpc(db, 'book', { name: 'Cliente de teste', phone, barber_id: barber, services, start: `${day}T${hour}:00-03:00`, consent: false, idempotency_key: randomUUID() }, hash || await token());
  const reset = () => db.exec('truncate barber_private.bookings cascade;');

  await t.test('previsão longa mantém uma hora; tempo extra é explícito e idempotente', async () => {
    const b = await book('09:00', [luzes]);
    assert.equal(b.duration, 60); assert.equal(b.forecast_minutes, 120); assert.equal(b.extra_block, null);
    const extra = await rpc(db, 'reserve_extra', { id: b.id }, null, ownerId);
    assert.equal(new Date(extra.extra_block.ends_at) - new Date(extra.extra_block.starts_at), 3600000);
    assert.equal(extra.duration, 60);
    assert.equal((await rpc(db, 'reserve_extra', { id: b.id }, null, ownerId)).extra_block.id, extra.extra_block.id);
    await assert.rejects(book('10:00'), e => e.code === '23P01');
    await rpc(db, 'cancel', { id: b.id }, null, ownerId);
    assert.equal((await db.query('select count(*)::int n from barber_private.blocks where booking_id=$1',[b.id])).rows[0].n, 0);
    assert.ok((await book('10:00')).id);
    await reset();
  });
  await t.test('conflito, almoço e expediente recusam tempo extra sem mudar a reserva', async () => {
    const b = await book('09:00', [luzes]); await book('10:00');
    await assert.rejects(rpc(db, 'reserve_extra', { id: b.id }, null, ownerId), e => e.code === '23P01');
    assert.equal((await db.query('select count(*)::int n from barber_private.blocks')).rows[0].n, 0);
    const lunch = await book('11:00', [luzes]), closing = await book('18:00', [luzes]);
    await assert.rejects(rpc(db, 'reserve_extra', { id: lunch.id }, null, ownerId), /almoço/);
    await assert.rejects(rpc(db, 'reserve_extra', { id: closing.id }, null, ownerId), /expediente/);
    await reset();
  });
  await t.test('reagendamento libera somente o bloco associado; nova reserva continua uma hora', async () => {
    const hash = await token(), b = await book('09:00', [luzes], hash);
    await rpc(db, 'reserve_extra', { id: b.id }, null, ownerId);
    const moved = await rpc(db, 'reschedule', { id:b.id,start:`${day}T13:00:00-03:00`,barber_id:barber }, hash);
    assert.equal(moved.extra_block, null); assert.equal(moved.duration, 60);
    assert.ok((await book('10:00')).id); await reset();
  });
  await t.test('adiantamento parcial e total não concluem; quitação permite concluir sem outro pagamento', async () => {
    const b = await book('09:00'), key = randomUUID();
    const first = await rpc(db,'pay',{id:b.id,amount:10,method:'pix',idempotency_key:key,complete:false},null,ownerId);
    assert.equal(first.status,'agendado'); assert.equal(Number(first.paid),10);
    await rpc(db,'pay',{id:b.id,amount:10,method:'pix',idempotency_key:key,complete:false},null,ownerId);
    assert.equal((await db.query('select count(*)::int n from barber_private.payments')).rows[0].n,1);
    const paid = await rpc(db,'pay',{id:b.id,amount:25,method:'dinheiro',idempotency_key:randomUUID(),complete:false},null,ownerId);
    assert.equal(paid.status,'agendado'); assert.equal(Number(paid.paid),35);
    const done = await rpc(db,'status',{id:b.id,status:'concluido',expected_version:paid.version},null,ownerId);
    assert.equal(done.status,'concluido');
    await assert.rejects(rpc(db,'pay',{id:b.id,amount:1,method:'pix',idempotency_key:randomUUID()},null,ownerId), /acima do saldo/);
    await reset();
  });
  await t.test('conclusão explícita parcial preserva saldo e estorno preserva status', async () => {
    const b = await book('09:00');
    const done = await rpc(db,'pay',{id:b.id,amount:10,method:'pix',idempotency_key:randomUUID(),complete:true},null,ownerId);
    assert.equal(done.status,'concluido'); assert.equal(Number(done.paid),10);
    const refund = await rpc(db,'refund',{id:b.id,amount:5,method:'pix',idempotency_key:randomUUID()},null,ownerId);
    assert.equal(refund.status,'concluido'); assert.equal(Number(refund.paid),5);
    await assert.rejects(rpc(db,'refund',{id:b.id,amount:6,method:'pix',idempotency_key:randomUUID()},null,ownerId), /acima/);
    await assert.rejects(rpc(db,'pay',{id:b.id,amount:0.001,method:'pix',idempotency_key:randomUUID()},null,ownerId), /casas decimais/);
    await reset();
  });
  await t.test('limite por celular abrange diferentes dispositivos e libera após cancelar', async () => {
    const bookings = [];
    for (const hour of ['09:00','10:00','11:00','13:00','14:00']) bookings.push(await book(hour));
    await assert.rejects(book('15:00'), /celular já possui cinco/);
    await rpc(db,'cancel',{id:bookings[0].id},null,ownerId);
    assert.ok((await book('15:00')).id); await reset();
  });
  await t.test('chave salva recupera apenas sua identidade; nome e telefone não autorizam acesso', async () => {
    const hash = await token(), other = await token(), b = await book('09:00',[corte],hash);
    assert.equal((await rpc(db,'restore',{},hash)).ok,true);
    assert.deepEqual((await rpc(db,'mine',{},hash)).map(x=>x.id),[b.id]);
    assert.deepEqual(await rpc(db,'mine',{},other),[]);
    assert.deepEqual(await rpc(db,'mine',{},'f'.repeat(64)),[]);
    await assert.rejects(rpc(db,'restore',{},'f'.repeat(64)),e=>e.code==='42501');
    await assert.rejects(rpc(db,'cancel',{id:b.id},other),e=>e.code==='42501');
    await reset();
  });
  await t.test('prazo e alterações de expediente são validados no banco', async () => {
    await rpc(db,'settings',{cancellation_minutes:120},null,ownerId);
    const hash = await token(), b = await book('09:00',[corte],hash);
    await assert.rejects(rpc(db,'save_barber',{id:barber,name:'Nicolas',phone:'5515996855412',hours:[]},null,ownerId), /afeta reservas/);
    await db.query("update barber_private.bookings set starts_at=now()+interval '1 hour' where id=$1",[b.id]);
    await assert.rejects(rpc(db,'cancel',{id:b.id},hash), /prazo de cancelamento/);
    await assert.rejects(rpc(db,'reschedule',{id:b.id,start:`${day}T13:00:00-03:00`,barber_id:barber},hash), /não pode ser reagendado/);
    assert.equal((await rpc(db,'cancel',{id:b.id},null,ownerId)).status,'cancelado'); await reset();
  });
  await t.test('manutenção expira avisos sem conexão e saúde não expõe segredos', async () => {
    const b = await book('09:00');
    await db.query("update barber_private.notifications set created_at=now()-interval '2 days' where booking_id=$1",[b.id]);
    await db.query("select public.barber_queue('maintenance')");
    assert.equal((await db.query('select status from barber_private.notifications where booking_id=$1',[b.id])).rows[0].status,'failed');
    await db.query("select public.barber_health('heartbeat','{\"configured\":false,\"processed\":0}')");
    const health = (await db.query("select public.barber_health('read','{}',$1) h",[ownerId])).rows[0].h;
    assert.equal(health.queue.pending,0); assert.equal(health.queue.failed,1); assert.ok(health.worker.last_checked_at);
    const exportData = await rpc(db,'admin_export',{},null,ownerId);
    assert.ok(!JSON.stringify(exportData).includes('token_hash')); assert.ok(!JSON.stringify(exportData).includes('owner_email'));
    await reset();
  });
  await t.test('limites por operação e páginas de notificações são independentes e completos', async () => {
    for (let i=0;i<3;i++) assert.equal((await db.query("select public.barber_action_rate_limit('test:book',3) ok")).rows[0].ok,true);
    assert.equal((await db.query("select public.barber_action_rate_limit('test:book',3) ok")).rows[0].ok,false);
    assert.equal((await db.query("select public.barber_action_rate_limit('test:restore',3) ok")).rows[0].ok,true);
    await db.exec("update barber_private.rate_limits set window_start=now()-interval '11 minutes' where key='test:book'");
    assert.equal((await db.query("select public.barber_action_rate_limit('test:book',3) ok")).rows[0].ok,true);
    const b=await book('09:00');
    await db.query("insert into barber_private.notifications(booking_id,recipient,kind,dedupe_key,payload) select $1::uuid,'5511888888888','new','page-test-'||n,'{}'::jsonb from generate_series(1,120) n",[b.id]);
    const pages=await Promise.all([0,1,2].map(page=>rpc(db,'notifications',{page},null,ownerId)));
    assert.equal(pages[0].total,121); assert.deepEqual(pages.map(p=>p.items.length),[50,50,21]);
    assert.equal(new Set(pages.flatMap(p=>p.items.map(n=>n.id))).size,121);
    assert.ok(pages.every(p=>p.items.every(n=>!Object.hasOwn(n,'payload'))));
    assert.deepEqual((await rpc(db,'admin_data',{include_notifications:false},null,ownerId)).notifications,[]);
    await reset();
  });
  await t.test('MFA exige aal2 nos uploads após ativação e funções novas permanecem privadas', async () => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ownerId]);
    await db.exec("select set_config('request.jwt.claims','{\"aal\":\"aal1\"}',false)");
    assert.equal((await db.query('select barber_private.brand_owner() ok')).rows[0].ok,true);
    await db.query("insert into auth.mfa_factors(user_id,status) values($1,'verified')",[ownerId]);
    assert.equal((await db.query('select barber_private.brand_owner() ok')).rows[0].ok,false);
    await db.exec("select set_config('request.jwt.claims','{\"aal\":\"aal2\"}',false)");
    assert.equal((await db.query('select barber_private.brand_owner() ok')).rows[0].ok,true);
    for (const role of ['anon','authenticated']) for (const fn of ['public.barber_health(text,jsonb,uuid)','public.barber_action_rate_limit(text,integer,integer)','public.barber_rpc(text,jsonb,text,uuid)']) {
      assert.equal((await db.query('select has_function_privilege($1,$2,\'execute\') ok',[role,fn])).rows[0].ok,false);
    }
    assert.equal((await db.query("select has_table_privilege('authenticated','barber_private.worker_health','select') ok")).rows[0].ok,false);
    await assert.rejects(rpc(db,'admin_export',{},null,null),e=>e.code==='42501');
  });
});
