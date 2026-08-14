/**
 * Acceptance test 19: Weekly Rollup figures match the workbook's formulas
 * cell-for-cell on the same input data — fixture built from the three
 * example rows (Daily EOD Log rows 5–7, week starting 2026-08-10).
 */
import { describe, expect, it } from 'vitest';
import { buildRollup, buildDeptRollup } from '../rollup';
import type { DayClose, Person } from '../types';

const P = (id: string, name: string, dept: Person['department']): Person => ({
  id, employee_code: id, full_name: name, department: dept, designation: '',
  reports_to_id: null, email: `${id}@x`, phone: null, access_role: 'Member',
  capabilities: [], status: 'Active', joined_on: null, deactivated_on: null,
  daily_capacity_hours: 8, wip_limit_p1: 3, settling_in_until: null,
});

const people: Person[] = [
  P('arjun', 'Arjun Desai', 'Management'),
  P('priya', 'Priya Nair', 'Sales'),
  P('rohan', 'Rohan Mehta', 'Sales'),
  P('ananya', 'Ananya Sharma', 'Marketing'),
  P('kabir', 'Kabir Singh', 'Marketing'),
  P('vikram', 'Vikram Rao', 'Operations'),
  P('sneha', 'Sneha Iyer', 'Finance'),
  P('meera', 'Meera Kapoor', 'HR'),
];

const close = (
  person_id: string, dept: DayClose['department'],
  v: Partial<DayClose>,
): DayClose => ({
  id: `${person_id}-c`, person_id, close_date: '2026-08-13',
  week_starting: '2026-08-10', month: '2026-08', department: dept,
  fixed_tasks_due: 5, fixed_tasks_done: 5, fixed_done_task_ids: [],
  primary_metric: null, target: null, direction: 'Higher is better', actual: null,
  assigned_on_track: 0, assigned_at_risk: 0, assigned_completed_today: 0,
  reactive_hours: 0, reactive_tags: [], blocker: false, top_3_tomorrow: [],
  submitted_at: '2026-08-13T19:00:00+05:30', submitted_on_time: true,
  edited_at: null, manager_reviewed: true, reviewed_by_id: null, reviewed_at: null,
  ...v,
});

// The three example rows, exactly as the workbook holds them
const closes: DayClose[] = [
  close('rohan', 'Sales', {
    primary_metric: 'New leads contacted', target: 25, actual: 28,
    assigned_on_track: 2, assigned_completed_today: 1, reactive_hours: 0.5,
  }),
  close('ananya', 'Marketing', {
    fixed_tasks_done: 4, primary_metric: 'Qualified leads generated',
    target: 20, actual: 14, assigned_on_track: 1, assigned_at_risk: 1,
    reactive_hours: 2, blocker: true,
  }),
  close('vikram', 'Operations', {
    primary_metric: 'Orders / requests processed', target: 40, actual: 37,
    assigned_on_track: 2, assigned_completed_today: 1, reactive_hours: 1.5,
    submitted_on_time: false,
  }),
];

