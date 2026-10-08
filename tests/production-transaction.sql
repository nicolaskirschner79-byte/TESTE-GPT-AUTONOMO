-- Smoke test no banco remoto: tudo é revertido no subtransaction final.
-- Não invoca Edge Functions, pg_net ou provedores de mensagens.
DO $smoke$
DECLARE owner_id uuid; barber_id uuid:=gen_random_uuid(); service_id uuid:=gen_random_uuid();
  hash text:=encode(extensions.gen_random_bytes(32),'hex'); day date:=(now() AT TIME ZONE 'America/Sao_Paulo')::date+2;
  booking jsonb; paid_booking jsonb; extra jsonb; start_at timestamptz;
BEGIN
  SELECT user_id INTO owner_id FROM barber_private.administrators WHERE barber_private.owner_allowed(user_id) LIMIT 1;
  IF owner_id IS NULL THEN RAISE EXCEPTION 'Proprietário verificado não encontrado.'; END IF;
  BEGIN
    INSERT INTO public.barbers(id,name) VALUES(barber_id,'Fixture transacional de publicação');
    INSERT INTO public.services(id,name,price,duration) VALUES(service_id,'Fixture serviço longo',110,120);
    INSERT INTO public.barber_services VALUES(barber_id,service_id);
    INSERT INTO barber_private.work_hours SELECT barber_id,n,'09:00'::time,'19:00'::time,'12:00'::time,'13:00'::time,60 FROM generate_series(0,6) n;
    PERFORM public.barber_rpc('session','{}',hash);
    start_at:=(day+time '09:00') AT TIME ZONE 'America/Sao_Paulo';
    booking:=public.barber_rpc('book',jsonb_build_object('name','Fixture de publicação','phone','5511000000000','barber_id',barber_id,'services',jsonb_build_array(service_id),'start',start_at,'consent',false,'idempotency_key',gen_random_uuid()),hash);
    IF (booking->>'duration')::integer<>60 OR (booking->>'forecast_minutes')::integer<>120 THEN RAISE EXCEPTION 'Reserva/previsão incorreta.'; END IF;
    extra:=public.barber_rpc('reserve_extra',jsonb_build_object('id',booking->>'id'),null,owner_id);
    IF extra->'extra_block' IS NULL OR extra->'extra_block'='null'::jsonb THEN RAISE EXCEPTION 'Bloqueio extra não criado.'; END IF;
    BEGIN
      PERFORM public.barber_rpc('book',jsonb_build_object('name','Fixture conflito','phone','5511000000000','barber_id',barber_id,'services',jsonb_build_array(service_id),'start',start_at+interval '1 hour','idempotency_key',gen_random_uuid()),hash);
      RAISE EXCEPTION 'Conflito não bloqueado.';
    EXCEPTION WHEN exclusion_violation THEN NULL; END;
    paid_booking:=public.barber_rpc('pay',jsonb_build_object('id',booking->>'id','amount',10,'method','pix','complete',false,'idempotency_key',gen_random_uuid()),null,owner_id);
    IF paid_booking->>'status'<>'agendado' OR (paid_booking->>'paid')::numeric<>10 THEN RAISE EXCEPTION 'Adiantamento concluiu atendimento.'; END IF;
    paid_booking:=public.barber_rpc('pay',jsonb_build_object('id',booking->>'id','amount',100,'method','pix','complete',false,'idempotency_key',gen_random_uuid()),null,owner_id);
    IF paid_booking->>'status'<>'agendado' THEN RAISE EXCEPTION 'Quitação antecipada concluiu atendimento.'; END IF;
    paid_booking:=public.barber_rpc('status',jsonb_build_object('id',booking->>'id','status','concluido','expected_version',paid_booking->'version'),null,owner_id);
    IF paid_booking->>'status'<>'concluido' THEN RAISE EXCEPTION 'Quitado não pôde ser concluído.'; END IF;
    PERFORM public.barber_rpc('cancel',jsonb_build_object('id',booking->>'id'),null,owner_id);
    IF EXISTS(SELECT 1 FROM barber_private.blocks WHERE booking_id=(booking->>'id')::uuid) THEN RAISE EXCEPTION 'Cancelamento manteve tempo extra.'; END IF;
    IF public.barber_rpc('restore','{}',hash)->>'ok'<>'true' THEN RAISE EXCEPTION 'Recuperação inválida.'; END IF;
    IF has_function_privilege('anon','public.barber_health(text,jsonb,uuid)','execute') OR has_function_privilege('authenticated','public.barber_rpc(text,jsonb,text,uuid)','execute') THEN RAISE EXCEPTION 'Função privada exposta.'; END IF;
    IF EXISTS(SELECT 1 FROM barber_private.notifications WHERE booking_id=(booking->>'id')::uuid) THEN RAISE EXCEPTION 'Fixture gerou comunicação externa.'; END IF;
    RAISE EXCEPTION 'Reverter fixtures concluídas.' USING ERRCODE='ZX001';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
  END;
END $smoke$;
SELECT true AS passed, 10 AS verified_rules, false AS persisted_test_bookings, false AS sent_messages;
