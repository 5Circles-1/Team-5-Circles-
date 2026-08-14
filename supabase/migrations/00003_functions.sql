-- ═══════════════════════════════════════════════════════════════════════════
-- 5C PULSE · 00003 · app.* helper functions
-- Pure authorization + time functions. RLS policies (00005) call these; they
-- mirror lib/permissions.ts one-for-one. All are SECURITY DEFINER with a
-- pinned search_path so they can read people/settings without RLS recursion.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Time: server time is the only truth for deadlines (Asia/Kolkata) ───────
create or replace function app.tz() returns text
language sql stable security definer set search_path = public
as $$ select timezone from public.settings where id = 1 $$;

create or replace function app.now_local() returns timestamp
language sql stable security definer set search_path = public
as $$ select (now() at time zone app.tz()) $$;

create or replace function app.today_local() returns date
language sql stable security definer set search_path = public
as $$ select (now() at time zone app.tz())::date $$;

create or replace function app.is_working_day(d date) returns boolean
language sql stable security definer set search_path = public
as $$
  select not (
    exists (select 1 from public.settings st
            where st.id = 1 and extract(isodow from d)::int = any (st.weekly_off))
    or exists (select 1 from public.holidays h where h.day = d)
  )
$$;

create or replace function app.next_working_day(d date) returns date
language plpgsql stable security definer set search_path = public
as $$
declare cur date := d;
begin
  for i in 1..30 loop
    if app.is_working_day(cur) then return cur; end if;
    cur := cur + 1;
  end loop;
  return d;
end $$;

create or replace function app.prev_working_day(d date) returns date
language plpgsql stable security definer set search_path = public
as $$
declare cur date := d;
begin
  for i in 1..30 loop
    if app.is_working_day(cur) then return cur; end if;
    cur := cur - 1;
  end loop;
  return d;
end $$;

