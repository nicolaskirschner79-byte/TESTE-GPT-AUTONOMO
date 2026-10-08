-- Mantém reservas de 60 minutos; tempo extra depende de uma decisão do proprietário.
CREATE INDEX booking_items_service_idx ON barber_private.booking_items(service_id);
CREATE INDEX expenses_barber_idx ON barber_private.expenses(barber_id);
CREATE INDEX payments_actor_idx ON barber_private.payments(actor_id);
CREATE INDEX bookings_phone_future_idx ON barber_private.bookings(customer_phone, starts_at)
  WHERE status IN ('agendado','confirmado','em_atendimento');
CREATE INDEX notifications_created_idx ON barber_private.notifications(created_at DESC, id);
ALTER TABLE barber_private.blocks ADD COLUMN booking_id uuid UNIQUE
  REFERENCES barber_private.bookings(id) ON DELETE CASCADE;

CREATE TABLE barber_private.worker_health (
  name text PRIMARY KEY CHECK (name = 'whatsapp'),
  last_checked_at timestamptz NOT NULL DEFAULT now(),
  configured boolean NOT NULL DEFAULT false,
  processed integer NOT NULL DEFAULT 0 CHECK (processed >= 0),
  last_error text
);
ALTER TABLE barber_private.worker_health ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON barber_private.worker_health FROM PUBLIC, anon, authenticated;
GRANT ALL ON barber_private.worker_health TO service_role;
CREATE POLICY server_only ON barber_private.worker_health FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE FUNCTION barber_private.owner_allowed(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM barber_private.administrators a
    JOIN auth.users u ON u.id = a.user_id
    JOIN barber_private.settings s ON s.id
    WHERE a.user_id = p_id AND u.email_confirmed_at IS NOT NULL
      AND lower(u.email) = lower(s.owner_email)
  )
$$;
REVOKE ALL ON FUNCTION barber_private.owner_allowed(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION barber_private.owner_allowed(uuid) TO service_role;

CREATE OR REPLACE FUNCTION barber_private.brand_owner() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT barber_private.owner_allowed((SELECT auth.uid())) AND (
    NOT EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = (SELECT auth.uid()) AND f.status = 'verified')
    OR (SELECT auth.jwt()->>'aal') = 'aal2'
  )
$$;
-- A policy de upload já usa brand_owner; o JWT é validado pelo Supabase Storage.
REVOKE ALL ON FUNCTION barber_private.brand_owner() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION barber_private.brand_owner() TO authenticated, service_role;

CREATE FUNCTION public.barber_action_rate_limit(p_key text, p_limit integer, p_seconds integer DEFAULT 600)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE attempts integer;
BEGIN
  IF p_limit NOT BETWEEN 1 AND 300 OR p_seconds NOT BETWEEN 1 AND 86400 THEN RAISE EXCEPTION 'Limite inválido.'; END IF;
  INSERT INTO barber_private.rate_limits(key, window_start, count) VALUES (p_key, now(), 1)
  ON CONFLICT(key) DO UPDATE SET
    count = CASE WHEN rate_limits.window_start < now()-make_interval(secs=>p_seconds) THEN 1 ELSE rate_limits.count+1 END,
    window_start = CASE WHEN rate_limits.window_start < now()-make_interval(secs=>p_seconds) THEN now() ELSE rate_limits.window_start END
  RETURNING count INTO attempts;
  RETURN attempts <= p_limit;
