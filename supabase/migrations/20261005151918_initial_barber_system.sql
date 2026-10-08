-- Sistema Barber: somente catálogo e sinal de disponibilidade são públicos.
create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;
create schema if not exists barber_private;
revoke all on schema barber_private from public, anon, authenticated;
grant usage on schema barber_private to service_role;

create table barber_private.settings (
 id boolean primary key default true check(id), shop_name text not null default 'Sistema Barber',
 timezone text not null default 'America/Sao_Paulo' check(timezone='America/Sao_Paulo'),
 owner_email text not null default 'nicolaskirschner79@gmail.com', cancellation_minutes int not null default 0 check(cancellation_minutes>=0)
);
insert into barber_private.settings(id) values(true);
create table barber_private.administrators(user_id uuid primary key references auth.users(id) on delete cascade);
create table public.barbers(id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 2 and 100), photo_url text, active boolean not null default true);
create table public.services(id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 2 and 100), description text not null default '', price numeric(10,2) not null check(price>=0), duration int not null check(duration between 5 and 480), active boolean not null default true);
create table public.barber_services(barber_id uuid references public.barbers(id) on delete cascade, service_id uuid references public.services(id) on delete cascade, primary key(barber_id,service_id));
create index barber_services_service_idx on public.barber_services(service_id);
create table public.availability_signal(id int primary key check(id=1), revision bigint not null default 0, updated_at timestamptz not null default now());
insert into public.availability_signal(id) values(1);
create table barber_private.barber_contacts(barber_id uuid primary key references public.barbers(id), phone text not null check(phone ~ '^55[1-9][0-9]{9,10}$'));
create table barber_private.work_hours(barber_id uuid references public.barbers(id), weekday int check(weekday between 0 and 6), opens time not null, closes time not null, lunch_start time, lunch_end time, slot_minutes int not null default 60 check(slot_minutes between 5 and 240), check(opens<closes), check((lunch_start is null and lunch_end is null) or (opens<=lunch_start and lunch_start<lunch_end and lunch_end<=closes)), primary key(barber_id,weekday));
create table barber_private.special_hours(id uuid primary key default gen_random_uuid(), barber_id uuid not null references public.barbers(id), day date not null, closed boolean not null default false, opens time, closes time, lunch_start time, lunch_end time, slot_minutes int default 60 check(slot_minutes between 5 and 240), unique(barber_id,day), check(closed or (opens is not null and closes is not null and opens<closes)), check((lunch_start is null and lunch_end is null) or (opens<=lunch_start and lunch_start<lunch_end and lunch_end<=closes)));
create table barber_private.clients(id uuid primary key default gen_random_uuid(), token_hash text not null unique check(length(token_hash)=64), name text, phone text, created_at timestamptz not null default now());
create table barber_private.bookings(id uuid primary key default gen_random_uuid(), client_id uuid references barber_private.clients(id), barber_id uuid not null references public.barbers(id), customer_name text not null, customer_phone text not null check(customer_phone ~ '^55[1-9][0-9]{9,10}$'), starts_at timestamptz not null, ends_at timestamptz not null, total numeric(10,2) not null check(total>=0), duration int not null check(duration>0), status text not null default 'agendado' check(status in ('agendado','confirmado','concluido','cancelado','nao_compareceu')), reminder_consent boolean not null default false, idempotency_key uuid not null unique, created_at timestamptz not null default now(), cancelled_at timestamptz, cancelled_by uuid, cancel_reason text, version int not null default 1, check(ends_at>starts_at), constraint no_overlapping_bookings exclude using gist (barber_id with =, tstzrange(starts_at,ends_at,'[)') with &&) where (status in ('agendado','confirmado','concluido')));
create index bookings_client_idx on barber_private.bookings(client_id, starts_at desc);
create index bookings_day_idx on barber_private.bookings(starts_at,barber_id);
create table barber_private.booking_items(id uuid primary key default gen_random_uuid(),booking_id uuid not null references barber_private.bookings(id) on delete cascade,service_id uuid not null references public.services(id),name text not null,price numeric(10,2) not null,duration int not null);
create index booking_items_booking_idx on barber_private.booking_items(booking_id);
create table barber_private.blocks(id uuid primary key default gen_random_uuid(),barber_id uuid not null references public.barbers(id), starts_at timestamptz not null,ends_at timestamptz not null,reason text not null default 'Indisponível',check(ends_at>starts_at));
create index blocks_barber_idx on barber_private.blocks(barber_id,starts_at);
create table barber_private.payments(id uuid primary key default gen_random_uuid(),booking_id uuid not null references barber_private.bookings(id),amount numeric(10,2) not null check(amount>0),kind text not null check(kind in ('payment','refund')),method text not null check(method in ('pix','dinheiro','debito','credito','outro')),idempotency_key uuid not null unique,created_at timestamptz not null default now(),actor_id uuid not null references auth.users(id));
create index payments_booking_idx on barber_private.payments(booking_id);
create index payments_date_idx on barber_private.payments(created_at);
create table barber_private.expenses(id uuid primary key default gen_random_uuid(),description text not null check(length(description)>1),amount numeric(10,2) not null check(amount>0),day date not null,barber_id uuid references public.barbers(id),created_at timestamptz not null default now());
create index expenses_day_idx on barber_private.expenses(day);
create table barber_private.consents(id uuid primary key default gen_random_uuid(),booking_id uuid not null references barber_private.bookings(id),allowed boolean not null,source text not null default 'booking',created_at timestamptz not null default now());
create index consents_booking_idx on barber_private.consents(booking_id);
create table barber_private.notifications(id uuid primary key default gen_random_uuid(),booking_id uuid not null references barber_private.bookings(id),recipient text not null,kind text not null,dedupe_key text not null unique,payload jsonb not null,status text not null default 'pending' check(status in ('pending','processing','sent','delivered','read','failed','unknown')),attempts int not null default 0,next_attempt timestamptz not null default now(),lease_until timestamptz,provider_id text unique,last_error text,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index notifications_queue_idx on barber_private.notifications(next_attempt) where status in ('pending','processing');
create index notifications_booking_idx on barber_private.notifications(booking_id);
create table barber_private.audit(id bigint generated always as identity primary key,actor_id uuid,action text not null,entity_id uuid,details jsonb not null default '{}',created_at timestamptz not null default now());
create table barber_private.rate_limits(key text primary key,window_start timestamptz not null,count int not null);

-- Vincular o proprietário somente após o Supabase verificar o endereço de e-mail.
create function barber_private.owner_verified() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.email_confirmed_at is not null and lower(new.email)=(select lower(owner_email) from barber_private.settings where id) then
  insert into barber_private.administrators(user_id) values(new.id) on conflict do nothing;
 end if;
 return new;
end $$;
revoke all on function barber_private.owner_verified() from public;
create trigger barber_owner_verified after insert or update of email_confirmed_at on auth.users for each row execute function barber_private.owner_verified();
insert into barber_private.administrators select id from auth.users where email_confirmed_at is not null and lower(email)='nicolaskirschner79@gmail.com' on conflict do nothing;

create function barber_private.bump_signal() returns void language sql set search_path='' as $$ update public.availability_signal set revision=revision+1,updated_at=clock_timestamp() where id=1 $$;
create function barber_private.price_duration(p_barber uuid,p_services jsonb) returns table(total numeric,duration int,items jsonb) language plpgsql set search_path='' as $$
declare n int;
begin
 if jsonb_typeof(p_services)<>'array' or jsonb_array_length(p_services) not between 1 and 12 then raise exception 'Selecione os serviços.';end if;
 select count(distinct value) into n from jsonb_array_elements_text(p_services);
 return query select sum(s.price),sum(s.duration)::int,jsonb_agg(jsonb_build_object('service_id',s.id,'name',s.name,'price',s.price,'duration',s.duration) order by s.name) from public.services s join public.barber_services bs on bs.service_id=s.id where bs.barber_id=p_barber and s.active and s.id in (select value::uuid from jsonb_array_elements_text(p_services));
 if (select count(*) from public.services s join public.barber_services bs on bs.service_id=s.id where bs.barber_id=p_barber and s.active and s.id in(select value::uuid from jsonb_array_elements_text(p_services)))<>n then raise exception 'Um serviço está indisponível para este barbeiro.';end if;
end $$;

create function barber_private.is_available(p_barber uuid,p_start timestamptz,p_duration int,p_ignore uuid default null) returns boolean language plpgsql set search_path='' as $$
declare d date;h record;special record;local_start timestamp;local_end timestamp;t_end timestamptz;anchor time;mins numeric;
begin
 local_start:=p_start at time zone 'America/Sao_Paulo';d:=local_start::date;t_end:=p_start+make_interval(mins=>p_duration);local_end:=t_end at time zone 'America/Sao_Paulo';
 if p_start<=now() or d>(now() at time zone 'America/Sao_Paulo')::date+180 or local_end::date<>d or p_duration not between 5 and 480 then return false;end if;
 if not exists(select 1 from public.barbers where id=p_barber and active) then return false;end if;
 select * into h from barber_private.work_hours where barber_id=p_barber and weekday=extract(dow from d)::int;
 select * into special from barber_private.special_hours where barber_id=p_barber and day=d;
 if found then if special.closed then return false;end if; h:=special;elsif h is null then return false;end if;
 if local_start::time<h.opens or local_end::time>h.closes then return false;end if;
 if h.lunch_start is not null and local_start::time<h.lunch_end and local_end::time>h.lunch_start then return false;end if;
 anchor:=case when h.lunch_end is not null and local_start::time>=h.lunch_end then h.lunch_end else h.opens end;
 mins:=extract(epoch from(local_start::time-anchor))/60;
 if mod(mins,h.slot_minutes)<>0 then return false;end if;
 if exists(select 1 from barber_private.bookings b where b.barber_id=p_barber and (p_ignore is null or b.id<>p_ignore) and b.status in ('agendado','confirmado','concluido') and tstzrange(b.starts_at,b.ends_at,'[)')&&tstzrange(p_start,t_end,'[)')) then return false;end if;
 if exists(select 1 from barber_private.blocks b where b.barber_id=p_barber and tstzrange(b.starts_at,b.ends_at,'[)')&&tstzrange(p_start,t_end,'[)')) then return false;end if;
 return true;
end $$;
create function barber_private.slots(p_barber uuid,p_day date,p_duration int,p_ignore uuid default null) returns jsonb language sql set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('start',t,'end',t+make_interval(mins=>p_duration)) order by t),'[]') from generate_series(p_day::timestamp at time zone 'America/Sao_Paulo', (p_day+1)::timestamp at time zone 'America/Sao_Paulo'-interval '5 minutes',interval '5 minutes') t where barber_private.is_available(p_barber,t,p_duration,p_ignore)
$$;
create function barber_private.booking_json(p_id uuid) returns jsonb language sql set search_path='' as $$
 select to_jsonb(b)-'client_id'-'idempotency_key'||jsonb_build_object('barber_name',r.name,'items',(select coalesce(jsonb_agg(to_jsonb(i)-'id'-'booking_id'),'[]') from barber_private.booking_items i where i.booking_id=b.id),'paid',coalesce((select sum(case when p.kind='payment' then p.amount else -p.amount end) from barber_private.payments p where p.booking_id=b.id),0)) from barber_private.bookings b join public.barbers r on r.id=b.barber_id where b.id=p_id
