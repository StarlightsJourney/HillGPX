/* global process, console */
process.on('uncaughtException', (error) => { console.error(error.message, error.detail ?? '', error.where ?? ''); process.exit(1); });
const { PGlite } = await import(process.env.HILLGPX_PGLITE_MODULE || '@electric-sql/pglite');
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import assert from 'node:assert/strict';
const repo = fileURLToPath(new URL('..', import.meta.url));
const file = (name) => readFileSync(`${repo}/supabase/migrations/${name}.sql`, 'utf8');
const repair = file('20261024000000_repair_accounts');
const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const third = '33333333-3333-4333-8333-333333333333';
const stub = `
create role anon;
create role authenticated;
create schema auth;
create schema storage;
create schema extensions;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}', created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, created_at timestamptz default now());
alter table storage.objects enable row level security;
create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1, '/') $$;
-- Crypto stand-ins only for unrelated spam-limit functions in this isolated test.
create function extensions.gen_random_bytes(integer) returns bytea language sql as $$ select decode(repeat('ab', $1), 'hex') $$;
create function extensions.digest(text,text) returns bytea language sql as $$ select decode(md5($1), 'hex') $$;
grant usage on schema public, auth, storage to anon, authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;
grant select, insert, update, delete on storage.objects to anon, authenticated;
`;
const route = (slug, anonymous = false, spoof = 'null') => `insert into public.routes
(slug,name,activity,distance_m,gain_m,loss_m,elevation_source,geom_hash,west,east,south,north,points,gpx_path,contributor,anonymous,user_id)
values ('${slug}','Test route','trail',100,10,10,'gps','hash-${slug}',103,104,1,2,'[[103,1,1],[104,2,2]]','${slug}.gpx.gz','RidgeRunner',${anonymous},${spoof})`;
async function setup() {
  const db = new PGlite();
  await db.exec(stub);
  for (const name of ['20261001000000_community','20261002000000_reports_route_photos','20261006000000_spam_limits','20261007000000_auto_publish']) await db.exec(file(name));
  return db;
}
async function scalar(db, sql) { return Object.values((await db.query(sql)).rows[0])[0]; }
for (const mode of ['missing', 'partial', 'already-installed']) {
  const db = await setup();
  await db.exec(`insert into auth.users(id,email,raw_user_meta_data) values
    ('${first}','one@example.com','{"username":"RidgeRunner"}'),
    ('${second}','two@example.com','{"username":"ridgerunner"}')`);
  if (mode === 'partial') {
    // Reproduce a dashboard-only function change without columns or trigger.
    const sync = file('20261023000000_contributor_sync');
    await db.exec(sync.slice(sync.indexOf('create or replace function private.stamp_route_owner()'), sync.indexOf('create or replace function private.sync_route_contributor()')));
  }
  if (mode === 'already-installed') {
    await db.exec(file('20261022000000_accounts'));
    await db.exec(file('20261023000000_contributor_sync'));
    // Reproduce an operator who already ran the earlier account SQL: the
    // smaller security migration must close the disclosure on its own.
    assert.notEqual(await scalar(db, "select to_regprocedure('public.email_for_username(text)')::text"), null);
    await db.exec(file('20261024010000_account_security'));
    assert.equal(await scalar(db, "select to_regprocedure('public.email_for_username(text)')::text"), null);
    assert.equal(await scalar(db, "select has_function_privilege('anon','public.delete_user()','EXECUTE')"), false);
  }
  await db.exec(repair);
  await db.exec(repair);
  assert.equal(await scalar(db, 'select count(*)::int from public.profiles'), 2);
  assert.equal(await scalar(db, 'select count(distinct lower(username))::int from public.profiles'), 2);
  assert.equal(await scalar(db, `select username from public.profiles where id='${first}'`), 'RidgeRunner');
  await db.exec(`insert into auth.users(id,email) values ('${third}','LongGoogleName@example.com')`);
  assert.equal(await scalar(db, `select username from public.profiles where id='${third}'`), 'longgooglename');
  // Existing route ownership must survive reruns. The trigger must overwrite
  // forged owner ids with the caller id, and retain ownership when anonymous.
  await db.exec(`set test.uid='${first}'; set role authenticated;`);
  await db.exec(route('owned-route', false, `'${second}'`));
  await db.exec(route('anonymous-route', true));
  assert.equal(await scalar(db, "select user_id::text from public.routes where slug='owned-route'"), first);
  assert.equal(await scalar(db, "select user_id::text from public.routes where slug='anonymous-route'"), first);
  assert.equal(await scalar(db, "select contributor from public.routes where slug='anonymous-route'"), null);
  await db.exec(`reset role; set test.uid=''; set role anon;`);
  await db.exec(route('signed-out-route', true));
  assert.equal(await scalar(db, "select user_id::text from public.routes where slug='signed-out-route'"), null);
  await db.exec(`reset role; set test.uid='${second}'; set role authenticated;`);
  assert.equal((await db.query("delete from public.routes where slug='owned-route' returning slug")).rows.length, 0);
  await db.exec(`reset role; set test.uid='${first}'; set role authenticated;`);
  await db.exec("update public.profiles set username='NewHandle' where id=auth.uid()");
  assert.equal(await scalar(db, "select contributor from public.routes where slug='owned-route'"), 'NewHandle');
  assert.equal(await scalar(db, "select contributor from public.routes where slug='anonymous-route'"), null);
  await db.exec('reset role');
  await db.exec(repair);
  assert.equal(await scalar(db, "select user_id::text from public.routes where slug='owned-route'"), first);
  assert.equal(await scalar(db, "select username from public.profiles where id='"+first+"'"), 'NewHandle');
  assert.equal(await scalar(db, "select has_schema_privilege('anon','private','USAGE')"), true);
  await db.exec(`set test.uid='${first}'; set role authenticated; select public.delete_community_route('anonymous-route');`);
  assert.equal(await scalar(db, "select count(*)::int from public.routes where slug='anonymous-route'"), 0);
  await db.exec('reset role');
  assert.equal(await scalar(db, "select to_regprocedure('public.email_for_username(text)')::text"), null);
  assert.equal(await scalar(db, "select has_function_privilege('anon','public.delete_user()','EXECUTE')"), false);
  assert.equal(await scalar(db, "select has_function_privilege('anon','public.delete_community_route(text)','EXECUTE')"), false);
  assert.equal(await scalar(db, "select has_function_privilege('authenticated','public.delete_community_route(text)','EXECUTE')"), true);
  for (const fn of ['new_profile', 'stamp_route_owner', 'sync_route_contributor']) {
    assert.equal(await scalar(db, `select has_function_privilege('anon','private.${fn}()','EXECUTE')`), false);
    assert.equal(await scalar(db, `select has_function_privilege('authenticated','private.${fn}()','EXECUTE')`), false);
  }
  // The separate security migration must work after an older repair too.
  await db.exec(file('20261024010000_account_security'));
  await db.exec(file('20261024010000_account_security'));
  await db.exec("set test.uid=''; set request.headers=''; set role anon");
  await db.exec("select public.record_route_download('owned-route')");
  assert.equal(await scalar(db, "select downloads from public.routes where slug='owned-route'"), 0);
  await assert.rejects(db.exec("select public.delete_user()"), /permission denied/);
  await assert.rejects(db.exec("select public.delete_community_route('owned-route')"), /permission denied/);
  await db.exec(`set request.headers='{"x-forwarded-for":"192.0.2.1"}'`);
  await db.exec("select public.record_route_download('invented-counter')");
  assert.equal(await scalar(db, "select count(*)::int from public.route_downloads where slug='invented-counter'"), 0);
  await db.exec("select public.record_route_download('owned-route')");
  await db.exec("select public.record_route_download('owned-route')");
  assert.equal(await scalar(db, "select downloads from public.routes where slug='owned-route'"), 1);
  await db.exec("select public.record_route_download('hong-kong-trail-section-2')");
  assert.equal(await scalar(db, "select count from public.route_downloads where slug='hong-kong-trail-section-2'"), 1);
  await db.exec("reset role; set request.headers=''");
  // Create enough real eligible rows to test quotas without counting invalid
  // slugs or duplicate suppression as evidence of rate limiting.
  for (let i = 0; i < 35; i++) await db.exec(route('quota-route-' + i));
  await db.exec(`set request.headers='{"x-forwarded-for":"192.0.2.2"}'; set role anon`);
  for (let i = 0; i < 35; i++) await db.exec(`select public.record_route_download('quota-route-${i}')`);
  assert.equal(await scalar(db, "select sum(downloads)::int from public.routes where slug like 'quota-route-%'"), 30);
  await db.exec('reset role');
  assert.equal(await scalar(db, "select count(*)::int from private.contribution_log where kind='route_downloads'"), 32);
  // Shorten the configured windows for independent tests of daily/global caps.
  await db.exec("update private.contribution_log set created_at=now()-interval '2 hours' where kind='route_downloads'; update private.limits set per_day=30 where kind='route_downloads'");
  await db.exec("set role anon; select public.record_route_download('quota-route-34'); reset role");
  assert.equal(await scalar(db, "select downloads from public.routes where slug='quota-route-34'"), 0);
  await db.exec("update private.limits set total_per_day=32 where kind='route_downloads'");
  await db.exec(`set request.headers='{"x-forwarded-for":"192.0.2.3"}'; set role anon; select public.record_route_download('quota-route-33'); reset role`);
  assert.equal(await scalar(db, "select downloads from public.routes where slug='quota-route-33'"), 0);
  assert.equal(await scalar(db, "select count(*)::int from private.contribution_log where kind='route_downloads'"), 32);
  await db.exec("set request.headers=''");
  await db.exec(repair);
  assert.equal(await scalar(db, "select downloads from public.routes where slug='owned-route'"), 1);
  console.log(`PASS ${mode}: no email RPC, function permissions, anonymous call denial, known-route counters, deduplication, hourly/daily/global caps, no quota-log growth on refusal, rerun preserves counters`);
  await db.close();
  console.log(`PASS ${mode}: repair, rerun, profile backfill/collision, signup, signed-in/signed-out ownership, spoof protection, RLS deletion, rename, preservation, storage permissions`);
}
