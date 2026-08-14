import Link from 'next/link';
import { requireSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase/server';
import { rollupScope } from '@/lib/permissions';
import { buildRollup, buildDeptRollup } from '@/lib/rollup';
import { weekStartISO, todayLocalISO, formatShort } from '@/lib/dates';
import { DEPARTMENTS, type DayClose, type Person } from '@/lib/types';
import { Card, CardBody, CardHeader, CardTitle, ControlCell, EmptyState } from '@/components/ui';
import { PctText } from '@/components/status';

export const metadata = { title: 'Rollups' };
export const dynamic = 'force-dynamic';

/** §13.H — Weekly and Monthly rollups with the workbook's one yellow control
 *  cell, made obvious. Every figure clicks through to the underlying rows. */
export default async function RollupsPage({ searchParams }: {
  searchParams: { period?: string; week?: string; month?: string };
}) {
  const { actor, person, settings } = await requireSession();
  const supabase = supabaseServer();
  const scope = rollupScope(actor);
  const period = searchParams.period === 'month' ? 'month' : 'week';
  const week = searchParams.week ?? weekStartISO(todayLocalISO());
  const month = searchParams.month ?? todayLocalISO().slice(0, 7);
  const diagnostic = !!settings.diagnostic_until && settings.diagnostic_until >= todayLocalISO();

  // People in scope (RLS also stands guard underneath)
  let peopleQuery = supabase.from('people').select('*').neq('status', 'Deactivated')
    .not('access_role', 'in', '("Observer")').order('full_name');
  if (scope.kind === 'department') peopleQuery = peopleQuery.eq('department', scope.department);
  if (scope.kind === 'self') peopleQuery = peopleQuery.eq('id', person.id);
  const { data: peopleRows } = await peopleQuery;

  let closesQuery = supabase.from('day_close').select('*');
  closesQuery = period === 'week'
    ? closesQuery.eq('week_starting', week)
    : closesQuery.eq('month', month);
  const { data: closeRows } = await closesQuery;

  const visiblePeople = (peopleRows ?? []) as Person[];
  const visibleIds = new Set(visiblePeople.map((p) => p.id));
  const closes = ((closeRows ?? []) as DayClose[]).filter((c) => visibleIds.has(c.person_id));

  const expectedDays = period === 'week'
    ? settings.working_days_per_week
    : settings.working_days_per_month;

  const { rows, total, flags } = buildRollup({ people: visiblePeople, closes, expectedDays });

  const deptView = scope.kind === 'all'
    ? buildDeptRollup(
        DEPARTMENTS, closes,
        Object.fromEntries(DEPARTMENTS.map((d) => [
          d, visiblePeople.filter((p) => p.department === d && p.status !== 'Deactivated').length,
        ])),
      )
    : null;

  const label = period === 'week' ? `Week of ${formatShort(week)}` : month;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-scale-1 font-bold">
          {period === 'week' ? 'Weekly Rollup' : 'Monthly Rollup'}
        </h1>
        <div className="flex items-center gap-2">
          <Link href={`/rollups?period=week`} className={`rounded px-2 py-1 text-scale-5 ${period === 'week' ? 'bg-navy-900 text-white' : 'hairline'}`}>Weekly</Link>
          <Link href={`/rollups?period=month`} className={`rounded px-2 py-1 text-scale-5 ${period === 'month' ? 'bg-navy-900 text-white' : 'hairline'}`}>Monthly</Link>
          <a href={`/api/export/workbook?week=${week}&month=${month}`}
            className="rounded px-2 py-1 text-scale-5 hairline hover:bg-paper">Export Excel</a>
        </div>
      </div>

      {/* The single yellow control cell */}
      <form method="get" action="/rollups">
        <input type="hidden" name="period" value={period} />
        <ControlCell>
          <label htmlFor="periodpick" className="text-scale-5 font-medium">
            {period === 'week' ? 'Week to view (Monday):' : 'Month to view:'}
          </label>
          {period === 'week' ? (
            <input id="periodpick" type="date" name="week" defaultValue={week}
              className="rounded bg-surface hairline px-2 py-1 text-scale-5 tabular" />
          ) : (
            <input id="periodpick" type="month" name="month" defaultValue={month}
              className="rounded bg-surface hairline px-2 py-1 text-scale-5 tabular" />
          )}
          <button className="rounded bg-navy-900 px-2.5 py-1 text-scale-5 font-medium text-white">View</button>
        </ControlCell>
      </form>

      {diagnostic ? (
        <p className="text-scale-5 text-ink-muted">
          Calibrating. Use this to find broken processes, not slow people — status labels return after diagnostic mode ends.
        </p>
      ) : null}

      <Card className="overflow-x-auto">
        <table className="table-dense w-full min-w-[880px] text-scale-5">
          <thead>
            <tr className="bg-steel-600 text-left text-white">
              <th className="px-3 py-2 font-medium">Team Member</th>
              <th className="px-3 py-2 font-medium">Department</th>
              <th className="px-3 py-2 font-medium text-right">Days Submitted</th>
              <th className="px-3 py-2 font-medium text-right">Submission Rate</th>
              <th className="px-3 py-2 font-medium text-right">On-Time Rate</th>
              <th className="px-3 py-2 font-medium text-right">Fixed Due</th>
              <th className="px-3 py-2 font-medium text-right">Fixed Done</th>
              <th className="px-3 py-2 font-medium text-right">Fixed %</th>
              <th className="px-3 py-2 font-medium text-right">Total Target</th>
              <th className="px-3 py-2 font-medium text-right">Total Actual</th>
              <th className="px-3 py-2 font-medium text-right">Achievement %</th>
              {period === 'month' ? (
                <>
                  <th className="px-3 py-2 font-medium text-right">Reactive Hrs</th>
                  <th className="px-3 py-2 font-medium text-right">Blockers</th>
                </>
              ) : null}
              <th className="px-3 py-2 font-medium">{period === 'week' ? 'Status' : 'Rating Input'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[--hairline]">
            {rows.map((r) => (
              <tr key={r.person_id} className="hover:bg-paper">
                <td className="px-3 font-medium">{r.full_name}</td>
                <td className="px-3 text-ink-muted">{r.department}</td>
                <td className="px-3 tabular text-right">{r.days_submitted}</td>
                <td className="px-3 tabular text-right">{pct(r.submission_rate)}</td>
                <td className="px-3 tabular text-right">{pct(r.on_time_rate)}</td>
                <td className="px-3 tabular text-right">{r.fixed_due}</td>
                <td className="px-3 tabular text-right">{r.fixed_done}</td>
                <td className="px-3 tabular text-right">{pct(r.fixed_pct)}</td>
                <td className="px-3 tabular text-right">{num(r.total_target)}</td>
                <td className="px-3 tabular text-right">{num(r.total_actual)}</td>
                <td className="px-3 text-right">
                  {diagnostic ? <span className="tabular text-ink-muted">{pct(r.achievement_pct)}</span> : <PctText value={r.achievement_pct} />}
                </td>
                {period === 'month' ? (
                  <>
                    <td className="px-3 tabular text-right">{r.reactive_hours}</td>
                    <td className="px-3 tabular text-right">{r.blockers_raised}</td>
                  </>
                ) : null}
                <td className="px-3">
                  {diagnostic
                    ? <span className="text-ink-muted">—</span>
                    : period === 'week' ? r.status
                    : (scope.kind === 'all' || scope.kind === 'department' || r.person_id === person.id)
                      ? r.rating
                      : '—' /* Rating Input never appears on a shared board */}
                </td>
              </tr>
            ))}
            <tr className="bg-paper font-semibold">
              <td className="px-3">TEAM TOTAL</td>
              <td className="px-3" />
              <td className="px-3 tabular text-right">{total.days_submitted}</td>
              <td className="px-3" /><td className="px-3" />
              <td className="px-3 tabular text-right">{total.fixed_due}</td>
              <td className="px-3 tabular text-right">{total.fixed_done}</td>
              <td className="px-3 tabular text-right">{pct(total.fixed_pct)}</td>
              <td className="px-3 tabular text-right">{num(total.total_target)}</td>
              <td className="px-3 tabular text-right">{num(total.total_actual)}</td>
              <td className="px-3 tabular text-right">{pct(total.achievement_pct)}</td>
              {period === 'month' ? (
                <>
                  <td className="px-3 tabular text-right">{total.reactive_hours}</td>
                  <td className="px-3 tabular text-right">{total.blockers_raised}</td>
                </>
              ) : null}
              <td className="px-3" />
            </tr>
          </tbody>
        </table>
      </Card>

      {scope.kind !== 'self' ? (
        <Card>
          <CardHeader><CardTitle>Attention flags {period === 'week' ? 'for this week' : 'for this month'}</CardTitle></CardHeader>
          <CardBody className="p-0">
            <ul className="divide-y divide-[--hairline] text-scale-4">
              <Flag n={flags.blockers_raised} href="/blockers"
                label="Blockers raised" note="Every one of these needs a response within 24 hours." />
              <Flag n={flags.not_reviewed} href="/review"
                label="Reports not yet reviewed by you" note="If this stays above zero, submissions will quietly stop." />
              <Flag n={flags.late_submissions} href="/review"
                label="Late submissions" note="Chase the pattern, not the one-off." />
              <Flag n={flags.reactive_hours} href="/rollups"
                label="Total reactive hours (unplanned work)" note="What is generating this? Fix the source, not the person." />
              <Flag n={flags.at_risk} href="/board?flag=overdue"
                label="Assigned tasks flagged At Risk" note="Cross-check against the Board." />
            </ul>
          </CardBody>
        </Card>
      ) : null}

      {deptView ? (
        <Card>
          <CardHeader><CardTitle>Department view</CardTitle></CardHeader>
          <CardBody className="overflow-x-auto p-0">
            <table className="table-dense w-full min-w-[640px] text-scale-5">
              <thead>
                <tr className="bg-steel-600 text-left text-white">
                  <th className="px-3 py-2 font-medium">Department</th>
                  <th className="px-3 py-2 font-medium text-right">Days Submitted</th>
                  <th className="px-3 py-2 font-medium text-right">Fixed %</th>
                  <th className="px-3 py-2 font-medium text-right">Total Target</th>
                  <th className="px-3 py-2 font-medium text-right">Total Actual</th>
                  <th className="px-3 py-2 font-medium text-right">Achievement %</th>
                  <th className="px-3 py-2 font-medium text-right">Reactive Hrs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[--hairline]">
                {deptView.map((d) => (
                  <tr key={d.department}>
                    <td className="px-3 font-medium">{d.department}</td>
                    {d.active_people === 0 ? (
                      <td className="px-3 text-ink-muted" colSpan={6}>No active members</td>
                    ) : (
                      <>
                        <td className="px-3 tabular text-right">{d.days_submitted}</td>
                        <td className="px-3 tabular text-right">{pct(d.fixed_pct)}</td>
                        <td className="px-3 tabular text-right">{num(d.total_target)}</td>
                        <td className="px-3 tabular text-right">{num(d.total_actual)}</td>
                        <td className="px-3 text-right">
                          {diagnostic ? <span className="tabular text-ink-muted">{pct(d.achievement_pct)}</span> : <PctText value={d.achievement_pct} />}
                        </td>
                        <td className="px-3 tabular text-right">{d.reactive_hours}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      ) : null}

      {rows.length === 0 ? (
        <Card><EmptyState title="The week starts Monday. Nothing to summarise yet." /></Card>
      ) : null}
    </div>
  );
}

function pct(v: number | null): string {
  return v === null ? '' : `${Math.round(v * 1000) / 10}%`;
}
function num(v: number): string {
  return v.toLocaleString('en-IN');
}
function Flag({ n, label, note, href }: { n: number; label: string; note: string; href: string }) {
  return (
    <li>
      <Link href={href} className="flex items-baseline gap-3 px-4 py-2.5 hover:bg-paper">
        <span className="tabular w-10 text-right font-display text-scale-3 font-semibold">{n}</span>
        <span className="min-w-0">
          <span className="block">{label}</span>
          <span className="block text-scale-6 text-ink-muted">{note}</span>
        </span>
      </Link>
    </li>
  );
}
