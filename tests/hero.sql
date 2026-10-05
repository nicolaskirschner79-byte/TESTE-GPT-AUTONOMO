-- Transação interna revertida: não muda as configurações ou os arquivos do proprietário.
create or replace function pg_temp.verify_hero() returns jsonb language plpgsql as $$
declare actor uuid;before_settings jsonb;catalog jsonb;admin_data jsonb;report jsonb:='[]';path text;style text;preset text;bad jsonb;
begin
 select a.user_id into actor from barber_private.administrators a join auth.users u on u.id=a.user_id join barber_private.settings s on s.id where u.email_confirmed_at is not null and lower(u.email)=lower(s.owner_email) limit 1;
 assert actor is not null,'Proprietário verificado necessário';
 select to_jsonb(s) into before_settings from barber_private.settings s where id;
 begin
  perform public.barber_rpc('settings','{"branding":{"hero_mode":"image","hero_image_url":"https://example.com/hero.webp","hero_style":"organic","hero_preset":"monogram","hero_position":"top","hero_title":"Seu visual.","hero_subtitle":"Sua escolha."}}',null,actor);
  catalog:=public.barber_rpc('catalog');
  assert catalog->'branding'->>'hero_image_url'='https://example.com/hero.webp' and catalog->'branding'->>'hero_style'='organic' and catalog->'branding'->>'hero_position'='top' and catalog->'branding'->>'hero_subtitle'='Sua escolha.','Destaque público não persistiu';
  assert catalog->>'shop_name'=before_settings->>'shop_name' and catalog->>'cancellation_minutes'=before_settings->>'cancellation_minutes' and ((catalog->'branding')-array['hero_mode','hero_image_url','hero_style','hero_preset','hero_position','hero_title','hero_subtitle'])=((before_settings->'branding')-array['hero_mode','hero_image_url','hero_style','hero_preset','hero_position','hero_title','hero_subtitle']),'Salvar destaque mudou a identidade ou as regras';
  admin_data:=public.barber_rpc('admin_data',jsonb_build_object('from',current_date,'to',current_date),null,actor);
  assert admin_data->'settings'->'branding'=catalog->'branding','Destaque difere entre cliente e painel';
  report:=report||jsonb_build_array('Foto, estilo, enquadramento e textos persistem iguais no catálogo e no painel, preservando a marca');
  perform public.barber_rpc('settings','{"shop_name":"QA Destaque","branding":{"accent_color":"#2255aa","font":"inter"}}',null,actor);
  assert ((public.barber_rpc('catalog')->'branding')-array['accent_color','font'])=((catalog->'branding')-array['accent_color','font']),'Salvar marca apagou o destaque';
  report:=report||jsonb_build_array('Nome, cores e fonte não apagam o destaque salvo');
  foreach style in array array['rounded','circle','frame','organic'] loop
   perform public.barber_rpc('settings',jsonb_build_object('branding',jsonb_build_object('hero_style',style)),null,actor);
   assert public.barber_rpc('catalog')->'branding'->>'hero_style'=style,'Formato não persistiu';
  end loop;
  foreach preset in array array['scissors','pole','monogram'] loop
   perform public.barber_rpc('settings',jsonb_build_object('branding',jsonb_build_object('hero_mode','preset','hero_preset',preset)),null,actor);
   assert public.barber_rpc('catalog')->'branding'->>'hero_preset'=preset and public.barber_rpc('catalog')->'branding'->>'hero_image_url'='https://example.com/hero.webp','Alternar arte apagou a foto';
  end loop;
  report:=report||jsonb_build_array('Quatro formatos e três artes disponíveis; alternar arte preserva a foto');
  foreach bad in array array[
   '{"hero_style":"evil"}'::jsonb,'{"hero_preset":"evil"}'::jsonb,'{"hero_mode":"evil"}'::jsonb,'{"hero_position":"left"}'::jsonb,
   '{"hero_image_url":"javascript:alert(1)"}'::jsonb,'{"hero_image_url":"https://user:password@example.com/photo.png"}'::jsonb,
   '{"hero_mode":"image","hero_image_url":""}'::jsonb,'{"hero_title":null}'::jsonb,jsonb_build_object('hero_title',repeat('x',61))
  ] loop
   begin perform public.barber_rpc('settings',jsonb_build_object('branding',bad),null,actor);raise exception using errcode='ZX001',message='Destaque inválido aceito';exception when raise_exception then null;end;
  end loop;
  report:=report||jsonb_build_array('Valores fora da lista, URL executável, credenciais na URL, imagem vazia e textos inválidos são bloqueados');
  begin perform public.barber_rpc('settings','{"branding":{"hero_preset":"pole"}}',null,null);raise exception using errcode='ZX001',message='Visitante editou destaque';exception when insufficient_privilege then null;end;
  assert not has_function_privilege('authenticated','barber_private.save_settings(jsonb)','execute') and not has_function_privilege('authenticated','barber_private.valid_branding(jsonb)','execute') and not has_function_privilege('anon','public.barber_rpc(text,jsonb,text,uuid)','execute') and not has_table_privilege('authenticated','barber_private.settings','select'),'Permissão privada ampliada';
  report:=report||jsonb_build_array('Somente o proprietário edita; configurações privadas e RPC continuam protegidas');
  assert exists(select 1 from storage.buckets where id='barber-hero' and public and file_size_limit=5242880 and allowed_mime_types=array['image/png','image/jpeg','image/webp']),'Limites de upload incorretos';
  report:=report||jsonb_build_array('Storage limita PNG, JPEG e WebP a 5 MB');
  perform set_config('request.jwt.claim.sub',actor::text,true);
  execute 'set local role authenticated';
  assert barber_private.brand_owner(),'Proprietário não autorizado';
  path:='images/'||actor::text||'/'||gen_random_uuid()::text||'.png';
  insert into storage.objects(bucket_id,name) values('barber-hero',path);
  assert exists(select 1 from storage.objects where bucket_id='barber-hero' and name=path),'Proprietário não lê a própria imagem';
  assert exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='barber_hero_owner_delete' and cmd='DELETE' and qual=(select qual from pg_policies where schemaname='storage' and tablename='objects' and policyname='barber_hero_owner_select')),'Remoção tem permissões diferentes da leitura';
  begin insert into storage.objects(bucket_id,name) values('barber-hero','logos/'||actor::text||'/'||gen_random_uuid()::text||'.png');raise exception using errcode='ZX001',message='Diretório incorreto aceito';exception when insufficient_privilege then null;end;
  report:=report||jsonb_build_array('Políticas reais permitem inserir e ler imagens do proprietário, restringindo diretório e remoção');
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  assert not barber_private.brand_owner(),'Não proprietário foi autorizado';
  begin insert into storage.objects(bucket_id,name) values('barber-hero','images/'||auth.uid()::text||'/'||gen_random_uuid()::text||'.png');raise exception using errcode='ZX001',message='Não proprietário enviou imagem';exception when insufficient_privilege then null;end;
  report:=report||jsonb_build_array('Não proprietário não pode enviar imagens');
  execute 'reset role';
  raise exception using errcode='ZH002',message='Reverter os dados dos testes';
 exception when sqlstate 'ZH002' then null;
 end;
 assert (select to_jsonb(s) from barber_private.settings s where id)=before_settings,'Teste alterou a configuração real';
 return jsonb_build_object('passed',jsonb_array_length(report),'checks',report,'fixtures_rolled_back',true);
end $$;
select pg_temp.verify_hero();
