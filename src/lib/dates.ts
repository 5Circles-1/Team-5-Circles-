/**
 * Server time is the only truth for deadlines. Everything here computes in
 * the company timezone (Asia/Kolkata by default — fixed UTC+05:30, no DST),
 * never the client clock.
 */
import { addDays, differenceInCalendarDays, format, parseISO, startOfDay } from 'date-fns';

const IST_OFFSET_MINUTES = 330; // Asia/Kolkata is fixed UTC+05:30

/** Current wall-clock time in company time, expressed as a Date whose UTC
 *  fields carry the local values (safe for format/compare, not for epoch). */
export function nowLocal(now: Date = new Date()): Date {
  return new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000);
}

/** YYYY-MM-DD of "today" in company time. */
export function todayLocalISO(now: Date = new Date()): string {
  return nowLocal(now).toISOString().slice(0, 10);
}

/** Minutes since midnight, company time. */
export function minutesOfDayLocal(now: Date = new Date()): number {
  const l = nowLocal(now);
  return l.getUTCHours() * 60 + l.getUTCMinutes();
}

export function parseTimeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

/** Monday of the week containing the date — the workbook's Week Starting. */
export function weekStartISO(dateISO: string): string {
  const d = parseISO(dateISO);
  const isoDow = ((d.getUTCDay() + 6) % 7) + 1; // 1=Mon … 7=Sun
  return format(addDays(startOfDay(d), -(isoDow - 1)), 'yyyy-MM-dd');
}

/** YYYY-MM stamped from the close date, never submission time (§15). */
export function monthOf(dateISO: string): string {
  return dateISO.slice(0, 7);
}

export function isoDow(dateISO: string): number {
  return ((parseISO(dateISO).getUTCDay() + 6) % 7) + 1;
}

export function isWorkingDay(
  dateISO: string,
  weeklyOff: number[],
  holidays: Set<string>,
): boolean {
  return !weeklyOff.includes(isoDow(dateISO)) && !holidays.has(dateISO);
}

export function nextWorkingDay(
  dateISO: string,
  weeklyOff: number[],
  holidays: Set<string>,
): string {
  let d = dateISO;
  for (let i = 0; i < 30; i++) {
    if (isWorkingDay(d, weeklyOff, holidays)) return d;
    d = format(addDays(parseISO(d), 1), 'yyyy-MM-dd');
  }
  return dateISO;
}

/** Add N working days — for template relative due dates ("+3 working days"). */
export function addWorkingDays(
  dateISO: string,
  n: number,
  weeklyOff: number[],
  holidays: Set<string>,
): string {
  let d = dateISO;
  let added = 0;
  for (let i = 0; i < 90 && added < n; i++) {
    d = format(addDays(parseISO(d), 1), 'yyyy-MM-dd');
    if (isWorkingDay(d, weeklyOff, holidays)) added++;
  }
  return d;
}

/** Whole days from today (company time) to the due date — the workbook's
 *  Days Left column: due − TODAY(). */
export function daysLeft(dueAtISO: string, now: Date = new Date()): number {
  const dueLocalDay = new Date(new Date(dueAtISO).getTime() + IST_OFFSET_MINUTES * 60_000)
    .toISOString().slice(0, 10);
  return differenceInCalendarDays(parseISO(dueLocalDay), parseISO(todayLocalISO(now)));
}

export function formatDayLong(dateISO: string): string {
  // "Tuesday, 12 August"
  return format(parseISO(dateISO), 'EEEE, d MMMM');
}

export function formatShort(dateISO: string): string {
  return format(parseISO(dateISO), 'd MMM');
}
