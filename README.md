# 5C Pulse

The internal operating system for 5 Circles. It replaces the nine-tab
Excel workbook that governs how work is assigned, how targets are set, and how
every team member reports at end of day — keeping every rule the workbook
encodes and giving it a multi-user body.

> The form must take under five minutes. If it takes longer, people stop
> filing honestly. Everything else in this codebase is in service of that.

*(Product name is a placeholder — swap it in `src/lib/constants.ts`; visual
identity lives entirely in `src/styles/tokens.css`.)*

## Stack

Next.js 14 (App Router, server components + server actions) · TypeScript ·
Supabase (Postgres, Auth, RLS, Realtime, Storage) · Tailwind + hand-rolled
shadcn-style primitives · lucide-react · recharts · date-fns · Zod ·
react-hook-form · Resend · Vercel Cron · exceljs.

## The three hard success criteria, and where they live

| # | Criterion | Where it is enforced |
|---|---|---|
| 1 | EOD report under 5 minutes, 80%+ pre-filled | `app.day_close_prefill()` builds the green columns server-side; the form (`src/app/(app)/day-close/form.tsx`) asks for exactly four things; median time-to-submit is measured in `form_timings` and surfaces on Settings when it crosses 5 minutes |
| 2 | Zero orphaned work | `trg_people_deactivation` (00004) refuses the status flip while any open task, blocker, duty, KPI, report, or approval remains — the Handover wizard (`people/[id]/handover.tsx`) places everything first |
| 3 | Every blocker answered in 24h | `sla_due_at` stamps itself on insert; the hourly `sla-sweep` cron nudges at 12h and **auto-escalates at 24h** to the manager + Owner, visibly to the raiser |

## Architecture rules (non-negotiable, §3)

- **Permissions live in the database.** Every table has RLS; the UI hides
  buttons, the database refuses the write regardless.
- **One permission module.** `src/lib/permissions.ts` exports pure functions
  (`canAssignTo`, `canViewTask`, `canEditCharter`, `canDeactivate`, …).
  The `app.*` SQL functions in `supabase/migrations/00003` mirror them
  one-for-one. Change a rule in both places or not at all.
- **Append-only.** `DELETE` is revoked *and* trigger-blocked. Deactivate,
  archive, supersede. Every state change writes `audit_log`.
- **Server time is the only truth.** All deadline maths run in the company
  timezone (Asia/Kolkata) — in SQL via `app.now_local()`, in TS via
  `src/lib/dates.ts`. Client clocks render, never decide.
- **Mobile-first** where it matters: Day Close and My Day are built for 375px.

## Repository map

```
supabase/
  migrations/            00001 enums · 00002 tables · 00003 app.* helpers
                         00004 guard triggers · 00005 RLS · 00006 views/matviews
                         00007 public RPC wrappers
  seed.sql               The workbook, imported exactly (8 people, 40 duties,
                         28 KPI rows, 3 tasks, 3 example closes)
  tests/                 00 shim (local Postgres stand-in for Supabase)
                         01 guard suite · 02 RLS suite (§18's forbidden-write script)
src/
  lib/                   permissions · compute (workbook formulas, direction-fixed)
                         rollup (COUNTIFS/SUMIFS parity) · dates · guards (§6.4)
                         notify (§12 matrix + quiet hours) · schemas (Zod) · session
  server/actions/        tasks (the four verbs, state machine) · day-close ·
                         blockers · people (add / handover) · misc
  app/(app)/             my-day · day-close · board · tasks/[code] · assign ·
                         review · rollups · blockers · people (+new, +[id]) ·
                         charters · targets · settings
  app/api/cron/          daily-spawn · sla-sweep · digests (5 kinds)
  app/api/export/        workbook (nine tabs, source layout) · my-record
  styles/tokens.css      THE brand file — the only place a hex may live
```

## Getting started