-- Monday of the week containing d (the workbook's Week Starting column)
create or replace function app.week_start(d date) returns date
language sql immutable
as $$ select d - ((extract(isodow from d)::int) - 1) $$;

-- ── Identity ────────────────────────────────────────────────────────────────
create or replace function app.current_person_id() returns uuid
language sql stable security definer set search_path = public
as $$
  select id from public.people
  where auth_user_id = auth.uid() and status <> 'Deactivated'
  limit 1
$$;

create or replace function app.role_of(pid uuid) returns public.access_role
language sql stable security definer set search_path = public
as $$ select access_role from public.people where id = pid $$;

create or replace function app.dept_of(pid uuid) returns public.department
language sql stable security definer set search_path = public
as $$ select department from public.people where id = pid $$;

create or replace function app.is_owner_role(pid uuid) returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce(app.role_of(pid) = 'Owner', false) $$;

create or replace function app.has_capability(pid uuid, cap text) returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(cap = any (capabilities), false)
  from public.people where id = pid
$$;

-- Management chain of pid, nearest manager first (excludes pid itself)
create or replace function app.chain_of(pid uuid) returns uuid[]
language sql stable security definer set search_path = public
as $$
  with recursive chain as (
    select p.reports_to_id as mid, 1 as depth
    from public.people p where p.id = pid
    union all
    select p.reports_to_id, c.depth + 1
    from chain c join public.people p on p.id = c.mid
    where c.mid is not null and c.depth < 12
  )
  select coalesce(array_agg(mid order by depth), '{}')
  from chain where mid is not null
$$;

-- Is `manager` anywhere up `target`'s reporting chain?
create or replace function app.manages(manager uuid, target uuid) returns boolean
language sql stable security definer set search_path = public
as $$ select manager = any (app.chain_of(target)) $$;

-- Shared manager for peer-request escalation routing
create or replace function app.shared_manager(a uuid, b uuid) returns uuid
language sql stable security definer set search_path = public
as $$
  select m from unnest(app.chain_of(a)) with ordinality as ca(m, ord)
  where m = any (app.chain_of(b))
  order by ord limit 1
$$;

-- Heads of a department (there may be more than one; Owner is the fallback)
create or replace function app.dept_head_ids(dept public.department) returns uuid[]
language sql stable security definer set search_path = public
as $$
  select coalesce(
    nullif((select array_agg(id) from public.people
            where department = dept and access_role = 'Department Head'
              and status <> 'Deactivated'), '{}'),
    (select array_agg(id) from public.people
     where access_role = 'Owner' and status <> 'Deactivated')
  )
$$;

-- ── §6.1 The permutation matrix: which verb may actor use on target? ───────
-- Returns null when no assignment path exists at all.
create or replace function app.assignment_verb_for(actor uuid, target uuid)
returns public.assignment_verb
language plpgsql stable security definer set search_path = public
as $$
declare
  a_role public.access_role := app.role_of(actor);
  t_status public.person_status;
begin
  if actor is null or target is null then return null; end if;
  select status into t_status from public.people where id = target;
  if t_status = 'Deactivated' then return null; end if;

  if actor = target then return 'Direct'; end if;             -- Self: everyone
  if a_role = 'Owner' then return 'Direct'; end if;            -- Owner: anyone
  if a_role = 'Observer' then return null; end if;             -- Observer: read only
  if app.manages(target, actor) then return 'Ask'; end if;     -- Upward: never lands unasked
  if a_role = 'Restricted' then return null; end if;           -- Restricted: self only

  if app.dept_of(actor) = app.dept_of(target) then
    if a_role = 'Department Head' then return 'Direct'; end if; -- report, skip-level, peer
    if app.manages(actor, target) then return 'Direct'; end if; -- Lead → pod member
    return 'Peer Request';                                      -- rep → rep, the one 5C wants
  end if;

  return 'Cross-department Request';                            -- their head decides
end $$;

-- ── Task visibility (§5 + §4.4 visibility) ─────────────────────────────────
create or replace function app.is_task_participant(pid uuid, tid uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.task_participants tp
    where tp.task_id = tid and tp.person_id = pid and tp.removed_at is null
  )
$$;

create or replace function app.can_view_task(pid uuid, tid uuid) returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  t record;
  r public.access_role := app.role_of(pid);
begin
  if pid is null then return false; end if;
  select owner_id, accountable_id, assigned_by_id, pending_with_id,
         department, visibility
    into t
    from public.tasks where id = tid;
  if not found then return false; end if;

  if r = 'Owner' then return true; end if;
  if pid in (t.owner_id, t.accountable_id, t.assigned_by_id) then return true; end if;
  if t.pending_with_id = pid then return true; end if;
  if app.is_task_participant(pid, tid) then return true; end if;
  if r = 'Observer' then return false; end if;       -- aggregates only, elsewhere
  if t.visibility = 'Private' then return false; end if;
  if r = 'Restricted' then return false; end if;     -- only own or supported work

  -- Managers up the owner's chain always see their reports' non-private work
  if app.manages(pid, t.owner_id) then return true; end if;

  if t.visibility = 'Team' then
    return app.dept_of(pid) = t.department;          -- teammates within the department
  end if;
  -- 'Department': the department's leadership only
  return app.dept_of(pid) = t.department and r in ('Department Head','Team Lead');
end $$;

create or replace function app.can_view_day_close(pid uuid, row_person uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  -- Full close (numbers + text): the person, their manager chain, the Owner.
  -- Teammates get submission *status* via the day_close_status view instead.
  select pid = row_person
      or app.is_owner_role(pid)
      or app.manages(pid, row_person)
$$;

create or replace function app.can_view_blocker(pid uuid, bid uuid) returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare b record;
begin
  -- Blockers are not gossip: raiser, named unblocker, both their managers, Owner.
  if pid is null then return false; end if;
  select raised_by_id, unblocker_id into b from public.blockers where id = bid;
  if not found then return false; end if;
  return app.is_owner_role(pid)
      or pid in (b.raised_by_id, b.unblocker_id)
      or app.manages(pid, b.raised_by_id)
      or app.manages(pid, b.unblocker_id);
end $$;

create or replace function app.can_view_subject(pid uuid, s_type text, s_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select case s_type
    when 'task' then app.can_view_task(pid, s_id)
    when 'blocker' then app.can_view_blocker(pid, s_id)
    when 'day_close' then app.can_view_day_close(
      pid, (select person_id from public.day_close where id = s_id))
    else false
  end
$$;

create or replace function app.can_edit_charter(actor uuid, person uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select app.is_owner_role(actor)
      or (app.role_of(actor) = 'Department Head'
          and app.dept_of(actor) = app.dept_of(person))
$$;

create or replace function app.can_view_charter(actor uuid, person uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select actor = person
      or app.is_owner_role(actor)
      or app.manages(actor, person)
      or (app.dept_of(actor) = app.dept_of(person)
          and app.role_of(actor) in ('Department Head','Team Lead'))
$$;

create or replace function app.can_view_kpi(actor uuid, person uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select actor = person
      or app.is_owner_role(actor)
      or app.manages(actor, person)
      or (app.dept_of(actor) = app.dept_of(person)
          and app.role_of(actor) in ('Department Head','Team Lead'))
      or app.has_capability(actor, 'finance_admin')  -- KPI values across departments
$$;

create or replace function app.can_manage_people(actor uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select app.is_owner_role(actor) or app.has_capability(actor, 'people_admin')
$$;

-- Guard used by the deactivation trigger: is every open item placed?
create or replace function app.open_footprint(pid uuid) returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'open_tasks', (select count(*) from public.tasks
       where owner_id = pid
         and status not in ('Completed','Dropped','Declined','Missed')),
    'open_blockers', (select count(*) from public.blockers
       where unblocker_id = pid and resolved_at is null),
    'active_duties', (select count(*) from public.charter_tasks ct
       join public.charters c on c.id = ct.charter_id
       where c.person_id = pid and ct.active),
    'direct_reports', (select count(*) from public.people
       where reports_to_id = pid and status <> 'Deactivated'),
    'pending_approvals', (select count(*) from public.approvals
       where approver_id = pid and decision = 'Pending'),
    'open_kpis', (select count(*) from public.kpis
       where person_id = pid and active and effective_to is null)
  )
$$;

-- On-leave check across a date (§8.4)
create or replace function app.on_leave(pid uuid, d date) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.leaves l
    where l.person_id = pid and d between l.starts_on and l.ends_on
  )
$$;

grant execute on all functions in schema app to authenticated, service_role;
