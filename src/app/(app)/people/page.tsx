import Link from 'next/link';
import { requireSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase/server';
import { canManagePeople } from '@/lib/permissions';
import { Card, EmptyState, Button } from '@/components/ui';

export const metadata = { title: 'People & Access' };
export const dynamic = 'force-dynamic';

export default async function PeoplePage() {
  const { actor } = await requireSession();
  const supabase = supabaseServer();
  const manage = canManagePeople(actor);

  const { data: people } = await supabase.from('people')
    .select('*').order('department').order('full_name');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-scale-1 font-bold">People &amp; Access</h1>
        {manage ? <Link href="/people/new"><Button size="sm">Add a person</Button></Link> : null}
      </div>

      {(people ?? []).length === 0 ? (
        <Card><EmptyState title="Nobody here yet." /></Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="table-dense w-full min-w-[820px] text-scale-5">
            <thead>
              <tr className="bg-steel-600 text-left text-white">
                <th className="px-3 py-2 font-medium">Employee ID</th>
                <th className="px-3 py-2 font-medium">Team Member</th>
                <th className="px-3 py-2 font-medium">Department</th>
                <th className="px-3 py-2 font-medium">Role / Designation</th>
                <th className="px-3 py-2 font-medium">Access</th>
                <th className="px-3 py-2 font-medium">Capabilities</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[--hairline]">
              {(people ?? []).map((p) => (
                <tr key={p.id} className={p.status === 'Deactivated' ? 'text-ink-muted' : 'hover:bg-paper'}>
                  <td className="px-3 tabular">{p.employee_code}</td>
                  <td className="px-3 font-medium">
                    <Link href={`/people/${p.id}`} className="hover:underline">
                      {p.full_name}
                    </Link>
                    {p.status === 'Deactivated' ? <span className="ml-1.5 text-scale-6">(former team member)</span> : null}
                    {p.settling_in_until && p.settling_in_until >= new Date().toISOString().slice(0, 10)
                      ? <span className="ml-1.5 rounded bg-steel-600/10 px-1.5 py-0.5 text-scale-6 text-steel-600">Settling in</span>
                      : null}
                  </td>
                  <td className="px-3">{p.department}</td>
                  <td className="px-3">{p.designation}</td>
                  <td className="px-3">
                    <span className="rounded border border-steel-300 px-1.5 py-0.5 text-scale-6">{p.access_role}</span>
                  </td>
                  <td className="px-3">
                    {(p.capabilities ?? []).map((c: string) => (
                      <span key={c} className="mr-1 rounded bg-steel-600/10 px-1.5 py-0.5 text-scale-6 text-steel-600">{c}</span>
                    ))}
                  </td>
                  <td className="px-3">{p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
