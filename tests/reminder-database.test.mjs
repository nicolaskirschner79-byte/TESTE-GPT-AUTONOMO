import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Banco Postgres isolado em memória. Vault simulado somente nesta fixture.
const setup=`
 create role anon;create role authenticated;create role service_role;
 create schema barber_private;create schema auth;create schema vault;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create table barber_private.administrators(user_id uuid primary key);
 create table barber_private.settings(id boolean primary key,shop_name text,owner_email text);
 insert into barber_private.settings values(true,'Barbearia','owner@example.test');
 create table barber_private.bookings(id uuid primary key default gen_random_uuid(),customer_name text default 'Cliente',customer_phone text default '5511888888888',starts_at timestamptz not null,status text default 'agendado',reminder_consent boolean default true);
 create table barber_private.notifications(id uuid primary key default gen_random_uuid(),booking_id uuid not null references barber_private.bookings(id),recipient text not null,kind text not null,dedupe_key text not null unique,payload jsonb not null,status text default 'pending',attempts integer default 0,next_attempt timestamptz default now(),lease_until timestamptz,provider_id text unique,last_error text,created_at timestamptz default now(),updated_at timestamptz default now());
 create function barber_private.booking_json(p_id uuid) returns jsonb language sql as $$ select to_jsonb(b)||jsonb_build_object('items','[]'::jsonb) from barber_private.bookings b where b.id=p_id $$;
 create table vault.decrypted_secrets(id uuid default gen_random_uuid() primary key,name text unique,decrypted_secret text);
 create function vault.create_secret(s text,n text,d text) returns uuid language plpgsql as $$declare i uuid;begin insert into vault.decrypted_secrets(name,decrypted_secret) values(n,s) returning id into i;return i;end$$;
 create function vault.update_secret(i uuid,s text) returns void language sql as $$update vault.decrypted_secrets set decrypted_secret=s where id=i$$;
`;
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function queue(db,action,payload={}){return (await db.query('select public.barber_queue($1,$2::jsonb) result',[action,JSON.stringify(payload)])).rows[0].result;}
async function book(db,n,minutes,opts={}){await db.query("insert into barber_private.bookings(id,starts_at,status,reminder_consent) values($1,now()+make_interval(mins=>$2),$3,$4)",[id(n),minutes,opts.status??'agendado',opts.consent??true]);}

