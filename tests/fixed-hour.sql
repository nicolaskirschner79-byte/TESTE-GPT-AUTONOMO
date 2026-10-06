-- Verificações de leitura: não criam reservas nem processam mensagens.
WITH professional AS (
  SELECT id FROM public.barbers WHERE active ORDER BY id LIMIT 1
), service_options AS (
  SELECT bs.barber_id, jsonb_agg(s.id ORDER BY s.id) AS ids
  FROM public.barber_services bs JOIN public.services s ON s.id=bs.service_id
  JOIN professional p ON p.id=bs.barber_id WHERE s.active GROUP BY bs.barber_id
), catalog_services AS (
  SELECT s.id,bs.barber_id,row_number() OVER (ORDER BY s.id)::int-1 AS position,count(*) OVER ()::int AS size
  FROM public.services s JOIN public.barber_services bs ON bs.service_id=s.id
  JOIN professional p ON p.id=bs.barber_id WHERE s.active
), service_combinations AS (
  SELECT s.barber_id,mask,jsonb_agg(s.id ORDER BY s.id) AS ids
  FROM catalog_services s CROSS JOIN LATERAL generate_series(1,(1<<s.size)-1) mask
  WHERE (mask & (1<<s.position))<>0 GROUP BY s.barber_id,mask
), candidate_day AS (
  SELECT d::date AS day FROM generate_series(
    (now() AT TIME ZONE 'America/Sao_Paulo')::date+1,
    (now() AT TIME ZONE 'America/Sao_Paulo')::date+30,interval '1 day'
  ) d CROSS JOIN professional p
  WHERE extract(dow FROM d) BETWEEN 1 AND 6
    AND NOT EXISTS (SELECT 1 FROM barber_private.bookings b WHERE b.barber_id=p.id
      AND (b.starts_at AT TIME ZONE 'America/Sao_Paulo')::date=d::date
      AND b.status IN ('agendado','confirmado','em_atendimento','concluido'))
    AND NOT EXISTS (SELECT 1 FROM barber_private.special_hours h WHERE h.barber_id=p.id AND h.day=d::date)
    AND NOT EXISTS (SELECT 1 FROM barber_private.blocks b WHERE b.barber_id=p.id
      AND tstzrange(b.starts_at,b.ends_at,'[)') && tstzrange(d AT TIME ZONE 'America/Sao_Paulo',(d+interval '1 day') AT TIME ZONE 'America/Sao_Paulo','[)'))
  ORDER BY day LIMIT 1
), available AS (
  SELECT barber_private.slots(p.id,d.day,60) AS slots,d.day
  FROM professional p CROSS JOIN candidate_day d
), checks AS (
  SELECT jsonb_build_object(
    'sample_day',a.day,
    'price_duration',pd.duration,
    'price',pd.total,
    'item_count',jsonb_array_length(pd.items),
    'combination_count',(SELECT count(*) FROM service_combinations),
    'all_combinations_fixed',NOT EXISTS (SELECT 1 FROM service_combinations s
      CROSS JOIN LATERAL barber_private.price_duration(s.barber_id,s.ids) x WHERE x.duration<>60),
    'all_parameters_same_slots',NOT EXISTS (SELECT 1 FROM unnest(ARRAY[5,10,40,65,120,195,480]) duration
      WHERE barber_private.slots(p.id,a.day,duration)<>a.slots),
    'all_slots_one_hour',NOT EXISTS (SELECT 1 FROM jsonb_array_elements(a.slots) slot
      WHERE (slot->>'end')::timestamptz-(slot->>'start')::timestamptz<>interval '1 hour'),
    '10_available',barber_private.is_available(p.id,(a.day+time '10:00') AT TIME ZONE 'America/Sao_Paulo',60),
    '13_available',barber_private.is_available(p.id,(a.day+time '13:00') AT TIME ZONE 'America/Sao_Paulo',195),
    'lunch_blocked',NOT barber_private.is_available(p.id,(a.day+time '12:00') AT TIME ZONE 'America/Sao_Paulo',60),
    'closing_blocked',NOT barber_private.is_available(p.id,(a.day+time '19:00') AT TIME ZONE 'America/Sao_Paulo',60),
    'adjacent_reservations_free',NOT EXISTS (SELECT 1 FROM barber_private.bookings b
      WHERE b.barber_id=p.id AND b.status IN ('agendado','confirmado','em_atendimento','concluido')
      AND b.starts_at>now() AND b.duration=60
      AND barber_private.is_available(p.id,b.ends_at,60,b.id)
      AND NOT barber_private.is_available(p.id,b.ends_at,60)),
    'normalized_records',NOT EXISTS (SELECT 1 FROM barber_private.bookings b
      WHERE (b.starts_at AT TIME ZONE 'America/Sao_Paulo')::date >= (now() AT TIME ZONE 'America/Sao_Paulo')::date
      AND b.status IN ('agendado','confirmado','em_atendimento','concluido')
      AND (b.duration<>60 OR b.ends_at<>b.starts_at+interval '1 hour')),
    'trigger_enabled',EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='barber_private.bookings'::regclass
      AND tgname='bookings_fixed_hour' AND tgenabled='O'),
    'private_trigger',NOT has_function_privilege('anon','barber_private.fixed_hour_booking()','execute'),
    'slots',a.slots
  ) AS result
  FROM professional p CROSS JOIN available a JOIN service_options s ON s.barber_id=p.id
  CROSS JOIN LATERAL barber_private.price_duration(p.id,s.ids) pd
) SELECT result FROM checks;
