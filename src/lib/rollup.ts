/**
 * Weekly and Monthly Rollups, reproducing the workbook's COUNTIFS/SUMIFS
 * cell-for-cell (§11, acceptance test 19), with achievement direction-
 * corrected per §4.6. Input is day_close rows already scoped by permissions.
 */
import type { DayClose, Direction, Person } from './types';
import { achievementPct, fixedPct, ratingInput, weeklyStatus, type RatingInput, type WeeklyStatus } from './compute';

export interface PersonRollup {
  person_id: string;
  full_name: string;
  department: string;
  days_submitted: number;
  submission_rate: number | null; // ÷ working days
  on_time_rate: number | null;    // blank when no submissions (workbook)
  fixed_due: number;
  fixed_done: number;
  fixed_pct: number | null;
  total_target: number;
  total_actual: number;
  achievement_pct: number | null;
  status: WeeklyStatus;
  // Monthly extras
  reactive_hours: number;
  blockers_raised: number;
  rating: RatingInput;
}

export interface AttentionFlags {
  blockers_raised: number;
  not_reviewed: number;
  late_submissions: number;
  reactive_hours: number;
  at_risk: number;
}

export interface TeamTotal {
  days_submitted: number;
  fixed_due: number;
  fixed_done: number;
  fixed_pct: number | null;
  total_target: number;
  total_actual: number;
  achievement_pct: number | null;
  reactive_hours: number;
  blockers_raised: number;
}

function rollupRows(
  person: Person,
  rows: DayClose[],
  expectedDays: number,
  leaveDays: number,
): PersonRollup {
  const days = rows.length;
  const onTime = rows.filter((r) => r.submitted_on_time).length;
  const fixedDue = rows.reduce((s, r) => s + r.fixed_tasks_due, 0);
  const fixedDone = rows.reduce((s, r) => s + r.fixed_tasks_done, 0);
  const target = rows.reduce((s, r) => s + (r.target ?? 0), 0);
  const actual = rows.reduce((s, r) => s + (r.actual ?? 0), 0);
  const direction: Direction = rows.find((r) => r.direction)?.direction ?? 'Higher is better';
  const achievement = days === 0 ? null : achievementPct(actual, target, direction);
  const fixed = fixedPct(fixedDone, fixedDue);
  // Submission rate excludes leave days rather than scoring zero (§8.4, §11.1)
  const denominator = Math.max(expectedDays - leaveDays, 0);

  return {
    person_id: person.id,
    full_name: person.full_name,
    department: person.department,
    days_submitted: days,
    submission_rate: denominator === 0 ? null : days / denominator,
    on_time_rate: days === 0 ? null : onTime / days,
    fixed_due: fixedDue,
    fixed_done: fixedDone,
    fixed_pct: fixed,
    total_target: target,
    total_actual: actual,
    achievement_pct: achievement,
    status: weeklyStatus(days, achievement),
    reactive_hours: rows.reduce((s, r) => s + r.reactive_hours, 0),
    blockers_raised: rows.filter((r) => r.blocker).length,
    rating: ratingInput(days, achievement, fixed),
  };
}

export interface RollupOptions {
  people: Person[];
  closes: DayClose[]; // already filtered to the week/month AND to the viewer's scope
  expectedDays: number; // working days per week (6) or month (26) from settings
  leaveDaysByPerson?: Record<string, number>;
}

export function buildRollup({ people, closes, expectedDays, leaveDaysByPerson = {} }: RollupOptions): {
  rows: PersonRollup[];
  total: TeamTotal;
  flags: AttentionFlags;
} {
  const byPerson = new Map<string, DayClose[]>();
  for (const c of closes) {
    const list = byPerson.get(c.person_id) ?? [];
    list.push(c);
    byPerson.set(c.person_id, list);
  }

  const rows = people.map((p) =>
    rollupRows(p, byPerson.get(p.id) ?? [], expectedDays, leaveDaysByPerson[p.id] ?? 0),
  );

  const total: TeamTotal = {
    days_submitted: rows.reduce((s, r) => s + r.days_submitted, 0),
    fixed_due: rows.reduce((s, r) => s + r.fixed_due, 0),
    fixed_done: rows.reduce((s, r) => s + r.fixed_done, 0),
    fixed_pct: null,
    total_target: rows.reduce((s, r) => s + r.total_target, 0),
    total_actual: rows.reduce((s, r) => s + r.total_actual, 0),
    achievement_pct: null,
    reactive_hours: rows.reduce((s, r) => s + r.reactive_hours, 0),
    blockers_raised: rows.reduce((s, r) => s + r.blockers_raised, 0),
  };
  total.fixed_pct = fixedPct(total.fixed_done, total.fixed_due);
  // Team total keeps the workbook's flat division: mixed directions make a
  // direction-corrected team ratio meaningless, and test 19 wants cell parity.
  total.achievement_pct = total.total_target === 0 ? null : total.total_actual / total.total_target;

  const flags: AttentionFlags = {
    blockers_raised: closes.filter((c) => c.blocker).length,
    not_reviewed: closes.filter((c) => !c.manager_reviewed).length,
    late_submissions: closes.filter((c) => !c.submitted_on_time).length,
    reactive_hours: closes.reduce((s, c) => s + c.reactive_hours, 0),
    at_risk: closes.reduce((s, c) => s + c.assigned_at_risk, 0),
  };

  return { rows, total, flags };
}

/** Department view under the Monthly Rollup (workbook's second table). */
export interface DeptRollup {
  department: string;
  days_submitted: number;
  fixed_pct: number | null;
  total_target: number;
  total_actual: number;
  achievement_pct: number | null;
  reactive_hours: number;
  active_people: number;
}

export function buildDeptRollup(
  departments: string[],
  closes: DayClose[],
  activePeopleByDept: Record<string, number>,
): DeptRollup[] {
  return departments.map((dept) => {
    const rows = closes.filter((c) => c.department === dept);
    const fixedDue = rows.reduce((s, r) => s + r.fixed_tasks_due, 0);
    const fixedDone = rows.reduce((s, r) => s + r.fixed_tasks_done, 0);
    const target = rows.reduce((s, r) => s + (r.target ?? 0), 0);
    const actual = rows.reduce((s, r) => s + (r.actual ?? 0), 0);
    return {
      department: dept,
      days_submitted: rows.length,
      fixed_pct: fixedPct(fixedDone, fixedDue),
      total_target: target,
      total_actual: actual,
      achievement_pct: target === 0 ? null : actual / target,
      reactive_hours: rows.reduce((s, r) => s + r.reactive_hours, 0),
      active_people: activePeopleByDept[dept] ?? 0,
    };
  });
}
