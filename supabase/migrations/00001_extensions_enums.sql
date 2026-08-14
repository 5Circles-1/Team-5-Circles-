-- ═══════════════════════════════════════════════════════════════════════════
-- 5C PULSE · 00001 · extensions, schemas, enums
-- Enums come straight from the workbook's Lists tab and must not drift.
-- Additions over the workbook (per spec §4/§7): Awaiting Acceptance, Declined,
-- Pending Review on task_status, plus Missed for fixed instances that lapse
-- at end of day (§7 recurring work: "marked Missed and feed the Fixed %").
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- Helper schema: pure authorization + time functions used by RLS policies.
-- These mirror lib/permissions.ts one-for-one.
create schema if not exists app;
grant usage on schema app to authenticated, anon, service_role;

-- ── Enums (Lists tab, frozen) ───────────────────────────────────────────────
create type public.department as enum
  ('Sales','Marketing','Operations','Finance','HR','Management');

create type public.cadence as enum
  ('Daily','Weekly','Fortnightly','Monthly','Quarterly');

create type public.task_status as enum
  ('Awaiting Acceptance','Declined','Not Started','On Track','At Risk',
   'Blocked','Pending Review','Completed','Dropped','Missed');

create type public.priority as enum
  ('P1 - Critical','P2 - Important','P3 - Nice to have');

create type public.target_type as enum ('Volume','Rate');

create type public.direction as enum ('Higher is better','Lower is better');

create type public.task_type as enum ('Fixed','Assigned','Reactive');

create type public.support_role as enum ('Support','Reviewer','Approver','Watcher');

create type public.access_role as enum
  ('Owner','Department Head','Team Lead','Member','Restricted','Observer');

create type public.person_status as enum ('Active','On Leave','Deactivated');

create type public.task_visibility as enum ('Team','Department','Private');

create type public.kpi_unit as enum ('INR','Count','%','Hours','Days');

create type public.assignment_verb as enum
  ('Direct','Peer Request','Cross-department Request','Ask');

create type public.approval_decision as enum
  ('Pending','Approved','Declined','Question');

create type public.blocker_severity as enum ('Low','Medium','High');

create type public.notification_channel as enum ('in-app','email','digest');

create type public.ask_status as enum ('Open','Converted','Answered','Declined');

-- Sequential, never-reused codes (EMP-01, TSK-001)
create sequence public.employee_code_seq;
create sequence public.task_code_seq;
