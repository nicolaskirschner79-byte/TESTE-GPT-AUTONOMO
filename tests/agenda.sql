-- Exercita as operações reais do painel em fixtures isolados, revertidos ao final.
create or replace function pg_temp.verify_daily_agenda() returns jsonb language plpgsql as $$
declare
 actor uuid; professional uuid:=gen_random_uuid(); service uuid:=gen_random_uuid(); free_service uuid:=gen_random_uuid();
 device uuid:=gen_random_uuid(); device_hash text:=encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');
 first_booking uuid:=gen_random_uuid(); second_booking uuid:=gen_random_uuid(); free_booking uuid:=gen_random_uuid(); future_booking uuid:=gen_random_uuid();
 today date:=(now() at time zone 'America/Sao_Paulo')::date; tomorrow date:=today+1; future_start timestamptz;
 result jsonb; report jsonb:='[]'; slots jsonb; settings_before jsonb; bookings_before bigint; payments_before bigint; payment_key uuid:=gen_random_uuid();
begin
 select a.user_id into actor from barber_private.administrators a join auth.users u on u.id=a.user_id join barber_private.settings s on s.id
 where u.email_confirmed_at is not null and lower(u.email)=lower(s.owner_email) limit 1;
 assert actor is not null,'Proprietário verificado necessário';
 select to_jsonb(s) into settings_before from barber_private.settings s where id;
 select count(*) into bookings_before from barber_private.bookings;
 select count(*) into payments_before from barber_private.payments;
 begin
  insert into public.barbers(id,name) values(professional,'QA Agenda transacional');
  insert into public.services(id,name,price,duration) values(service,'QA Corte',35,20),(free_service,'QA Gratuito',0,10);
  insert into public.barber_services values(professional,service),(professional,free_service);
  insert into barber_private.work_hours(barber_id,weekday,opens,closes,lunch_start,lunch_end,slot_minutes)
  select professional,n,'00:00'::time,'23:59'::time,'12:00'::time,'13:00'::time,60 from generate_series(0,6) n;
  insert into barber_private.clients(id,token_hash) values(device,device_hash);
  insert into barber_private.bookings(id,client_id,barber_id,customer_name,customer_phone,starts_at,ends_at,total,duration,status,idempotency_key)
  values
  (first_booking,device,professional,'QA Primeiro','5515999990000',(today+time '09:00') at time zone 'America/Sao_Paulo',(today+time '09:20') at time zone 'America/Sao_Paulo',35,20,'confirmado',gen_random_uuid()),
  (second_booking,device,professional,'QA Segundo','5515999990000',(today+time '10:00') at time zone 'America/Sao_Paulo',(today+time '10:20') at time zone 'America/Sao_Paulo',35,20,'confirmado',gen_random_uuid()),
  (free_booking,device,professional,'QA Gratuito','5515999990000',(today+time '11:00') at time zone 'America/Sao_Paulo',(today+time '11:10') at time zone 'America/Sao_Paulo',0,10,'agendado',gen_random_uuid());
  assert (select bool_and(duration=60 and ends_at=starts_at+interval '1 hour') from barber_private.bookings where id in(first_booking,second_booking,free_booking)), 'Reserva não foi normalizada para uma hora';
  insert into barber_private.booking_items(booking_id,service_id,name,price,duration)
  values(first_booking,service,'QA Corte',35,20),(second_booking,service,'QA Corte',35,20),(free_booking,free_service,'QA Gratuito',0,10);

  result:=public.barber_rpc('status',jsonb_build_object('id',first_booking,'status','em_atendimento','expected_version',1),null,actor);
  assert result->>'status'='em_atendimento' and (result->>'version')::int=2,'Início não persistiu';
  assert (result->>'paid')::numeric=0 and not exists(select 1 from barber_private.payments where booking_id=first_booking),'Início criou receita';
  report:=report||jsonb_build_array('Iniciar altera status e versão sem inventar pagamento');
  begin perform public.barber_rpc('status',jsonb_build_object('id',first_booking,'status','nao_compareceu','expected_version',1),null,actor);raise exception using errcode='ZA001',message='Versão desatualizada aceita';exception when raise_exception then null;end;
  begin perform public.barber_rpc('status',jsonb_build_object('id',first_booking,'status','nao_compareceu','expected_version',2),null,actor);raise exception using errcode='ZA001',message='Ausência em atendimento aceita';exception when raise_exception then null;end;
  begin perform public.barber_rpc('status',jsonb_build_object('id',second_booking,'status','em_atendimento','expected_version',1),null,actor);raise exception using errcode='ZA001',message='Segundo atendimento simultâneo aceito';exception when raise_exception then null;end;
  begin update barber_private.bookings set status='em_atendimento' where id=second_booking;raise exception using errcode='ZA001',message='Índice aceitou dois atendimentos';exception when unique_violation then null;end;
  report:=report||jsonb_build_array('Versão antiga, transição inválida e dois atendimentos simultâneos são bloqueados');

  result:=public.barber_rpc('admin_data',jsonb_build_object('from',tomorrow,'to',tomorrow,'barber_id',professional,'include_agenda',true),null,actor);
  assert exists(select 1 from jsonb_array_elements(result->'bookings') b where b->>'id'=first_booking::text),'Atendimento em curso desapareceu fora do período';
  assert jsonb_array_length(result->'agenda_slots')=1 and (result->'agenda_slots'->0->>'minimum_duration')::int=60,'Horários não reservam uma hora';
  assert not exists(select 1 from jsonb_array_elements(result->'agenda_slots'->0->'slots') s where (s->>'start')::timestamptz at time zone 'America/Sao_Paulo'>=tomorrow+time '12:00' and (s->>'start')::timestamptz at time zone 'America/Sao_Paulo'<tomorrow+time '13:00'),'Almoço exposto como livre';
  report:=report||jsonb_build_array('Consulta diária traz andamento fora da data e vagas reais, respeitando serviços e almoço');
  slots:=barber_private.agenda_slots(tomorrow,tomorrow+6,professional);
  assert jsonb_array_length(slots)=7,'Semana incompleta';
  begin perform barber_private.agenda_slots(tomorrow,tomorrow+7,professional);raise exception using errcode='ZA001',message='Mais de sete dias aceitos';exception when raise_exception then null;end;
  begin perform public.barber_rpc('admin_data',jsonb_build_object('from',tomorrow,'to',tomorrow+7,'include_agenda',true),null,actor);raise exception using errcode='ZA001',message='Agenda ampla aceita';exception when raise_exception then null;end;
  report:=report||jsonb_build_array('Semana possui sete dias e consultas de disponibilidade maiores são rejeitadas');

  result:=public.barber_rpc('pay',jsonb_build_object('id',first_booking,'amount',35,'method','pix','idempotency_key',payment_key),null,actor);
  assert result->>'status'='concluido' and (result->>'paid')::numeric=35,'Conclusão não registrou pagamento';
  perform public.barber_rpc('pay',jsonb_build_object('id',first_booking,'amount',35,'method','pix','idempotency_key',payment_key),null,actor);
  assert (select count(*) from barber_private.payments where booking_id=first_booking)=1,'Repetição duplicou recebimento';
  result:=public.barber_rpc('status',jsonb_build_object('id',second_booking,'status','em_atendimento','expected_version',1),null,actor);
  assert result->>'status'='em_atendimento','Conclusão não liberou próximo atendimento';
  result:=public.barber_rpc('cancel',jsonb_build_object('id',second_booking),null,actor);
  assert result->>'status'='cancelado','Proprietário não cancela andamento';
  perform public.barber_rpc('cancel',jsonb_build_object('id',first_booking),null,actor);
  assert (barber_private.booking_json(first_booking)->>'paid')::numeric=35,'Cancelamento apagou pagamento';
  report:=report||jsonb_build_array('Conclusão recebe uma vez, libera próximo atendimento e cancelamento preserva valores recebidos');

  perform public.barber_rpc('status',jsonb_build_object('id',free_booking,'status','confirmado','expected_version',1),null,actor);
  perform public.barber_rpc('status',jsonb_build_object('id',free_booking,'status','em_atendimento','expected_version',2),null,actor);
  result:=public.barber_rpc('status',jsonb_build_object('id',free_booking,'status','concluido','expected_version',3),null,actor);
  assert result->>'status'='concluido' and not exists(select 1 from barber_private.payments where booking_id=free_booking),'Serviço gratuito inventou pagamento';
  report:=report||jsonb_build_array('Serviço gratuito pode ser concluído sem pagamento fictício');

  future_start:=(tomorrow+time '09:00') at time zone 'America/Sao_Paulo';
  insert into barber_private.bookings(id,client_id,barber_id,customer_name,customer_phone,starts_at,ends_at,total,duration,status,idempotency_key)
  values(future_booking,device,professional,'QA Futuro','5515999990000',future_start,future_start+interval '20 minutes',35,20,'confirmado',gen_random_uuid());
  insert into barber_private.booking_items(booking_id,service_id,name,price,duration) values(future_booking,service,'QA Corte',35,20);
  begin perform public.barber_rpc('status',jsonb_build_object('id',future_booking,'status','em_atendimento','expected_version',1),null,actor);raise exception using errcode='ZA001',message='Início em data futura aceito';exception when raise_exception then null;end;
  begin perform public.barber_rpc('status',jsonb_build_object('id',future_booking,'status',null,'expected_version',1),null,actor);raise exception using errcode='ZA001',message='Status nulo aceito';exception when raise_exception then null;end;
  -- Estado direto apenas no fixture para verificar também as restrições de disponibilidade.
  update barber_private.bookings set status='em_atendimento' where id=future_booking;
  assert not barber_private.is_available(professional,future_start,10),'Andamento liberou horário ocupado';
  begin
   insert into barber_private.bookings(barber_id,customer_name,customer_phone,starts_at,ends_at,total,duration,idempotency_key)
   values(professional,'QA Sobreposição','5515999990000',future_start,future_start+interval '10 minutes',0,10,gen_random_uuid());
   raise exception using errcode='ZA001',message='Sobreposição direta aceita';
  exception when exclusion_violation then null;end;
  slots:=barber_private.agenda_slots(tomorrow,tomorrow,professional);
  assert not exists(select 1 from jsonb_array_elements(slots->0->'slots') s where (s->>'start')::timestamptz=future_start),'Agenda mostrou andamento como livre';
  report:=report||jsonb_build_array('Início futuro e status nulo são bloqueados; andamento ocupa horário no banco e na agenda');

  begin perform public.barber_rpc('cancel',jsonb_build_object('id',future_booking),device_hash);raise exception using errcode='ZA001',message='Cliente cancelou andamento';exception when raise_exception then null;end;
  begin perform public.barber_rpc('status',jsonb_build_object('id',future_booking,'status','concluido'),device_hash);raise exception using errcode='ZA001',message='Cliente alterou status administrativo';exception when insufficient_privilege then null;end;
  begin perform public.barber_rpc('admin_data',jsonb_build_object('from',today,'to',today,'include_agenda',true),device_hash);raise exception using errcode='ZA001',message='Cliente leu agenda privada';exception when insufficient_privilege then null;end;
  assert not has_function_privilege('anon','barber_private.agenda_slots(date,date,uuid)','execute') and not has_function_privilege('authenticated','barber_private.agenda_slots(date,date,uuid)','execute') and not has_function_privilege('anon','public.barber_rpc(text,jsonb,text,uuid)','execute') and not has_table_privilege('authenticated','barber_private.bookings','select'),'Permissões privadas ampliadas';
  report:=report||jsonb_build_array('Cliente não cancela andamento nem acessa status ou agenda administrativa; permissões continuam restritas');

  begin perform public.barber_rpc('save_barber',jsonb_build_object('id',professional,'name','QA Agenda transacional','phone','5515999990000','active',false),null,actor);raise exception using errcode='ZA001',message='Desativação durante atendimento aceita';exception when raise_exception then null;end;
  begin perform public.barber_rpc('block',jsonb_build_object('barber_id',professional,'start',future_start,'end',future_start+interval '1 hour'),null,actor);raise exception using errcode='ZA001',message='Bloqueio sobre andamento aceito';exception when raise_exception then null;end;
  begin perform public.barber_rpc('special_hours',jsonb_build_object('barber_id',professional,'day',tomorrow,'closed',true),null,actor);raise exception using errcode='ZA001',message='Fechamento sobre andamento aceito';exception when raise_exception then null;end;
  perform public.barber_rpc('cancel',jsonb_build_object('id',future_booking),null,actor);
  assert barber_private.is_available(professional,future_start,10),'Cancelamento não liberou vaga';
  report:=report||jsonb_build_array('Desativar, bloquear ou fechar sobre atendimento é impedido; cancelamento administrativo libera a vaga');
  raise exception using errcode='ZA002',message='Reverter todos os fixtures';
 exception when sqlstate 'ZA002' then null;
 end;
 assert not exists(select 1 from public.barbers where id=professional) and not exists(select 1 from barber_private.clients where id=device),'Fixture persistiu';
 assert (select count(*) from barber_private.bookings)=bookings_before and (select count(*) from barber_private.payments)=payments_before,'Dados reais alterados';
 assert (select to_jsonb(s) from barber_private.settings s where id)=settings_before,'Marca ou regras alteradas';
 report:=report||jsonb_build_array('Fixtures revertidos, reservas e pagamentos reais preservados, marca e regras inalteradas');
 return jsonb_build_object('passed',jsonb_array_length(report),'checks',report,'fixtures_rolled_back',true);
end $$;
select pg_temp.verify_daily_agenda();
