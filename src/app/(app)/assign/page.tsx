import { requireSession, chainOf } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase/server';
import { canAssignTo } from '@/lib/permissions';
import { AssignForm } from './form';

export const metadata = { title: 'Assign' };
export const dynamic = 'force-dynamic';

export default async function AssignPage({ searchParams }: { searchParams: { mode?: string } }) {
  const { person, actor } = await requireSession();
  const supabase = supabaseServer();

  const { data: people } = await supabase.from('people')
    .select('id, full_name, department, status, reports_to_id, daily_capacity_hours')
    .neq('status', 'Deactivated').order('department').order('full_name');

  // Verb per candidate, decided server-side from the §6.1 matrix
  const candidates = await Promise.all((people ?? []).map(async (p) => {
    const chain = await chainOf(p.id);
    const verb = canAssignTo(actor, { id: p.id, department: p.department, status: p.status, chain });
    const { count } = await supabase.from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', p.id)
      .not('status', 'in', '("Completed","Dropped","Declined","Missed")');
    return {
      id: p.id, full_name: p.full_name, department: p.department,
      verb, open_count: count ?? 0, on_leave: p.status === 'On Leave',
    };
  }));

  const { data: kpis } = await supabase.from('kpis')
    .select('id, metric, person_id').eq('active', true).is('effective_to', null);

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-4 font-display text-scale-1 font-bold">
        {searchParams.mode === 'ask' ? 'Ask someone' : 'Hand work to someone'}
      </h1>
      <AssignForm
        me={{ id: person.id, name: person.full_name }}
        candidates={candidates.filter((c) => c.verb !== null || c.id === person.id)}
        kpis={kpis ?? []}
        startInAskMode={searchParams.mode === 'ask'}
      />
    </div>
  );
}