describe('Weekly Rollup — cell-for-cell against the workbook', () => {
  const { rows, total, flags } = buildRollup({ people, closes, expectedDays: 6 });
  const by = (name: string) => rows.find((r) => r.full_name === name)!;

  it('Rohan Mehta: 1 day, 16.7% rate, 100% on-time, 5/5 fixed, 28/25 → 112% On target', () => {
    const r = by('Rohan Mehta');
    expect(r.days_submitted).toBe(1);
    expect(r.submission_rate).toBeCloseTo(0.1666666667, 9);
    expect(r.on_time_rate).toBe(1);
    expect(r.fixed_due).toBe(5);
    expect(r.fixed_done).toBe(5);
    expect(r.fixed_pct).toBe(1);
    expect(r.total_target).toBe(25);
    expect(r.total_actual).toBe(28);
    expect(r.achievement_pct).toBeCloseTo(1.12, 10);
    expect(r.status).toBe('On target');
  });

  it('Ananya Sharma: 4/5 fixed, 14/20 → 70% Needs attention', () => {
    const r = by('Ananya Sharma');
    expect(r.fixed_pct).toBeCloseTo(0.8, 10);
    expect(r.achievement_pct).toBeCloseTo(0.7, 10);
    expect(r.status).toBe('Needs attention');
  });

  it('Vikram Rao: on-time 0%, 37/40 → 92.5% Slightly behind', () => {
    const r = by('Vikram Rao');
    expect(r.on_time_rate).toBe(0);
    expect(r.achievement_pct).toBeCloseTo(0.925, 10);
    expect(r.status).toBe('Slightly behind');
  });

  it('non-submitters read No submissions with blank rates, like the workbook', () => {
    for (const name of ['Arjun Desai', 'Priya Nair', 'Kabir Singh', 'Sneha Iyer', 'Meera Kapoor']) {
      const r = by(name);
      expect(r.days_submitted).toBe(0);
      expect(r.status).toBe('No submissions');
      expect(r.on_time_rate).toBeNull();
      expect(r.fixed_pct).toBeNull();
      expect(r.achievement_pct).toBeNull();
    }
  });

  it('TEAM TOTAL row: 3 submitted, 14/15 fixed (93.3%), 79/85 (92.94%)', () => {
    expect(total.days_submitted).toBe(3);
    expect(total.fixed_due).toBe(15);
    expect(total.fixed_done).toBe(14);
    expect(total.fixed_pct).toBeCloseTo(0.9333333333, 9);
    expect(total.total_target).toBe(85);
    expect(total.total_actual).toBe(79);
    expect(total.achievement_pct).toBeCloseTo(0.9294117647, 9);
  });

  it('the five attention flags match the workbook block', () => {
    expect(flags.blockers_raised).toBe(1);
    expect(flags.not_reviewed).toBe(0);
    expect(flags.late_submissions).toBe(1);
    expect(flags.reactive_hours).toBe(4);
    expect(flags.at_risk).toBe(1);
  });
});

describe('Monthly Rollup extras (ratings + department view)', () => {
  const { rows } = buildRollup({ people, closes, expectedDays: 26 });
  const by = (name: string) => rows.find((r) => r.full_name === name)!;

  it('rating inputs match the workbook column N', () => {
    expect(by('Rohan Mehta').rating).toBe('Exceeding');
    expect(by('Vikram Rao').rating).toBe('Meeting');
    expect(by('Ananya Sharma').rating).toBe('Below - review');
    expect(by('Sneha Iyer').rating).toBe('No data');
  });

  it('monthly submission rate uses 26 working days', () => {
    expect(by('Rohan Mehta').submission_rate).toBeCloseTo(0.03846153846, 9);
  });

  it('department view matches the workbook second table', () => {
    const dept = buildDeptRollup(
      ['Sales', 'Marketing', 'Operations', 'Finance', 'HR', 'Management'],
      closes,
      { Sales: 2, Marketing: 2, Operations: 1, Finance: 1, HR: 1, Management: 1 },
    );
    const sales = dept.find((d) => d.department === 'Sales')!;
    expect(sales.days_submitted).toBe(1);
    expect(sales.fixed_pct).toBe(1);
    expect(sales.achievement_pct).toBeCloseTo(1.12, 10);
    const mkt = dept.find((d) => d.department === 'Marketing')!;
    expect(mkt.fixed_pct).toBeCloseTo(0.8, 10);
    expect(mkt.achievement_pct).toBeCloseTo(0.7, 10);
    const fin = dept.find((d) => d.department === 'Finance')!;
    expect(fin.days_submitted).toBe(0);
    expect(fin.achievement_pct).toBeNull(); // renders "No active members"/blank, never 0%
  });

  it('leave days shrink the submission-rate denominator instead of scoring zero', () => {
    const { rows: withLeave } = buildRollup({
      people, closes, expectedDays: 6, leaveDaysByPerson: { rohan: 2 },
    });
    expect(withLeave.find((r) => r.person_id === 'rohan')!.submission_rate)
      .toBeCloseTo(1 / 4, 10);
  });
});

describe('changing a KPI target today never alters last month (test 21)', () => {
  it('rollup reads the target snapshot stored on each close row', () => {
    // The close stored target 25 on 13 Aug. A new KPI row (target 30,
    // effective later) must not touch history: the rollup only ever sums
    // day_close.target, which was stamped from the row effective that day.
    const { rows } = buildRollup({
      people: [people[2]], closes: [closes[0]], expectedDays: 6,
    });
    expect(rows[0].total_target).toBe(25); // not 30
  });
});
