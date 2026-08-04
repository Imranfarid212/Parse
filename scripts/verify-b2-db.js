const { spawnSync } = require('child_process');

let databaseContainer;

function localDatabaseContainer() {
  if (databaseContainer) return databaseContainer;

  const result = spawnSync('docker', ['ps', '--format', '{{.Names}}'], {
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    process.stderr.write(result.stderr || '');
    process.stdout.write(result.stdout || '');
    throw new Error('[b2:db] could not list Docker containers');
  }

  const containers = result.stdout
    .split('\n')
    .map((name) => name.trim())
    .filter((name) => name.startsWith('supabase_db_'));

  if (containers.length !== 1) {
    throw new Error(
      `[b2:db] expected one running local Supabase database container, found ${containers.length}: ${containers.join(', ') || 'none'}`,
    );
  }

  databaseContainer = containers[0];
  return databaseContainer;
}

function sql(query) {
  const result = spawnSync('docker', [
    'exec',
    localDatabaseContainer(),
    'psql',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '-v',
    'ON_ERROR_STOP=1',
    '-tAc',
    query,
  ], {
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    process.stderr.write(result.stderr || '');
    process.stdout.write(result.stdout || '');
    throw new Error('[b2:db] sql check failed');
  }

  return result.stdout.trim();
}

const categories = sql("select string_agg(id || ':' || name || ':' || is_system, ',' order by id) from public.categories;");
const expectedCategories = [
  '1:Travel & Transit:false',
  '2:Meals & Entertainment:false',
  '3:Office Supplies:false',
  '4:Software & IT:false',
  '5:Vehicle Expenses:false',
  '6:Advertising & Marketing:false',
  '7:Professional Services:false',
  '8:Utilities & Telecom:false',
  '9:Inventory & Materials:false',
  '10:Miscellaneous:true',
].join(',');

if (categories !== expectedCategories) {
  throw new Error(`[b2:db] categories expected ${expectedCategories}, got ${categories}`);
}

if (sql("select public.health_check();") !== '1') {
  throw new Error('[b2:db] health_check failed');
}

if (sql("select count(*) from pg_proc where proname = 'complete_onboarding';") !== '1') {
  throw new Error('[b2:db] complete_onboarding RPC missing');
}

const rlsProbe = sql(`
do $$
declare
  user_a uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  user_b uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  visible_count int;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values
    (user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b2-a@example.test', 'x', now(), now(), now()),
    (user_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b2-b@example.test', 'x', now(), now(), now())
  on conflict (id) do nothing;

  insert into public.profiles (id, country, default_currency, onboarding_complete)
  values
    (user_a, 'US', 'USD', true),
    (user_b, 'CA', 'CAD', true)
  on conflict (id) do update set
    country = excluded.country,
    default_currency = excluded.default_currency,
    onboarding_complete = excluded.onboarding_complete;

  insert into public.user_categories (user_id, category_id, sort_order)
  values
    (user_a, 1, 1),
    (user_a, 10, 2),
    (user_b, 2, 1),
    (user_b, 10, 2)
  on conflict (user_id, category_id) do update set sort_order = excluded.sort_order;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', user_a::text, true);

  select count(*) into visible_count from public.profiles where id = user_b;
  if visible_count <> 0 then
    raise exception 'user A can read user B profile';
  end if;

  select count(*) into visible_count from public.user_categories where user_id = user_b;
  if visible_count <> 0 then
    raise exception 'user A can read user B categories';
  end if;
end $$;
select 'ok';
`);

if (!rlsProbe.split('\n').includes('ok')) {
  throw new Error(`[b2:db] RLS probe expected ok, got ${rlsProbe}`);
}

console.log('[b2:db] categories, onboarding RPC, health_check, and profile/category RLS verified');
