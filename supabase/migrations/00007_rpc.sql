-- ═══════════════════════════════════════════════════════════════════════════
-- 5C PULSE · 00007 · public RPC wrappers
-- PostgREST exposes the public schema; the app.* internals stay private.
-- Each wrapper simply forwards — authorization lives inside the app functions.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.link_me() returns uuid
language sql volatile security definer set search_path = public
as $$ select app.link_me() $$;

create or replace function public.chain_of(pid uuid) returns uuid[]
language sql stable security definer set search_path = public
as $$ select app.chain_of(pid) $$;

create or replace function public.current_person() returns uuid
language sql stable security definer set search_path = public
as $$ select app.current_person_id() $$;

create or replace function public.assignment_verb_for(target uuid) returns text
language sql stable security definer set search_path = public
as $$ select app.assignment_verb_for(app.current_person_id(), target)::text $$;

create or replace function public.day_close_prefill(p_person uuid, p_date date) returns jsonb
language sql volatile security definer set search_path = public
as $$ select app.day_close_prefill(p_person, p_date) $$;

create or replace function public.open_footprint(pid uuid) returns jsonb
language sql stable security definer set search_path = public
as $$
  select case
    when app.can_manage_people(app.current_person_id())
      or app.is_owner_role(app.current_person_id())
      or app.current_person_id() = pid
    then app.open_footprint(pid)
    else null
  end
$$;

create or replace function public.reset_demo_data() returns void
language sql volatile security definer set search_path = public
as $$ select app.reset_demo_data() $$;

create or replace function public.is_working_day(d date) returns boolean
language sql stable security definer set search_path = public
as $$ select app.is_working_day(d) $$;

grant execute on function
  public.link_me(), public.chain_of(uuid), public.current_person(),
  public.assignment_verb_for(uuid), public.day_close_prefill(uuid, date),
  public.open_footprint(uuid), public.reset_demo_data(), public.is_working_day(date)
to authenticated, service_role;

-- System jobs (cron only — not for browser roles)
create or replace function public.spawn_fixed_tasks(p_date date) returns int
language sql volatile security definer set search_path = public
as $$ select app.spawn_fixed_tasks(p_date) $$;

create or replace function public.mark_missed_fixed(p_date date) returns int
language sql volatile security definer set search_path = public
as $$ select app.mark_missed_fixed(p_date) $$;

create or replace function public.refresh_rollups() returns void
language sql volatile security definer set search_path = public
as $$ select app.refresh_rollups() $$;

revoke execute on function
  public.spawn_fixed_tasks(date), public.mark_missed_fixed(date), public.refresh_rollups()
from public, anon, authenticated;
grant execute on function
  public.spawn_fixed_tasks(date), public.mark_missed_fixed(date), public.refresh_rollups()
to service_role;
