import Link from 'next/link';
import { requireSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase/server';
import { taskFlag, isOverdue } from '@/lib/compute';
import { daysLeft, formatShort } from '@/lib/dates';
import { Card, EmptyState, cn } from '@/components/ui';
import { StatusPill, FlagChip, PriorityMark } from '@/components/status';
import type { TaskStatus } from '@/lib/types';

export const metadata = { title: 'Board' };
export const dynamic = 'force-dynamic';

const LANES: TaskStatus[] = ['Not Started', 'On Track', 'At Risk', 'Blocked', 'Pending Review', 'Completed'];

export default async function BoardPage({ searchParams }: {
  searchParams: { view?: string; person?: string; dept?: string; priority?: string; flag?: string; mine?: string };
}) {
  const { person } = await requireSession();
  const supabase = supabaseServer();
  const view = searchParams.view === 'list' ? 'list' : 'kanban';

  let query = supabase.from('tasks')
    .select('*, owner:people!tasks_owner_id_fkey(full_name), assigner:people!tasks_assigned_by_id_fkey(full_name)')
    .neq('task_type', 'Fixed')
    .not('status', 'in', '("Declined","Missed","Dropped")')
    .order('due_at')
    .limit(400);
  if (searchParams.mine === '1') query = query.eq('owner_id', person.id);
  if (searchParams.dept) query = query.eq('department', searchParams.dept);
  if (searchParams.priority) query = query.eq('priority', searchParams.priority);
  const { data } = await query;
  let tasks = data ?? [];
  if (searchParams.flag === 'overdue') tasks = tasks.filter((t) => isOverdue(t.due_at, t.status));

  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { ...searchParams, ...patch };
    Object.entries(merged).forEach(([k, v]) => { if (v) p.set(k, v); });
    const s = p.toString();
    return s ? `?${s}` : '';
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-scale-1 font-bold">Board</h1>
        <div className="flex flex-wrap items-center gap-2 text-scale-5">
          <Link href={`/board${qs({ view: undefined })}`}
            className={cn('rounded px-2 py-1', view === 'kanban' ? 'bg-navy-900 text-white' : 'hairline')}>Kanban</Link>
          <Link href={`/board${qs({ view: 'list' })}`}
            className={cn('rounded px-2 py-1', view === 'list' ? 'bg-navy-900 text-white' : 'hairline')}>List</Link>
          <span className="mx-1 text-ink-muted">·</span>
          <Link href={`/board${qs({ mine: searchParams.mine === '1' ? undefined : '1' })}`}
            className={cn('rounded px-2 py-1', searchParams.mine === '1' ? 'bg-steel-600 text-white' : 'hairline')}>
            My work
          </Link>
          <Link href={`/board${qs({ flag: searchParams.flag === 'overdue' ? undefined : 'overdue' })}`}
            className={cn('rounded px-2 py-1', searchParams.flag === 'overdue' ? 'bg-attention text-white' : 'hairline')}>
            Overdue only
          </Link>
          <Link href="/assign" className="rounded bg-navy-900 px-3 py-1.5 font-medium text-white">New task</Link>
        </div>
      </div>

      {tasks.length === 0 ? (
        <Card><EmptyState title="Nothing on the board with these filters."
          hint="Clear a filter, or hand something to someone with New task." /></Card>
      ) : view === 'kanban' ? (
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {LANES.map((lane) => {
            const items = tasks.filter((t) => t.status === lane);
            return (
              <section key={lane} aria-label={lane} className="min-w-0">
                <h2 className="mb-2 flex items-center justify-between text-scale-5 font-semibold text-ink-muted">
                  {lane}<span className="tabular">{items.length}</span>
                </h2>
                <div className="space-y-2">
                  {items.map((t) => (
                    <Link key={t.id} href={`/tasks/${t.task_code}`}
                      className="block rounded-lg bg-surface hairline p-3 hover:bg-paper">
                      <div className="flex items-start justify-between gap-2">
                        <span className="tabular text-scale-6 text-ink-muted">{t.task_code}</span>
                        <PriorityMark priority={t.priority} />
                      </div>
                      <p className="mt-1 text-scale-5 leading-snug">{t.title}</p>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="truncate text-scale-6 text-ink-muted">
                          {(t.owner as { full_name: string } | null)?.full_name}
                        </span>
                        <FlagChip flag={taskFlag(t.due_at, t.status)} />
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <Card className="overflow-x-auto">
          <table className="table-dense w-full min-w-[760px] text-scale-5">
            <thead>
              <tr className="bg-steel-600 text-left text-white">
                <th className="px-3 py-2 font-medium">Task ID</th>
                <th className="px-3 py-2 font-medium">Task</th>
                <th className="px-3 py-2 font-medium">Owner</th>
                <th className="px-3 py-2 font-medium">Assigned By</th>
                <th className="px-3 py-2 font-medium">Due</th>
                <th className="px-3 py-2 font-medium">Priority</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium text-right">Days Left</th>
                <th className="px-3 py-2 font-medium">Flag</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[--hairline]">
              {tasks.map((t) => (
                <tr key={t.id} className="hover:bg-paper">
                  <td className="px-3 tabular text-ink-muted">
                    <Link href={`/tasks/${t.task_code}`} className="hover:underline">{t.task_code}</Link>
                  </td>
                  <td className="px-3 max-w-[320px] truncate">{t.title}</td>
                  <td className="px-3">{(t.owner as { full_name: string } | null)?.full_name}</td>
                  <td className="px-3 text-ink-muted">{(t.assigner as { full_name: string } | null)?.full_name}</td>
                  <td className="px-3 tabular">{formatShort(t.due_at.slice(0, 10))}</td>
                  <td className="px-3"><PriorityMark priority={t.priority} /></td>
                  <td className="px-3"><StatusPill status={t.status} /></td>
                  <td className="px-3 tabular text-right">
                    {t.status === 'Completed' ? 'Done' : daysLeft(t.due_at)}
                  </td>
                  <td className="px-3"><FlagChip flag={taskFlag(t.due_at, t.status)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