1. **Supabase**: create a project, then apply migrations and seed:

   ```bash
   for f in supabase/migrations/*.sql supabase/seed.sql; do
     psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$f"
   done
   ```

   Enable the **magic link** and **Google** providers in Auth settings, and
   set session expiry to 30 days. Sign-ins only work for emails present in
   `people` — auth users link to people rows automatically (trigger +
   `link_me()` fallback).

2. **Environment**: copy `.env.example` → `.env.local` and fill in the
   Supabase URL/keys, Resend key, and a `CRON_SECRET`.

3. **Run**: `npm install && npm run dev` — sign in as `arjun@company.com`
   (or any seeded address your Supabase can deliver mail to).

4. **Deploy**: on Vercel, `vercel.json` registers the cron schedule
   (times are UTC = IST − 5:30): fixed-work spawn 00:05, morning digest
   08:30, nudge 18:45, manager digest 19:45, weekly pack Mon 07:00,
   monthly pack 1st 07:00, SLA sweep hourly.

## Tests

```bash
npm test                 # 50 unit tests: workbook-parity rollups (test 19),
                         # direction-corrected achievement (test 20), window
                         # timing (test 11), the §6.1 matrix, the §6.4 guards
```

```bash
# Database suites against a scratch Postgres (also runnable on Supabase):
psql -d pulse -f supabase/tests/00_supabase_shim.sql   # local stand-in only
psql -d pulse -f supabase/migrations/*.sql             # in order
psql -d pulse -f supabase/seed.sql
psql -d pulse -f supabase/tests/01_guards_test.sql     # 14 structural guards
psql -d pulse -f supabase/tests/02_rls_test.sql        # 12 forbidden-access probes
```

The guard suite proves: orphan-proof deactivation, both ceilings (with the
spec's exact copy), one-primary-KPI, target history immutability, delegation
depth 2, reviewer + approval completion gates, no anonymous blocking, one
close per day, append-only, idempotent spawn, one-level subtasks. The RLS
suite drives real JWT-scoped sessions through every §17 access test.

## Decisions worth knowing about

- **`Missed` status.** §7 says lapsed fixed instances are "marked Missed";
  the Lists tab has no such value, so the enum adds one, used only by the
  system on Fixed work. The three §4 additions (Awaiting Acceptance,
  Declined, Pending Review) are per Appendix A.
- **Fortnightly cadence** spawns on the weekday mask in odd ISO weeks
  (deterministic, anchor-free). Change in `app.spawn_fixed_tasks` if 5 Circles
  counts fortnights differently.
- **Team-total achievement** in rollups keeps the workbook's flat
  Σactual/Σtarget (mixed directions make a corrected team ratio meaningless);
  the per-person figure is direction-corrected as §4.6 demands.
- **Rollup materialised views** exist for scale (nightly refresh via
  `daily-spawn`); the rollup screen currently aggregates live through RLS,
  which is exact and fast at seed size — swap to the matviews behind the same
  `lib/rollup.ts` shapes when row counts demand it.
- **Offline queueing** for Day Close is implemented as an aggressive
  localStorage draft (every field, restored on reload); a service-worker sync
  queue is the natural next step.
- **Fallback track** (Google Sheets + Apps Script) was not built, per the
  brief's "do not build both". The permission functions and formula module
  are pure TS and would port; realtime and RLS would degrade badly — that is
  the trade-off the brief accepts.

## What ships where (build phases, §19)

Phases 0–4 are functional end-to-end: schema/RLS/seed, directory + charters +
targets with ceilings, the Day Close loop with review queue and streaks, the
assignment engine (all four verbs, acceptance, guards, delegation, state
machine), and blockers with clocks, escalation, comments and digests.
Phase 5 ships the Weekly/Monthly rollups, department view, attention flags
and the nine-tab Excel export; PDF pack lands as a print-ready route next.
Phase 6 ships the handover wizard, leave, kudos and announcements;
task templates and round-robin distribution are schema-ready (`task_templates`,
`batch_id`) with UI to follow.
