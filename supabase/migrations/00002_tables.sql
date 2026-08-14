-- ═══════════════════════════════════════════════════════════════════════════
-- 5C PULSE · 00002 · tables (§4 data model)
-- Append-only doctrine: nothing is ever hard-deleted — deactivate, archive,
-- supersede. DELETE is revoked from application roles in 00005_rls.sql.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 4.1 people ──────────────────────────────────────────────────────────────
create table public.people (
  id                   uuid primary key default gen_random_uuid(),
  employee_code        text unique,                  -- EMP-01, auto-issued, never reused
  full_name            text not null,
  department           public.department not null,
  designation          text not null,                -- label; access_role is power
  reports_to_id        uuid references public.people(id),
  email                text not null,
  phone                text,
  access_role          public.access_role not null default 'Member',
  capabilities         text[] not null default '{}', -- hr_admin | finance_admin | people_admin
  status               public.person_status not null default 'Active',
  joined_on            date,
  deactivated_on       date,
  daily_capacity_hours numeric not null default 8,
  wip_limit_p1         int not null default 3,
  auth_user_id         uuid unique,                  -- linked from auth.users by email
  settling_in_until    date,                         -- 14-day grace for new joiners
  notification_prefs   jsonb not null default '{}'::jsonb,
  density_pref         text not null default 'dense',
  created_at           timestamptz not null default now()
);

create unique index people_email_key on public.people (lower(email));
-- Exactly one root permitted in the reporting tree (§4.1)
create unique index people_single_root on public.people ((1))
  where reports_to_id is null and status <> 'Deactivated';
create index people_reports_to_idx on public.people (reports_to_id);

-- ── 4.2 charters + charter_tasks ────────────────────────────────────────────
create table public.charters (
  id                     uuid primary key default gen_random_uuid(),
  person_id              uuid not null unique references public.people(id),
  owns_outcome           text,                       -- outcomes, not activities
  can_decide_alone       text[] not null default '{}',
  needs_approval_from_id uuid references public.people(id),
  needs_approval_for     text[] not null default '{}',
  reviewed_on            date,
  -- Charters flag for review 90 days after reviewed_on
  next_review_due        date generated always as (reviewed_on + 90) stored,
  created_at             timestamptz not null default now()
);

create table public.charter_tasks (
  id                 uuid primary key default gen_random_uuid(),
  charter_id         uuid not null references public.charters(id),
  title              text not null,
  cadence            public.cadence not null,
  definition_of_done text,
  weekday_mask       int[],                          -- ISO 1–7 (Mon=1), weekly/fortnightly
  month_day          int check (month_day between 1 and 31),
  active             boolean not null default true,
  suspended_reason   text,                           -- 'Suspended — no owner' after handover
  sort_order         int not null default 0,
  created_at         timestamptz not null default now()
);

create index charter_tasks_charter_idx on public.charter_tasks (charter_id) where active;

