import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFile, readdir } from 'node:fs/promises';

export const ownerId = '00000000-0000-4000-8000-000000000099';
export async function fullDatabase() {
  const db = new PGlite({ extensions: { btree_gist, pgcrypto } });
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema extensions; create schema auth; create schema storage; create schema vault;
    set search_path=public,extensions;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create table auth.mfa_factors(id uuid default gen_random_uuid(),user_id uuid,status text);
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
    create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name,'/') $$;
    create table vault.decrypted_secrets(id uuid default gen_random_uuid() primary key,name text unique,decrypted_secret text);
    create function vault.create_secret(s text,n text,d text) returns uuid language plpgsql as $$declare i uuid;begin insert into vault.decrypted_secrets(name,decrypted_secret) values(n,s) returning id into i;return i;end$$;
    create function vault.update_secret(i uuid,s text) returns void language sql as $$update vault.decrypted_secrets set decrypted_secret=s where id=i$$;
    insert into auth.users values('${ownerId}','nicolaskirschner79@gmail.com',now());
  `);
  const directory = new URL('../../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(directory)).filter(n => n.endsWith('.sql')).sort()) {
    // Cron/pg_net são infraestrutura remota. Vault/Auth/Storage usam fixtures sem rede.
    if (name.endsWith('_notification_scheduler.sql')) continue;
    const sql = (await readFile(new URL(name, directory), 'utf8')).replace('alter publication supabase_realtime add table public.availability_signal;', '');
    try { await db.exec(sql); } catch (error) { error.message = `${name}: ${error.message}`; throw error; }
  }
  return db;
}
export async function rpc(db, action, payload = {}, tokenHash = null, adminId = null) {
  return (await db.query('select public.barber_rpc($1,$2::jsonb,$3,$4::uuid) result', [action, JSON.stringify(payload), tokenHash, adminId])).rows[0].result;
}
export async function futureDay(db, offset = 2) {
  return (await db.query(`select ((now() at time zone 'America/Sao_Paulo')::date+$1::integer+case when extract(dow from (now() at time zone 'America/Sao_Paulo')::date+$1::integer)=0 then 1 else 0 end)::text as day`, [offset])).rows[0].day;
}
