-- Destaque da landing page: conteúdo público; edição e upload apenas pelo proprietário.
update barber_private.settings
set branding='{"hero_mode":"preset","hero_image_url":"","hero_style":"rounded","hero_preset":"scissors","hero_position":"center","hero_title":"Bom corte.","hero_subtitle":"Sem espera."}'::jsonb||branding
where id;
alter table barber_private.settings alter column branding set default '{"tagline":"Seu tempo. Seu estilo.","logo_url":"","accent_color":"#d83737","header_color":"#191919","background_color":"#f6f6f3","font":"inter","hero_mode":"preset","hero_image_url":"","hero_style":"rounded","hero_preset":"scissors","hero_position":"center","hero_title":"Bom corte.","hero_subtitle":"Sem espera."}'::jsonb;

create or replace function barber_private.valid_branding(p_brand jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare k text;v text;logo text;hero_image text;
begin
 if jsonb_typeof(p_brand) is distinct from 'object' then raise exception 'Informe uma identidade visual válida.';end if;
 p_brand:='{"hero_mode":"preset","hero_image_url":"","hero_style":"rounded","hero_preset":"scissors","hero_position":"center","hero_title":"Bom corte.","hero_subtitle":"Sem espera."}'::jsonb||p_brand;
 foreach k in array array['accent_color','header_color','background_color'] loop
  v:=p_brand->>k;
  if v is null or v !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Escolha cores válidas para a identidade visual.';end if;
 end loop;
 if (p_brand->>'font') is null or (p_brand->>'font') not in ('inter','system','serif') then raise exception 'Escolha uma fonte disponível no sistema.';end if;
 if (p_brand->>'tagline') is null or jsonb_typeof(p_brand->'tagline')<>'string' or length(p_brand->>'tagline')>100 then raise exception 'A frase da marca deve ter até 100 caracteres.';end if;
 logo:=p_brand->>'logo_url';
 if logo is null or jsonb_typeof(p_brand->'logo_url')<>'string' or length(logo)>1024 or (logo<>'' and (logo !~ '^https://[^[:space:]<>"\\]+$' or logo ~ '^https://[^/]*@')) then raise exception 'A logo precisa de um endereço HTTPS válido.';end if;
 if (p_brand->>'hero_mode') is null or (p_brand->>'hero_mode') not in ('preset','image') then raise exception 'Escolha uma imagem ou uma arte do sistema.';end if;
 if (p_brand->>'hero_style') is null or (p_brand->>'hero_style') not in ('rounded','circle','frame','organic') then raise exception 'Escolha um formato de imagem disponível.';end if;
 if (p_brand->>'hero_preset') is null or (p_brand->>'hero_preset') not in ('scissors','pole','monogram') then raise exception 'Escolha uma arte disponível no sistema.';end if;
 if (p_brand->>'hero_position') is null or (p_brand->>'hero_position') not in ('center','top','bottom') then raise exception 'Escolha um enquadramento disponível.';end if;
 hero_image:=p_brand->>'hero_image_url';
 if hero_image is null or jsonb_typeof(p_brand->'hero_image_url')<>'string' or length(hero_image)>1024 or (hero_image<>'' and (hero_image !~ '^https://[^[:space:]<>"\\]+$' or hero_image ~ '^https://[^/]*@')) then raise exception 'A imagem do destaque precisa de um endereço HTTPS válido.';end if;
 if p_brand->>'hero_mode'='image' and hero_image='' then raise exception 'Envie uma imagem para o destaque ou escolha uma arte do sistema.';end if;
 foreach k in array array['hero_title','hero_subtitle'] loop
  if jsonb_typeof(p_brand->k) is distinct from 'string' or length(p_brand->>k)>60 then raise exception 'Cada linha do destaque deve ter até 60 caracteres.';end if;
 end loop;
 return jsonb_build_object(
  'tagline',trim(p_brand->>'tagline'),'logo_url',logo,'accent_color',lower(p_brand->>'accent_color'),
  'header_color',lower(p_brand->>'header_color'),'background_color',lower(p_brand->>'background_color'),'font',p_brand->>'font',
  'hero_mode',p_brand->>'hero_mode','hero_image_url',hero_image,'hero_style',p_brand->>'hero_style',
  'hero_preset',p_brand->>'hero_preset','hero_position',p_brand->>'hero_position',
  'hero_title',trim(p_brand->>'hero_title'),'hero_subtitle',trim(p_brand->>'hero_subtitle')
 );
end $$;
revoke all on function barber_private.valid_branding(jsonb) from public,anon,authenticated;
grant execute on function barber_private.valid_branding(jsonb) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('barber-hero','barber-hero',true,5242880,array['image/png','image/jpeg','image/webp']);
create policy barber_hero_owner_insert on storage.objects for insert to authenticated
 with check(bucket_id='barber-hero' and (select barber_private.brand_owner()) and (storage.foldername(name))[1]='images' and (storage.foldername(name))[2]=(select auth.uid())::text);
create policy barber_hero_owner_select on storage.objects for select to authenticated
 using(bucket_id='barber-hero' and (select barber_private.brand_owner()) and (storage.foldername(name))[1]='images' and (storage.foldername(name))[2]=(select auth.uid())::text);
create policy barber_hero_owner_delete on storage.objects for delete to authenticated
 using(bucket_id='barber-hero' and (select barber_private.brand_owner()) and (storage.foldername(name))[1]='images' and (storage.foldername(name))[2]=(select auth.uid())::text);
-- Nomes únicos com upsert=false dispensam permissão de UPDATE em arquivos existentes.
