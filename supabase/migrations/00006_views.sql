-- ═══════════════════════════════════════════════════════════════════════════
-- 5C PULSE · 00006 · views, materialised rollups, auth linking, demo reset
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Teammate-visible Day Close *status* (no numbers, no text) ──────────────
-- Members see whether department-mates closed their day — never blocker text,
-- never ratings. Definer view with its own visibility filter.
create view public.day_close_status as
select
  dc.person_id,
  p.full_name,
  dc.close_date,
  dc.week_starting,
  dc.month,
  dc.department,
  dc.submitted_on_time,
  dc.manager_reviewed,
  (dc.submitted_at is not null) as submitted
from public.day_close dc
join public.people p on p.id = dc.person_id
where
  app.role_of(app.current_person_id()) not in ('Restricted','Observer')
  and (
    app.is_owner_role(app.current_person_id())
    or dc.person_id = app.current_person_id()
    or app.manages(app.current_person_id(), dc.person_id)
    or dc.department = app.dept_of(app.current_person_id())
  );

grant select on public.day_close_status to authenticated;

-- ── Private-task capacity mask (§5.3) ──────────────────────────────────────
-- A department head sees that a private task exists (title masked) so
-- capacity maths still work. Access to this view is itself logged app-side.
create view public.task_capacity as
select
  t.id,
  case when t.visibility = 'Private'
        and not app.can_view_task(app.current_person_id(), t.id)
       then 'Private task' else t.title end as title,
  t.owner_id, t.department, t.priority, t.status, t.due_at, t.est_hours,
  (t.visibility = 'Private'
   and not app.can_view_task(app.current_person_id(), t.id)) as is_masked
from public.tasks t
where t.status not in ('Completed','Dropped','Declined','Missed')
  and (
    app.can_view_task(app.current_person_id(), t.id)
    or (app.role_of(app.current_person_id()) in ('Department Head','Team Lead','Owner')
        and app.dept_of(app.current_person_id()) = t.department)
    or app.is_owner_role(app.current_person_id())
  );

grant select on public.task_capacity to authenticated;

-- ── Materialised rollups (precomputed nightly; served through server code
--    with lib/permissions filtering; not readable by browser roles) ─────────
create materialized view public.weekly_rollup_mv as
select
  dc.person_id,
  dc.week_starting,
  count(*)::int                                   as days_submitted,
  count(*) filter (where dc.submitted_on_time)::int as on_time_count,
  sum(dc.fixed_tasks_due)::int                    as fixed_due,
  sum(dc.fixed_tasks_done)::int                   as fixed_done,
  sum(coalesce(dc.target, 0))                     as total_target,
  sum(coalesce(dc.actual, 0))                     as total_actual,
  min(dc.direction::text)                         as direction,
  sum(dc.reactive_hours)                          as reactive_hours,
  count(*) filter (where dc.blocker)::int         as blockers_raised,
  count(*) filter (where not dc.manager_reviewed)::int as not_reviewed,
  count(*) filter (where not dc.submitted_on_time)::int as late_count,
  sum(dc.assigned_at_risk)::int                   as at_risk_sum
from public.day_close dc
group by dc.person_id, dc.week_starting;

create unique index weekly_rollup_mv_pk on public.weekly_rollup_mv (person_id, week_starting);

create materialized view public.monthly_rollup_mv as
select
  dc.person_id,
  dc.month,
  count(*)::int                                   as days_submitted,
  count(*) filter (where dc.submitted_on_time)::int as on_time_count,
  sum(dc.fixed_tasks_due)::int                    as fixed_due,
  sum(dc.fixed_tasks_done)::int                   as fixed_done,
  sum(coalesce(dc.target, 0))                     as total_target,
  sum(coalesce(dc.actual, 0))                     as total_actual,
  min(dc.direction::text)                         as direction,
  sum(dc.reactive_hours)                          as reactive_hours,
  count(*) filter (where dc.blocker)::int         as blockers_raised
from public.day_close dc
group by dc.person_id, dc.month;

create unique index monthly_rollup_mv_pk on public.monthly_rollup_mv (person_id, month);

revoke all on public.weekly_rollup_mv from authenticated, anon;
revoke all on public.monthly_rollup_mv from authenticated, anon;

create or replace function app.refresh_rollups() returns void
language plpgsql security definer set search_path = public
as $$
begin
  refresh materialized view concurrently public.weekly_rollup_mv;
  refresh materialized view concurrently public.monthly_rollup_mv;
end $$;

-- ── Auth linking: people.email is the login identity ───────────────────────
create or replace function app.link_auth_user() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  update public.people
     set auth_user_id = new.id
   where lower(email) = lower(new.email)
     and auth_user_id is null
     and status <> 'Deactivated';
  return new;
end $$;

do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'auth' and table_name = 'users') then
    execute 'create trigger trg_link_auth_user after insert on auth.users
             for each row execute function app.link_auth_user()';
  end if;
end $$;

-- Fallback used on session start (some projects restrict auth triggers)
create or replace function app.link_me() returns uuid
language plpgsql security definer set search_path = public
as $$
declare pid uuid;
begin
  select id into pid from public.people where auth_user_id = auth.uid();
  if pid is not null then return pid; end if;
  update public.people p
     set auth_user_id = auth.uid()
    from auth.users u
   where u.id = auth.uid()
     and lower(p.email) = lower(u.email)
     and p.auth_user_id is null
     and p.status <> 'Deactivated'
  returning p.id into pid;
  return pid;
end $$;

-- ── Reset demo data (§20): clears the illustrative data, keeps the schema ──
-- Keeps settings, holidays, and the calling person (promoted to root Owner)
-- so someone can still log in afterwards.
create or replace function app.reset_demo_data() returns void
language plpgsql security definer set search_path = public
as $$
declare me uuid := app.current_person_id();
begin
  if me is null or not app.is_owner_role(me) then
    raise exception 'Only the Owner resets demo data.';
  end if;
  set local session_replication_role = replica; -- skip forbid-delete triggers, by design
  truncate public.form_timings, public.attachments, public.task_templates,
           public.asks, public.leaves, public.kudos, public.announcement_acks,
           public.announcements, public.handovers, public.notifications,
           public.approvals, public.comments, public.blockers, public.day_close,
           public.task_participants, public.tasks, public.kpis,
           public.charter_tasks, public.charters, public.audit_log
           restart identity cascade;
  delete from public.people where id <> me;
  update public.people set reports_to_id = null, access_role = 'Owner',
         status = 'Active' where id = me;
  set local session_replication_role = default;
end $$;

grant execute on all functions in schema app to authenticated, service_role;
