-- Execute no SQL Editor. Todas as alterações de teste são revertidas no bloco.
create or replace function pg_temp.verify_barber() returns jsonb language plpgsql as $$
declare report jsonb:='[]'; c1 text:=encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');c2 text:=encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');r uuid;cut uuid;lights uuid;b1 jsonb;b2 jsonb;original text;actor uuid:=gen_random_uuid();payload jsonb;duplicate jsonb;second uuid;payment_key uuid:=gen_random_uuid();
begin
 begin
  select id into r from public.barbers limit 1;select id into cut from public.services where name='Corte';select id into lights from public.services where name='Luzes';
  perform public.barber_rpc('session','{}',c1);perform public.barber_rpc('session','{}',c2);
  payload:=jsonb_build_object('barber_id',r,'services',jsonb_build_array(cut),'start','2026-10-06T12:00:00Z','name','Teste QA transacional','phone','5515999990000','idempotency_key',gen_random_uuid());
  b1:=public.barber_rpc('book',payload,c1);
  duplicate:=public.barber_rpc('book',payload,c1);
  assert b1->>'id'=duplicate->>'id','Requisição duplicou a reserva';report:=report||jsonb_build_array('Idempotência: aprovada');
  begin perform public.barber_rpc('book',payload||jsonb_build_object('idempotency_key',gen_random_uuid()),c2);raise exception 'Conflito não bloqueado';exception when exclusion_violation then report:=report||jsonb_build_array('Sobreposição no mesmo barbeiro: bloqueada');end;
  assert jsonb_array_length(public.barber_rpc('mine','{}',c2))=0,'Histórico exposto a outro dispositivo';
  begin perform public.barber_rpc('cancel',jsonb_build_object('id',b1->>'id'),c2);raise exception 'Cancelamento de outro cliente aceito';exception when insufficient_privilege then report:=report||jsonb_build_array('Histórico e cancelamento isolados por dispositivo');end;
  assert not barber_private.is_available(r,'2026-10-06T14:00:00Z',120),'Serviço atravessou almoço';assert not barber_private.is_available(r,'2026-10-06T21:00:00Z',120),'Serviço atravessou fechamento';assert not barber_private.is_available(r,'2026-10-11T12:00:00Z',40),'Domingo não bloqueado';report:=report||jsonb_build_array('Almoço, fechamento e domingo: respeitados');
  b2:=public.barber_rpc('book',payload||jsonb_build_object('start','2026-10-06T13:00:00Z','idempotency_key',gen_random_uuid()),c2);original:=b1->>'starts_at';
  begin perform public.barber_rpc('reschedule',jsonb_build_object('id',b1->>'id','start',b2->>'starts_at'),c1);raise exception 'Reagendamento em conflito aceito';exception when exclusion_violation then null;end;
  assert (select starts_at::text from barber_private.bookings where id=(b1->>'id')::uuid)::timestamptz=original::timestamptz,'Original perdido';report:=report||jsonb_build_array('Reagendamento em conflito preserva a reserva original');
  perform public.barber_rpc('cancel',jsonb_build_object('id',b2->>'id'),c2);assert barber_private.is_available(r,'2026-10-06T13:00:00Z',40),'Cancelamento não liberou horário';
  update public.services set price=999,duration=100 where id=cut;assert (barber_private.booking_json((b1->>'id')::uuid)->>'total')::numeric=35,'Preço histórico alterado';report:=report||jsonb_build_array('Cancelamento libera horário; preço e duração históricos preservados');
  insert into public.barbers(name) values('QA outro profissional') returning id into second;insert into public.barber_services values(second,cut);insert into barber_private.work_hours values(second,2,'09:00','19:00','12:00','13:00',60);
  assert barber_private.is_available(second,'2026-10-06T12:00:00Z',40),'Agenda não independente';report:=report||jsonb_build_array('Barbeiros diferentes atendem simultaneamente');
  assert not has_function_privilege('anon','public.barber_rpc(text,jsonb,text,uuid)','execute'),'Anon acessa RPC privilegiada';assert not has_table_privilege('anon','barber_private.bookings','select'),'Anon acessa dados privados';report:=report||jsonb_build_array('RPCs e tabelas privadas indisponíveis a visitantes');
  begin perform public.barber_rpc('admin_data','{}',c1);raise exception 'Cliente acessou painel';exception when insufficient_privilege then report:=report||jsonb_build_array('Usuário não autorizado bloqueado no painel');end;
  -- Identidade temporária sem senha, apenas dentro da transação revertida.
  insert into auth.users(id,email,email_confirmed_at) values(actor,'qa-temporario@example.invalid',now());insert into barber_private.administrators values(actor);
  perform public.barber_rpc('admin_data',jsonb_build_object('from','2026-10-01','to','2026-10-31'),null,actor);
  perform public.barber_rpc('reschedule',jsonb_build_object('id',b1->>'id','start','2026-10-07T12:00:00Z'),null,actor);
  assert exists(select 1 from barber_private.notifications n where n.booking_id=(b1->>'id')::uuid and n.dedupe_key like '%:previous:%' and n.payload->>'day'='2026-10-06' and jsonb_array_length(n.payload->'booking'->'items')=1 and n.payload->>'day_summary'='Nenhum atendimento ativo.'),'Agenda anterior ou snapshot de serviços não foi atualizado';
  report:=report||jsonb_build_array('Reagendamento atualiza também a agenda anterior com os serviços históricos');
  perform public.barber_rpc('pay',jsonb_build_object('id',b1->>'id','amount',35,'method','pix','idempotency_key',payment_key),null,actor);
  perform public.barber_rpc('pay',jsonb_build_object('id',b1->>'id','amount',35,'method','pix','idempotency_key',payment_key),null,actor);
  assert (select count(*) from barber_private.payments where booking_id=(b1->>'id')::uuid)=1,'Repetição duplicou o pagamento';
  -- Cancelar pela operação administrativa real, diretamente após o pagamento.
  perform public.barber_rpc('cancel',jsonb_build_object('id',b1->>'id'),null,actor);assert (barber_private.booking_json((b1->>'id')::uuid)->>'paid')::numeric=35,'Cancelamento apagou pagamento';
  perform public.barber_rpc('refund',jsonb_build_object('id',b1->>'id','amount',35,'method','pix','idempotency_key',gen_random_uuid()),null,actor);assert (barber_private.booking_json((b1->>'id')::uuid)->>'paid')::numeric=0,'Estorno não aplicado';report:=report||jsonb_build_array('Pagamento, cancelamento pago e estorno: validados');
  assert exists(select 1 from barber_private.notifications where booking_id=(b1->>'id')::uuid and status='pending'),'Fila não persistiu';report:=report||jsonb_build_array('Fila permanece pendente sem credenciais externas');
  raise exception using errcode='ZB001',message='rollback do fixture';
 exception when sqlstate 'ZB001' then null;
 end;
 return jsonb_build_object('passed',jsonb_array_length(report),'checks',report,'fixtures_rolled_back',true);
end $$;
select pg_temp.verify_barber();
