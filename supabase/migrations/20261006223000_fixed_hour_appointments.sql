-- Reservas e encaixes fixos de uma hora, independentes da estimativa dos serviços.
-- Mantém as permissões e a restrição transacional contra reservas sobrepostas.
LOCK TABLE barber_private.bookings IN SHARE ROW EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION barber_private.price_duration(p_barber uuid, p_services jsonb)
 RETURNS TABLE(total numeric, duration integer, items jsonb)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare n int;
begin
 if jsonb_typeof(p_services)<>'array' or jsonb_array_length(p_services) not between 1 and 12 then raise exception 'Selecione os serviços.';end if;
 select count(distinct value) into n from jsonb_array_elements_text(p_services);
 return query select sum(s.price),60::int,jsonb_agg(jsonb_build_object('service_id',s.id,'name',s.name,'price',s.price,'duration',s.duration) order by s.name) from public.services s join public.barber_services bs on bs.service_id=s.id where bs.barber_id=p_barber and s.active and s.id in (select value::uuid from jsonb_array_elements_text(p_services));
 if (select count(*) from public.services s join public.barber_services bs on bs.service_id=s.id where bs.barber_id=p_barber and s.active and s.id in(select value::uuid from jsonb_array_elements_text(p_services)))<>n then raise exception 'Um serviço está indisponível para este barbeiro.';end if;
end $function$;

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
 if exists(select 1 from barber_private.blocks b where b.barber_id=p_barber and tstzrange(b.starts_at,b.ends_at,'[)')&&tstzrange(p_start,t_end,'[)')) then return false;end if;
 return true;
end $function$;

CREATE OR REPLACE FUNCTION barber_private.slots(p_barber uuid, p_day date, p_duration integer, p_ignore uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 select coalesce(jsonb_agg(jsonb_build_object('start',t,'end',t+interval '1 hour') order by t),'[]') from generate_series(p_day::timestamp at time zone 'America/Sao_Paulo', (p_day+1)::timestamp at time zone 'America/Sao_Paulo'-interval '5 minutes',interval '5 minutes') t where barber_private.is_available(p_barber,t,60,p_ignore)
$function$;

CREATE OR REPLACE FUNCTION barber_private.agenda_slots(p_from date, p_to date, p_barber uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>6 then raise exception 'Selecione até sete dias para consultar a agenda.';end if;
 return (
  select coalesce(jsonb_agg(jsonb_build_object('barber_id',r.id,'day',d::date,'minimum_duration',60,'slots',barber_private.slots(r.id,d::date,60)) order by r.name,d),'[]'::jsonb)
  from public.barbers r cross join generate_series(p_from::timestamp,p_to::timestamp,interval '1 day') d
  join lateral (select min(service.duration)::int as duration from public.services service join public.barber_services bs on bs.service_id=service.id where bs.barber_id=r.id and service.active) s on s.duration is not null
  where r.active and (p_barber is null or r.id=p_barber)
 );
end $function$;

CREATE OR REPLACE FUNCTION barber_private.fixed_hour_booking()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  NEW.duration := 60;
  NEW.ends_at := NEW.starts_at + interval '1 hour';
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION barber_private.fixed_hour_booking() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION barber_private.fixed_hour_booking() TO service_role;
CREATE TRIGGER bookings_fixed_hour
BEFORE INSERT OR UPDATE OF starts_at, ends_at, duration ON barber_private.bookings
FOR EACH ROW EXECUTE FUNCTION barber_private.fixed_hour_booking();

-- Ajusta as reservas de hoje em diante que ocupam a agenda.
-- O histórico anterior, serviços, valores e pagamentos ficam preservados.
UPDATE barber_private.bookings
SET duration = 60, ends_at = starts_at + interval '1 hour', version = version + 1
WHERE (starts_at AT TIME ZONE 'America/Sao_Paulo')::date >= (now() AT TIME ZONE 'America/Sao_Paulo')::date
  AND status IN ('agendado', 'confirmado', 'em_atendimento', 'concluido')
  AND (duration <> 60 OR ends_at <> starts_at + interval '1 hour');
UPDATE barber_private.work_hours SET slot_minutes = 60 WHERE slot_minutes <> 60;
UPDATE barber_private.special_hours SET slot_minutes = 60 WHERE slot_minutes IS DISTINCT FROM 60;
SELECT barber_private.bump_signal();
