-- A blocked influencer attribution must never earn money. apply_rc_event owns
-- the atomic payment transaction; this guard makes the invariant independent
-- of future changes to that function's lookup query.
create or replace function public.guard_influencer_commission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_user_id uuid;
begin
  select user_id into v_user_id from public.payment_events where id = new.payment_event_id;
  if not exists (
    select 1
      from public.referrals r
      join public.referral_codes rc on rc.id = r.code_id
     where r.referred_user_id = v_user_id
       and r.code_id = new.code_id
       and r.status = 'released'
       and rc.kind = 'influencer'
       and rc.active
       and rc.commission_rate = 0.15
  ) then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists commission_requires_released_referral on public.commission_ledger;
create trigger commission_requires_released_referral
before insert on public.commission_ledger
for each row execute function public.guard_influencer_commission();

notify pgrst, 'reload schema';
