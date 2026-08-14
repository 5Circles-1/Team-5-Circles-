/**
 * §6.4 — Guards fired at the moment of assigning. Each is a warning with an
 * override that records a reason, never a hard block (except the impossible
 * date, which the database refuses outright). Pure logic; the assign action
 * gathers the inputs and the Assign screen renders these as amber notes.
 */
import { isWorkingDay, nextWorkingDay, todayLocalISO } from './dates';
import type { Priority } from './types';

export interface GuardWarning {
  code:
    | 'overload' | 'capacity' | 'charter_clash' | 'non_working_day'
    | 'same_day_peer' | 'leave_clash';
  message: string;
  /** Extra data the UI shows (the three P1s, the suggested Monday, …). */
  detail?: unknown;
  /** One-tap fix the UI can offer (e.g. shifted due date). */
  suggestion?: { due_at?: string; fallback_owner_id?: string };
}

export interface GuardContext {
  targetName: string;
  targetFirstName: string;
  openP1: { code: string; title: string; due_at: string }[];
  wipLimitP1: number;
  priority: Priority;
  dueDateISO: string;      // company-time date of the due timestamp
  dueAtISO: string;        // full timestamp
  dueDayHours: number;     // Σ est_hours of open tasks due that day
  estHours: number | null;
  dailyCapacityHours: number;
  charterMatch: { title: string } | null;
  weeklyOff: number[];
  holidays: Set<string>;
  offDayName: string | null; // e.g. 'Sunday' when due lands on one
  isPeerRequest: boolean;
  onLeaveUntil: string | null;
  managerId: string | null;
  managerName: string | null;
  now?: Date;
}

export function runAssignmentGuards(ctx: GuardContext): GuardWarning[] {
  const warnings: GuardWarning[] = [];
  const now = ctx.now ?? new Date();

  // Overload: target already holds ≥ wip_limit_p1 open P1 tasks
  if (ctx.priority === 'P1 - Critical' && ctx.openP1.length >= ctx.wipLimitP1) {
    warnings.push({
      code: 'overload',
      message: `${ctx.targetFirstName} already holds ${ctx.openP1.length} critical tasks due this week. Assign anyway?`,
      detail: ctx.openP1,
    });
  }

  // Capacity: the day's estimated hours exceed daily capacity
  if (ctx.estHours && ctx.dueDayHours + ctx.estHours > ctx.dailyCapacityHours) {
    const total = ctx.dueDayHours + ctx.estHours;
    warnings.push({
      code: 'capacity',
      message: `This puts ${ctx.targetFirstName} at ${total % 1 ? total.toFixed(1) : total} hours on ${new Date(ctx.dueDateISO + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' })}.`,
    });
  }

  // Charter clash: this already exists as fixed work
  if (ctx.charterMatch) {
    warnings.push({
      code: 'charter_clash',
      message: `This is already fixed work in ${ctx.targetFirstName}'s charter ("${ctx.charterMatch.title}"). Assign as a one-off anyway?`,
    });
  }

  // Non-working day, with a one-tap fix
  if (!isWorkingDay(ctx.dueDateISO, ctx.weeklyOff, ctx.holidays)) {
    const shifted = nextWorkingDay(ctx.dueDateISO, ctx.weeklyOff, ctx.holidays);
    const dayName = ctx.offDayName ?? 'That day';
    const shiftedName = new Date(shifted + 'T00:00:00Z')
      .toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' });
    warnings.push({
      code: 'non_working_day',
      message: `${dayName} is not a working day. Due ${shiftedName} instead?`,
      suggestion: { due_at: shifted },
    });
  }

  // Same-day peer request: forced urgent + acceptance required
  if (ctx.isPeerRequest) {
    const hoursToDue = (new Date(ctx.dueAtISO).getTime() - now.getTime()) / 3_600_000;
    if (hoursToDue < 24) {
      warnings.push({
        code: 'same_day_peer',
        message: `Due in under 24 hours — this request is marked Urgent and needs ${ctx.targetFirstName}'s acceptance.`,
      });
    }
  }

  // Leave clash, offering the manager as fallback owner
  if (ctx.onLeaveUntil && ctx.onLeaveUntil >= todayLocalISO(now)) {
    const until = new Date(ctx.onLeaveUntil + 'T00:00:00Z')
      .toLocaleDateString('en-IN', { day: 'numeric', month: 'long', timeZone: 'UTC' });
    warnings.push({
      code: 'leave_clash',
      message: `${ctx.targetFirstName} is on leave until ${until}.${ctx.managerName ? ` ${ctx.managerName} could own it instead.` : ''}`,
      suggestion: ctx.managerId ? { fallback_owner_id: ctx.managerId } : undefined,
    });
  }

  return warnings;
}

/** Title similarity for the charter-clash guard (≥80% per §6.4). Bigram Dice
 *  coefficient — cheap, symmetric, and good enough for near-duplicate titles. */
export function titleSimilarity(a: string, b: string): number {
  const bigrams = (s: string) => {
    const t = s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const grams = new Map<string, number>();
    for (let i = 0; i < t.length - 1; i++) {
      const g = t.slice(i, i + 2);
      grams.set(g, (grams.get(g) ?? 0) + 1);
    }
    return grams;
  };
  const ga = bigrams(a);
  const gb = bigrams(b);
  if (ga.size === 0 || gb.size === 0) return a.trim().toLowerCase() === b.trim().toLowerCase() ? 1 : 0;
  let overlap = 0;
  let na = 0;
  let nb = 0;
  ga.forEach((n) => { na += n; });
  gb.forEach((n) => { nb += n; });
  ga.forEach((n, g) => { overlap += Math.min(n, gb.get(g) ?? 0); });
  return (2 * overlap) / (na + nb);
}
