-- Testes com transação interna revertida: não alteram a marca, a agenda ou os arquivos reais.
create or replace function pg_temp.verify_branding() returns jsonb language plpgsql as $$
declare actor uuid;before_settings jsonb;catalog jsonb;admin_data jsonb;minutes int;report jsonb:='[]';path text;
begin
 select a.user_id into actor from barber_private.administrators a join auth.users u on u.id=a.user_id join barber_private.settings s on s.id where u.email_confirmed_at is not null and lower(u.email)=lower(s.owner_email) limit 1;
 assert actor is not null,'Proprietário verificado necessário para testar a autorização';
 select to_jsonb(s),cancellation_minutes into before_settings,minutes from barber_private.settings s where id;
 begin
  perform public.barber_rpc('settings',jsonb_build_object('shop_name','QA Identidade Visual','branding',jsonb_build_object('tagline','Minha marca','logo_url','https://example.com/logo.png','accent_color','#2255AA','header_color','#FFFFFF','background_color','#111111','font','serif')),null,actor);
  catalog:=public.barber_rpc('catalog');
  assert catalog->>'shop_name'='QA Identidade Visual' and catalog->'branding'->>'accent_color'='#2255aa' and catalog->'branding'->>'font'='serif','Identidade pública não persistiu';
  assert not(catalog ? 'owner_email') and not(catalog->'branding' ? 'owner_email'),'Configuração privada exposta';
  assert (catalog->>'cancellation_minutes')::int=minutes,'Alteração visual mudou o prazo de cancelamento';
  admin_data:=public.barber_rpc('admin_data',jsonb_build_object('from',current_date,'to',current_date),null,actor);
  assert admin_data->'settings'->'branding'=catalog->'branding','Identidade difere entre cliente e painel';
  report:=report||jsonb_build_array('Nome, logo, cores e fonte persistem e chegam iguais ao catálogo e ao painel');
  perform public.barber_rpc('settings',jsonb_build_object('cancellation_minutes',0),null,actor);
  assert public.barber_rpc('catalog')->'branding'=catalog->'branding','Salvar prazo apagou a identidade';
  report:=report||jsonb_build_array('Alteração parcial preserva a identidade e as demais preferências');
  begin perform public.barber_rpc('settings','{"branding":{"accent_color":"red;display:none"}}',null,actor);raise exception using errcode='ZX001',message='Cor inválida aceita';exception when raise_exception then report:=report||jsonb_build_array('Cor inválida bloqueada');end;
  begin perform public.barber_rpc('settings','{"branding":{"logo_url":"javascript:alert(1)"}}',null,actor);raise exception using errcode='ZX001',message='URL executável aceita';exception when raise_exception then report:=report||jsonb_build_array('URL insegura de logo bloqueada');end;
  begin perform public.barber_rpc('settings','{"branding":{"font":"unknown"}}',null,actor);raise exception using errcode='ZX001',message='Fonte inválida aceita';exception when raise_exception then report:=report||jsonb_build_array('Fonte fora da lista bloqueada');end;
  begin perform public.barber_rpc('settings','{"shop_name":"X"}',null,actor);raise exception using errcode='ZX001',message='Nome inválido aceito';exception when raise_exception then report:=report||jsonb_build_array('Nome inválido bloqueado');end;
  begin perform public.barber_rpc('settings','{"shop_name":"Cliente"}',null,null);raise exception using errcode='ZX001',message='Cliente alterou a marca';exception when insufficient_privilege then report:=report||jsonb_build_array('Visitante não altera configurações');end;
  assert not has_function_privilege('authenticated','barber_private.save_settings(jsonb)','execute') and not has_function_privilege('anon','public.barber_rpc(text,jsonb,text,uuid)','execute') and not has_table_privilege('authenticated','barber_private.settings','select'),'Permissão privada ampliada';
  report:=report||jsonb_build_array('Preferências e RPC privilegiada continuam privadas');
  assert exists(select 1 from storage.buckets where id='barber-branding' and public and file_size_limit=2097152 and allowed_mime_types=array['image/png','image/jpeg','image/webp']),'Limites do bucket incorretos';
  report:=report||jsonb_build_array('Bucket de logos limita formatos e tamanho de 2 MB');
  -- Simula a identidade JWT na conexão de teste e passa pelas políticas reais de Storage.
  perform set_config('request.jwt.claim.sub',actor::text,true);
  execute 'set local role authenticated';
  assert barber_private.brand_owner(),'Proprietário bloqueado na política de Storage';
  path:='logos/'||actor::text||'/'||gen_random_uuid()::text||'.png';
  insert into storage.objects(bucket_id,name) values('barber-branding',path);
  assert exists(select 1 from storage.objects where bucket_id='barber-branding' and name=path),'Proprietário não lê a própria logo';
  assert exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='barber_branding_owner_delete' and cmd='DELETE' and qual=(select qual from pg_policies where schemaname='storage' and tablename='objects' and policyname='barber_branding_owner_select')),'Remoção não está restrita ao mesmo proprietário da leitura';
  report:=report||jsonb_build_array('Políticas reais permitem inserir e ler logos; remoção tem a mesma restrição de proprietário');
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  assert not barber_private.brand_owner(),'Não proprietário passou na política';
  begin insert into storage.objects(bucket_id,name) values('barber-branding','logos/'||auth.uid()::text||'/'||gen_random_uuid()::text||'.png');raise exception using errcode='ZX001',message='Não proprietário enviou logo';exception when insufficient_privilege then report:=report||jsonb_build_array('Não proprietário não envia logos');end;
  execute 'reset role';
  raise exception using errcode='ZB002',message='Reverter somente as mudanças dos testes';
 exception when sqlstate 'ZB002' then null;
 end;
 assert (select to_jsonb(s) from barber_private.settings s where id)=before_settings,'Teste alterou a configuração real';
 return jsonb_build_object('passed',jsonb_array_length(report),'checks',report,'fixtures_rolled_back',true);
end $$;
select pg_temp.verify_branding();
