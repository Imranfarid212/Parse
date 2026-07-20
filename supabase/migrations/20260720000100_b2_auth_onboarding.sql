create or replace function public.complete_onboarding(
  selected_category_ids int[],
  selected_country text default null,
  selected_default_currency text default 'USD'
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  normalized_currency text := upper(coalesce(nullif(trim(selected_default_currency), ''), 'USD'));
  system_category_id int;
  non_system_count int;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if normalized_currency !~ '^[A-Z]{3}$' then
    raise exception 'default_currency must be an ISO 4217 code' using errcode = '22023';
  end if;

  select id into system_category_id
  from public.categories
  where is_system = true and name = 'Miscellaneous'
  limit 1;

  if system_category_id is null then
    raise exception 'System category Miscellaneous is missing' using errcode = '23514';
  end if;

  select count(*) into non_system_count
  from public.categories c
  where c.id = any(selected_category_ids)
    and c.is_system = false;

  if non_system_count < 1 then
    raise exception 'Select at least one category besides Miscellaneous' using errcode = '23514';
  end if;

  delete from public.user_categories
  where user_id = auth.uid();

  insert into public.user_categories (user_id, category_id, sort_order)
  select auth.uid(), c.id, row_number() over (order by c.is_system, c.id)
  from public.categories c
  where c.id = any(selected_category_ids)
     or c.id = system_category_id
  on conflict (user_id, category_id) do update
    set sort_order = excluded.sort_order;

  update public.profiles
  set
    country = nullif(upper(trim(selected_country)), ''),
    default_currency = normalized_currency,
    onboarding_complete = true
  where id = auth.uid();

  if not found then
    raise exception 'Profile is missing for authenticated user' using errcode = '23503';
  end if;
end;
$$;

grant usage on schema public to anon, authenticated;
grant select on public.categories to anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.user_categories to authenticated;
grant execute on function public.complete_onboarding(int[], text, text) to authenticated;
