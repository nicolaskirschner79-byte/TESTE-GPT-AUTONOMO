create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
-- Vault mantém a credencial do worker fora do código, dos logs e do frontend.
select vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'barber_worker_key','Credencial interna do processamento da fila');
create function barber_private.worker_key_matches(p_key text) returns boolean language sql security definer set search_path='' as $$
 select length(p_key)=64 and exists(select 1 from vault.decrypted_secrets where name='barber_worker_key' and extensions.digest(decrypted_secret,'sha256')=extensions.digest(p_key,'sha256'))
$$;
revoke all on function barber_private.worker_key_matches(text) from public,anon,authenticated;
grant execute on function barber_private.worker_key_matches(text) to service_role;
create function public.barber_worker_authorized(p_key text) returns boolean language sql security invoker set search_path='' as $$ select barber_private.worker_key_matches(p_key) $$;
revoke all on function public.barber_worker_authorized(text) from public,anon,authenticated;
grant execute on function public.barber_worker_authorized(text) to service_role;
create function barber_private.notification_tick() returns void language plpgsql security definer set search_path='' as $$
begin
 perform net.http_post(url:='https://hvsqlrqegjbjqspaqcsc.supabase.co/functions/v1/whatsapp-worker',headers:=jsonb_build_object('Content-Type','application/json','x-worker-key',(select decrypted_secret from vault.decrypted_secrets where name='barber_worker_key' limit 1)),body:='{}'::jsonb,timeout_milliseconds:=10000);
end $$;
revoke all on function barber_private.notification_tick() from public,anon,authenticated;
select cron.schedule('barber-whatsapp-queue','* * * * *','select barber_private.notification_tick()');
