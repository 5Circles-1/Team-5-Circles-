import { requireSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase/server';
import { canSetKpiTargets } from '@/lib/permissions';
import { weeklyTarget, monthlyTarget } from '@/lib/compute';
import { Card, CardBody, CardHeader, CardTitle, EmptyState } from '@/components/ui';
import { KpiEditor } from './parts';

export const metadata = { title: 'Targets' };
export const dynamic = 'force-dynamic';

/** §13.K — KPI table per person with live weekly/monthly computation and a
 *  history strip. Weekly and monthly are computed, never stored. */
export default async function TargetsPage() {
  const { actor, settings } = await requireSession();
  const supabase = supabaseServer();

  const [{ data: people }, { data: kpis }] = await Promise.all([
    supabase.from('people').select('id, full_name, department, status')
      .neq('status', 'Deactivated')
      .not('access_role', 'in', '("Observer")').order('department').order('full_name'),
    supabase.from('kpis').select('*').order('effective_from', { ascending: false }),
  ]);

  const visible = (people ?? []).filter((p) =>
    (kpis ?? []).some((k) => k.person_id === p.id) ||
    canSetKpiTargets(actor, { department: p.department }),
  );

  if (visible.length === 0) return <Card><EmptyState title="No targets you can see." /></Card>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-scale-1 font-bold">Targets</h1>
        <p className="text-scale-5 text-ink-muted">
          Daily is the number you set; weekly ×{settings.working_days_per_week} and monthly
          ×{settings.working_days_per_month} compute themselves for Volume metrics, and stay flat for Rates.
          Changing a target closes the old row — history never rewrites itself.
        </p>
      </div>

      {visible.map((p) => {
        const current = (kpis ?? []).filter((k) => k.person_id === p.id && k.active && !k.effective_to);
        const history = (kpis ?? []).filter((k) => k.person_id === p.id && k.effective_to);
        const editable = canSetKpiTargets(actor, { department: p.department });
        return (
          <Card key={p.id}>
            <CardHeader>
              <CardTitle>{p.full_name}</CardTitle>
              <span className="tabular text-scale-6 text-ink-muted">{current.length}/4 KPIs</span>
            </CardHeader>
            <CardBody className="space-y-3 overflow-x-auto">
              {current.length === 0 ? (
                <p className="text-scale-5 text-ink-muted">No numbers owned yet.</p>
              ) : (
                <table className="table-dense w-full min-w-[640px] text-scale-5">
                  <thead>
                    <tr className="text-left text-ink-muted">
                      <th className="py-1 pr-3 font-medium">Metric</th>
                      <th className="py-1 pr-3 font-medium">Unit</th>
                      <th className="py-1 pr-3 font-medium">Direction</th>
                      <th className="py-1 pr-3 font-medium text-right">Daily</th>
                      <th className="py-1 pr-3 font-medium text-right">Weekly</th>
                      <th className="py-1 pr-3 font-medium text-right">Monthly</th>
                      <th className="py-1 pr-3 font-medium">Review</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[--hairline]">
                    {current.map((k) => (
                      <tr key={k.id}>
                        <td className="py-1 pr-3">
                          {k.metric}
                          {k.is_primary ? (
                            <span className="ml-1.5 rounded bg-navy-900 px-1.5 py-0.5 text-scale-6 text-white">primary</span>
                          ) : null}
                        </td>
                        <td className="py-1 pr-3 text-ink-muted">{k.unit}</td>
                        <td className="py-1 pr-3 text-ink-muted">{k.direction === 'Lower is better' ? '↓ lower' : '↑ higher'}</td>
                        <td className="py-1 pr-3 tabular text-right">{fmt(k.daily_target, k.unit)}</td>
                        <td className="py-1 pr-3 tabular text-right">
                          {fmt(weeklyTarget(k.daily_target, k.target_type, settings.working_days_per_week), k.unit)}
                        </td>
                        <td className="py-1 pr-3 tabular text-right">
                          {fmt(monthlyTarget(k.daily_target, k.target_type, settings.working_days_per_month), k.unit)}
                        </td>
                        <td className="py-1 pr-3 text-ink-muted">{k.review_cadence}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {history.length > 0 ? (
                <p className="text-scale-6 text-ink-muted">
                  History: {history.slice(0, 4)
                    .map((k) => `${k.metric} ${fmt(k.daily_target, k.unit)} (until ${k.effective_to})`)
                    .join(' · ')}
                </p>
              ) : null}

              {editable ? (
                <KpiEditor
                  personId={p.id}
                  atCeiling={current.length >= 4}
                  hasPrimary={current.some((k) => k.is_primary)}
                  current={current.map((k) => ({ id: k.id, metric: k.metric }))}
                  workingDays={{ week: settings.working_days_per_week, month: settings.working_days_per_month }}
                />
              ) : null}
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}

function fmt(v: number, unit: string): string {
  if (unit === '%') return `${Math.round(v * 1000) / 10}%`;
  if (unit === 'INR') return `₹${v.toLocaleString('en-IN')}`;
  return v.toLocaleString('en-IN');
}