-- ── 4.3 kpis ────────────────────────────────────────────────────────────────
create table public.kpis (
  id             uuid primary key default gen_random_uuid(),
  person_id      uuid not null references public.people(id),
  metric         text not null,
  unit           public.kpi_unit not null,
  target_type    public.target_type not null,
  direction      public.direction not null,
  daily_target   numeric not null,
  review_cadence public.cadence not null,
  is_primary     boolean not null default false,     -- exactly one per person pre-fills Day Close
  effective_from date not null default current_date,
  effective_to   date,                               -- null = current; close old row, insert new
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

-- Exactly one primary among each person's current KPIs
create unique index kpis_one_primary on public.kpis (person_id)
  where is_primary and active and effective_to is null;
create index kpis_person_current_idx on public.kpis (person_id)
  where active and effective_to is null;

-- ── 4.4 tasks — the heart of the system ─────────────────────────────────────
create table public.tasks (
  id                     uuid primary key default gen_random_uuid(),
  task_code              text unique,                -- TSK-001 sequential, never reused
  title                  text not null,
  description            text,                       -- markdown
  checklist              jsonb not null default '[]'::jsonb, -- [{text, done}]
  task_type              public.task_type not null default 'Assigned',
  owner_id               uuid not null references public.people(id),
  accountable_id         uuid not null references public.people(id),
  department             public.department not null, -- derived from owner, stored for filtering
  priority               public.priority not null default 'P2 - Important',
  status                 public.task_status not null default 'Not Started',
  assigned_by_id         uuid not null references public.people(id),
  assigned_on            timestamptz not null default now(),
  due_at                 timestamptz not null,
  est_hours              numeric,
  started_at             timestamptz,
  completed_at           timestamptz,
  linked_kpi_id          uuid references public.kpis(id),
  parent_task_id         uuid references public.tasks(id), -- one level deep only
  recurrence_rule        jsonb,
  source_charter_task_id uuid references public.charter_tasks(id),
  spawn_date             date,                       -- fixed instances: idempotent daily spawn
  visibility             public.task_visibility not null default 'Team',
  acceptance_required    boolean not null default false,
  accepted_at            timestamptz,
  declined_reason        text,
  origin_verb            public.assignment_verb not null default 'Direct',
  pending_with_id        uuid references public.people(id), -- who must act on a request
  respond_by             timestamptz,                -- 12h peer clock / 24h cross-dept clock
  request_nudged_at      timestamptz,
  proposed_due_at        timestamptz,                -- counter-propose
  proposed_owner_id      uuid references public.people(id),
  counter_note           text,
  delegation_chain       uuid[] not null default '{}', -- prior owners; max depth 2
  batch_id               uuid,                       -- multi-assign tracking
  urgent                 boolean not null default false, -- same-day peer request
  override_reason        text,                       -- recorded when a §6.4 guard is overridden
  drop_reason            text,
  reopened_at            timestamptz,
  created_at             timestamptz not null default now(),
  constraint due_after_assigned check (due_at >= assigned_on)
);

create unique index tasks_fixed_spawn_once
  on public.tasks (source_charter_task_id, spawn_date)
  where source_charter_task_id is not null;
create index tasks_owner_status_idx on public.tasks (owner_id, status);
create index tasks_due_open_idx on public.tasks (due_at)
  where status not in ('Completed','Dropped','Declined','Missed');
create index tasks_dept_idx on public.tasks (department, status);
create index tasks_pending_with_idx on public.tasks (pending_with_id)
  where status = 'Awaiting Acceptance';

-- ── 4.5 task_participants — supporting members, done properly ──────────────
create table public.task_participants (
  id              uuid primary key default gen_random_uuid(),
  task_id         uuid not null references public.tasks(id),
  person_id       uuid not null references public.people(id),
  support_role    public.support_role not null default 'Support',
  added_by_id     uuid references public.people(id),
  added_at        timestamptz not null default now(),
  acknowledged_at timestamptz,
  signed_off_at   timestamptz,                       -- reviewer sign-off gates Completed
  removed_at      timestamptz,
  removed_reason  text
);

create unique index task_participants_unique_active
  on public.task_participants (task_id, person_id) where removed_at is null;
create index task_participants_person_idx on public.task_participants (person_id)
  where removed_at is null;

-- ── 4.7 blockers (before day_close so the FK can point here) ───────────────
create table public.blockers (
  id                 uuid primary key default gen_random_uuid(),
  raised_by_id       uuid not null references public.people(id),
  unblocker_id       uuid not null references public.people(id), -- no anonymous blocking
  task_id            uuid references public.tasks(id),
  day_close_id       uuid,                           -- FK added after day_close exists
  description        text not null,
  severity           public.blocker_severity not null default 'Medium',
  raised_at          timestamptz not null default now(),
  sla_due_at         timestamptz not null,           -- raised_at + settings.blocker_sla_hours
  first_response_at  timestamptz,
  first_responder_id uuid references public.people(id),
  resolved_at        timestamptz,
  resolution_note    text,
  nudged_at          timestamptz,                    -- 12h nudge to the unblocker
  escalated_at       timestamptz,                    -- 24h auto-escalation, not optional
  escalated_to_id    uuid references public.people(id)
);

create index blockers_open_idx on public.blockers (unblocker_id, sla_due_at)
  where resolved_at is null;

-- ── 4.6 day_close — one row per person per day ─────────────────────────────
create table public.day_close (
  id                       uuid primary key default gen_random_uuid(),
  person_id                uuid not null references public.people(id),
  close_date               date not null,
  week_starting            date not null,            -- Monday, stamped by trigger
  month                    text not null,            -- YYYY-MM, stamped from close_date
  department               public.department not null,
  -- Pre-filled by the system (green in the workbook)
  fixed_tasks_due          int not null default 0,
  fixed_tasks_done         int not null default 0,
  fixed_done_task_ids      uuid[] not null default '{}',
  primary_metric           text,
  target                   numeric,
  direction                public.direction,         -- snapshot for direction-corrected achievement
  assigned_on_track        int not null default 0,
  assigned_at_risk         int not null default 0,
  assigned_completed_today int not null default 0,
  -- Typed by the person (blue in the workbook — exactly four things)
  actual                   numeric,
  reactive_hours           numeric not null default 0,
  reactive_tags            text[] not null default '{}',
  blocker                  boolean not null default false,
  top_3_tomorrow           text[] not null default '{}',
  -- Server-computed
  submitted_at             timestamptz not null default now(),
  submitted_on_time        boolean not null default false,
  edited_at                timestamptz,
  unlock_by_id             uuid references public.people(id),
  unlocked_until           timestamptz,
  manager_reviewed         boolean not null default false,
  reviewed_by_id           uuid references public.people(id),
  reviewed_at              timestamptz,
  review_reaction          text,
  constraint day_close_once unique (person_id, close_date)
);

create index day_close_person_date_idx on public.day_close (person_id, close_date);
create index day_close_week_idx on public.day_close (week_starting);
create index day_close_month_idx on public.day_close (month);

alter table public.blockers
  add constraint blockers_day_close_fk
  foreign key (day_close_id) references public.day_close(id);

-- ── 4.7 supporting tables ───────────────────────────────────────────────────
create table public.comments (
  id           uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('task','day_close','blocker')),
  subject_id   uuid not null,
  author_id    uuid not null references public.people(id),
  body         text not null,
  mentions     uuid[] not null default '{}',
  is_system    boolean not null default false,       -- inline status-change entries
  edited_at    timestamptz,
  struck_at    timestamptz,                          -- never deleted — struck through
  created_at   timestamptz not null default now()
);
create index comments_subject_idx on public.comments (subject_type, subject_id, created_at);