$$;
create function barber_private.queue_owner(p_id uuid,p_kind text) returns void language plpgsql set search_path='' as $$
declare b record;phone text;day date;summary text;payload jsonb;
begin
 select * into b from barber_private.bookings where id=p_id;select c.phone into phone from barber_private.barber_contacts c where c.barber_id=b.barber_id;if phone is null then return;end if;
 day:=(b.starts_at at time zone 'America/Sao_Paulo')::date;
 select string_agg(to_char(x.starts_at at time zone 'America/Sao_Paulo','HH24:MI')||' '||x.customer_name||' · R$'||x.total::text,'; ' order by x.starts_at) into summary from barber_private.bookings x where x.barber_id=b.barber_id and (x.starts_at at time zone 'America/Sao_Paulo')::date=day and x.status in ('agendado','confirmado');
 payload:=jsonb_build_object('booking',barber_private.booking_json(p_id),'event',p_kind,'day',day,'day_summary',coalesce(summary,'Nenhum atendimento ativo.'),'shop_name',(select shop_name from barber_private.settings where id));
 insert into barber_private.notifications(booking_id,recipient,kind,dedupe_key,payload) values(p_id,phone,p_kind,p_id::text||':'||p_kind||':'||b.version,payload) on conflict(dedupe_key) do nothing;