END $$;
REVOKE ALL ON FUNCTION public.barber_action_rate_limit(text,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.barber_action_rate_limit(text,integer,integer) TO service_role;

CREATE FUNCTION barber_private.expire_notifications() RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  UPDATE barber_private.notifications n SET status='failed', last_error='Lembrete invalidado: reserva alterada, sem consentimento ou horário passado.', updated_at=now()
  WHERE n.status='pending' AND n.kind='reminder' AND NOT EXISTS (
    SELECT 1 FROM barber_private.bookings b WHERE b.id=n.booking_id AND b.status IN ('agendado','confirmado')
      AND b.reminder_consent AND b.starts_at>now()
      AND b.starts_at=coalesce(n.booking_start,(n.payload->'booking'->>'starts_at')::timestamptz)
  );
  UPDATE barber_private.notifications SET status='failed', last_error='Aviso expirado antes da conexão do WhatsApp.', updated_at=now()
  WHERE status='pending' AND kind<>'reminder' AND created_at<now()-interval '24 hours';
  UPDATE barber_private.notifications SET status='unknown', last_error='Envio interrompido. Conferir o provedor antes de repetir.', updated_at=now()
  WHERE status='processing' AND lease_until<now();
END $$;
REVOKE ALL ON FUNCTION barber_private.expire_notifications() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION barber_private.expire_notifications() TO service_role;

CREATE FUNCTION public.barber_health(p_action text, p_payload jsonb DEFAULT '{}', p_admin_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_action='heartbeat' THEN
    INSERT INTO barber_private.worker_health(name, last_checked_at, configured, processed, last_error)
    VALUES ('whatsapp', now(), coalesce((p_payload->>'configured')::boolean,false), coalesce((p_payload->>'processed')::integer,0), left(p_payload->>'error',500))
    ON CONFLICT(name) DO UPDATE SET last_checked_at=excluded.last_checked_at, configured=excluded.configured, processed=excluded.processed, last_error=excluded.last_error;
    RETURN jsonb_build_object('ok',true);
  ELSIF p_action='read' AND barber_private.owner_allowed(p_admin_id) THEN
    RETURN jsonb_build_object(
      'worker',(SELECT to_jsonb(h) FROM barber_private.worker_health h WHERE name='whatsapp'),
      'queue',(SELECT jsonb_build_object('pending',count(*) FILTER(WHERE status IN ('pending','processing')),
        'failed',count(*) FILTER(WHERE status='failed'),'unknown',count(*) FILTER(WHERE status='unknown'),
        'oldest_pending_at',min(created_at) FILTER(WHERE status IN ('pending','processing')))
        FROM barber_private.notifications WHERE created_at>now()-interval '30 days')
    );
  END IF;
  RAISE EXCEPTION 'Acesso administrativo não autorizado.' USING errcode='42501';
END $$;
REVOKE ALL ON FUNCTION public.barber_health(text,jsonb,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.barber_health(text,jsonb,uuid) TO service_role;

CREATE OR REPLACE FUNCTION barber_private.booking_json(p_id uuid) RETURNS jsonb
LANGUAGE sql SET search_path = '' AS $$
  SELECT to_jsonb(b)-'client_id'-'idempotency_key'||jsonb_build_object(
    'barber_name',r.name,
    'items',(SELECT coalesce(jsonb_agg(to_jsonb(i)-'id'-'booking_id'),'[]') FROM barber_private.booking_items i WHERE i.booking_id=b.id),
    'forecast_minutes',(SELECT coalesce(sum(i.duration),0) FROM barber_private.booking_items i WHERE i.booking_id=b.id),
    'extra_block',(SELECT jsonb_build_object('id',x.id,'starts_at',x.starts_at,'ends_at',x.ends_at) FROM barber_private.blocks x WHERE x.booking_id=b.id),
    'paid',coalesce((SELECT sum(CASE WHEN p.kind='payment' THEN p.amount ELSE -p.amount END) FROM barber_private.payments p WHERE p.booking_id=b.id),0))
  FROM barber_private.bookings b JOIN public.barbers r ON r.id=b.barber_id WHERE b.id=p_id
$$;

CREATE FUNCTION barber_private.reserve_extra(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE b barber_private.bookings%rowtype; h record; extra integer; finish timestamptz; d date;
BEGIN
  SELECT * INTO b FROM barber_private.bookings WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR b.status NOT IN ('agendado','confirmado','em_atendimento') OR b.ends_at<=now() THEN
    RAISE EXCEPTION 'Tempo adicional disponível somente para atendimentos ativos que ainda não terminaram.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(b.barber_id::text,0));
  SELECT greatest(0,ceil(coalesce(sum(duration),0)/60.0)::integer-1)*60 INTO extra FROM barber_private.booking_items WHERE booking_id=p_id;
  IF extra=0 THEN RAISE EXCEPTION 'A previsão dos serviços cabe na reserva de uma hora.'; END IF;
  finish:=b.ends_at+make_interval(mins=>extra); d:=(b.starts_at AT TIME ZONE 'America/Sao_Paulo')::date;
  SELECT * INTO h FROM barber_private.special_hours WHERE barber_id=b.barber_id AND day=d;
  IF FOUND THEN
    IF h.closed THEN RAISE EXCEPTION 'O profissional está fechado neste dia.'; END IF;
  ELSE
    SELECT * INTO h FROM barber_private.work_hours WHERE barber_id=b.barber_id AND weekday=extract(dow FROM d)::integer;
    IF NOT FOUND THEN RAISE EXCEPTION 'Não há expediente neste dia.'; END IF;
  END IF;
  IF (finish AT TIME ZONE 'America/Sao_Paulo')::date<>d OR (finish AT TIME ZONE 'America/Sao_Paulo')::time>h.closes
    OR (h.lunch_start IS NOT NULL AND (b.ends_at AT TIME ZONE 'America/Sao_Paulo')::time<h.lunch_end AND (finish AT TIME ZONE 'America/Sao_Paulo')::time>h.lunch_start) THEN
    RAISE EXCEPTION 'O tempo adicional ultrapassa o expediente ou o almoço. Reagende para um intervalo maior.';
  END IF;
  IF EXISTS(SELECT 1 FROM barber_private.bookings x WHERE x.barber_id=b.barber_id AND x.id<>b.id AND x.status IN ('agendado','confirmado','em_atendimento','concluido') AND tstzrange(x.starts_at,x.ends_at,'[)')&&tstzrange(b.ends_at,finish,'[)'))
    OR EXISTS(SELECT 1 FROM barber_private.blocks x WHERE x.barber_id=b.barber_id AND x.booking_id IS DISTINCT FROM b.id AND tstzrange(x.starts_at,x.ends_at,'[)')&&tstzrange(b.ends_at,finish,'[)')) THEN
    RAISE EXCEPTION 'O tempo adicional está ocupado. A reserva original foi mantida.' USING errcode='23P01';
  END IF;
  INSERT INTO barber_private.blocks(barber_id,starts_at,ends_at,reason,booking_id)
  VALUES(b.barber_id,b.ends_at,finish,'Tempo adicional do atendimento #'||left(b.id::text,8),b.id)
  ON CONFLICT(booking_id) DO UPDATE SET starts_at=excluded.starts_at,ends_at=excluded.ends_at;
  RETURN barber_private.booking_json(b.id);
END $$;
REVOKE ALL ON FUNCTION barber_private.reserve_extra(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION barber_private.reserve_extra(uuid) TO service_role;

CREATE FUNCTION barber_private.release_extra() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.barber_id IS DISTINCT FROM OLD.barber_id OR NEW.status IN ('cancelado','nao_compareceu') THEN
    DELETE FROM barber_private.blocks WHERE booking_id=NEW.id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION barber_private.release_extra() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION barber_private.release_extra() TO service_role;
CREATE TRIGGER bookings_release_extra AFTER UPDATE OF starts_at,barber_id,status ON barber_private.bookings
FOR EACH ROW EXECUTE FUNCTION barber_private.release_extra();

CREATE OR REPLACE FUNCTION barber_private.is_available(p_barber uuid, p_start timestamp with time zone, p_duration integer, p_ignore uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare d date;h record;special record;local_start timestamp;local_end timestamp;t_end timestamptz;anchor time;mins numeric;
begin
 local_start:=p_start at time zone 'America/Sao_Paulo';d:=local_start::date;t_end:=p_start+interval '1 hour';local_end:=t_end at time zone 'America/Sao_Paulo';
 if p_start<=now() or d>(now() at time zone 'America/Sao_Paulo')::date+180 or local_end::date<>d then return false;end if;
 if not exists(select 1 from public.barbers where id=p_barber and active) then return false;end if;
 select * into h from barber_private.work_hours where barber_id=p_barber and weekday=extract(dow from d)::int;
 select * into special from barber_private.special_hours where barber_id=p_barber and day=d;
 if found then if special.closed then return false;end if; h:=special;elsif h is null then return false;end if;
 if local_start::time<h.opens or local_end::time>h.closes then return false;end if;
 if h.lunch_start is not null and local_start::time<h.lunch_end and local_end::time>h.lunch_start then return false;end if;
 anchor:=case when h.lunch_end is not null and local_start::time>=h.lunch_end then h.lunch_end else h.opens end;
 mins:=extract(epoch from(local_start::time-anchor))/60;
 if mod(mins,60)<>0 then return false;end if;
 if exists(select 1 from barber_private.bookings b where b.barber_id=p_barber and (p_ignore is null or b.id<>p_ignore) and b.status in ('agendado','confirmado','em_atendimento','concluido') and tstzrange(b.starts_at,b.ends_at,'[)')&&tstzrange(p_start,t_end,'[)')) then return false;end if;
 if exists(select 1 from barber_private.blocks b where b.barber_id=p_barber and (p_ignore is null or b.booking_id is distinct from p_ignore) and tstzrange(b.starts_at,b.ends_at,'[)')&&tstzrange(p_start,t_end,'[)')) then return false;end if;
 return true;
end $function$;


CREATE OR REPLACE FUNCTION public.barber_rpc(p_action text, p_payload jsonb DEFAULT '{}'::jsonb, p_token_hash text DEFAULT NULL::text, p_admin_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare admin boolean;client uuid;b barber_private.bookings%rowtype;br uuid;s record;item jsonb;result jsonb;st timestamptz;v_id uuid;v_name text;v_phone text;paid numeric;amt numeric;key uuid;start_day date;end_day date;candidate record;old_snapshot jsonb;
begin
 admin:=barber_private.owner_allowed(p_admin_id);
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
 elsif p_action='restore' then
  if client is null then raise exception 'Chave de acesso não encontrada. Use a chave salva ao agendar.' using errcode='42501';end if;
  return jsonb_build_object('ok',true);
 elsif p_action='session' then
  if p_token_hash is null or length(p_token_hash)<>64 then raise exception 'Identidade do dispositivo inválida.' using errcode='42501';end if;
  insert into barber_private.clients(token_hash) values(p_token_hash) on conflict(token_hash) do nothing;return jsonb_build_object('ok',true);
 elsif p_action='mine' then
  if client is null then return '[]'::jsonb;end if;
  return (select coalesce(jsonb_agg(barber_private.booking_json(x.id) order by x.starts_at desc),'[]') from barber_private.bookings x where client_id=client);
 elsif p_action='book' then
  if not admin and client is null then raise exception 'Identidade do dispositivo não encontrada.' using errcode='42501';end if;
  key:=(p_payload->>'idempotency_key')::uuid;
  select * into b from barber_private.bookings where idempotency_key=key;
  if found then if admin or b.client_id=client then return barber_private.booking_json(b.id);else raise exception 'Solicitação inválida.' using errcode='42501';end if;end if;
  v_name:=trim(p_payload->>'name');v_phone:=p_payload->>'phone';
  if v_name is null or length(v_name) not between 2 and 100 or v_phone !~ '^55[1-9][0-9]{9,10}$' or v_phone is null then raise exception 'Informe um nome e celular válidos.';end if;
  -- Locks por telefone e dispositivo também cobrem reservas simultâneas com outros barbeiros.
  if not admin then
   perform pg_advisory_xact_lock(hashtextextended('phone:'||v_phone,0));
   perform pg_advisory_xact_lock(hashtextextended('client:'||client::text,0));
  end if;
  br:=(p_payload->>'barber_id')::uuid;perform pg_advisory_xact_lock(hashtextextended(br::text,0));
  select * into b from barber_private.bookings where idempotency_key=key;
  if found then if admin or b.client_id=client then return barber_private.booking_json(b.id);else raise exception 'Solicitação inválida.' using errcode='42501';end if;end if;

  if not admin and (select count(*) from barber_private.bookings where client_id=client and starts_at>now() and status in('agendado','confirmado','em_atendimento'))>=5 then raise exception 'Você já possui cinco agendamentos futuros. Cancele um antes de reservar outro.';end if;
  if not admin and (select count(*) from barber_private.bookings where customer_phone=v_phone and starts_at>now() and status in('agendado','confirmado','em_atendimento'))>=5 then raise exception 'Este celular já possui cinco agendamentos futuros. Fale com a barbearia antes de reservar outro.';end if;
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
   if not coalesce(((b.status='agendado' and p_payload->>'status' in('confirmado','nao_compareceu')) or (b.status='confirmado' and p_payload->>'status' in('em_atendimento','nao_compareceu')) or (b.status in('agendado','confirmado','em_atendimento') and paid>=b.total and p_payload->>'status'='concluido')),false) then raise exception 'Transição de status inválida.';end if;
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
   if amt is null or amt<=0 or amt<>round(amt,2) then raise exception 'Informe um valor positivo com até duas casas decimais.';end if;
   if p_action='pay' and (b.status not in('agendado','confirmado','em_atendimento','concluido') or paid+amt>b.total) then raise exception 'Pagamento incompatível com o atendimento ou acima do saldo.';end if;
   if p_action='refund' and amt>paid then raise exception 'Estorno acima do valor recebido.';end if;
   insert into barber_private.payments(booking_id,amount,kind,method,idempotency_key,actor_id) values(v_id,amt,case when p_action='pay' then 'payment' else 'refund' end,p_payload->>'method',key,p_admin_id);
   if p_action='pay' then
    update barber_private.bookings set status=case when coalesce((p_payload->>'complete')::boolean,false) then 'concluido' else status end,version=version+1 where bookings.id=v_id;
   end if;
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
 if p_action='reserve_extra' then
  v_id:=(p_payload->>'id')::uuid;result:=barber_private.reserve_extra(v_id);
  insert into barber_private.audit(actor_id,action,entity_id) values(p_admin_id,p_action,v_id);
  perform barber_private.bump_signal();return result;
 elsif p_action='notifications' then
  if coalesce((p_payload->>'page')::int,0)<0 then raise exception 'Página inválida.';end if;
  return jsonb_build_object('page',coalesce((p_payload->>'page')::int,0),'page_size',50,
   'total',(select count(*) from barber_private.notifications where created_at>now()-interval '30 days'),
   'items',(select coalesce(jsonb_agg(to_jsonb(x)-'payload' order by created_at desc,id),'[]') from
    (select * from barber_private.notifications where created_at>now()-interval '30 days' order by created_at desc,id limit 50 offset (least(coalesce((p_payload->>'page')::int,0),100000)*50)) x));
 elsif p_action='admin_export' then
  return jsonb_build_object('format','barber-operational-export-v1','exported_at',now(),
   'bookings',(select coalesce(jsonb_agg(barber_private.booking_json(x.id) order by starts_at),'[]') from barber_private.bookings x),
   'payments',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from barber_private.payments x),
   'expenses',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from barber_private.expenses x),
   'barbers',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.barbers x),
   'services',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.services x),
   'barber_services',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.barber_services x),
   'hours',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from barber_private.work_hours x),
   'special_hours',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from barber_private.special_hours x),
   'blocks',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from barber_private.blocks x),
   'settings',(select to_jsonb(x)-'owner_email' from barber_private.settings x where x.id));
 elsif p_action='admin_data' then
  start_day:=coalesce((p_payload->>'from')::date,(now() at time zone 'America/Sao_Paulo')::date);end_day:=coalesce((p_payload->>'to')::date,start_day);
  if end_day<start_day or end_day-start_day>366 then raise exception 'Selecione um período de até um ano.';end if;
  if p_payload->'include_agenda'='true'::jsonb and end_day-start_day>6 then raise exception 'A agenda diária ou semanal deve ter até sete dias.';end if;
  return jsonb_build_object('agenda_slots',case when p_payload->'include_agenda'='true'::jsonb then barber_private.agenda_slots(start_day,end_day,nullif(p_payload->>'barber_id','')::uuid) else '[]'::jsonb end,'bookings',(select coalesce(jsonb_agg(barber_private.booking_json(x.id) order by starts_at),'[]') from barber_private.bookings x where ((starts_at at time zone 'America/Sao_Paulo')::date between start_day and end_day or status='em_atendimento') and (p_payload->>'barber_id' is null or barber_id=(p_payload->>'barber_id')::uuid)),
   'payments',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from barber_private.payments x join barber_private.bookings pay_booking on pay_booking.id=x.booking_id where (x.created_at at time zone 'America/Sao_Paulo')::date between start_day and end_day and (p_payload->>'barber_id' is null or pay_booking.barber_id=(p_payload->>'barber_id')::uuid)),
   'expenses',(select coalesce(jsonb_agg(to_jsonb(x) order by day desc),'[]') from barber_private.expenses x where day between start_day and end_day and(p_payload->>'barber_id' is null or x.barber_id=(p_payload->>'barber_id')::uuid)),
   'notifications',case when p_payload->'include_notifications'='false'::jsonb then '[]'::jsonb else (select coalesce(jsonb_agg(to_jsonb(x)-'payload' order by created_at desc),'[]') from (select * from barber_private.notifications where created_at>now()-interval '30 days' order by created_at desc,id limit 200) x) end,
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
   for item in select value from jsonb_array_elements(p_payload->'hours') loop insert into barber_private.work_hours(barber_id,weekday,opens,closes,lunch_start,lunch_end,slot_minutes) values(v_id,(item->>'weekday')::int,(item->>'opens')::time,(item->>'closes')::time,nullif(item->>'lunch_start','')::time,nullif(item->>'lunch_end','')::time,60);end loop;
   if exists(
    select 1 from barber_private.bookings x where x.barber_id=v_id and x.starts_at>now() and x.status in('agendado','confirmado','em_atendimento')
     and not exists(select 1 from barber_private.special_hours sp where sp.barber_id=v_id and sp.day=(x.starts_at at time zone 'America/Sao_Paulo')::date)
     and not exists(select 1 from barber_private.work_hours h where h.barber_id=v_id and h.weekday=extract(dow from x.starts_at at time zone 'America/Sao_Paulo')::int
       and (x.starts_at at time zone 'America/Sao_Paulo')::time>=h.opens and (greatest(x.ends_at,coalesce((select z.ends_at from barber_private.blocks z where z.booking_id=x.id),x.ends_at)) at time zone 'America/Sao_Paulo')::time<=h.closes
       and (h.lunch_start is null or (x.starts_at at time zone 'America/Sao_Paulo')::time>=h.lunch_end or (greatest(x.ends_at,coalesce((select z.ends_at from barber_private.blocks z where z.booking_id=x.id),x.ends_at)) at time zone 'America/Sao_Paulo')::time<=h.lunch_start))
   ) then raise exception 'O novo expediente afeta reservas futuras. Resolva-as antes de salvar.';end if;
  end if;
 elsif p_action='block' then
  v_id:=gen_random_uuid();br:=(p_payload->>'barber_id')::uuid;perform pg_advisory_xact_lock(hashtextextended(br::text,0));st:=(p_payload->>'start')::timestamptz;
  if exists(select 1 from barber_private.bookings where barber_id=br and status in('agendado','confirmado','em_atendimento') and tstzrange(st,(p_payload->>'end')::timestamptz,'[)')&&tstzrange(starts_at,ends_at,'[)')) then raise exception 'O bloqueio afeta reservas existentes. Resolva-as primeiro.';end if;
  insert into barber_private.blocks(id,barber_id,starts_at,ends_at,reason) values(v_id,br,st,(p_payload->>'end')::timestamptz,coalesce(p_payload->>'reason','Indisponível'));
 elsif p_action='delete_block' then v_id:=(p_payload->>'id')::uuid;delete from barber_private.blocks where blocks.id=v_id;
 elsif p_action='special_hours' then
  br:=(p_payload->>'barber_id')::uuid;perform pg_advisory_xact_lock(hashtextextended(br::text,0));
  if exists(select 1 from barber_private.bookings where barber_id=br and (starts_at at time zone 'America/Sao_Paulo')::date=(p_payload->>'day')::date and status in('agendado','confirmado','em_atendimento')) then raise exception 'Há reservas neste dia. Resolva-as antes de alterar o funcionamento.';end if;
  insert into barber_private.special_hours(barber_id,day,closed,opens,closes,lunch_start,lunch_end,slot_minutes) values(br,(p_payload->>'day')::date,coalesce((p_payload->>'closed')::boolean,false),nullif(p_payload->>'opens','')::time,nullif(p_payload->>'closes','')::time,nullif(p_payload->>'lunch_start','')::time,nullif(p_payload->>'lunch_end','')::time,60) on conflict(barber_id,day) do update set closed=excluded.closed,opens=excluded.opens,closes=excluded.closes,lunch_start=excluded.lunch_start,lunch_end=excluded.lunch_end,slot_minutes=excluded.slot_minutes;
 elsif p_action='delete_special' then
  v_id:=(p_payload->>'id')::uuid;
  select barber_id into br from barber_private.special_hours where id=v_id;
  perform pg_advisory_xact_lock(hashtextextended(br::text,0));
  if exists(select 1 from barber_private.bookings b join barber_private.special_hours sp on sp.id=v_id and sp.barber_id=b.barber_id
   where (b.starts_at at time zone 'America/Sao_Paulo')::date=sp.day and b.starts_at>now() and b.status in('agendado','confirmado','em_atendimento')) then
   raise exception 'Há reservas neste dia. Resolva-as antes de remover o horário especial.';
  end if;
  delete from barber_private.special_hours where special_hours.id=v_id;
 elsif p_action='expense' then v_id:=gen_random_uuid();insert into barber_private.expenses(id,description,amount,day,barber_id) values(v_id,trim(p_payload->>'description'),(p_payload->>'amount')::numeric,(p_payload->>'day')::date,nullif(p_payload->>'barber_id','')::uuid);
 elsif p_action='settings' then perform barber_private.save_settings(p_payload);
 elsif p_action='whoami' then return jsonb_build_object('admin',true);
 else raise exception 'Operação inválida.';end if;
 insert into barber_private.audit(actor_id,action,entity_id) values(p_admin_id,p_action,v_id);perform barber_private.bump_signal();return jsonb_build_object('ok',true,'id',v_id);