create table public.approvals (
  id            uuid primary key default gen_random_uuid(),
  requested_by_id uuid not null references public.people(id),
  approver_id   uuid not null references public.people(id),
  subject_type  text not null check (subject_type in
    ('task_approval','cross_dept_assignment','support_request','deactivation_countersign','standalone')),
  subject_ref   uuid,                                -- the task / person the request is about
  task_id       uuid references public.tasks(id),    -- gates Completed when set
  context       text not null,                       -- what, why, how much
  decision      public.approval_decision not null default 'Pending',
  decided_at    timestamptz,
  note          text,
  respond_by    timestamptz,
  created_at    timestamptz not null default now()
);
create index approvals_pending_idx on public.approvals (approver_id) where decision = 'Pending';
create index approvals_task_idx on public.approvals (task_id) where decision = 'Pending';

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  person_id  uuid not null references public.people(id),
  kind       text not null,
  payload    jsonb not null default '{}'::jsonb,
  channel    public.notification_channel not null default 'in-app',
  read_at    timestamptz,
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_person_idx on public.notifications (person_id, created_at desc);

create table public.handovers (
  id              uuid primary key default gen_random_uuid(),
  from_person_id  uuid not null references public.people(id),
  to_person_id    uuid references public.people(id), -- primary recipient (may be several; see detail)
  task_ids        uuid[] not null default '{}',
  charter_items   uuid[] not null default '{}',
  kpi_items       uuid[] not null default '{}',
  blocker_ids     uuid[] not null default '{}',
  detail          jsonb not null default '{}'::jsonb, -- full per-item placement record
  summary         text,
  executed_by_id  uuid not null references public.people(id),
  executed_at     timestamptz not null default now()
);

