-- ═══════════════════════════════════════════════════════════════════════════
-- 5C PULSE · 00004 · triggers: the guards that make the rules structural
-- The UI hides buttons; these refuse the write regardless. Assume the UI
-- will be bypassed.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Sequential codes, never reused ─────────────────────────────────────────
create or replace function app.issue_employee_code() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.employee_code is null then
    new.employee_code := 'EMP-' || lpad(nextval('public.employee_code_seq')::text, 2, '0');
  end if;
  return new;
end $$;

create trigger trg_people_code before insert on public.people
for each row execute function app.issue_employee_code();

create or replace function app.issue_task_code() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.task_code is null then
    new.task_code := 'TSK-' || lpad(nextval('public.task_code_seq')::text, 3, '0');
  end if;
  return new;
end $$;

create trigger trg_task_code before insert on public.tasks
for each row execute function app.issue_task_code();

-- ── Append-only audit: every state change writes to audit_log ──────────────
create or replace function app.write_audit() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  eid text;
begin
  eid := coalesce((to_jsonb(coalesce(new, old)) ->> 'id'),
                  (to_jsonb(coalesce(new, old)) ->> 'day'));
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (
    app.current_person_id(),
    tg_op,
    tg_table_name,
    eid,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'people','charters','charter_tasks','kpis','tasks','task_participants',
    'day_close','blockers','approvals','comments','handovers','settings',
    'announcements','kudos','leaves','asks','task_templates','holidays'
  ] loop
    execute format(
      'create trigger trg_audit_%1$s after insert or update or delete on public.%1$s
       for each row execute function app.write_audit()', t);
  end loop;
end $$;

-- ── Ceilings are enforced, not suggested (§16) ─────────────────────────────
create or replace function app.enforce_duty_ceiling() returns trigger
language plpgsql security definer set search_path = public
as $$
declare n int;
begin
  if new.active then
    select count(*) into n from public.charter_tasks
    where charter_id = new.charter_id and active
      and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000');
    if n >= 5 then
      raise exception 'Five is the ceiling. A person with fourteen daily duties has none. Retire one first.'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

create trigger trg_duty_ceiling before insert or update on public.charter_tasks
for each row execute function app.enforce_duty_ceiling();

create or replace function app.enforce_kpi_ceiling() returns trigger
language plpgsql security definer set search_path = public
as $$
declare n int;
begin
  if new.active and new.effective_to is null then
    select count(*) into n from public.kpis
    where person_id = new.person_id and active and effective_to is null
      and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000');
    if n >= 4 then
      raise exception 'Four KPIs is the ceiling. Close one before adding another.'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

create trigger trg_kpi_ceiling before insert or update on public.kpis
for each row execute function app.enforce_kpi_ceiling();

-- Never overwrite a target in place: close the old row, insert a new one.
create or replace function app.kpi_immutable_target() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if old.effective_to is not null and new.effective_to is not null then
    -- Historical row: frozen entirely (rollups must reconstruct old targets)
    if new.daily_target is distinct from old.daily_target
       or new.metric is distinct from old.metric
       or new.direction is distinct from old.direction
       or new.target_type is distinct from old.target_type
       or new.effective_from is distinct from old.effective_from then
      raise exception 'Historical KPI rows are frozen. Insert a new row instead.';
    end if;
  elsif new.daily_target is distinct from old.daily_target
     or new.metric is distinct from old.metric
     or new.direction is distinct from old.direction
     or new.target_type is distinct from old.target_type then
    raise exception 'Never overwrite a target in place. Close this row (effective_to = today) and insert a new one.';
  end if;
  return new;
end $$;

create trigger trg_kpi_immutable before update on public.kpis
for each row execute function app.kpi_immutable_target();

-- ── People: zero orphaned work (hard success criterion #2) ─────────────────
create or replace function app.block_orphaning_deactivation() returns trigger
language plpgsql security definer set search_path = public
as $$
declare fp jsonb;
begin
  if new.status = 'Deactivated' and old.status <> 'Deactivated' then
    fp := app.open_footprint(new.id);
    if (fp->>'open_tasks')::int > 0
       or (fp->>'open_blockers')::int > 0
       or (fp->>'active_duties')::int > 0
       or (fp->>'direct_reports')::int > 0
       or (fp->>'pending_approvals')::int > 0
       or (fp->>'open_kpis')::int > 0 then
      raise exception 'Cannot deactivate: open footprint remains (%). Run the Handover wizard first.', fp
        using errcode = 'P0001';
    end if;
    new.deactivated_on := coalesce(new.deactivated_on, app.today_local());
  end if;
  -- Reporting line must never point at a deactivated person
  if new.reports_to_id is not null then
    if exists (select 1 from public.people
               where id = new.reports_to_id and status = 'Deactivated') then
      raise exception 'Cannot report to a deactivated person.';
    end if;
    if new.reports_to_id = new.id then
      raise exception 'A person cannot report to themselves.';
    end if;
  end if;
  return new;
end $$;

create trigger trg_people_deactivation before update on public.people
for each row execute function app.block_orphaning_deactivation();

-- No hard deletes anywhere: deactivate, archive, supersede.
create or replace function app.forbid_delete() returns trigger
language plpgsql as $$
begin
  raise exception 'Nothing is hard-deleted in 5C Pulse. Deactivate, archive, or supersede instead.';
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'people','charters','charter_tasks','kpis','tasks','task_participants',
    'day_close','blockers','approvals','comments','handovers','audit_log',
    'announcements','kudos','settings'
  ] loop
    execute format(
      'create trigger trg_nodelete_%1$s before delete on public.%1$s
       for each row execute function app.forbid_delete()', t);
  end loop;
end $$;

-- ── Tasks: creation invariants ─────────────────────────────────────────────
create or replace function app.task_insert_guards() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  actor uuid := app.current_person_id();
  verb public.assignment_verb;
begin
  -- Impossible date: hard block (the one §6.4 guard with no override)
  if new.due_at < new.assigned_on then
    raise exception 'Impossible date: due before assigned.';
  end if;
  if tg_op = 'INSERT' and actor is not null and new.task_type <> 'Fixed'
     and new.due_at < now() - interval '1 minute' then
    raise exception 'Impossible date: due date is in the past.';
  end if;

  -- Subtasks: one level deep only
  if new.parent_task_id is not null then
    if exists (select 1 from public.tasks p
               where p.id = new.parent_task_id and p.parent_task_id is not null) then
      raise exception 'Subtasks go one level deep only.';
    end if;
  end if;

  -- Department derives from the owner
  new.department := app.dept_of(new.owner_id);

  -- Actor-facing invariants (skipped for the system: cron spawns run as service)
  if actor is not null then
    if new.assigned_by_id <> actor and not app.is_owner_role(actor) then
      raise exception 'assigned_by must be you.';
    end if;
    verb := app.assignment_verb_for(actor, new.owner_id);
    if verb is null then
      raise exception 'You cannot assign to this person.';
    end if;
    if verb = 'Ask' then
      raise exception 'Upward requests go through an Ask, never straight onto a senior''s board.';
    end if;
    if verb in ('Peer Request','Cross-department Request') then
      -- Requests land as Awaiting Acceptance with a response clock
      if new.status <> 'Awaiting Acceptance' then
        raise exception 'A % lands as Awaiting Acceptance, not %.', verb, new.status;
      end if;
      new.origin_verb := verb;
      new.acceptance_required := true;
      if verb = 'Peer Request' then
        new.pending_with_id := new.owner_id;
        new.respond_by := coalesce(new.respond_by,
          now() + make_interval(hours => (select peer_request_hours from public.settings where id = 1)));
        -- Same-day peer: forced urgent
        if new.due_at < now() + interval '24 hours' then
          new.urgent := true;
        end if;
      else
        -- Cross-department: goes to the target's department head first
        new.pending_with_id := coalesce(new.pending_with_id,
          (app.dept_head_ids(app.dept_of(new.owner_id)))[1]);
        new.respond_by := coalesce(new.respond_by, now() + interval '24 hours');
      end if;
    else
      new.origin_verb := 'Direct';
    end if;
  end if;

  return new;
end $$;

create trigger trg_task_insert before insert on public.tasks
for each row execute function app.task_insert_guards();

-- ── Tasks: the §7 state machine ────────────────────────────────────────────
create or replace function app.task_transition_guards() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  actor uuid := app.current_person_id();
  is_support boolean;
  reviewer_missing int;
  approvals_open int;
  has_reviewer boolean;
begin
  -- Delegation: owner moves, accountable does not; depth capped at 2 hops
  if new.owner_id is distinct from old.owner_id then
    if array_length(old.delegation_chain, 1) >= 2 then
      raise exception 'This has moved twice already. Reassign it from the source instead.'
        using errcode = 'P0001';
    end if;
    new.delegation_chain := old.delegation_chain || old.owner_id;
    new.department := app.dept_of(new.owner_id);
    -- The delegator stays in the loop as a Reviewer
    if actor is not null and old.owner_id <> new.owner_id then
      insert into public.task_participants (task_id, person_id, support_role, added_by_id)
      values (new.id, old.owner_id, 'Reviewer', actor)
      on conflict do nothing;
    end if;
  end if;

  if new.status = old.status then return new; end if;

  -- Who may move it (only enforceable when a person, not the system, acts)
  if actor is not null then
    is_support := app.is_task_participant(actor, new.id);
    if new.status in ('At Risk','Blocked') then
      -- Support may flag sinking work; owner and managers too
      if actor not in (old.owner_id, old.accountable_id, old.assigned_by_id)
         and not is_support and not app.is_owner_role(actor)
         and not app.manages(actor, old.owner_id) then
        raise exception 'Only the owner or a supporting member can flag this task.';
      end if;
    elsif new.status = 'Dropped' then
      if actor not in (old.assigned_by_id, old.accountable_id) and not app.is_owner_role(actor) then
        raise exception 'Only the assigner (or the Owner) can drop a task, with a reason.';
      end if;
    elsif new.status in ('Awaiting Acceptance','Declined') and old.status in ('Awaiting Acceptance','Declined') then
      null; -- request handling, checked below
    elsif old.status = 'Completed' then
      null; -- reopen, checked below
    else
      -- Forward movement belongs to the owner (reviewers sign off via participants)
      if actor <> old.owner_id and not app.is_owner_role(actor)
         and actor not in (old.accountable_id, old.assigned_by_id) then
        raise exception 'Only the owner moves a task forward.';
      end if;
    end if;
  end if;

  -- Transition table
  if old.status = 'Awaiting Acceptance' and new.status not in ('Not Started','Declined','Dropped') then
    raise exception 'A request is accepted (Not Started) or declined — nothing else.';
  end if;
  if old.status = 'Declined' and new.status not in ('Awaiting Acceptance','Dropped') then
    raise exception 'A declined request can only be re-sent or dropped.';
  end if;
  if new.status = 'Declined' then
    if coalesce(new.declined_reason, '') = '' then
      raise exception 'Decline needs a reason — it returns to the sender with it.';
    end if;
  end if;
  if new.status = 'Not Started' and old.status = 'Awaiting Acceptance' then
    new.accepted_at := now();
    new.pending_with_id := null;
  end if;

  if new.status = 'Dropped' and coalesce(new.drop_reason, '') = '' then
    raise exception 'Dropped requires a reason.';
  end if;

  if new.status = 'Blocked' then
    if not exists (select 1 from public.blockers b
                   where b.task_id = new.id and b.resolved_at is null) then
      raise exception 'Blocked requires a linked blocker with a named unblocker. There is no anonymous blocking.';
    end if;
  end if;

  -- Completion gates: every Reviewer's sign-off + no open Approval (§7, §9)
  if new.status in ('Completed','Pending Review') then
    select count(*) into reviewer_missing from public.task_participants tp
      where tp.task_id = new.id and tp.support_role = 'Reviewer'
        and tp.removed_at is null and tp.signed_off_at is null;
    select count(*) into approvals_open from public.approvals a
      where a.task_id = new.id and a.decision = 'Pending';
    has_reviewer := exists (select 1 from public.task_participants tp
      where tp.task_id = new.id and tp.support_role = 'Reviewer' and tp.removed_at is null);

    if new.status = 'Completed' then
      if reviewer_missing > 0 then
        raise exception 'Completion is gated: % reviewer(s) have not signed off.', reviewer_missing;
      end if;
      if approvals_open > 0 then
        raise exception 'Completion is gated: an approval is still open on this task.';
      end if;
      new.completed_at := now();
    else -- Pending Review
      if not has_reviewer then
        raise exception 'Pending Review only exists when a Reviewer is on the task.';
      end if;
    end if;
  end if;

  -- Reopen window: 7 days, by the assigner; after that it is a new task
  if old.status = 'Completed' and new.status <> 'Completed' then
    if old.completed_at < now() - interval '7 days' then
      raise exception 'Reopen window is 7 days. Raise a new task linked to this one.';
    end if;
    if actor is not null and actor not in (old.assigned_by_id, old.accountable_id)
       and not app.is_owner_role(actor) then
      raise exception 'Only the assigner can reopen a completed task.';
    end if;
    new.reopened_at := now();
    new.completed_at := null;
  end if;

  -- Missed is the system's word for a lapsed fixed duty, nobody else's
  if new.status = 'Missed' and (actor is not null or old.task_type <> 'Fixed') then
    raise exception 'Missed is set by the system on fixed work only.';
  end if;

  if old.status = 'Not Started' and new.status in ('On Track','At Risk','Blocked') then
    new.started_at := coalesce(old.started_at, now());
  end if;

  return new;
end $$;

create trigger trg_task_transitions before update on public.tasks
for each row execute function app.task_transition_guards();

-- ── Participants: one owner, many supports, ≤2 reviewers, ≤1 approver ──────
create or replace function app.participant_guards() returns trigger
language plpgsql security definer set search_path = public
as $$
declare n int;
begin
  if new.removed_at is null then
    if new.support_role = 'Reviewer' then
      select count(*) into n from public.task_participants
      where task_id = new.task_id and support_role = 'Reviewer' and removed_at is null
        and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000');
      if n >= 2 then raise exception 'At most two reviewers per task.'; end if;
    elsif new.support_role = 'Approver' then
      select count(*) into n from public.task_participants
      where task_id = new.task_id and support_role = 'Approver' and removed_at is null
        and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000');
      if n >= 1 then raise exception 'At most one approver per task.'; end if;
    end if;
    if exists (select 1 from public.tasks t
               where t.id = new.task_id and t.owner_id = new.person_id) then
      raise exception 'The owner is already accountable for this task — no second hat.';
    end if;
  end if;
  return new;
end $$;

create trigger trg_participant_guards before insert or update on public.task_participants
for each row execute function app.participant_guards();

-- ── Day Close: stamping, the window, one row per person per day ────────────
create or replace function app.day_close_insert() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  s record;
  now_l timestamp := app.now_local();
  close_l timestamp;
  grace_l timestamp;
  open_l timestamp;
begin
  select * into s from public.settings where id = 1;

  -- month is stamped from close_date, never from submission time (§15)
  new.week_starting := app.week_start(new.close_date);
  new.month := to_char(new.close_date, 'YYYY-MM');
  new.department := app.dept_of(new.person_id);
  new.submitted_at := now();

  -- On weekends and holidays it does not open at all
  if not app.is_working_day(new.close_date) then
    raise exception 'No Day Close expected on a non-working day.';
  end if;
  if app.on_leave(new.person_id, new.close_date) then
    raise exception 'No Day Close expected while on leave.';
  end if;
  if new.close_date > app.today_local() then
    raise exception 'Cannot close a day that has not happened.';
  end if;

  open_l  := new.close_date + s.window_open;
  close_l := new.close_date + s.window_close;
  grace_l := (new.close_date + 1) + s.grace_until;

  -- Server clock vs the window: on time until 19:30, late until 09:00 next
  -- day, refused after that without a manager unlock. System inserts (service
  -- role, e.g. seed or import) keep the flag they carry.
  if app.current_person_id() is not null then
    if now_l > grace_l then
      raise exception 'The window for % closed at % the next morning. Ask your manager to unlock it.',
        new.close_date, s.grace_until;
    end if;
    new.submitted_on_time := (now_l <= close_l);
  end if;

  return new;
end $$;

create trigger trg_day_close_insert before insert on public.day_close
for each row execute function app.day_close_insert();

create or replace function app.day_close_update() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  s record;
  actor uuid := app.current_person_id();
  grace_l timestamp;
begin
  select * into s from public.settings where id = 1;
  grace_l := (old.close_date + 1) + s.grace_until;

  -- The submitted-time snapshot never silently rewrites itself
  new.close_date := old.close_date;
  new.week_starting := old.week_starting;
  new.month := old.month;
  new.person_id := old.person_id;
  new.submitted_at := old.submitted_at;
  new.submitted_on_time := old.submitted_on_time;

  if actor is not null and actor = old.person_id then
    -- Edits allowed until 09:00 next day; later ones need a manager unlock
    if app.now_local() > grace_l
       and (old.unlocked_until is null or now() > old.unlocked_until) then
      raise exception 'Edits closed at % next morning. Ask your manager to unlock this close.', s.grace_until;
    end if;
    new.edited_at := now();
    -- Post-review edits clear the flag and re-notify — silent edits corrupt trust
    if old.manager_reviewed then
      new.manager_reviewed := false;
      insert into public.notifications (person_id, kind, payload)
      select old.reviewed_by_id, 'close_edited_after_review',
             jsonb_build_object('day_close_id', old.id, 'person_id', old.person_id,
                                'close_date', old.close_date)
      where old.reviewed_by_id is not null;
    end if;
  end if;

  return new;
end $$;

create trigger trg_day_close_update before update on public.day_close
for each row execute function app.day_close_update();

-- ── Blockers: SLA clock stamps itself; escalation is not optional ──────────
create or replace function app.blocker_insert() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.sla_due_at := coalesce(new.sla_due_at,
    new.raised_at + make_interval(hours =>
      (select blocker_sla_hours from public.settings where id = 1)));
  if new.unblocker_id = new.raised_by_id then
    raise exception 'A blocker needs someone else to clear it — pick the person who can.';
  end if;
  return new;
end $$;

create trigger trg_blocker_insert before insert on public.blockers
for each row execute function app.blocker_insert();

-- ── Comments: never deleted — struck through; edits stamp edited_at ────────
create or replace function app.comment_update() returns trigger
language plpgsql security definer set search_path = public
as $$
declare actor uuid := app.current_person_id();
begin
  if actor is not null and actor <> old.author_id and not app.is_owner_role(actor) then
    raise exception 'Only the author edits or strikes a comment.';
  end if;
  if new.body is distinct from old.body then
    new.edited_at := now();
  end if;
  return new;
end $$;

create trigger trg_comment_update before update on public.comments
for each row execute function app.comment_update();

-- ── Approvals: decisions need notes on decline; decided rows freeze ────────
create or replace function app.approval_update() returns trigger
language plpgsql security definer set search_path = public
as $$
declare actor uuid := app.current_person_id();
begin
  if old.decision <> 'Pending' and new.decision is distinct from old.decision then
    raise exception 'A decided approval is frozen. Request a fresh one.';
  end if;
  if new.decision in ('Approved','Declined') and old.decision = 'Pending' then
    if actor is not null and actor <> old.approver_id and not app.is_owner_role(actor) then
      raise exception 'Only the named approver decides this.';
    end if;
    if new.decision = 'Declined' and coalesce(new.note, '') = '' then
      raise exception 'Decline requires a note.';
    end if;
    new.decided_at := now();
  end if;
  return new;
end $$;

create trigger trg_approval_update before update on public.approvals
for each row execute function app.approval_update();

-- ═══════════════════════════════════════════════════════════════════════════
-- System functions (called by cron with the service key; all idempotent)
-- ═══════════════════════════════════════════════════════════════════════════

-- §7 Recurring work: charter tasks spawn instances at 00:05 daily per cadence.
create or replace function app.spawn_fixed_tasks(p_date date) returns int
language plpgsql security definer set search_path = public
as $$
declare
  ct record;
  s record;
  due_ts timestamptz;
  n int := 0;
  dow int := extract(isodow from p_date)::int;
  eff_month_day int;
begin
  select * into s from public.settings where id = 1;
  if not app.is_working_day(p_date) then return 0; end if;

  for ct in
    select ctk.*, c.person_id
    from public.charter_tasks ctk
    join public.charters c on c.id = ctk.charter_id
    join public.people p on p.id = c.person_id
    where ctk.active and p.status = 'Active'
  loop
    if app.on_leave(ct.person_id, p_date) then continue; end if;

    if ct.cadence = 'Daily' then
      null; -- every working day
    elsif ct.cadence = 'Weekly' then
      if not (coalesce(ct.weekday_mask, '{1}') @> array[dow]) then continue; end if;
    elsif ct.cadence = 'Fortnightly' then
      if not (coalesce(ct.weekday_mask, '{1}') @> array[dow]) then continue; end if;
      if extract(week from p_date)::int % 2 <> 1 then continue; end if; -- odd ISO weeks
    elsif ct.cadence in ('Monthly','Quarterly') then
      if ct.cadence = 'Quarterly' and extract(month from p_date)::int not in (1,4,7,10) then
        continue;
      end if;
      eff_month_day := least(coalesce(ct.month_day, 1),
        extract(day from (date_trunc('month', p_date) + interval '1 month - 1 day'))::int);
      -- Rolled back to the last working day if it lands on an off day
      if app.prev_working_day(make_date(extract(year from p_date)::int,
           extract(month from p_date)::int, eff_month_day)) <> p_date then
        continue;
      end if;
    end if;

    due_ts := ((p_date + s.window_close)::timestamp) at time zone s.timezone;
    insert into public.tasks
      (title, description, task_type, owner_id, accountable_id, department,
       priority, status, assigned_by_id, assigned_on, due_at,
       source_charter_task_id, spawn_date, visibility)
    values
      (ct.title, ct.definition_of_done, 'Fixed', ct.person_id, ct.person_id,
       app.dept_of(ct.person_id), 'P2 - Important', 'Not Started', ct.person_id,
       ((p_date::timestamp) at time zone s.timezone), due_ts,
       ct.id, p_date, 'Team')
    on conflict (source_charter_task_id, spawn_date)
      where source_charter_task_id is not null
      do nothing;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- Instances neither completed nor dropped by end of day are Missed — they do
-- not roll over and pile up. Yesterday's guilt, not tomorrow's work.
create or replace function app.mark_missed_fixed(p_date date) returns int
language plpgsql security definer set search_path = public
as $$
declare n int;
begin
  update public.tasks
     set status = 'Missed'
   where task_type = 'Fixed' and spawn_date = p_date
     and status not in ('Completed','Dropped','Missed');
  get diagnostics n = row_count;
  return n;
end $$;

-- Day Close pre-fill: everything green in the workbook, computed server-side.
create or replace function app.day_close_prefill(p_person uuid, p_date date) returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  k record;
  fixed jsonb;
  open_tasks jsonb;
  top3 text[];
begin
  if p_person is distinct from app.current_person_id()
     and app.current_person_id() is not null
     and not app.manages(app.current_person_id(), p_person)
     and not app.is_owner_role(app.current_person_id()) then
    raise exception 'Not your Day Close.';
  end if;

  select metric, daily_target, direction, unit into k
  from public.kpis
  where person_id = p_person and is_primary and active
    and effective_from <= p_date and (effective_to is null or effective_to >= p_date)
  order by effective_from desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'title', t.title, 'definition_of_done', t.description,
           'status', t.status) order by t.created_at), '[]'::jsonb)
    into fixed
  from public.tasks t
  where t.owner_id = p_person and t.task_type = 'Fixed' and t.spawn_date = p_date;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'code', t.task_code, 'title', t.title, 'status', t.status,
           'priority', t.priority, 'due_at', t.due_at) order by t.due_at), '[]'::jsonb)
    into open_tasks
  from public.tasks t
  where t.owner_id = p_person and t.task_type <> 'Fixed'
    and t.status not in ('Completed','Dropped','Declined','Missed','Awaiting Acceptance');

  select array_agg(title order by due_at) into top3 from (
    select title, due_at from public.tasks
    where owner_id = p_person and task_type <> 'Fixed'
      and status not in ('Completed','Dropped','Declined','Missed')
    order by due_at asc limit 3
  ) q;

  return jsonb_build_object(
    'close_date', p_date,
    'week_starting', app.week_start(p_date),
    'month', to_char(p_date, 'YYYY-MM'),
    'department', app.dept_of(p_person),
    'primary_metric', k.metric,
    'target', k.daily_target,
    'direction', k.direction,
    'unit', k.unit,
    'fixed', fixed,
    'open_tasks', open_tasks,
    'suggested_top3', coalesce(top3, '{}')
  );
end $$;

grant execute on all functions in schema app to authenticated, service_role;