end $function$;

revoke all on function public.barber_rpc(text,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.barber_rpc(text,jsonb,text,uuid) to service_role;

create or replace function public.barber_queue(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; job barber_private.notifications%rowtype; valid boolean;
begin
 if p_action='maintenance' then
  perform barber_private.expire_notifications();return jsonb_build_object('ok',true);
 elsif p_action='enqueue_reminders' then
  return jsonb_build_object('queued',barber_private.enqueue_due_reminders());
 elsif p_action='claim' then
  perform barber_private.expire_notifications();
  with pending as (
   select id from barber_private.notifications where status='pending' and next_attempt<=now()
    and (scheduled_for is null or scheduled_for<=now())
    and (not automatic or coalesce((p_payload->>'automatic_enabled')::boolean,true))
    and (p_payload->'kinds' is null or p_payload->'kinds' ? kind)
   order by (kind='reminder') desc,coalesce(scheduled_for,created_at),created_at limit 5 for update skip locked
  ), claimed as (
   update barber_private.notifications n set status='processing',lease_until=now()+interval '2 minutes',attempts=attempts+1,updated_at=now()
   from pending p where n.id=p.id returning n.*
  ) select coalesce(jsonb_agg(to_jsonb(claimed)),'[]') into result from claimed;return result;
 elsif p_action='prepare' then
  select * into job from barber_private.notifications where id=(p_payload->>'id')::uuid and status='processing';
  if not found then return null;end if;
  if job.kind='reminder' then
   select exists(select 1 from barber_private.bookings b where b.id=job.booking_id and b.status in ('agendado','confirmado') and b.reminder_consent
    and b.starts_at>now() and b.starts_at=coalesce(job.booking_start,(job.payload->'booking'->>'starts_at')::timestamptz)) into valid;
   if not valid then
    update barber_private.notifications set status='failed',last_error='Lembrete invalidado antes do envio.',lease_until=null,updated_at=now() where id=job.id;return null;
   end if;
   job.payload:=jsonb_build_object('booking',barber_private.booking_json(job.booking_id),'shop_name',(select shop_name from barber_private.settings where id));
  end if;
  return to_jsonb(job);
 elsif p_action='result' then
  update barber_private.notifications set
   status=case when status in ('read','delivered') then status when status='sent' and p_payload->>'status' in ('pending','unknown','failed') then status else p_payload->>'status' end,
   provider_id=coalesce(p_payload->>'provider_id',provider_id),last_error=left(p_payload->>'error',1000),
   next_attempt=now()+make_interval(secs=>least(3600,(power(2,attempts)*30)::int)),lease_until=null,updated_at=now()
   where id=(p_payload->>'id')::uuid;
 elsif p_action='webhook' then
  update barber_private.notifications set status=case when p_payload->>'status'='read' then 'read' when p_payload->>'status'='delivered' and status<>'read' then 'delivered' when p_payload->>'status'='sent' and status not in ('read','delivered') then 'sent' when p_payload->>'status'='failed' and status not in ('read','delivered') then 'failed' else status end,
   provider_id=coalesce(provider_id,p_payload->>'provider_id'),last_error=coalesce(p_payload->>'error',last_error),updated_at=now()
   where provider_id=p_payload->>'provider_id' or (id::text=p_payload->>'job_id' and provider_id is null);
 elsif p_action='retry' then
  update barber_private.notifications set status='pending',next_attempt=now(),updated_at=now()
   where id=(p_payload->>'id')::uuid and status='failed' and (not automatic or booking_start>now());
 else raise exception 'Operação inválida.';end if;
 return jsonb_build_object('ok',true);
end $$;

ALTER TABLE barber_private.work_hours ADD CONSTRAINT work_hours_fixed_interval CHECK(slot_minutes=60);
ALTER TABLE barber_private.special_hours ADD CONSTRAINT special_hours_fixed_interval CHECK(slot_minutes=60);
