/**
 * The workbook's formulas, live. Same words, same thresholds — with the one
 * deliberate fix the spec demands: achievement is direction-corrected, so a
 * "Lower is better" metric can no longer reward a climbing number (§4.6).
 */
import type { Direction, TargetType, TaskStatus } from './types';
import { daysLeft } from './dates';

// ── Days Left / Flag — Assigned Tasks tab, columns J and K ─────────────────
export type TaskFlag = 'OVERDUE' | 'BLOCKED - needs you' | 'Due soon' | 'Closed' | '';

export function taskDaysLeft(
  dueAt: string,
  status: TaskStatus,
  now: Date = new Date(),
): number | 'Done' {
  if (status === 'Completed') return 'Done';
  return daysLeft(dueAt, now);
}

/** =IF(Completed,"Closed",IF(due<TODAY(),"OVERDUE",IF(Blocked,"BLOCKED - needs
 *  you",IF(due-TODAY()<=2,"Due soon","")))) — reproduced exactly. */
export function taskFlag(dueAt: string, status: TaskStatus, now: Date = new Date()): TaskFlag {
  if (status === 'Completed' || status === 'Dropped') return 'Closed';
  const left = daysLeft(dueAt, now);
  if (left < 0) return 'OVERDUE';
  if (status === 'Blocked') return 'BLOCKED - needs you';
  if (left <= 2) return 'Due soon';
  return '';
}

export function isOverdue(dueAt: string, status: TaskStatus, now: Date = new Date()): boolean {
  // Overdue is a flag, not a status — a task can be On Track and overdue (§7).
  if (status === 'Completed' || status === 'Dropped' || status === 'Declined') return false;
  return daysLeft(dueAt, now) < 0;
}

// ── Fixed % — Daily EOD Log column H ───────────────────────────────────────
export function fixedPct(done: number, due: number): number | null {
  if (!due) return null; // workbook: blank when nothing was due
  return done / due;
}

// ── Achievement % — direction-corrected (the workbook's known defect, fixed)
export function achievementPct(
  actual: number | null,
  target: number | null,
  direction: Direction = 'Higher is better',
): number | null {
  if (actual === null || target === null) return null;
  if (direction === 'Lower is better') {
    // target/actual: staying under target scores ≥100%. Guards: actual 0 hits
    // the target perfectly (100%, never ∞); target 0 with a non-zero actual
    // is a miss and must show below 100%, never above (§17 test 20).
    if (actual === 0) return 1;
    return target / actual;
  }
  if (target === 0) return null; // workbook: blank when no target
  return actual / target;
}

// ── Weekly / monthly targets: computed, never stored (§4.3) ────────────────
export function weeklyTarget(daily: number, type: TargetType, workingDaysPerWeek: number): number {
  return type === 'Volume' ? daily * workingDaysPerWeek : daily;
}

export function monthlyTarget(daily: number, type: TargetType, workingDaysPerMonth: number): number {
  return type === 'Volume' ? daily * workingDaysPerMonth : daily;
}

// ── Weekly Rollup status — column L, exact wording and thresholds ──────────
export type WeeklyStatus =
  | 'On target' | 'Slightly behind' | 'Needs attention' | 'No submissions' | 'Awaiting data';

export function weeklyStatus(daysSubmitted: number, achievement: number | null): WeeklyStatus {
  if (daysSubmitted === 0) return 'No submissions';
  if (achievement === null) return 'Awaiting data';
  if (achievement >= 1) return 'On target';
  if (achievement >= 0.8) return 'Slightly behind';
  return 'Needs attention';
}

// ── Monthly Rating Input — column N, exact wording and thresholds ──────────
export type RatingInput = 'Exceeding' | 'Meeting' | 'Below - review' | 'No data';

export function ratingInput(
  daysSubmitted: number,
  achievement: number | null,
  fixed: number | null,
): RatingInput {
  if (daysSubmitted === 0) return 'No data';
  if (achievement !== null && achievement >= 1 && fixed !== null && fixed >= 0.9) {
    return 'Exceeding';
  }
  if (achievement !== null && achievement >= 0.8) return 'Meeting';
  return 'Below - review';
}

// ── Aging overdue buckets (§11.3) ──────────────────────────────────────────
export function agingBucket(daysOverdue: number): '1–3' | '4–7' | '8+' | null {
  if (daysOverdue <= 0) return null;
  if (daysOverdue <= 3) return '1–3';
  if (daysOverdue <= 7) return '4–7';
  return '8+';
}

// ── Day Close window (§10) — pure so it is unit-testable ───────────────────
export type SubmissionTiming = 'on-time' | 'late' | 'refused';

/** minutesNow is minutes since midnight company time on `dayOffset` relative
 *  to the close date (0 = same day, 1 = next morning). */
export function submissionTiming(
  minutesNow: number,
  dayOffset: number,
  windowCloseMin: number, // 19:30 → 1170
  graceUntilMin: number,  // 09:00 → 540
): SubmissionTiming {
  if (dayOffset === 0) {
    return minutesNow <= windowCloseMin ? 'on-time' : 'late';
  }
  if (dayOffset === 1 && minutesNow <= graceUntilMin) return 'late';
  return 'refused';
}

// ── Five Rings (§14.3) — the five disciplines of one day ───────────────────
export interface RingsInput {
  submitted: boolean;
  fixedDone: number;
  fixedDue: number;
  achievement: number | null; // capped visually at 1; real figure in centre
  assignedOpen: number;
  assignedOverdue: number;
  blockersPastSla: number;
}

export interface RingsOutput {
  closed: number;   // 1 · Day Close submitted
  fixed: number;    // 2 · fixed-task %
  target: number;   // 3 · achievement, capped at 1
  assigned: number; // 4 · open not overdue ÷ total open
  clear: number;    // 5 · full when no blocker past SLA
}

export function computeRings(i: RingsInput): RingsOutput {
  return {
    closed: i.submitted ? 1 : 0,
    fixed: i.fixedDue > 0 ? Math.min(1, i.fixedDone / i.fixedDue) : 1,
    target: i.achievement === null ? 0 : Math.max(0, Math.min(1, i.achievement)),
    assigned: i.assignedOpen > 0
      ? Math.max(0, (i.assignedOpen - i.assignedOverdue) / i.assignedOpen)
      : 1,
    clear: i.blockersPastSla > 0 ? 0 : 1,
  };
}
