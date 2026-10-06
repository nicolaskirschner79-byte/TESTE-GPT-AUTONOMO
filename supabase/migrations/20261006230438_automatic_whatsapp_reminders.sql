-- Configuração criptografada; somente o backend pode ler o token.
create function barber_private.whatsapp_config(p_action text,p_payload jsonb default '{}',p_admin_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare secret_id uuid; value jsonb;
begin
 if p_action not in ('read','write') then raise exception 'Operação inválida.';end if;
 if p_action='write' and not exists(
  select 1 from barber_private.administrators a join auth.users u on u.id=a.user_id
  join barber_private.settings s on s.id
  where a.user_id=p_admin_id and u.email_confirmed_at is not null and lower(u.email)=lower(s.owner_email)
 ) then raise exception 'Acesso administrativo não autorizado.' using errcode='42501';end if;
 select id,decrypted_secret::jsonb into secret_id,value from vault.decrypted_secrets where name='barber_whatsapp_config';
 if p_action='write' then
  if secret_id is null then perform vault.create_secret(p_payload::text,'barber_whatsapp_config','Configuração privada do WhatsApp');
  else perform vault.update_secret(secret_id,p_payload::text);end if;
  return jsonb_build_object('ok',true);
 end if;
 return coalesce(value,'{}'::jsonb);
end $$;
revoke all on function barber_private.whatsapp_config(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function barber_private.whatsapp_config(text,jsonb,uuid) to service_role;
create function public.barber_whatsapp_config(p_action text,p_payload jsonb default '{}',p_admin_id uuid default null) returns jsonb
language sql security invoker set search_path='' as $$ select barber_private.whatsapp_config(p_action,p_payload,p_admin_id) $$;
revoke all on function public.barber_whatsapp_config(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.barber_whatsapp_config(text,jsonb,uuid) to service_role;

alter table barber_private.notifications add column automatic boolean not null default false;
alter table barber_private.notifications add column booking_start timestamptz;
alter table barber_private.notifications add column scheduled_for timestamptz;
create index bookings_reminder_due_idx on barber_private.bookings(starts_at) where reminder_consent and status in ('agendado','confirmado');

-- A chave usa o instante da reserva, não a versão (que também muda com confirmação/pagamento).
create function barber_private.enqueue_due_reminders() returns integer
language plpgsql security invoker set search_path='' as $$
declare inserted integer;
begin
 insert into barber_private.notifications(booking_id,recipient,kind,dedupe_key,payload,automatic,booking_start,scheduled_for)
 select b.id,b.customer_phone,'reminder',b.id::text||':automatic:'||extract(epoch from b.starts_at)::text,
  jsonb_build_object('booking',barber_private.booking_json(b.id),'shop_name',s.shop_name),true,b.starts_at,b.starts_at-interval '30 minutes'
 from barber_private.bookings b cross join barber_private.settings s
 where s.id and b.reminder_consent and b.status in ('agendado','confirmado')
  and b.starts_at>now() and b.starts_at<=now()+interval '30 minutes'
  and not exists(select 1 from barber_private.notifications n where n.booking_id=b.id and n.kind='reminder'
   and not n.automatic and n.created_at>=b.starts_at-interval '30 minutes'
   and n.status in ('pending','processing','sent','delivered','read','unknown')
   and (n.payload->'booking'->>'starts_at')::timestamptz=b.starts_at)
 on conflict(dedupe_key) do nothing;
 get diagnostics inserted=row_count;return inserted;
end $$;
revoke all on function barber_private.enqueue_due_reminders() from public,anon,authenticated;
grant execute on function barber_private.enqueue_due_reminders() to service_role;

-- Reagendamentos, cancelamentos e atendimentos iniciados invalidam a fila imediatamente.
create function barber_private.invalidate_reminders() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.starts_at is distinct from old.starts_at or not new.reminder_consent or new.status not in ('agendado','confirmado') then
  update barber_private.notifications set status='failed',last_error='Lembrete invalidado por alteração da reserva.',updated_at=now()
   where booking_id=new.id and kind='reminder' and status='pending';
 end if;return new;
end $$;
revoke all on function barber_private.invalidate_reminders() from public,anon,authenticated;
grant execute on function barber_private.invalidate_reminders() to service_role;
create trigger bookings_invalidate_reminders after update of starts_at,status,reminder_consent on barber_private.bookings
for each row execute function barber_private.invalidate_reminders();

create or replace function public.barber_queue(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb; job barber_private.notifications%rowtype; valid boolean;
begin
 if p_action='enqueue_reminders' then
  return jsonb_build_object('queued',barber_private.enqueue_due_reminders());
 elsif p_action='claim' then
  update barber_private.notifications n set status='failed',last_error='Lembrete invalidado: reserva alterada, sem consentimento ou horário passado.',updated_at=now()
   where n.status='pending' and n.kind='reminder' and not exists(
    select 1 from barber_private.bookings b where b.id=n.booking_id and b.status in ('agendado','confirmado') and b.reminder_consent and b.starts_at>now()
     and b.starts_at=coalesce(n.booking_start,(n.payload->'booking'->>'starts_at')::timestamptz));
  -- A conexão inicial não dispara avisos antigos acumulados.
  update barber_private.notifications set status='failed',last_error='Aviso expirado antes da conexão do WhatsApp.',updated_at=now()
   where status='pending' and kind<>'reminder' and created_at<now()-interval '24 hours';
  update barber_private.notifications set status='unknown',last_error='Envio interrompido. Conferir o provedor antes de repetir.',updated_at=now()
   where status='processing' and lease_until<now();
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