create table public.audit_log (
  id        bigint generated always as identity primary key,
  actor_id  uuid,
  action    text not null,
  entity    text not null,
  entity_id text,
  before    jsonb,
  after     jsonb,
  at        timestamptz not null default now()
);
create index audit_entity_idx on public.audit_log (entity, entity_id, at desc);

create table public.announcements (
  id           uuid primary key default gen_random_uuid(),
  author_id    uuid not null references public.people(id),
  body         text not null,
  pinned       boolean not null default true,
  ack_required boolean not null default false,
  department   public.department,                    -- null = company-wide
  created_at   timestamptz not null default now()
);

create table public.announcement_acks (
  announcement_id uuid not null references public.announcements(id),
  person_id       uuid not null references public.people(id),
  acked_at        timestamptz not null default now(),
  primary key (announcement_id, person_id)
);

create table public.settings (
  id                     int primary key default 1 check (id = 1),
  working_days_per_week  int not null default 6,
  working_days_per_month int not null default 26,
  window_open            time not null default '18:00',
  window_close           time not null default '19:30',
  grace_until            time not null default '09:00', -- next day = Late
  blocker_sla_hours      int not null default 24,
  peer_request_hours     int not null default 12,
  diagnostic_until       date,                       -- diagnostic mode end date
  timezone               text not null default 'Asia/Kolkata',
  weekly_off             int[] not null default '{7}', -- ISO dow, Sunday
  product_name           text not null default '5C Pulse'
);

create table public.kudos (
  id             uuid primary key default gen_random_uuid(),
  from_person_id uuid not null references public.people(id),
  to_person_id   uuid not null references public.people(id),
  note           text not null,
  task_id        uuid references public.tasks(id),
  created_at     timestamptz not null default now()
);

create table public.holidays (
  day  date primary key,
  name text not null
);

create table public.leaves (
  id              uuid primary key default gen_random_uuid(),
  person_id       uuid not null references public.people(id),
  starts_on       date not null,
  ends_on         date not null,
  cover_person_id uuid references public.people(id),
  note            text,
  created_by_id   uuid references public.people(id),
  created_at      timestamptz not null default now(),
  constraint leave_range check (ends_on >= starts_on)
);
create index leaves_person_idx on public.leaves (person_id, starts_on, ends_on);

create table public.asks (
  id              uuid primary key default gen_random_uuid(),
  from_person_id  uuid not null references public.people(id),
  to_person_id    uuid not null references public.people(id),
  body            text not null,
  status          public.ask_status not null default 'Open',
  created_task_id uuid references public.tasks(id),
  answer          text,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now()
);
create index asks_open_idx on public.asks (to_person_id) where status = 'Open';

create table public.task_templates (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  title               text not null,
  description         text,
  checklist           jsonb not null default '[]'::jsonb,
  est_hours           numeric,
  priority            public.priority not null default 'P2 - Important',
  default_support_ids uuid[] not null default '{}',
  relative_due_days   int not null default 3,        -- "+3 working days"
  department          public.department,
  created_by_id       uuid not null references public.people(id),
  created_at          timestamptz not null default now()
);

create table public.attachments (
  id             uuid primary key default gen_random_uuid(),
  subject_type   text not null check (subject_type in ('task','day_close','blocker','comment')),
  subject_id     uuid not null,
  storage_path   text not null,
  file_name      text not null,
  uploaded_by_id uuid not null references public.people(id),
  created_at     timestamptz not null default now()
);

-- Median time-to-submit instrumentation (§16: the five-minute promise is measured)
create table public.form_timings (
  id         uuid primary key default gen_random_uuid(),
  person_id  uuid not null references public.people(id),
  form       text not null default 'day_close',
  opened_at  timestamptz not null,
  submitted_at timestamptz not null default now(),
  seconds    int not null
);

insert into public.settings (id) values (1);
