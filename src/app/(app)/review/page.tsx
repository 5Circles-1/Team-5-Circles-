import { requireSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase/server';
import { rollupScope } from '@/lib/permissions';
import { achievementPct, computeRings, fixedPct } from '@/lib/compute';
import { todayLocalISO, formatDayLong } from '@/lib/dates';
import { Card, EmptyState } from '@/components/ui';
import { FiveRings } from '@/components/five-rings';
import { ReviewActions } from './parts';

export const metadata = { title: 'Review queue' };
export const dynamic = 'force-dynamic';

/** §13.G — today's closes as cards. Designed to clear eight people in four
 *  minutes: react or comment, swipe on. */
export default async function ReviewPage({ searchParams }: { searchParams: { date?: string } }) {
  const { actor, settings } = await requireSession();
  const supabase = supabaseServer();
  const scope = rollupScope(actor);
  if (scope.kind === 'self' || scope.kind === 'aggregate') {
    return <Card><EmptyState title="The review queue belongs to managers." /></Card>;
  }
  const date = searchParams.date ?? todayLocalISO();

  // RLS already limits closes to the manager's chain (or everything for Owner)
  const { data: closes } = await supabase.from('day_close')
    .select('*, person:people!day_close_person_id_fkey(id, full_name, department, settling_in_until)')
    .eq('close_date', date)
    .order('manager_reviewed')
    .order('submitted_at');

  const { data: blockers } = await supabase.from('blockers')
    .select('id, day_close_id, description, severity')
    .gte('raised_at', `${date}T00:00:00+05:30`).lte('raised_at', `${date}T23:59:59+05:30`);

  const diagnostic = !!settings.diagnostic_until && settings.diagnostic_until >= todayLocalISO();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-scale-1 font-bold">Review · {formatDayLong(date)}</h1>
        <span className="text-scale-5 text-ink-muted">
          {(closes ?? []).filter((c) => !c.manager_reviewed).length} to review
        </span>
      </div>

      {(closes ?? []).length === 0 ? (
        <Card><EmptyState title="No closes yet for this day."
          hint="They start arriving at 18:00. The 19:45 digest lists who closed and who did not." /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(closes ?? []).map((c) => {
            const person = c.person as { id: string; full_name: string; department: string; settling_in_until: string | null };
            const achievement = achievementPct(c.actual, c.target, c.direction ?? 'Higher is better');
            const rings = computeRings({
              submitted: true,
              fixedDone: c.fixed_tasks_done, fixedDue: c.fixed_tasks_due,
              achievement,
              assignedOpen: c.assigned_on_track + c.assigned_at_risk,
              assignedOverdue: c.assigned_at_risk,
              blockersPastSla: 0,
            });
            const blocker = (blockers ?? []).find((b) => b.day_close_id === c.id);
            const settling = person.settling_in_until && person.settling_in_until >= date;
            return (
              <Card key={c.id} className="p-4">
                <div className="flex items-start gap-3">
                  <FiveRings rings={rings} size={44} diagnostic={diagnostic} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-scale-4 font-medium">
                      {person.full_name}
                      {settling ? <span className="ml-1.5 rounded bg-steel-600/10 px-1.5 py-0.5 text-scale-6 text-steel-600">Settling in</span> : null}
                    </p>
                    <p className="text-scale-6 text-ink-muted">
                      {person.department} · {c.submitted_on_time ? 'on time' : 'late'}
                      {c.edited_at ? ' · edited' : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="tabular text-scale-3 font-display font-semibold">
                      {diagnostic || achievement === null ? '—' : `${Math.round(achievement * 100)}%`}
                    </p>
                    <p className="text-scale-6 text-ink-muted">
                      fixed {fixedPct(c.fixed_tasks_done, c.fixed_tasks_due) === null
                        ? '—' : `${c.fixed_tasks_done}/${c.fixed_tasks_due}`}
                    </p>
                  </div>
                </div>

                <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-scale-6 text-ink-muted">
                  <div><dt>Reactive</dt><dd className="tabular text-scale-5 text-ink">{c.reactive_hours}h</dd></div>
                  <div><dt>At risk</dt><dd className="tabular text-scale-5 text-ink">{c.assigned_at_risk}</dd></div>
                  <div><dt>Done today</dt><dd className="tabular text-scale-5 text-ink">{c.assigned_completed_today}</dd></div>
                </dl>

                {blocker ? (
                  <p className="mt-3 rounded bg-blocked/10 px-3 py-2 text-scale-5 text-blocked">
                    Blocked: {blocker.description}
                  </p>
                ) : null}

                {c.top_3_tomorrow?.length ? (
                  <ol className="mt-3 list-decimal pl-5 text-scale-5 text-ink-muted">
                    {c.top_3_tomorrow.map((t: string, i: number) => <li key={i}>{t}</li>)}
                  </ol>
                ) : null}

                <ReviewActions closeId={c.id} reviewed={c.manager_reviewed} />
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
