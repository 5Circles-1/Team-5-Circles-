import { notFound } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase/server';
import { canManagePeople } from '@/lib/permissions';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui';
import { HandoverWizard } from './handover';

export const dynamic = 'force-dynamic';

export default async function PersonPage({ params }: { params: { id: string } }) {
  const { actor } = await requireSession();
  const supabase = supabaseServer();

  const { data: person } = await supabase.from('people')
    .select('*, manager:people!people_reports_to_id_fkey(full_name)')
    .eq('id', params.id).maybeSingle();
  if (!person) notFound();

  const manage = canManagePeople(actor);
  const former = person.status === 'Deactivated';

  const { data: footprint } = manage && !former
    ? await supabase.rpc('open_footprint', { pid: person.id })
    : { data: null };

  const needsHandover = footprint && Object.values(footprint as Record<string, number>).some((n) => n > 0);

  // Handover pick-lists (only loaded for people_admin on an active person)
  let handoverData = null;
  if (manage && !former) {
    const [tasks, supports, duties, blockers, kpis, reports, approvals, candidates] = await Promise.all([
      supabase.from('tasks').select('id, task_code, title, priority, due_at')
        .eq('owner_id', person.id)
        .not('status', 'in', '("Completed","Dropped","Declined","Missed")'),
      supabase.from('task_participants').select('id, support_role, tasks!task_participants_task_id_fkey(task_code, title)')
        .eq('person_id', person.id).is('removed_at', null),
      supabase.from('charter_tasks').select('id, title, cadence, charters!inner(person_id)')
        .eq('charters.person_id', person.id).eq('active', true),
      supabase.from('blockers').select('id, description').eq('unblocker_id', person.id).is('resolved_at', null),
      supabase.from('kpis').select('id, metric').eq('person_id', person.id).eq('active', true).is('effective_to', null),
      supabase.from('people').select('id, full_name').eq('reports_to_id', person.id).neq('status', 'Deactivated'),
      supabase.from('approvals').select('id, context').eq('approver_id', person.id).eq('decision', 'Pending'),
      supabase.from('people').select('id, full_name, department').neq('status', 'Deactivated').neq('id', person.id).order('full_name'),
    ]);
    handoverData = {
      tasks: tasks.data ?? [],
      supports: (supports.data ?? []).map((s) => ({
        id: s.id, role: s.support_role,
        task: (s.tasks as unknown as { task_code: string; title: string } | null)?.title ?? '—',
      })),
      duties: duties.data ?? [],
      blockers: blockers.data ?? [],
      kpis: kpis.data ?? [],
      reports: reports.data ?? [],
      approvals: approvals.data ?? [],
      candidates: candidates.data ?? [],
    };
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <p className="tabular text-scale-5 text-ink-muted">{person.employee_code}</p>
        <h1 className={`font-display text-scale-1 font-bold ${former ? 'text-ink-muted' : ''}`}>
          {person.full_name}
          {former ? <span className="ml-2 text-scale-4 font-normal">(former team member)</span> : null}
        </h1>
        <p className="text-scale-4 text-ink-muted">
          {person.designation} · {person.department}
          {person.manager ? <> · reports to {(person.manager as { full_name: string }).full_name}</> : ' · root'}
        </p>
      </div>

      <Card>
        <CardBody className="grid grid-cols-2 gap-4 text-scale-5 sm:grid-cols-3">
          <Meta label="Access role" value={person.access_role} />
          <Meta label="Capabilities" value={(person.capabilities ?? []).join(', ') || '—'} />
          <Meta label="Status" value={person.status} />
          <Meta label="Joined" value={person.joined_on ?? '—'} />
          <Meta label="Capacity" value={`${person.daily_capacity_hours}h/day`} />
          <Meta label="P1 limit" value={person.wip_limit_p1} />
        </CardBody>
      </Card>

      {manage && !former && handoverData ? (
        <Card>
          <CardHeader>
            <CardTitle>Handover &amp; deactivation</CardTitle>
            {!needsHandover ? <span className="text-scale-6 text-on-target">Footprint clear</span> : null}
          </CardHeader>
          <CardBody>
            <HandoverWizard
              person={{ id: person.id, name: person.full_name }}
              data={handoverData}
            />
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-scale-6 uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="mt-0.5">{value}</p>
    </div>
  );
}
