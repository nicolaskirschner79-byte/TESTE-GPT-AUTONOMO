-- Agenda diária/semanal e início real do atendimento, mantendo a autorização existente.
alter table barber_private.bookings drop constraint bookings_status_check;
alter table barber_private.bookings add constraint bookings_status_check check(status in('agendado','confirmado','em_atendimento','concluido','cancelado','nao_compareceu'));
alter table barber_private.bookings drop constraint no_overlapping_bookings;
alter table barber_private.bookings add constraint no_overlapping_bookings exclude using gist(barber_id with =,tstzrange(starts_at,ends_at,'[)') with &&) where(status in('agendado','confirmado','em_atendimento','concluido'));
create unique index bookings_one_in_progress_per_barber on barber_private.bookings(barber_id) where status='em_atendimento';

CREATE OR REPLACE FUNCTION barber_private.agenda_summary(p_barber uuid, p_day date)
 RETURNS text
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 select coalesce(string_agg(to_char(x.starts_at at time zone 'America/Sao_Paulo','HH24:MI')||'–'||to_char(x.ends_at at time zone 'America/Sao_Paulo','HH24:MI')||' '||x.customer_name||' · '||coalesce((select string_agg(i.name,' + ' order by i.name) from barber_private.booking_items i where i.booking_id=x.id),'')||' · R$'||x.total::text||' ['||x.status||']','; ' order by x.starts_at),'Nenhum atendimento ativo.') from barber_private.bookings x where x.barber_id=p_barber and (x.starts_at at time zone 'America/Sao_Paulo')::date=p_day and x.status in ('agendado','confirmado','em_atendimento')
$function$;


