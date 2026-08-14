import { describe, expect, it } from 'vitest';
import {
  achievementPct, agingBucket, computeRings, fixedPct, ratingInput,
  submissionTiming, taskFlag, weeklyStatus, weeklyTarget, monthlyTarget,
} from '../compute';
import { weekStartISO } from '../dates';

describe('achievement % — direction-corrected (§4.6, acceptance tests 20 + edge cases)', () => {
  it('higher is better: plain actual/target (workbook parity)', () => {
    expect(achievementPct(28, 25)).toBeCloseTo(1.12, 10);
    expect(achievementPct(14, 20)).toBeCloseTo(0.7, 10);
    expect(achievementPct(37, 40)).toBeCloseTo(0.925, 10);
  });

  it('lower is better: target/actual so a climbing number stops scoring', () => {
    // The workbook's flat division would score 3/0 → ∞ or reward drift.
    expect(achievementPct(3, 0, 'Lower is better')).toBe(0); // below 100%, never above
    expect(achievementPct(10, 5, 'Lower is better')).toBeCloseTo(0.5, 10);
    expect(achievementPct(5, 10, 'Lower is better')).toBeCloseTo(2, 10);
  });

  it('lower is better with actual 0: exactly 100%, never ∞ (§15)', () => {
    expect(achievementPct(0, 0, 'Lower is better')).toBe(1);
    expect(achievementPct(0, 5, 'Lower is better')).toBe(1);
  });

  it('higher is better with target 0: blank like the workbook', () => {
    expect(achievementPct(5, 0)).toBeNull();
  });
});

describe('weekly/monthly targets: computed, never stored (§4.3)', () => {
  it('Volume multiplies by working days; Rate stays flat', () => {
    expect(weeklyTarget(25, 'Volume', 6)).toBe(150);   // Rohan: 25 × 6
    expect(monthlyTarget(25, 'Volume', 26)).toBe(650); // 25 × 26
    expect(weeklyTarget(350, 'Rate', 6)).toBe(350);    // CPL stays flat
    expect(monthlyTarget(0.95, 'Rate', 26)).toBe(0.95);
  });
});

describe('workbook flag formula (Assigned Tasks · K)', () => {
  const now = new Date('2026-08-14T10:00:00+05:30');
  it('matches the workbook words exactly', () => {
    expect(taskFlag('2026-08-13T19:30:00+05:30', 'At Risk', now)).toBe('OVERDUE');
    expect(taskFlag('2026-08-17T19:30:00+05:30', 'On Track', now)).toBe('');
    expect(taskFlag('2026-08-15T19:30:00+05:30', 'On Track', now)).toBe('Due soon');
    expect(taskFlag('2026-08-20T19:30:00+05:30', 'Blocked', now)).toBe('BLOCKED - needs you');
    expect(taskFlag('2026-08-10T19:30:00+05:30', 'Completed', now)).toBe('Closed');
  });
  it('OVERDUE outranks BLOCKED, as in the nested IF', () => {
    expect(taskFlag('2026-08-12T19:30:00+05:30', 'Blocked', now)).toBe('OVERDUE');
  });
});

describe('weekly status + monthly rating wording (Rollup L / N)', () => {
  it('weekly', () => {
    expect(weeklyStatus(0, null)).toBe('No submissions');
    expect(weeklyStatus(3, null)).toBe('Awaiting data');
    expect(weeklyStatus(3, 1.12)).toBe('On target');
    expect(weeklyStatus(3, 0.925)).toBe('Slightly behind');
    expect(weeklyStatus(3, 0.7)).toBe('Needs attention');
  });
  it('monthly rating input', () => {
    expect(ratingInput(0, null, null)).toBe('No data');
    expect(ratingInput(1, 1.12, 1)).toBe('Exceeding');   // Rohan
    expect(ratingInput(1, 0.925, 1)).toBe('Meeting');    // Vikram
    expect(ratingInput(1, 0.7, 0.8)).toBe('Below - review'); // Ananya
    expect(ratingInput(1, 1.05, 0.85)).toBe('Meeting');  // ≥100% but fixed <90%
  });
});

describe('submission window (§10, acceptance test 11)', () => {
  const close = 19 * 60 + 30; // 19:30
  const grace = 9 * 60;       // 09:00
  it('19:29 on time; 19:31 late; 08:00 next day late; 09:01 refused', () => {
    expect(submissionTiming(19 * 60 + 29, 0, close, grace)).toBe('on-time');
    expect(submissionTiming(19 * 60 + 31, 0, close, grace)).toBe('late');
    expect(submissionTiming(8 * 60, 1, close, grace)).toBe('late');
    expect(submissionTiming(9 * 60 + 1, 1, close, grace)).toBe('refused');
  });
});

describe('misc', () => {
  it('week starts Monday like the workbook WEEKDAY(date,3)', () => {
    expect(weekStartISO('2026-08-13')).toBe('2026-08-10');
    expect(weekStartISO('2026-08-10')).toBe('2026-08-10');
    expect(weekStartISO('2026-08-16')).toBe('2026-08-10');
  });
  it('fixed % blank when nothing due', () => {
    expect(fixedPct(0, 0)).toBeNull();
    expect(fixedPct(4, 5)).toBeCloseTo(0.8, 10);
  });
  it('aging buckets', () => {
    expect(agingBucket(0)).toBeNull();
    expect(agingBucket(2)).toBe('1–3');
    expect(agingBucket(5)).toBe('4–7');
    expect(agingBucket(9)).toBe('8+');
  });
  it('five rings', () => {
    const r = computeRings({
      submitted: true, fixedDone: 4, fixedDue: 5, achievement: 1.12,
      assignedOpen: 4, assignedOverdue: 1, blockersPastSla: 0,
    });
    expect(r).toEqual({ closed: 1, fixed: 0.8, target: 1, assigned: 0.75, clear: 1 });
  });
});