end $$;

-- Esta função é invocável exclusivamente pela Edge Function com a chave de servidor.
create function public.barber_rpc(p_action text,p_payload jsonb default '{}',p_token_hash text default null,p_admin_id uuid default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare admin boolean;client uuid;b barber_private.bookings%rowtype;br uuid;s record;item jsonb;result jsonb;st timestamptz;v_id uuid;v_name text;v_phone text;paid numeric;amt numeric;key uuid;start_day date;end_day date;candidate record;
begin
 admin:=p_admin_id is not null and exists(select 1 from barber_private.administrators where user_id=p_admin_id);
 if p_admin_id is not null and not admin then raise exception 'Acesso administrativo não autorizado.' using errcode='42501';end if;
 if p_token_hash is not null then select c.id into client from barber_private.clients c where c.token_hash=p_token_hash;end if;
 if p_action='catalog' then
  return jsonb_build_object('shop_name',(select shop_name from barber_private.settings where settings.id),'services',(select coalesce(jsonb_agg(to_jsonb(x) order by x.name),'[]') from public.services x where active),'barbers',(select coalesce(jsonb_agg(to_jsonb(x) order by x.name),'[]') from public.barbers x where active),'barber_services',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.barber_services x),'cancellation_minutes',(select cancellation_minutes from barber_private.settings where settings.id));
 elsif p_action='slots' then
  br:=(p_payload->>'barber_id')::uuid;
  if p_payload->>'booking_id' is not null then
   select * into b from barber_private.bookings where bookings.id=(p_payload->>'booking_id')::uuid and (admin or client_id=client);
   if not found then raise exception 'Agendamento não encontrado.' using errcode='42501';end if;
   return barber_private.slots(br,(p_payload->>'day')::date,b.duration,b.id);
  end if;
  select * into s from barber_private.price_duration(br,p_payload->'services');return barber_private.slots(br,(p_payload->>'day')::date,s.duration);
 elsif p_action='session' then
  if p_token_hash is null or length(p_token_hash)<>64 then raise exception 'Identidade do dispositivo inválida.' using errcode='42501';end if;
  insert into barber_private.clients(token_hash) values(p_token_hash) on conflict(token_hash) do nothing;return jsonb_build_object('ok',true);
 elsif p_action='mine' then
  if client is null then raise exception 'Identidade do dispositivo não encontrada.' using errcode='42501';end if;
  return (select coalesce(jsonb_agg(barber_private.booking_json(x.id) order by x.starts_at desc),'[]') from barber_private.bookings x where client_id=client);
 elsif p_action='book' then
  if not admin and client is null then raise exception 'Identidade do dispositivo não encontrada.' using errcode='42501';end if;
  key:=(p_payload->>'idempotency_key')::uuid;
  select * into b from barber_private.bookings where idempotency_key=key;
  if found then if admin or b.client_id=client then return barber_private.booking_json(b.id);else raise exception 'Solicitação inválida.' using errcode='42501';end if;end if;
  br:=(p_payload->>'barber_id')::uuid;perform pg_advisory_xact_lock(hashtextextended(br::text,0));
  select * into b from barber_private.bookings where idempotency_key=key;
  if found then if admin or b.client_id=client then return barber_private.booking_json(b.id);else raise exception 'Solicitação inválida.' using errcode='42501';end if;end if;
  v_name:=trim(p_payload->>'name');v_phone:=p_payload->>'phone';
  if v_name is null or length(v_name) not between 2 and 100 or v_phone !~ '^55[1-9][0-9]{9,10}$' or v_phone is null then raise exception 'Informe um nome e celular válidos.';end if;
  if not admin and (select count(*) from barber_private.bookings where client_id=client and starts_at>now() and status in('agendado','confirmado'))>=5 then raise exception 'Você já possui cinco agendamentos futuros. Cancele um antes de reservar outro.';end if;
  select * into s from barber_private.price_duration(br,p_payload->'services');st:=(p_payload->>'start')::timestamptz;
  if not barber_private.is_available(br,st,s.duration) then raise exception 'Este horário acabou de ficar indisponível. Escolha outro.' using errcode='23P01';end if;
  insert into barber_private.bookings(client_id,barber_id,customer_name,customer_phone,starts_at,ends_at,total,duration,idempotency_key,reminder_consent) values(client,br,v_name,v_phone,st,st+make_interval(mins=>s.duration),s.total,s.duration,key,coalesce((p_payload->>'consent')::boolean,false)) returning bookings.id into v_id;
  for item in select value from jsonb_array_elements(s.items) loop insert into barber_private.booking_items(booking_id,service_id,name,price,duration) values(v_id,(item->>'service_id')::uuid,item->>'name',(item->>'price')::numeric,(item->>'duration')::int);end loop;
  update barber_private.clients set name=v_name,phone=v_phone where clients.id=client;
  insert into barber_private.consents(booking_id,allowed) values(v_id,coalesce((p_payload->>'consent')::boolean,false));perform barber_private.queue_owner(v_id,'new');perform barber_private.bump_signal();
  if admin then insert into barber_private.audit(actor_id,action,entity_id) values(p_admin_id,'manual_booking',v_id);end if;
  return barber_private.booking_json(v_id);
 elsif p_action in ('cancel','reschedule','status','pay','refund','remind') then
  v_id:=(p_payload->>'id')::uuid;
  select * into b from barber_private.bookings where bookings.id=v_id and (admin or client_id=client) for update;
  if not found then raise exception 'Agendamento não encontrado.' using errcode='42501';end if;
  if p_action in ('status','pay','refund','remind') and not admin then raise exception 'Acesso administrativo não autorizado.' using errcode='42501';end if;
  select coalesce(sum(case when kind='payment' then amount else -amount end),0) into paid from barber_private.payments where booking_id=v_id;
  if p_action='cancel' then
   if b.status='cancelado' then return barber_private.booking_json(v_id);end if;
   if b.status not in ('agendado','confirmado') then raise exception 'Este atendimento não pode ser cancelado.';end if;
   if not admin and now()+make_interval(mins=>(select cancellation_minutes from barber_private.settings where settings.id))>b.starts_at then raise exception 'O prazo de cancelamento terminou. Fale com a barbearia.';end if;
   update barber_private.bookings set status='cancelado',cancelled_at=now(),cancelled_by=p_admin_id,cancel_reason=left(p_payload->>'reason',500),version=version+1 where bookings.id=v_id;
   perform barber_private.queue_owner(v_id,'cancel');
  elsif p_action='reschedule' then
   if b.status not in('agendado','confirmado') or (not admin and now()+make_interval(mins=>(select cancellation_minutes from barber_private.settings where settings.id))>b.starts_at) then raise exception 'Este atendimento não pode ser reagendado.';end if;
   br:=coalesce((p_payload->>'barber_id')::uuid,b.barber_id);st:=(p_payload->>'start')::timestamptz;
   perform pg_advisory_xact_lock(hashtextextended(least(br::text,b.barber_id::text),0));if br<>b.barber_id then perform pg_advisory_xact_lock(hashtextextended(greatest(br::text,b.barber_id::text),0));end if;
   if exists(select 1 from barber_private.booking_items i where i.booking_id=v_id and not exists(select 1 from public.barber_services bs where bs.barber_id=br and bs.service_id=i.service_id)) then raise exception 'O barbeiro não realiza todos os serviços desta reserva.';end if;
   if not barber_private.is_available(br,st,b.duration,v_id) then raise exception 'O novo horário está ocupado. Seu agendamento original foi mantido.' using errcode='23P01';end if;
   update barber_private.bookings set status='confirmado',barber_id=br,starts_at=st,ends_at=st+make_interval(mins=>b.duration),version=version+1 where bookings.id=v_id;
   -- Avisar o barbeiro anterior antes e depois quando a atribuição muda.
   if br<>b.barber_id then insert into barber_private.notifications(booking_id,recipient,kind,dedupe_key,payload) select v_id,c.phone,'reschedule',v_id||':previous:'||(b.version+1),jsonb_build_object('booking',to_jsonb(b),'event','transfer','day',(b.starts_at at time zone 'America/Sao_Paulo')::date,'day_summary','Atendimento transferido para outro profissional.','shop_name','Sistema Barber') from barber_private.barber_contacts c where c.barber_id=b.barber_id;end if;
   perform barber_private.queue_owner(v_id,'reschedule');
  elsif p_action='status' then
   if not ((b.status='agendado' and p_payload->>'status' in('confirmado','nao_compareceu')) or (b.status='confirmado' and p_payload->>'status'='nao_compareceu')) then raise exception 'Transição de status inválida.';end if;
   update barber_private.bookings set status=p_payload->>'status',version=version+1 where bookings.id=v_id;
  elsif p_action in('pay','refund') then
   key:=(p_payload->>'idempotency_key')::uuid;
   if exists(select 1 from barber_private.payments where idempotency_key=key and booking_id=v_id) then return barber_private.booking_json(v_id);end if;
   amt:=(p_payload->>'amount')::numeric;
   if amt is null or amt<=0 then raise exception 'Informe um valor positivo.';end if;
   if p_action='pay' and (b.status not in('agendado','confirmado','concluido') or paid+amt>b.total) then raise exception 'Pagamento incompatível com o atendimento ou acima do saldo.';end if;
   if p_action='refund' and amt>paid then raise exception 'Estorno acima do valor recebido.';end if;
   insert into barber_private.payments(booking_id,amount,kind,method,idempotency_key,actor_id) values(v_id,amt,case when p_action='pay' then 'payment' else 'refund' end,p_payload->>'method',key,p_admin_id);
   if p_action='pay' then update barber_private.bookings set status='concluido',version=version+1 where bookings.id=v_id;end if;
  elsif p_action='remind' then
   if b.status not in('agendado','confirmado') or b.starts_at<=now() then raise exception 'Lembrete disponível somente para reservas futuras ativas.';end if;
   if not b.reminder_consent then raise exception 'O cliente não autorizou lembretes pelo WhatsApp.';end if;
   if exists(select 1 from barber_private.notifications where booking_id=v_id and kind='reminder' and created_at>now()-interval '15 minutes') then raise exception 'Um lembrete já foi solicitado nos últimos 15 minutos.';end if;
   insert into barber_private.notifications(booking_id,recipient,kind,dedupe_key,payload) values(v_id,b.customer_phone,'reminder',v_id||':reminder:'||floor(extract(epoch from now())/900)::text,jsonb_build_object('booking',barber_private.booking_json(v_id),'shop_name',(select shop_name from barber_private.settings where settings.id))) returning notifications.id into key;
   return jsonb_build_object('id',key,'status','pending');
  end if;
  insert into barber_private.audit(actor_id,action,entity_id,details) values(p_admin_id,p_action,v_id,jsonb_build_object('reason',left(p_payload->>'reason',500)));
  perform barber_private.bump_signal();return barber_private.booking_json(v_id);
 end if;
 if not admin then raise exception 'Acesso administrativo não autorizado.' using errcode='42501';end if;
 if p_action='admin_data' then
  start_day:=coalesce((p_payload->>'from')::date,(now() at time zone 'America/Sao_Paulo')::date);end_day:=coalesce((p_payload->>'to')::date,start_day);
  if end_day<start_day or end_day-start_day>366 then raise exception 'Selecione um período de até um ano.';end if;
  return jsonb_build_object('bookings',(select coalesce(jsonb_agg(barber_private.booking_json(x.id) order by starts_at),'[]') from barber_private.bookings x where (starts_at at time zone 'America/Sao_Paulo')::date between start_day and end_day and (p_payload->>'barber_id' is null or barber_id=(p_payload->>'barber_id')::uuid)),
   'payments',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from barber_private.payments x join barber_private.bookings b on b.id=x.booking_id where (x.created_at at time zone 'America/Sao_Paulo')::date between start_day and end_day and (p_payload->>'barber_id' is null or b.barber_id=(p_payload->>'barber_id')::uuid)),
   'expenses',(select coalesce(jsonb_agg(to_jsonb(x) order by day desc),'[]') from barber_private.expenses x where day between start_day and end_day and(p_payload->>'barber_id' is null or x.barber_id=(p_payload->>'barber_id')::uuid)),
   'notifications',(select coalesce(jsonb_agg(to_jsonb(x)-'payload' order by created_at desc),'[]') from barber_private.notifications x where created_at>now()-interval '30 days'),
   'barbers',(select coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('phone',c.phone)),'[]') from public.barbers x left join barber_private.barber_contacts c on c.barber_id=x.id),
   'services',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.services x),'barber_services',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.barber_services x),
   'hours',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from barber_private.work_hours x),'special_hours',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from barber_private.special_hours x),'blocks',(select coalesce(jsonb_agg(to_jsonb(x) order by starts_at),'[]') from barber_private.blocks x where ends_at>now()-interval '30 days'),'settings',(select to_jsonb(x)-'owner_email' from barber_private.settings x where x.id));
 elsif p_action='save_service' then
  v_id:=coalesce((p_payload->>'id')::uuid,gen_random_uuid());
  insert into public.services(id,name,description,price,duration,active) values(v_id,trim(p_payload->>'name'),coalesce(p_payload->>'description',''),(p_payload->>'price')::numeric,(p_payload->>'duration')::int,coalesce((p_payload->>'active')::boolean,true)) on conflict(id) do update set name=excluded.name,description=excluded.description,price=excluded.price,duration=excluded.duration,active=excluded.active;
  if p_payload ? 'barbers' then delete from public.barber_services where service_id=v_id;insert into public.barber_services select value::uuid,v_id from jsonb_array_elements_text(p_payload->'barbers') on conflict do nothing;end if;
 elsif p_action='save_barber' then
  v_id:=coalesce((p_payload->>'id')::uuid,gen_random_uuid());
  if coalesce((p_payload->>'active')::boolean,true)=false and exists(select 1 from barber_private.bookings where barber_id=v_id and starts_at>now() and status in('agendado','confirmado')) then raise exception 'Há reservas futuras. Cancele ou reagende cada uma antes de desativar este barbeiro.';end if;
  if p_payload->>'photo_url' is not null and p_payload->>'photo_url'<>'' and p_payload->>'photo_url' !~ '^https://' then raise exception 'A foto deve usar uma URL HTTPS.';end if;
  insert into public.barbers(id,name,photo_url,active) values(v_id,trim(p_payload->>'name'),nullif(p_payload->>'photo_url',''),coalesce((p_payload->>'active')::boolean,true)) on conflict(id) do update set name=excluded.name,photo_url=excluded.photo_url,active=excluded.active;
  insert into barber_private.barber_contacts(barber_id,phone) values(v_id,p_payload->>'phone') on conflict(barber_id) do update set phone=excluded.phone;
  if p_payload ? 'services' then delete from public.barber_services where barber_id=v_id;insert into public.barber_services select v_id,value::uuid from jsonb_array_elements_text(p_payload->'services') on conflict do nothing;end if;
  if p_payload ? 'hours' then
   perform pg_advisory_xact_lock(hashtextextended(v_id::text,0));delete from barber_private.work_hours where barber_id=v_id;
   for item in select value from jsonb_array_elements(p_payload->'hours') loop insert into barber_private.work_hours(barber_id,weekday,opens,closes,lunch_start,lunch_end,slot_minutes) values(v_id,(item->>'weekday')::int,(item->>'opens')::time,(item->>'closes')::time,nullif(item->>'lunch_start','')::time,nullif(item->>'lunch_end','')::time,(item->>'slot_minutes')::int);end loop;
  end if;
 elsif p_action='block' then
  v_id:=gen_random_uuid();br:=(p_payload->>'barber_id')::uuid;perform pg_advisory_xact_lock(hashtextextended(br::text,0));st:=(p_payload->>'start')::timestamptz;
  if exists(select 1 from barber_private.bookings where barber_id=br and status in('agendado','confirmado') and tstzrange(st,(p_payload->>'end')::timestamptz,'[)')&&tstzrange(starts_at,ends_at,'[)')) then raise exception 'O bloqueio afeta reservas existentes. Resolva-as primeiro.';end if;
  insert into barber_private.blocks(id,barber_id,starts_at,ends_at,reason) values(v_id,br,st,(p_payload->>'end')::timestamptz,coalesce(p_payload->>'reason','Indisponível'));
 elsif p_action='delete_block' then v_id:=(p_payload->>'id')::uuid;delete from barber_private.blocks where blocks.id=v_id;
 elsif p_action='special_hours' then
  br:=(p_payload->>'barber_id')::uuid;perform pg_advisory_xact_lock(hashtextextended(br::text,0));
  if exists(select 1 from barber_private.bookings where barber_id=br and (starts_at at time zone 'America/Sao_Paulo')::date=(p_payload->>'day')::date and status in('agendado','confirmado')) then raise exception 'Há reservas neste dia. Resolva-as antes de alterar o funcionamento.';end if;
  insert into barber_private.special_hours(barber_id,day,closed,opens,closes,lunch_start,lunch_end,slot_minutes) values(br,(p_payload->>'day')::date,coalesce((p_payload->>'closed')::boolean,false),nullif(p_payload->>'opens','')::time,nullif(p_payload->>'closes','')::time,nullif(p_payload->>'lunch_start','')::time,nullif(p_payload->>'lunch_end','')::time,coalesce((p_payload->>'slot_minutes')::int,60)) on conflict(barber_id,day) do update set closed=excluded.closed,opens=excluded.opens,closes=excluded.closes,lunch_start=excluded.lunch_start,lunch_end=excluded.lunch_end,slot_minutes=excluded.slot_minutes;
 elsif p_action='delete_special' then v_id:=(p_payload->>'id')::uuid;delete from barber_private.special_hours where special_hours.id=v_id;
 elsif p_action='expense' then v_id:=gen_random_uuid();insert into barber_private.expenses(id,description,amount,day,barber_id) values(v_id,trim(p_payload->>'description'),(p_payload->>'amount')::numeric,(p_payload->>'day')::date,nullif(p_payload->>'barber_id','')::uuid);
 elsif p_action='settings' then update barber_private.settings set shop_name=trim(p_payload->>'shop_name'),cancellation_minutes=(p_payload->>'cancellation_minutes')::int where settings.id;
 elsif p_action='whoami' then return jsonb_build_object('admin',true);
 else raise exception 'Operação inválida.';end if;
 insert into barber_private.audit(actor_id,action,entity_id) values(p_admin_id,p_action,v_id);perform barber_private.bump_signal();return jsonb_build_object('ok',true,'id',v_id);