CREATE OR REPLACE FUNCTION barber_private.is_available(p_barber uuid, p_start timestamp with time zone, p_duration integer, p_ignore uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
 if exists(select 1 from barber_private.bookings b where b.barber_id=p_barber and (p_ignore is null or b.id<>p_ignore) and b.status in ('agendado','confirmado','em_atendimento','concluido') and tstzrange(b.starts_at,b.ends_at,'[)')&&tstzrange(p_start,t_end,'[)')) then return false;end if;
 if exists(select 1 from barber_private.blocks b where b.barber_id=p_barber and tstzrange(b.starts_at,b.ends_at,'[)')&&tstzrange(p_start,t_end,'[)')) then return false;end if;
 return true;
end $function$;

create function barber_private.agenda_slots(p_from date,p_to date,p_barber uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>6 then raise exception 'Selecione até sete dias para consultar a agenda.';end if;
 return (
  select coalesce(jsonb_agg(jsonb_build_object('barber_id',r.id,'day',d::date,'minimum_duration',s.duration,'slots',barber_private.slots(r.id,d::date,s.duration)) order by r.name,d),'[]'::jsonb)
  from public.barbers r cross join generate_series(p_from::timestamp,p_to::timestamp,interval '1 day') d
  join lateral (select min(service.duration)::int as duration from public.services service join public.barber_services bs on bs.service_id=service.id where bs.barber_id=r.id and service.active) s on s.duration is not null
  where r.active and (p_barber is null or r.id=p_barber)
 );
end $$;
revoke all on function barber_private.agenda_slots(date,date,uuid) from public,anon,authenticated;
grant execute on function barber_private.agenda_slots(date,date,uuid) to service_role;

CREATE OR REPLACE FUNCTION public.barber_rpc(p_action text, p_payload jsonb DEFAULT '{}'::jsonb, p_token_hash text DEFAULT NULL::text, p_admin_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare admin boolean;client uuid;b barber_private.bookings%rowtype;br uuid;s record;item jsonb;result jsonb;st timestamptz;v_id uuid;v_name text;v_phone text;paid numeric;amt numeric;key uuid;start_day date;end_day date;candidate record;old_snapshot jsonb;
begin
 admin:=p_admin_id is not null and exists(select 1 from barber_private.administrators where user_id=p_admin_id);
 if p_admin_id is not null and not admin then raise exception 'Acesso administrativo não autorizado.' using errcode='42501';end if;
 if p_token_hash is not null then select c.id into client from barber_private.clients c where c.token_hash=p_token_hash;end if;
 if p_action='catalog' then
  return jsonb_build_object('shop_name',(select shop_name from barber_private.settings where settings.id),'branding',(select branding from barber_private.settings where settings.id),'services',(select coalesce(jsonb_agg(to_jsonb(x) order by x.name),'[]') from public.services x where active),'barbers',(select coalesce(jsonb_agg(to_jsonb(x) order by x.name),'[]') from public.barbers x where active),'barber_services',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.barber_services x),'cancellation_minutes',(select cancellation_minutes from barber_private.settings where settings.id));
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
  if not admin and (select count(*) from barber_private.bookings where client_id=client and starts_at>now() and status in('agendado','confirmado','em_atendimento'))>=5 then raise exception 'Você já possui cinco agendamentos futuros. Cancele um antes de reservar outro.';end if;
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
   if b.status not in ('agendado','confirmado') and not (admin and b.status in('em_atendimento','concluido')) then raise exception 'Este atendimento não pode ser cancelado.';end if;
   if not admin and now()+make_interval(mins=>(select cancellation_minutes from barber_private.settings where settings.id))>b.starts_at then raise exception 'O prazo de cancelamento terminou. Fale com a barbearia.';end if;
   update barber_private.bookings set status='cancelado',cancelled_at=now(),cancelled_by=p_admin_id,cancel_reason=left(p_payload->>'reason',500),version=version+1 where bookings.id=v_id;
   perform barber_private.queue_owner(v_id,'cancel');
  elsif p_action='reschedule' then
   if b.status not in('agendado','confirmado') or (not admin and now()+make_interval(mins=>(select cancellation_minutes from barber_private.settings where settings.id))>b.starts_at) then raise exception 'Este atendimento não pode ser reagendado.';end if;
   br:=coalesce((p_payload->>'barber_id')::uuid,b.barber_id);st:=(p_payload->>'start')::timestamptz;
   perform pg_advisory_xact_lock(hashtextextended(least(br::text,b.barber_id::text),0));if br<>b.barber_id then perform pg_advisory_xact_lock(hashtextextended(greatest(br::text,b.barber_id::text),0));end if;
   if exists(select 1 from barber_private.booking_items i where i.booking_id=v_id and not exists(select 1 from public.barber_services bs where bs.barber_id=br and bs.service_id=i.service_id)) then raise exception 'O barbeiro não realiza todos os serviços desta reserva.';end if;
   if not barber_private.is_available(br,st,b.duration,v_id) then raise exception 'O novo horário está ocupado. Seu agendamento original foi mantido.' using errcode='23P01';end if;
   old_snapshot:=barber_private.booking_json(v_id);
   update barber_private.bookings set status='confirmado',barber_id=br,starts_at=st,ends_at=st+make_interval(mins=>b.duration),version=version+1 where bookings.id=v_id;
   -- Atualizar também a agenda do dia/profissional anterior, com os serviços originais.
   if br<>b.barber_id or (st at time zone 'America/Sao_Paulo')::date<>(b.starts_at at time zone 'America/Sao_Paulo')::date then
    insert into barber_private.notifications(booking_id,recipient,kind,dedupe_key,payload)
    select v_id,c.phone,'reschedule',v_id||':previous:'||(b.version+1),jsonb_build_object('booking',old_snapshot,'event',case when br<>b.barber_id then 'transfer' else 'reschedule' end,'day',(b.starts_at at time zone 'America/Sao_Paulo')::date,'day_summary',barber_private.agenda_summary(b.barber_id,(b.starts_at at time zone 'America/Sao_Paulo')::date),'shop_name',(select shop_name from barber_private.settings where settings.id)) from barber_private.barber_contacts c where c.barber_id=b.barber_id;
   end if;
   perform barber_private.queue_owner(v_id,'reschedule');
  elsif p_action='status' then
   if p_payload ? 'expected_version' and b.version is distinct from (p_payload->>'expected_version')::int then raise exception 'Este agendamento foi atualizado. Confira a agenda antes de tentar novamente.';end if;
   if not coalesce(((b.status='agendado' and p_payload->>'status' in('confirmado','nao_compareceu')) or (b.status='confirmado' and p_payload->>'status' in('em_atendimento','nao_compareceu')) or (b.status in('agendado','confirmado','em_atendimento') and b.total=0 and p_payload->>'status'='concluido')),false) then raise exception 'Transição de status inválida.';end if;
   if p_payload->>'status'='em_atendimento' then
    perform pg_advisory_xact_lock(hashtextextended(b.barber_id::text,0));
    if (b.starts_at at time zone 'America/Sao_Paulo')::date<>(now() at time zone 'America/Sao_Paulo')::date then raise exception 'Inicie o atendimento na data marcada.';end if;
    if not exists(select 1 from public.barbers where id=b.barber_id and active) then raise exception 'Este profissional está inativo.';end if;
    if exists(select 1 from barber_private.bookings where barber_id=b.barber_id and status='em_atendimento' and id<>b.id) then raise exception 'Este barbeiro já está atendendo. Conclua o atendimento atual antes de iniciar outro.';end if;
   end if;
   update barber_private.bookings set status=p_payload->>'status',version=version+1 where bookings.id=v_id;
  elsif p_action in('pay','refund') then
   key:=(p_payload->>'idempotency_key')::uuid;
   if exists(select 1 from barber_private.payments where idempotency_key=key and booking_id=v_id) then return barber_private.booking_json(v_id);end if;
   amt:=(p_payload->>'amount')::numeric;
   if amt is null or amt<=0 then raise exception 'Informe um valor positivo.';end if;
   if p_action='pay' and (b.status not in('agendado','confirmado','em_atendimento','concluido') or paid+amt>b.total) then raise exception 'Pagamento incompatível com o atendimento ou acima do saldo.';end if;
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
  if p_payload->'include_agenda'='true'::jsonb and end_day-start_day>6 then raise exception 'A agenda diária ou semanal deve ter até sete dias.';end if;
  return jsonb_build_object('agenda_slots',case when p_payload->'include_agenda'='true'::jsonb then barber_private.agenda_slots(start_day,end_day,nullif(p_payload->>'barber_id','')::uuid) else '[]'::jsonb end,'bookings',(select coalesce(jsonb_agg(barber_private.booking_json(x.id) order by starts_at),'[]') from barber_private.bookings x where ((starts_at at time zone 'America/Sao_Paulo')::date between start_day and end_day or status='em_atendimento') and (p_payload->>'barber_id' is null or barber_id=(p_payload->>'barber_id')::uuid)),
   'payments',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from barber_private.payments x join barber_private.bookings pay_booking on pay_booking.id=x.booking_id where (x.created_at at time zone 'America/Sao_Paulo')::date between start_day and end_day and (p_payload->>'barber_id' is null or pay_booking.barber_id=(p_payload->>'barber_id')::uuid)),
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
  if coalesce((p_payload->>'active')::boolean,true)=false and exists(select 1 from barber_private.bookings where barber_id=v_id and ((starts_at>now() and status in('agendado','confirmado')) or status='em_atendimento')) then raise exception 'Há reservas futuras. Cancele ou reagende cada uma antes de desativar este barbeiro.';end if;
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
  if exists(select 1 from barber_private.bookings where barber_id=br and status in('agendado','confirmado','em_atendimento') and tstzrange(st,(p_payload->>'end')::timestamptz,'[)')&&tstzrange(starts_at,ends_at,'[)')) then raise exception 'O bloqueio afeta reservas existentes. Resolva-as primeiro.';end if;
  insert into barber_private.blocks(id,barber_id,starts_at,ends_at,reason) values(v_id,br,st,(p_payload->>'end')::timestamptz,coalesce(p_payload->>'reason','Indisponível'));
 elsif p_action='delete_block' then v_id:=(p_payload->>'id')::uuid;delete from barber_private.blocks where blocks.id=v_id;
 elsif p_action='special_hours' then
  br:=(p_payload->>'barber_id')::uuid;perform pg_advisory_xact_lock(hashtextextended(br::text,0));
  if exists(select 1 from barber_private.bookings where barber_id=br and (starts_at at time zone 'America/Sao_Paulo')::date=(p_payload->>'day')::date and status in('agendado','confirmado','em_atendimento')) then raise exception 'Há reservas neste dia. Resolva-as antes de alterar o funcionamento.';end if;
  insert into barber_private.special_hours(barber_id,day,closed,opens,closes,lunch_start,lunch_end,slot_minutes) values(br,(p_payload->>'day')::date,coalesce((p_payload->>'closed')::boolean,false),nullif(p_payload->>'opens','')::time,nullif(p_payload->>'closes','')::time,nullif(p_payload->>'lunch_start','')::time,nullif(p_payload->>'lunch_end','')::time,coalesce((p_payload->>'slot_minutes')::int,60)) on conflict(barber_id,day) do update set closed=excluded.closed,opens=excluded.opens,closes=excluded.closes,lunch_start=excluded.lunch_start,lunch_end=excluded.lunch_end,slot_minutes=excluded.slot_minutes;
 elsif p_action='delete_special' then v_id:=(p_payload->>'id')::uuid;delete from barber_private.special_hours where special_hours.id=v_id;
 elsif p_action='expense' then v_id:=gen_random_uuid();insert into barber_private.expenses(id,description,amount,day,barber_id) values(v_id,trim(p_payload->>'description'),(p_payload->>'amount')::numeric,(p_payload->>'day')::date,nullif(p_payload->>'barber_id','')::uuid);
 elsif p_action='settings' then perform barber_private.save_settings(p_payload);
 elsif p_action='whoami' then return jsonb_build_object('admin',true);
 else raise exception 'Operação inválida.';end if;
 insert into barber_private.audit(actor_id,action,entity_id) values(p_admin_id,p_action,v_id);perform barber_private.bump_signal();return jsonb_build_object('ok',true,'id',v_id);
end $function$;

revoke all on function public.barber_rpc(text,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.barber_rpc(text,jsonb,text,uuid) to service_role;
