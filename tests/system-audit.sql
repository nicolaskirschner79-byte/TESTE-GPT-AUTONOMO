-- Auditoria funcional com perfis/serviços próprios e rollback integral dos fixtures.
create or replace function pg_temp.verify_system_audit() returns jsonb language plpgsql as $$
declare actor uuid; professional uuid; service uuid; payload jsonb; result jsonb; booking jsonb; slots jsonb;
 audit_day date:=(now() at time zone 'America/Sao_Paulo')::date+1; today date:=(now() at time zone 'America/Sao_Paulo')::date;
 token text:=encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex'); block_id uuid; special_id uuid; other_booking jsonb;
 before_settings jsonb; before_bookings bigint; before_payments bigint; report jsonb:='[]'; key uuid:=gen_random_uuid();
begin
 select a.user_id into actor from barber_private.administrators a join auth.users u on u.id=a.user_id join barber_private.settings s on s.id
 where u.email_confirmed_at is not null and lower(u.email)=lower(s.owner_email) limit 1;
 assert actor is not null,'Proprietário verificado necessário';
 select to_jsonb(s) into before_settings from barber_private.settings s where id;
 select count(*) into before_bookings from barber_private.bookings;select count(*) into before_payments from barber_private.payments;
 while extract(dow from audit_day)=0 loop audit_day:=audit_day+1;end loop;
 begin
  result:=public.barber_rpc('save_service','{"name":"QA Auditoria Corte","description":"Fixture isolado","price":35,"duration":40,"active":true,"barbers":[]}',null,actor);service:=(result->>'id')::uuid;
  payload:=jsonb_build_object('name','QA Auditoria Profissional','phone','5515999990000','active',true,'services',jsonb_build_array(service),'hours',
   (select jsonb_agg(jsonb_build_object('weekday',n,'opens','09:00','closes','19:00','lunch_start','12:00','lunch_end','13:00','slot_minutes',60)) from generate_series(1,6) n));
  result:=public.barber_rpc('save_barber',payload,null,actor);professional:=(result->>'id')::uuid;
  assert exists(select 1 from public.barber_services where barber_id=professional and service_id=service),'Profissional não recebeu serviço';
  slots:=public.barber_rpc('slots',jsonb_build_object('barber_id',professional,'services',jsonb_build_array(service),'day',audit_day));
  assert jsonb_array_length(slots)=9,'Expediente/almoço não produziram nove inícios';
  report:=report||jsonb_build_array('Cadastro de serviço, profissional, vinculação e expediente funcionam');

  result:=public.barber_rpc('block',jsonb_build_object('barber_id',professional,'start',slots->0->>'start','end',slots->0->>'end','reason','QA Pausa'),null,actor);block_id:=(result->>'id')::uuid;
  assert not barber_private.is_available(professional,(slots->0->>'start')::timestamptz,40),'Bloqueio não ocupou horário';
  perform public.barber_rpc('delete_block',jsonb_build_object('id',block_id),null,actor);
  assert barber_private.is_available(professional,(slots->0->>'start')::timestamptz,40),'Remoção não liberou horário';
  perform public.barber_rpc('special_hours',jsonb_build_object('barber_id',professional,'day',audit_day,'closed',true),null,actor);
  select id into special_id from barber_private.special_hours where barber_id=professional and special_hours.day=audit_day;
  assert jsonb_array_length(public.barber_rpc('slots',jsonb_build_object('barber_id',professional,'services',jsonb_build_array(service),'day',audit_day)))=0,'Fechamento especial ignorado';
  perform public.barber_rpc('delete_special',jsonb_build_object('id',special_id),null,actor);
  assert barber_private.is_available(professional,(slots->0->>'start')::timestamptz,40),'Remoção de feriado não restaurou expediente';
  report:=report||jsonb_build_array('Bloquear/remover intervalos e fechar/remover feriados atualiza disponibilidade');

  perform public.barber_rpc('session','{}',token);
  payload:=jsonb_build_object('barber_id',professional,'services',jsonb_build_array(service),'start',slots->0->>'start','name','QA Auditoria Cliente','phone','5515999990000','consent',true,'idempotency_key',key);
  booking:=public.barber_rpc('book',payload,token);
  assert (public.barber_rpc('book',payload,token)->>'id')=booking->>'id','Reserva repetida duplicada';
  assert jsonb_array_length(public.barber_rpc('mine','{}',token))=1,'Histórico não trouxe a reserva';
  result:=public.barber_rpc('remind',jsonb_build_object('id',booking->>'id'),null,actor);
  assert result->>'status'='pending','Lembrete não entrou na fila';
  begin perform public.barber_rpc('remind',jsonb_build_object('id',booking->>'id'),null,actor);raise exception using errcode='ZU001',message='Lembrete duplicado aceito';exception when raise_exception then null;end;
  report:=report||jsonb_build_array('Reserva, idempotência, histórico e consentimento/fila de lembretes funcionam sem enviar mensagem real');

  perform public.barber_rpc('save_service',jsonb_build_object('id',service,'name','QA Auditoria Corte atualizado','price',50,'duration',60,'active',true),null,actor);
  result:=public.barber_rpc('reschedule',jsonb_build_object('id',booking->>'id','start',slots->1->>'start'),token);
  assert (result->>'total')::numeric=35 and (result->>'duration')::int=60,'Reagendamento alterou preço histórico ou janela de uma hora';
  assert result->>'status'='confirmado','Reagendamento não confirmou';
  report:=report||jsonb_build_array('Editar cadastro preserva preço e duração da reserva e do reagendamento');

  perform public.barber_rpc('expense',jsonb_build_object('description','QA Material','amount',10,'day',today,'barber_id',professional),null,actor);
  result:=public.barber_rpc('pay',jsonb_build_object('id',booking->>'id','amount',10,'method','pix','idempotency_key',gen_random_uuid()),null,actor);
  assert (result->>'paid')::numeric=10 and result->>'status'='concluido','Pagamento parcial inconsistente';
  key:=gen_random_uuid();perform public.barber_rpc('pay',jsonb_build_object('id',booking->>'id','amount',25,'method','dinheiro','idempotency_key',key),null,actor);
  perform public.barber_rpc('pay',jsonb_build_object('id',booking->>'id','amount',25,'method','dinheiro','idempotency_key',key),null,actor);
  result:=public.barber_rpc('admin_data',jsonb_build_object('from',today,'to',today,'barber_id',professional),null,actor);
  assert jsonb_array_length(result->'payments')=2 and jsonb_array_length(result->'expenses')=1,'Financeiro omitiu pagamento/despesa da data';
  perform public.barber_rpc('cancel',jsonb_build_object('id',booking->>'id'),null,actor);
  assert (barber_private.booking_json((booking->>'id')::uuid)->>'paid')::numeric=35,'Cancelamento apagou recebimento';
  result:=public.barber_rpc('refund',jsonb_build_object('id',booking->>'id','amount',35,'method','pix','idempotency_key',gen_random_uuid()),null,actor);
  assert (result->>'paid')::numeric=0,'Estorno não descontou recebido';
  report:=report||jsonb_build_array('Despesas, pagamentos parciais, recebimento por data, cancelamento pago e estorno funcionam');

  other_booking:=public.barber_rpc('book',payload||jsonb_build_object('idempotency_key',gen_random_uuid()),null,actor);
  perform public.barber_rpc('status',jsonb_build_object('id',other_booking->>'id','status','nao_compareceu','expected_version',1),null,actor);
  assert barber_private.is_available(professional,(slots->0->>'start')::timestamptz,40),'Ausência não liberou vaga';
  perform public.barber_rpc('save_barber',jsonb_build_object('id',professional,'name','QA Auditoria Profissional','phone','5515999990000','active',false),null,actor);
  assert not barber_private.is_available(professional,(slots->0->>'start')::timestamptz,40),'Profissional inativo continuou disponível';
  report:=report||jsonb_build_array('Agendamento manual, ausência e desativação do profissional atualizam a agenda');

  begin perform public.barber_rpc('expense','{"description":"QA não autorizado","amount":10,"day":"2026-10-05"}',token);raise exception using errcode='ZU001',message='Cliente lançou despesa';exception when insufficient_privilege then null;end;
  assert not has_function_privilege('anon','public.barber_queue(text,jsonb)','execute') and not has_table_privilege('authenticated','barber_private.payments','select'),'Permissão financeira/fila exposta';
  report:=report||jsonb_build_array('Clientes não acessam operações financeiras nem processamento da fila');
  raise exception using errcode='ZU002',message='Rollback integral da auditoria';
 exception when sqlstate 'ZU002' then null;
 end;
 assert (select count(*) from barber_private.bookings)=before_bookings and (select count(*) from barber_private.payments)=before_payments,'Reserva/pagamento real alterado';
 assert (select to_jsonb(s) from barber_private.settings s where id)=before_settings,'Configuração real alterada';
 assert not exists(select 1 from public.barbers where id=professional),'Fixture de profissional persistiu';
 report:=report||jsonb_build_array('Rollback confirmado e dados/configurações reais preservados');
 return jsonb_build_object('passed',jsonb_array_length(report),'checks',report,'fixtures_rolled_back',true);
end $$;
select pg_temp.verify_system_audit();
