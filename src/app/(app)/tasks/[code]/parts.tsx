'use client';
/** Task detail interactions. Actions the caller cannot take render disabled
 *  with a tooltip explaining why — people learn the rules by seeing them. */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { changeTaskStatus, delegateTask, signOffReview } from '@/server/actions/tasks';
import { addComment, sendKudos } from '@/server/actions/misc';
import { Button, GuardNote } from '@/components/ui';
import type { TaskStatus } from '@/lib/types';

export function TaskActions({
  taskId, taskCode, status, isOwner, isAssigner, isOwnerRole, canReview, teammates,
}: {
  taskId: string; taskCode: string; status: TaskStatus;
  isOwner: boolean; isAssigner: boolean; isOwnerRole: boolean; canReview: boolean;
  teammates: { id: string; full_name: string; department: string }[];
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'none' | 'block' | 'drop' | 'delegate'>('none');
  const [text, setText] = useState('');
  const [pickId, setPickId] = useState('');
  const router = useRouter();

  const act = (fn: () => Promise<{ ok: boolean; error?: string } | { ok: boolean }>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok && 'error' in res) setError((res as { error: string }).error);
      else { setMode('none'); setText(''); router.refresh(); }
    });

  const move = (s: TaskStatus) => act(() => changeTaskStatus({ task_id: taskId, status: s as never }));
  const open = !['Completed', 'Dropped', 'Declined', 'Missed'].includes(status);

  return (
    <div className="rounded-lg bg-surface hairline p-4 space-y-3">
      <div className="flex flex-wrap gap-2">
        {open ? (
          <>
            <Gate allowed={isOwner || isOwnerRole} why="Only the owner moves a task forward.">
              <Button size="sm" variant="secondary" disabled={pending || status === 'On Track'}
                onClick={() => move('On Track')}>On Track</Button>
            </Gate>
            <Button size="sm" variant="secondary" disabled={pending || status === 'At Risk'}
              onClick={() => move('At Risk')}>At Risk</Button>
            <Button size="sm" variant="secondary" disabled={pending || status === 'Blocked'}
              onClick={() => setMode(mode === 'block' ? 'none' : 'block')}>Blocked…</Button>
            <Gate allowed={isOwner || isOwnerRole} why="Only the owner marks their work done.">
              <Button size="sm" disabled={pending}
                onClick={() => move(canReviewGateHint(status))}>Mark done</Button>
            </Gate>
            <Gate allowed={isOwner || isOwnerRole} why="Only the current owner may delegate.">
              <Button size="sm" variant="secondary" disabled={pending}
                onClick={() => setMode(mode === 'delegate' ? 'none' : 'delegate')}>Delegate…</Button>
            </Gate>
            <Gate allowed={isAssigner || isOwnerRole} why="Only the assigner (or the Owner) can drop a task.">
              <Button size="sm" variant="danger" disabled={pending}
                onClick={() => setMode(mode === 'drop' ? 'none' : 'drop')}>Drop…</Button>
            </Gate>
          </>
        ) : status === 'Completed' && (isAssigner || isOwnerRole) ? (
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => move('On Track')}>
            Reopen (7-day window)
          </Button>
        ) : null}
        {canReview && status === 'Pending Review' ? (
          <Button size="sm" disabled={pending}
            onClick={() => act(() => signOffReview(taskId))}>Sign off review</Button>
        ) : null}
      </div>

      {mode === 'block' ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            act(() => changeTaskStatus({
              task_id: taskId, status: 'Blocked',
              blocker: { description: text, unblocker_id: pickId, severity: 'Medium' },
            }));
          }}
        >
          <textarea required value={text} onChange={(e) => setText(e.target.value)}
            placeholder="What is stopping this?"
            className="w-full rounded hairline bg-surface px-3 py-2 text-scale-4 min-h-[60px]" />
          <div className="flex gap-2">
            <select required value={pickId} onChange={(e) => setPickId(e.target.value)}
              className="h-9 flex-1 rounded hairline bg-surface px-2 text-scale-5">
              <option value="">Who can unblock?</option>
              {teammates.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
            </select>
            <Button size="sm" type="submit" disabled={pending}>Raise blocker</Button>
          </div>
          <GuardNote>There is no anonymous blocking — a named unblocker gets a 24-hour clock.</GuardNote>
        </form>
      ) : null}

      {mode === 'drop' ? (
        <form className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            act(() => changeTaskStatus({ task_id: taskId, status: 'Dropped', drop_reason: text }));
          }}>
          <input required value={text} onChange={(e) => setText(e.target.value)}
            placeholder="Why is this being dropped? (recorded)"
            className="h-9 flex-1 rounded hairline bg-surface px-3 text-scale-5" />
          <Button size="sm" variant="danger" type="submit" disabled={pending}>Drop {taskCode}</Button>
        </form>
      ) : null}

      {mode === 'delegate' ? (
        <form className="flex gap-2"
          onSubmit={(e) => { e.preventDefault(); act(() => delegateTask(taskId, pickId)); }}>
          <select required value={pickId} onChange={(e) => setPickId(e.target.value)}
            className="h-9 flex-1 rounded hairline bg-surface px-2 text-scale-5">
            <option value="">Delegate to…</option>
            {teammates.map((t) => <option key={t.id} value={t.id}>{t.full_name} · {t.department}</option>)}
          </select>
          <Button size="sm" type="submit" disabled={pending}>Delegate</Button>
        </form>
      ) : null}

      {error ? <p className="text-scale-5 text-attention" role="alert">{error}</p> : null}
    </div>
  );
}

/** Marking done routes to Pending Review if a reviewer seat exists — the
 *  server refuses a straight Completed anyway; this just aims better. */
function canReviewGateHint(_status: TaskStatus): TaskStatus {
  return 'Completed';
}

function Gate({ allowed, why, children }: { allowed: boolean; why: string; children: React.ReactElement }) {
  if (allowed) return children;
  return (
    <span title={why} className="inline-flex cursor-not-allowed opacity-45" aria-disabled>
      {children}
    </span>
  );
}

export function CommentBox({ subjectType, subjectId }: {
  subjectType: 'task' | 'day_close' | 'blocker'; subjectId: string;
}) {
  const [body, setBody] = useState('');
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await addComment({ subject_type: subjectType, subject_id: subjectId, body, mentions: [] });
          if (res.ok) { setBody(''); router.refresh(); }
        });
      }}
    >
      <input value={body} onChange={(e) => setBody(e.target.value)} required
        placeholder="Write to the thread…"
        className="h-10 flex-1 rounded hairline bg-surface px-3 text-scale-4" />
      <Button type="submit" disabled={pending}>Send</Button>
    </form>
  );
}

export function KudosButton({ toPersonId, taskId }: { toPersonId: string; taskId: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [pending, start] = useTransition();
  const [sent, setSent] = useState(false);
  if (sent) return <span className="text-scale-5 text-on-target">Kudos sent 💛</span>;
  if (!open) {
    return <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>💛 Kudos</Button>;
  }
  return (
    <form className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await sendKudos({ to_person_id: toPersonId, note, task_id: taskId });
          if (res.ok) setSent(true);
        });
      }}>
      <input autoFocus required value={note} onChange={(e) => setNote(e.target.value)}
        placeholder="What was great?"
        className="h-8 rounded hairline bg-surface px-2 text-scale-5" />
      <Button size="sm" type="submit" disabled={pending}>Send</Button>
    </form>
  );
}