end $$;
revoke all on function public.barber_rpc(text,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.barber_rpc(text,jsonb,text,uuid) to service_role;

create function public.barber_rate_limit(p_key text) returns boolean language plpgsql security invoker set search_path='' as $$
declare c int;
begin
 insert into barber_private.rate_limits(key,window_start,count) values(p_key,now(),1) on conflict(key) do update set count=case when rate_limits.window_start<now()-interval '10 minutes' then 1 else rate_limits.count+1 end,window_start=case when rate_limits.window_start<now()-interval '10 minutes' then now() else rate_limits.window_start end returning count into c;
 delete from barber_private.rate_limits where window_start<now()-interval '1 day';return c<=300;
end $$;
revoke all on function public.barber_rate_limit(text) from public,anon,authenticated;grant execute on function public.barber_rate_limit(text) to service_role;

-- A fila persiste mesmo que o provedor esteja indisponível. Lease evita workers concorrentes.
create function public.barber_queue(p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if p_action='claim' then
  update barber_private.notifications set status='unknown',last_error='Envio interrompido após iniciar a chamada. Verificar provedor antes de repetir.',updated_at=now() where status='processing' and lease_until<now();
  with pending as (select id from barber_private.notifications where status='pending' and next_attempt<=now() order by created_at limit 10 for update skip locked), claimed as(update barber_private.notifications n set status='processing',lease_until=now()+interval '2 minutes',attempts=attempts+1,updated_at=now() from pending p where n.id=p.id returning n.*) select coalesce(jsonb_agg(to_jsonb(claimed)),'[]') into result from claimed;
  return result;
 elsif p_action='result' then
  update barber_private.notifications set status=p_payload->>'status',provider_id=coalesce(p_payload->>'provider_id',provider_id),last_error=left(p_payload->>'error',1000),next_attempt=now()+make_interval(secs=>least(3600,(power(2,attempts)*30)::int)),lease_until=null,updated_at=now() where id=(p_payload->>'id')::uuid;
 elsif p_action='webhook' then
  update barber_private.notifications set status=case when p_payload->>'status'='read' then 'read' when p_payload->>'status'='delivered' and status<>'read' then 'delivered' when p_payload->>'status'='sent' and status not in('read','delivered') then 'sent' when p_payload->>'status'='failed' and status not in('read','delivered') then 'failed' else status end,last_error=coalesce(p_payload->>'error',last_error),updated_at=now() where provider_id=p_payload->>'provider_id';
 elsif p_action='retry' then
  -- Somente falhas explícitas podem ser repetidas automaticamente; timeout é ambíguo.
  update barber_private.notifications set status='pending',next_attempt=now(),updated_at=now() where id=(p_payload->>'id')::uuid and status='failed';
 else raise exception 'Operação inválida.';end if;return jsonb_build_object('ok',true);
end $$;
revoke all on function public.barber_queue(text,jsonb) from public,anon,authenticated;grant execute on function public.barber_queue(text,jsonb) to service_role;

-- RLS em todo o catálogo exposto e também nas tabelas privadas como defesa adicional.
alter table public.barbers enable row level security;alter table public.services enable row level security;alter table public.barber_services enable row level security;alter table public.availability_signal enable row level security;
create policy public_barbers on public.barbers for select to anon,authenticated using(active);
create policy public_services on public.services for select to anon,authenticated using(active);
create policy public_barber_services on public.barber_services for select to anon,authenticated using(exists(select 1 from public.barbers b where b.id=barber_id and b.active) and exists(select 1 from public.services s where s.id=service_id and s.active));
create policy public_signal on public.availability_signal for select to anon,authenticated using(true);
revoke all on public.barbers,public.services,public.barber_services,public.availability_signal from anon,authenticated;
grant select on public.barbers,public.services,public.barber_services,public.availability_signal to anon,authenticated;
do $$declare x record;begin for x in select tablename from pg_tables where schemaname='barber_private' loop execute format('alter table barber_private.%I enable row level security',x.tablename);end loop;end $$;
grant all on all tables in schema barber_private to service_role;grant all on all sequences in schema barber_private to service_role;grant execute on all functions in schema barber_private to service_role;
revoke all on all functions in schema barber_private from public,anon,authenticated;
grant all on public.barbers,public.services,public.barber_services,public.availability_signal to service_role;
alter publication supabase_realtime add table public.availability_signal;

-- Durações iniciais provisórias, editáveis pelo proprietário.
insert into public.barbers(name) values('Nicolas');
insert into barber_private.barber_contacts select id,'5515996855412' from public.barbers;
insert into public.services(name,description,price,duration) values('Corte','Corte personalizado e acabamento.',35,40),('Sobrancelha','Alinhamento e acabamento.',5,10),('Barba','Modelagem e acabamento da barba.',20,25),('Luzes','Clareamento e finalização.',110,120);
insert into public.barber_services select b.id,s.id from public.barbers b cross join public.services s;
insert into barber_private.work_hours select id,d,'09:00'::time,'19:00'::time,'12:00'::time,'13:00'::time,60 from public.barbers cross join generate_series(1,6) d;
