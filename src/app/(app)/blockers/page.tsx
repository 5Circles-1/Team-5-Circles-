import { requireSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase/server';
import { Card, EmptyState } from '@/components/ui';
import { SlaClock } from '@/components/countdown';
import { BlockerActions } from './parts';

export const metadata = { title: 'Blockers' };
export const dynamic = 'force-dynamic';

/** §13.L — open blockers ordered by clock remaining. The screen the founder
 *  can leave open on a second monitor. */
export default async function BlockersPage() {
  const { person } = await requireSession();
  const supabase = supabaseServer();

  const { data: open } = await supabase.from('blockers')
    .select(`*,
      raiser:people!blockers_raised_by_id_fkey(full_name),
      unblocker:people!blockers_unblocker_id_fkey(id, full_name)`)
    .is('resolved_at', null)
    .order('sla_due_at');

  const { data: recent } = await supabase.from('blockers')
    .select('*, raiser:people!blockers_raised_by_id_fkey(full_name), unblocker:people!blockers_unblocker_id_fkey(full_name)')
    .not('resolved_at', 'is', null)
    .order('resolved_at', { ascending: false }).limit(8);

  return (
    <div className="space-y-5">
      <h1 className="font-display text-scale-1 font-bold">Blockers</h1>

      {(open ?? []).length === 0 ? (
        <Card><EmptyState title="Nothing is blocked. Rare and good." /></Card>
      ) : (
        <div className="space-y-3">
          {(open ?? []).map((b) => {
            const mineToClear = (b.unblocker as { id: string }).id === person.id;
            return (
              <Card key={b.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-scale-4">
                      <strong>{(b.raiser as { full_name: string }).full_name}</strong> is blocked
                      {' '}· clears with <strong>{(b.unblocker as { full_name: string }).full_name}</strong>
                      {b.escalated_at ? (
                        <span className="ml-2 rounded bg-blocked/10 px-1.5 py-0.5 text-scale-6 font-semibold text-blocked">
                          Escalated — the system carried it
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1 text-scale-4 text-ink">{b.description}</p>
                    <p className="mt-1 text-scale-6 text-ink-muted">
                      {b.severity} · raised {new Date(b.raised_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      {b.first_response_at ? ' · responded' : ' · no response yet'}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <SlaClock due={b.sla_due_at} />
                    {mineToClear ? (
                      <BlockerActions blockerId={b.id} responded={!!b.first_response_at} />
                    ) : null}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {(recent ?? []).length > 0 ? (
        <div>
          <h2 className="mb-2 font-display text-scale-3 font-semibold text-ink-muted">Recently cleared</h2>
          <Card className="divide-y divide-[--hairline]">
            {(recent ?? []).map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-scale-5">
                <span className="min-w-0 flex-1 truncate text-ink-muted">
                  {(b.raiser as { full_name: string }).full_name}: {b.description}
                </span>
                <span className="text-on-target">
                  cleared by {(b.unblocker as { full_name: string }).full_name}
                </span>
              </div>
            ))}
          </Card>
        </div>
      ) : null}
    </div>
  );
}
