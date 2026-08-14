import { requireSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase/server';
import { canEditCharter } from '@/lib/permissions';
import { todayLocalISO } from '@/lib/dates';
import { Card, CardBody, CardHeader, CardTitle, EmptyState } from '@/components/ui';
import { AddDutyForm, RetireDutyButton } from './parts';

export const metadata = { title: 'Charters' };
export const dynamic = 'force-dynamic';

/** §13.J — per person: outcomes owned, fixed duties with cadence and
 *  definition of done, decision rights. RLS scopes who appears. */
export default async function ChartersPage() {
  const { actor } = await requireSession();
  const supabase = supabaseServer();

  const { data: charters } = await supabase.from('charters')
    .select(`*,
      person:people!charters_person_id_fkey(id, full_name, department, designation, status),
      approver:people!charters_needs_approval_from_id_fkey(full_name),
      charter_tasks(id, title, cadence, definition_of_done, active, suspended_reason, sort_order)`)
    .order('created_at');

  const today = todayLocalISO();
  const visible = (charters ?? []).filter(
    (c) => (c.person as { status: string }).status !== 'Deactivated',
  );

  if (visible.length === 0) {
    return <Card><EmptyState title="No charters you can see." /></Card>;
  }

  return (
    <div className="space-y-5">
      <h1 className="font-display text-scale-1 font-bold">Charters</h1>
      <div className="grid gap-4 lg:grid-cols-2">
        {visible.map((c) => {
          const person = c.person as { id: string; full_name: string; department: string; designation: string };
          const duties = (c.charter_tasks as {
            id: string; title: string; cadence: string; definition_of_done: string | null;
            active: boolean; suspended_reason: string | null; sort_order: number;
          }[]).sort((a, b) => a.sort_order - b.sort_order);
          const activeDuties = duties.filter((d) => d.active);
          const suspended = duties.filter((d) => !d.active && d.suspended_reason === 'Suspended — no owner');
          const editable = canEditCharter(actor, { id: person.id, department: person.department as never });
          const reviewDue = c.next_review_due && c.next_review_due <= today;

          return (
            <Card key={c.id}>
              <CardHeader>
                <div>
                  <CardTitle>{person.full_name}</CardTitle>
                  <p className="text-scale-6 text-ink-muted">{person.designation} · {person.department}</p>
                </div>
                {reviewDue ? (
                  <span className="rounded bg-behind/10 px-2 py-0.5 text-scale-6 font-medium text-behind">
                    Review due
                  </span>
                ) : (
                  <span className="text-scale-6 text-ink-muted tabular">{activeDuties.length}/5 duties</span>
                )}
              </CardHeader>
              <CardBody className="space-y-3">
                {c.owns_outcome ? (
                  <p className="text-scale-4"><span className="text-ink-muted">Owns:</span> {c.owns_outcome}</p>
                ) : null}
                <ul className="space-y-1.5">
                  {activeDuties.map((d) => (
                    <li key={d.id} className="flex items-start gap-2 text-scale-4">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-steel-600" aria-hidden />
                      <span className="min-w-0 flex-1">
                        {d.title} <span className="text-scale-6 text-ink-muted">· {d.cadence}</span>
                        {d.definition_of_done ? (
                          <span className="block text-scale-6 text-ink-muted">Done: {d.definition_of_done}</span>
                        ) : null}
                      </span>
                      {editable ? <RetireDutyButton dutyId={d.id} /> : null}
                    </li>
                  ))}
                  {suspended.map((d) => (
                    <li key={d.id} className="flex items-start gap-2 text-scale-4 text-attention">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-attention" aria-hidden />
                      <span>{d.title} — <strong>Suspended, no owner</strong></span>
                    </li>
                  ))}
                </ul>
                {(c.can_decide_alone as string[]).length > 0 ? (
                  <p className="text-scale-5 text-ink-muted">
                    Decides alone: {(c.can_decide_alone as string[]).join('; ')}
                  </p>
                ) : null}
                {(c.needs_approval_for as string[]).length > 0 ? (
                  <p className="text-scale-5 text-ink-muted">
                    Needs {(c.approver as { full_name: string } | null)?.full_name ?? 'approval'} for:{' '}
                    {(c.needs_approval_for as string[]).join('; ')}
                  </p>
                ) : null}
                {editable ? <AddDutyForm charterId={c.id} atCeiling={activeDuties.length >= 5} /> : null}
              </CardBody>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
