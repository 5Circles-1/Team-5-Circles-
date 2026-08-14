'use client';
/** Client-side interactions on My Day: tap-to-tick, inbox triage. */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { changeTaskStatus, respondToRequest } from '@/server/actions/tasks';
import { respondToBlocker } from '@/server/actions/blockers';
import { decideApproval, triageAsk } from '@/server/actions/misc';
import { Button, cn } from '@/components/ui';

export function TickDuty({ id, title, definitionOfDone, done }: {
  id: string; title: string; definitionOfDone: string | null; done: boolean;
}) {
  const [showDod, setShowDod] = useState(false);
  const [optimistic, setOptimistic] = useState(done);
  const [, start] = useTransition();
  const router = useRouter();

  function toggle() {
    const next = !optimistic;
    setOptimistic(next); // optimistic update, quiet rollback on failure
    start(async () => {
      const res = await changeTaskStatus({ task_id: id, status: next ? 'Completed' : 'On Track' });
      if (!res.ok) setOptimistic(!next);
      else router.refresh();
    });
  }

  return (
    <li className="px-4 py-2.5">
      <div className="flex items-center gap-3">
        <button
          onClick={toggle}
          role="checkbox"
          aria-checked={optimistic}
          aria-label={`${title} — mark ${optimistic ? 'not done' : 'done'}`}
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors duration-150',
            optimistic ? 'bg-on-target border-on-target text-white' : 'border-steel-300 bg-surface',
          )}
        >
          {optimistic ? '✓' : ''}
        </button>
        <button
          onClick={() => setShowDod((v) => !v)}
          className={cn('min-w-0 flex-1 text-left text-scale-4', optimistic && 'text-ink-muted line-through')}
        >
          {title}
        </button>
      </div>
      {showDod && definitionOfDone ? (
        <p className="mt-1 pl-9 text-scale-5 text-ink-muted">Done means: {definitionOfDone}</p>
      ) : null}
    </li>
  );
}

export function InboxRequestActions({ taskId }: { taskId: string }) {
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, start] = useTransition();
  const router = useRouter();

  const act = (fn: () => Promise<unknown>) => start(async () => { await fn(); router.refresh(); });

  if (declining) {
    return (
      <form
        className="flex w-full items-center gap-2 sm:w-auto"
        onSubmit={(e) => {
          e.preventDefault();
          act(() => respondToRequest({ task_id: taskId, response: 'decline', declined_reason: reason }));
        }}
      >
        <input
          autoFocus required value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="Why not? (returns to the sender)"
          className="h-8 flex-1 rounded hairline bg-surface px-2 text-scale-5"
        />
        <Button size="sm" type="submit" disabled={pending}>Decline</Button>
      </form>
    );
  }
  return (
    <div className="flex gap-2">
      <Button size="sm" disabled={pending}
        onClick={() => act(() => respondToRequest({ task_id: taskId, response: 'accept' }))}>
        Accept
      </Button>
      <Button size="sm" variant="secondary" onClick={() => setDeclining(true)}>Decline…</Button>
    </div>
  );
}

export function InboxApprovalActions({ approvalId }: { approvalId: string }) {
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState('');
  const [pending, start] = useTransition();
  const router = useRouter();
  const act = (fn: () => Promise<unknown>) => start(async () => { await fn(); router.refresh(); });

  if (declining) {
    return (
      <form
        className="flex w-full items-center gap-2 sm:w-auto"
        onSubmit={(e) => { e.preventDefault(); act(() => decideApproval(approvalId, 'Declined', note)); }}
      >
        <input autoFocus required value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Why not? (required)"
          className="h-8 flex-1 rounded hairline bg-surface px-2 text-scale-5" />
        <Button size="sm" type="submit" disabled={pending}>Decline</Button>
      </form>
    );
  }
  return (
    <div className="flex gap-2">
      <Button size="sm" disabled={pending} onClick={() => act(() => decideApproval(approvalId, 'Approved'))}>
        Approve
      </Button>
      <Button size="sm" variant="secondary" onClick={() => setDeclining(true)}>Decline…</Button>
    </div>
  );
}

export function InboxAskActions({ askId }: { askId: string }) {
  const [answering, setAnswering] = useState(false);
  const [answer, setAnswer] = useState('');
  const [pending, start] = useTransition();
  const router = useRouter();
  const act = (fn: () => Promise<unknown>) => start(async () => { await fn(); router.refresh(); });

  if (answering) {
    return (
      <form
        className="flex w-full items-center gap-2 sm:w-auto"
        onSubmit={(e) => { e.preventDefault(); act(() => triageAsk(askId, { action: 'answer', answer })); }}
      >
        <input autoFocus required value={answer} onChange={(e) => setAnswer(e.target.value)}
          placeholder="Answer here — this resolves it"
          className="h-8 flex-1 rounded hairline bg-surface px-2 text-scale-5" />
        <Button size="sm" type="submit" disabled={pending}>Send</Button>
      </form>
    );
  }
  return (
    <div className="flex gap-2">
      <Button size="sm" variant="secondary" onClick={() => setAnswering(true)}>Answer</Button>
      <Button size="sm" variant="ghost" disabled={pending}
        onClick={() => act(() => triageAsk(askId, { action: 'decline' }))}>
        Decline
      </Button>
    </div>
  );
}

export function GotThisButton({ blockerId, responded }: { blockerId: string; responded: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  if (responded) return <span className="text-scale-5 text-on-target">On it</span>;
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() => start(async () => {
        await respondToBlocker({ blocker_id: blockerId, action: 'got-it' });
        router.refresh();
      })}
    >
      I&apos;ve got this
    </Button>
  );
}
