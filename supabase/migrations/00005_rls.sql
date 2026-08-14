-- ═══════════════════════════════════════════════════════════════════════════
-- 5C PULSE · 00005 · Row Level Security on every table, no exceptions.
-- Policies mirror lib/permissions.ts one-for-one. The service role bypasses
-- RLS (system jobs); anon gets nothing.
-- ═══════════════════════════════════════════════════════════════════════════

-- Application roles never DELETE (append-only doctrine), belt to the trigger's braces.
revoke delete on all tables in schema public from authenticated, anon;
revoke all on all tables in schema public from anon;

do $$
declare t text;
begin
  foreach t in array array[
    'people','charters','charter_tasks','kpis','tasks','task_participants',
    'day_close','blockers','comments','approvals','notifications','handovers',
    'audit_log','announcements','announcement_acks','settings','kudos',
    'holidays','leaves','asks','task_templates','attachments','form_timings'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ── people ─────────────────────────────────────────────────────────────────
-- Directory visible to Member and above; Restricted see self + task-mates;
-- Observer sees no individual rows; deactivated history stays readable to
-- their old manager and the Owner.
create policy people_select on public.people for select to authenticated
using (
  id = app.current_person_id()
  or app.is_owner_role(app.current_person_id())
  or (
    app.role_of(app.current_person_id()) not in ('Observer','Restricted')
    and (
      status <> 'Deactivated'
      or app.manages(app.current_person_id(), id)
    )
  )
  or (
    app.role_of(app.current_person_id()) = 'Restricted'
    and exists (
      select 1 from public.tasks t
      where (t.owner_id = people.id or t.assigned_by_id = people.id
             or t.accountable_id = people.id)
        and (t.owner_id = app.current_person_id()
             or app.is_task_participant(app.current_person_id(), t.id))
    )
  )
);

create policy people_insert on public.people for insert to authenticated
with check (app.can_manage_people(app.current_person_id()));

create policy people_update on public.people for update to authenticated
using (
  app.can_manage_people(app.current_person_id())
  or id = app.current_person_id()  -- own prefs; sensitive columns guarded below
)
with check (
  app.can_manage_people(app.current_person_id())
  or (
    id = app.current_person_id()
    -- Self-service may not change own power or reporting line
    and access_role = (select access_role from public.people p2 where p2.id = people.id)
    and capabilities = (select capabilities from public.people p2 where p2.id = people.id)
    and status = (select status from public.people p2 where p2.id = people.id)
  )
);

-- ── charters / charter_tasks ───────────────────────────────────────────────
create policy charters_select on public.charters for select to authenticated
using (app.can_view_charter(app.current_person_id(), person_id));

create policy charters_write on public.charters for insert to authenticated
with check (app.can_edit_charter(app.current_person_id(), person_id));

create policy charters_update on public.charters for update to authenticated
using (app.can_edit_charter(app.current_person_id(), person_id));

create policy charter_tasks_select on public.charter_tasks for select to authenticated
using (app.can_view_charter(app.current_person_id(),
  (select person_id from public.charters c where c.id = charter_id)));

create policy charter_tasks_insert on public.charter_tasks for insert to authenticated
with check (app.can_edit_charter(app.current_person_id(),
  (select person_id from public.charters c where c.id = charter_id)));

create policy charter_tasks_update on public.charter_tasks for update to authenticated
using (app.can_edit_charter(app.current_person_id(),
  (select person_id from public.charters c where c.id = charter_id)));

-- ── kpis ───────────────────────────────────────────────────────────────────
create policy kpis_select on public.kpis for select to authenticated
using (app.can_view_kpi(app.current_person_id(), person_id));

create policy kpis_insert on public.kpis for insert to authenticated
with check (
  app.is_owner_role(app.current_person_id())
  or (app.role_of(app.current_person_id()) = 'Department Head'
      and app.dept_of(app.current_person_id()) = app.dept_of(person_id))
);

create policy kpis_update on public.kpis for update to authenticated
using (
  app.is_owner_role(app.current_person_id())
  or (app.role_of(app.current_person_id()) = 'Department Head'
      and app.dept_of(app.current_person_id()) = app.dept_of(person_id))
);

-- ── tasks ──────────────────────────────────────────────────────────────────
-- Row columns are referenced inline (not via can_view_task(id)) so the policy
-- also holds for INSERT … RETURNING, where the new row is not yet visible to
-- a re-query. Semantics mirror app.can_view_task / lib/permissions.canViewTask.
create policy tasks_select on public.tasks for select to authenticated
using (
  app.is_owner_role(app.current_person_id())
  or app.current_person_id() in (owner_id, accountable_id, assigned_by_id, pending_with_id)
  or app.is_task_participant(app.current_person_id(), id)
  or (
    app.role_of(app.current_person_id()) not in ('Observer','Restricted')
    and visibility <> 'Private'
    and (
      app.manages(app.current_person_id(), owner_id)
      or (visibility = 'Team'
          and app.dept_of(app.current_person_id()) = department)
      or (visibility = 'Department'
          and app.dept_of(app.current_person_id()) = department
          and app.role_of(app.current_person_id()) in ('Department Head','Team Lead'))
    )
  )
);

create policy tasks_insert on public.tasks for insert to authenticated
with check (
  assigned_by_id = app.current_person_id()
  or app.is_owner_role(app.current_person_id())
);

create policy tasks_update on public.tasks for update to authenticated
using (
  app.current_person_id() in (owner_id, accountable_id, assigned_by_id, pending_with_id)
  or app.is_task_participant(app.current_person_id(), id)
  or app.is_owner_role(app.current_person_id())
  or app.manages(app.current_person_id(), owner_id)
);
-- (Column/verb-level rules ride in trg_task_transitions.)

-- ── task_participants ──────────────────────────────────────────────────────
create policy participants_select on public.task_participants for select to authenticated
using (app.can_view_task(app.current_person_id(), task_id));

create policy participants_insert on public.task_participants for insert to authenticated
with check (
  exists (
    select 1 from public.tasks t
    where t.id = task_id
      and (
        app.current_person_id() in (t.owner_id, t.accountable_id, t.assigned_by_id)
        or app.is_owner_role(app.current_person_id())
        or (app.role_of(app.current_person_id()) = 'Department Head'
            and app.dept_of(app.current_person_id()) = t.department)
        or app.manages(app.current_person_id(), t.owner_id)
      )
  )
  and added_by_id = app.current_person_id()
);

create policy participants_update on public.task_participants for update to authenticated
using (
  person_id = app.current_person_id()   -- acknowledge, sign off, remove self with reason
  or app.is_owner_role(app.current_person_id())
  or exists (select 1 from public.tasks t
             where t.id = task_id
               and app.current_person_id() in (t.owner_id, t.accountable_id, t.assigned_by_id))
);

-- ── day_close ──────────────────────────────────────────────────────────────
-- Full rows: the person, their manager chain, the Owner. Teammates read the
-- day_close_status view (00006) which carries no numbers and no text.
create policy day_close_select on public.day_close for select to authenticated
using (app.can_view_day_close(app.current_person_id(), person_id));

create policy day_close_insert on public.day_close for insert to authenticated
with check (person_id = app.current_person_id());

create policy day_close_update on public.day_close for update to authenticated
using (
  person_id = app.current_person_id()
  or app.manages(app.current_person_id(), person_id)   -- review, unlock
  or app.is_owner_role(app.current_person_id())
);

-- ── blockers ───────────────────────────────────────────────────────────────
-- Inline for the same INSERT … RETURNING reason as tasks_select.
create policy blockers_select on public.blockers for select to authenticated
using (
  app.is_owner_role(app.current_person_id())
  or app.current_person_id() in (raised_by_id, unblocker_id)
  or app.manages(app.current_person_id(), raised_by_id)
  or app.manages(app.current_person_id(), unblocker_id)
);

create policy blockers_insert on public.blockers for insert to authenticated
with check (raised_by_id = app.current_person_id());

create policy blockers_update on public.blockers for update to authenticated
using (
  app.current_person_id() in (raised_by_id, unblocker_id)
  or app.manages(app.current_person_id(), raised_by_id)
  or app.manages(app.current_person_id(), unblocker_id)
  or app.is_owner_role(app.current_person_id())
);

-- ── comments ───────────────────────────────────────────────────────────────
create policy comments_select on public.comments for select to authenticated
using (app.can_view_subject(app.current_person_id(), subject_type, subject_id));

create policy comments_insert on public.comments for insert to authenticated
with check (
  author_id = app.current_person_id()
  and app.can_view_subject(app.current_person_id(), subject_type, subject_id)
  and app.role_of(app.current_person_id()) <> 'Observer'
);

create policy comments_update on public.comments for update to authenticated
using (author_id = app.current_person_id() or app.is_owner_role(app.current_person_id()));

-- ── approvals ──────────────────────────────────────────────────────────────
create policy approvals_select on public.approvals for select to authenticated
using (
  app.current_person_id() in (requested_by_id, approver_id)
  or app.manages(app.current_person_id(), requested_by_id)
  or app.is_owner_role(app.current_person_id())
);

create policy approvals_insert on public.approvals for insert to authenticated
with check (requested_by_id = app.current_person_id());

create policy approvals_update on public.approvals for update to authenticated
using (
  approver_id = app.current_person_id()
  or app.is_owner_role(app.current_person_id())
);

-- ── notifications (own only; writes go through service or definer RPCs) ────
create policy notifications_select on public.notifications for select to authenticated
using (person_id = app.current_person_id());

create policy notifications_update on public.notifications for update to authenticated
using (person_id = app.current_person_id());

-- ── handovers ──────────────────────────────────────────────────────────────
create policy handovers_select on public.handovers for select to authenticated
using (
  app.can_manage_people(app.current_person_id())
  or app.current_person_id() in (from_person_id, to_person_id, executed_by_id)
  or app.manages(app.current_person_id(), from_person_id)
);

create policy handovers_insert on public.handovers for insert to authenticated
with check (app.can_manage_people(app.current_person_id())
            and executed_by_id = app.current_person_id());

-- ── audit_log ──────────────────────────────────────────────────────────────
-- Owner reads everything; anyone reads the trail of a task they can view
-- (the task detail's collapsed audit tab).
create policy audit_select on public.audit_log for select to authenticated
using (
  app.is_owner_role(app.current_person_id())
  or (entity = 'tasks' and entity_id ~ '^[0-9a-f-]{36}$'
      and app.can_view_task(app.current_person_id(), entity_id::uuid))
);
-- No insert/update policies: only triggers (definer) and service write here.

-- ── announcements ──────────────────────────────────────────────────────────
create policy announcements_select on public.announcements for select to authenticated
using (
  app.role_of(app.current_person_id()) <> 'Observer'
  and (department is null or department = app.dept_of(app.current_person_id())
       or app.is_owner_role(app.current_person_id()))
);

create policy announcements_insert on public.announcements for insert to authenticated
with check (
  author_id = app.current_person_id()
  and app.role_of(app.current_person_id()) in ('Owner','Department Head')
);

create policy announcements_update on public.announcements for update to authenticated
using (author_id = app.current_person_id() or app.is_owner_role(app.current_person_id()));

create policy announcement_acks_select on public.announcement_acks for select to authenticated
using (true);

create policy announcement_acks_insert on public.announcement_acks for insert to authenticated
with check (person_id = app.current_person_id());

-- ── settings / holidays ────────────────────────────────────────────────────
create policy settings_select on public.settings for select to authenticated using (true);
create policy settings_update on public.settings for update to authenticated
using (app.is_owner_role(app.current_person_id()));

create policy holidays_select on public.holidays for select to authenticated using (true);
create policy holidays_write on public.holidays for insert to authenticated
with check (app.can_manage_people(app.current_person_id())
            or app.is_owner_role(app.current_person_id()));
create policy holidays_update on public.holidays for update to authenticated
using (app.can_manage_people(app.current_person_id())
       or app.is_owner_role(app.current_person_id()));

-- ── kudos (the one place recognition is public) ────────────────────────────
create policy kudos_select on public.kudos for select to authenticated
using (app.role_of(app.current_person_id()) <> 'Observer');

create policy kudos_insert on public.kudos for insert to authenticated
with check (from_person_id = app.current_person_id()
            and app.role_of(app.current_person_id()) <> 'Observer');

-- ── leaves ─────────────────────────────────────────────────────────────────
create policy leaves_select on public.leaves for select to authenticated
using (
  person_id = app.current_person_id()
  or app.has_capability(app.current_person_id(), 'hr_admin')  -- leave across all departments
  or app.manages(app.current_person_id(), person_id)
  or app.is_owner_role(app.current_person_id())
);

create policy leaves_insert on public.leaves for insert to authenticated
with check (
  app.has_capability(app.current_person_id(), 'hr_admin')
  or app.is_owner_role(app.current_person_id())
  or app.manages(app.current_person_id(), person_id)
);

create policy leaves_update on public.leaves for update to authenticated
using (
  app.has_capability(app.current_person_id(), 'hr_admin')
  or app.is_owner_role(app.current_person_id())
  or app.manages(app.current_person_id(), person_id)
);

-- ── asks ───────────────────────────────────────────────────────────────────
create policy asks_select on public.asks for select to authenticated
using (
  app.current_person_id() in (from_person_id, to_person_id)
  or app.is_owner_role(app.current_person_id())
);

create policy asks_insert on public.asks for insert to authenticated
with check (from_person_id = app.current_person_id());

create policy asks_update on public.asks for update to authenticated
using (app.current_person_id() in (from_person_id, to_person_id)
       or app.is_owner_role(app.current_person_id()));

-- ── task_templates ─────────────────────────────────────────────────────────
create policy templates_select on public.task_templates for select to authenticated
using (app.role_of(app.current_person_id()) not in ('Observer','Restricted'));

create policy templates_insert on public.task_templates for insert to authenticated
with check (created_by_id = app.current_person_id()
            and app.role_of(app.current_person_id()) not in ('Observer','Restricted'));

create policy templates_update on public.task_templates for update to authenticated
using (created_by_id = app.current_person_id() or app.is_owner_role(app.current_person_id()));

-- ── attachments ────────────────────────────────────────────────────────────
create policy attachments_select on public.attachments for select to authenticated
using (app.can_view_subject(app.current_person_id(),
  case when subject_type = 'comment' then 'task' else subject_type end,
  case when subject_type = 'comment'
       then (select c.subject_id from public.comments c where c.id = subject_id)
       else subject_id end));

create policy attachments_insert on public.attachments for insert to authenticated
with check (uploaded_by_id = app.current_person_id());

-- ── form_timings (own writes; Owner reads the five-minute promise) ─────────
create policy form_timings_select on public.form_timings for select to authenticated
using (person_id = app.current_person_id() or app.is_owner_role(app.current_person_id()));

create policy form_timings_insert on public.form_timings for insert to authenticated
with check (person_id = app.current_person_id());
