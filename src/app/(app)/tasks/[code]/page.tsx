import { notFound } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase/server';
import { taskFlag } from '@/lib/compute';
import { daysLeft, formatShort } from '@/lib/dates';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui';
import { StatusPill, FlagChip, PriorityMark } from '@/components/status';
import { SlaClock } from '@/components/countdown';
import { TaskActions, CommentBox, KudosButton } from './parts';

export const dynamic = 'force-dynamic';

export default async function TaskDetailPage({ params }: { params: { code: string } }) {
  const { person, actor } = await requireSession();
  const supabase = supabaseServer();

  const { data: task } = await supabase.from('tasks')
    .select(`*,
      owner:people!tasks_owner_id_fkey(id, full_name),
      accountable:people!tasks_accountable_id_fkey(id, full_name),
      assigner:people!tasks_assigned_by_id_fkey(id, full_name)`)
    .eq('task_code', params.code).maybeSingle();
  if (!task) notFound();

  const [{ data: participants }, { data: comments }, { data: blockers }, { data: audit }, { data: teammates }, { data: chainNames }] =
    await Promise.all([
      supabase.from('task_participants')
        .select('*, person:people!task_participants_person_id_fkey(id, full_name)')
        .eq('task_id', task.id).is('removed_at', null),
      supabase.from('comments').select('*, author:people!comments_author_id_fkey(full_name)')
        .eq('subject_type', 'task').eq('subject_id', task.id).order('created_at'),
      supabase.from('blockers').select('*, unblocker:people!blockers_unblocker_id_fkey(full_name)')
        .eq('task_id', task.id).order('raised_at', { ascending: false }),
      supabase.from('audit_log').select('actor_id, action, at, before, after')
        .eq('entity', 'tasks').eq('entity_id', task.id).order('at', { ascending: false }).limit(40),
      supabase.from('people').select('id, full_name, department').neq('status', 'Deactivated').order('full_name'),
      task.delegation_chain.length
        ? supabase.from('people').select('id, full_name').in('id', task.delegation_chain)
        : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    ]);

  const chainDisplay = task.delegation_chain.length
    ? [...task.delegation_chain.map((id: string) =>
        (chainNames ?? []).find((p) => p.id === id)?.full_name ?? '—'),
       (task.owner as { full_name: string }).full_name].join(' → ')
    : null;

  const isOwner = task.owner_id === person.id;
  const isAssigner = task.assigned_by_id === person.id || task.accountable_id === person.id;
  const myReviewerSeat = (participants ?? []).find(
    (p) => p.person_id === person.id && p.support_role === 'Reviewer' && !p.signed_off_at,
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="tabular text-scale-5 text-ink-muted">{task.task_code}</p>
          <h1 className="font-display text-scale-2 font-bold leading-tight">{task.title}</h1>
          {chainDisplay ? (
            <p className="mt-1 text-scale-5 text-ink-muted">Delegation: {chainDisplay}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <FlagChip flag={taskFlag(task.due_at, task.status)} />
          <StatusPill status={task.status} />
        </div>
      </div>

      <Card>
        <CardBody className="grid grid-cols-2 gap-4 text-scale-5 sm:grid-cols-4">
          <Meta label="Owner" value={(task.owner as { full_name: string }).full_name} />
          <Meta label="Accountable" value={(task.accountable as { full_name: string }).full_name} />
          <Meta label="Assigned by" value={(task.assigner as { full_name: string }).full_name} />
          <Meta label="Priority" value={<PriorityMark priority={task.priority} />} />
          <Meta label="Due" value={
            <span className="tabular">
              {formatShort(task.due_at.slice(0, 10))} · {task.status === 'Completed' ? 'Done' : `${daysLeft(task.due_at)}d left`}
            </span>
          } />
          <Meta label="Estimate" value={task.est_hours ? `${task.est_hours}h` : '—'} />
          <Meta label="Visibility" value={task.visibility} />
          <Meta label="Type" value={task.task_type} />
        </CardBody>
      </Card>

      {task.description ? (
        <Card><CardBody><p className="whitespace-pre-wrap text-scale-4">{task.description}</p></CardBody></Card>
      ) : null}

      <TaskActions
        taskId={task.id}
        taskCode={task.task_code}
        status={task.status}
        isOwner={isOwner}
        isAssigner={isAssigner}
        isOwnerRole={actor.access_role === 'Owner'}
        canReview={!!myReviewerSeat}
        teammates={teammates ?? []}
      />

      {(blockers ?? []).length > 0 ? (
        <Card>
          <CardHeader><CardTitle>Blockers</CardTitle></CardHeader>
          <CardBody className="space-y-2 text-scale-4">
            {(blockers ?? []).map((b) => (
              <div key={b.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 flex-1">
                  “{b.description}” → {(b.unblocker as { full_name: string } | null)?.full_name}
                </span>
                <SlaClock due={b.sla_due_at} resolved={!!b.resolved_at} />
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Supports</CardTitle>
          <KudosButton toPersonId={task.owner_id} taskId={task.id} />
        </CardHeader>
        <CardBody className="p-0">
          <ul className="divide-y divide-[--hairline] text-scale-4">
            {(participants ?? []).length === 0 ? (
              <li className="px-4 py-3 text-ink-muted">Nobody supporting yet.</li>
            ) : (participants ?? []).map((p) => (
              <li key={p.id} className="flex items-center justify-between px-4 py-2.5">
                <span>{(p.person as { full_name: string }).full_name}</span>
                <span className="text-scale-6 text-ink-muted">
                  {p.support_role}{p.support_role === 'Reviewer' && p.signed_off_at ? ' · signed off' : ''}
                </span>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Thread</CardTitle></CardHeader>
        <CardBody className="space-y-3">
          {(comments ?? []).map((c) => (
            <div key={c.id} className={c.is_system ? 'text-scale-6 text-ink-muted' : 'text-scale-4'}>
              <span className="font-medium">{(c.author as { full_name: string }).full_name}</span>{' '}
              <span className={c.struck_at ? 'line-through text-ink-muted' : ''}>{c.body}</span>
              {c.edited_at && !c.is_system ? <span className="text-scale-6 text-ink-muted"> (edited)</span> : null}
            </div>
          ))}
          <CommentBox subjectType="task" subjectId={task.id} />
        </CardBody>
      </Card>

      <details className="rounded-lg bg-surface hairline">
        <summary className="cursor-pointer px-4 py-3 text-scale-5 text-ink-muted">Audit trail</summary>
        <div className="hairline-b" />
        <ul className="max-h-72 overflow-y-auto px-4 py-2 text-scale-6 text-ink-muted space-y-1">
          {(audit ?? []).map((a, i) => {
            const beforeStatus = (a.before as { status?: string } | null)?.status;
            const afterStatus = (a.after as { status?: string } | null)?.status;
            return (
              <li key={i} className="tabular">
                {new Date(a.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} · {a.action}
                {beforeStatus && afterStatus && beforeStatus !== afterStatus
                  ? ` · ${beforeStatus} → ${afterStatus}` : ''}
              </li>
            );
          })}
        </ul>
      </details>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-scale-6 uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="mt-0.5 text-ink">{value}</p>
    </div>
  );
}