test('migração e regras reais de lembrete no Postgres isolado',async t=>{
 const db=new PGlite();t.after(()=>db.close());await db.exec(setup);
 const files=await import('node:fs/promises');const migrations=await files.readdir(new URL('../supabase/migrations/',import.meta.url));
 const name=migrations.find(n=>n.endsWith('_automatic_whatsapp_reminders.sql'));
 await db.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'));
 await t.test('limite de 30 minutos, consentimento, status e repetição do cron',async()=>{
  await book(db,1,31);await book(db,2,29);await book(db,3,5);await book(db,4,-1);await book(db,5,29,{consent:false});await book(db,6,29,{status:'cancelado'});await book(db,7,29,{status:'confirmado'});
  assert.equal((await queue(db,'enqueue_reminders')).queued,3);assert.equal((await queue(db,'enqueue_reminders')).queued,0);
  const rows=(await db.query("select * from barber_private.notifications")).rows;
  assert.deepEqual(rows.map(x=>x.booking_id).sort(),[id(2),id(3),id(7)]);assert.ok(rows.every(x=>(new Date(x.booking_start)-new Date(x.scheduled_for))===30*60000));
 });
 await t.test('cancelamento e reagendamento invalidam fila e criam um novo lembrete apenas no novo horário',async()=>{
  await db.query("update barber_private.bookings set status='cancelado' where id=$1",[id(2)]);
  assert.equal((await db.query('select status from barber_private.notifications where booking_id=$1',[id(2)])).rows[0].status,'failed');
  await db.query("update barber_private.bookings set starts_at=now()+interval '2 hours' where id=$1",[id(3)]);
  assert.equal((await db.query('select status from barber_private.notifications where booking_id=$1',[id(3)])).rows[0].status,'failed');assert.equal((await queue(db,'enqueue_reminders')).queued,0);
  await db.query("update barber_private.bookings set starts_at=now()+interval '29 minutes' where id=$1",[id(3)]);assert.equal((await queue(db,'enqueue_reminders')).queued,1);
 });
 await t.test('confirmar não produz outro lembrete; pausa e claim consecutivo não duplicam',async()=>{
  await db.query("update barber_private.bookings set status='confirmado' where id=$1",[id(3)]);assert.equal((await queue(db,'enqueue_reminders')).queued,0);
  assert.equal((await queue(db,'claim',{kinds:['reminder'],automatic_enabled:false})).length,0);
  const jobs=await queue(db,'claim',{kinds:['reminder'],automatic_enabled:true});assert.equal(jobs.length,2);assert.equal((await queue(db,'claim',{kinds:['reminder']})).length,0);
  const canceled=jobs.find(x=>x.booking_id===id(7));await db.query("update barber_private.bookings set status='cancelado' where id=$1",[id(7)]);
  assert.equal(await queue(db,'prepare',{id:canceled.id}),null);
 });
 await t.test('webhook entregue não é rebaixado por resposta tardia; lease expirado não é reenviado',async()=>{
  const note=(await db.query("select id from barber_private.notifications where booking_id=$1 and status='processing'",[id(3)])).rows[0];
  await queue(db,'webhook',{job_id:note.id,provider_id:'wamid.qa',status:'delivered'});await queue(db,'result',{id:note.id,status:'sent',provider_id:'wamid.qa'});
  assert.equal((await db.query('select status from barber_private.notifications where id=$1',[note.id])).rows[0].status,'delivered');
  await book(db,8,29);await queue(db,'enqueue_reminders');await queue(db,'claim',{kinds:['reminder']});
  await db.query("update barber_private.notifications set lease_until=now()-interval '1 minute' where booking_id=$1",[id(8)]);
  assert.equal((await queue(db,'claim',{kinds:['reminder']})).length,0);assert.equal((await db.query('select status from barber_private.notifications where booking_id=$1',[id(8)])).rows[0].status,'unknown');
 });
 await t.test('lembrete manual na janela impede automático e reservas expiradas não são enviadas',async()=>{
  await book(db,9,10);
  await db.query("insert into barber_private.notifications(booking_id,recipient,kind,dedupe_key,payload,status,created_at) select id,customer_phone,'reminder','manual-qa',jsonb_build_object('booking',barber_private.booking_json(id)),'sent',now()-interval '19 minutes' from barber_private.bookings where id=$1",[id(9)]);
  assert.equal((await queue(db,'enqueue_reminders')).queued,0);
  await book(db,10,1);await queue(db,'enqueue_reminders');
  await db.query("update barber_private.bookings set starts_at=now()-interval '1 minute' where id=$1",[id(10)]);
  assert.equal((await queue(db,'claim',{kinds:['reminder']})).length,0);
  const note=(await db.query('select status from barber_private.notifications where booking_id=$1',[id(10)])).rows[0];assert.equal(note.status,'failed');
 });
 await t.test('anon e authenticated não podem ler os segredos; gravação exige proprietário verificado',async()=>{
  const perms=(await db.query("select has_function_privilege('anon','public.barber_whatsapp_config(text,jsonb,uuid)','execute') a,has_function_privilege('authenticated','public.barber_whatsapp_config(text,jsonb,uuid)','execute') b")).rows[0];assert.equal(perms.a,false);assert.equal(perms.b,false);
  await assert.rejects(db.query("select public.barber_whatsapp_config('write','{}',$1)",[id(99)]),e=>e.code==='42501');
  await db.query("insert into auth.users values($1,'owner@example.test',now())",[id(99)]);await db.query('insert into barber_private.administrators values($1)',[id(99)]);
  await db.query("select public.barber_whatsapp_config('write',$1::jsonb,$2)",[JSON.stringify({access_token:'qa-token'}),id(99)]);
  assert.equal((await db.query("select public.barber_whatsapp_config('read') c")).rows[0].c.access_token,'qa-token');
 });
});
