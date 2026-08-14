'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { respondToBlocker } from '@/server/actions/blockers';
import { Button } from '@/components/ui';

export function BlockerActions({ blockerId, responded }: { blockerId: string; responded: boolean }) {
  const [pending, start] = useTransition();
  const [resolving, setResolving] = useState(false);
  const [note, setNote] = useState('');
  const router = useRouter();

  const act = (input: Parameters<typeof respondToBlocker>[0]) =>
    start(async () => { await respondToBlocker(input); router.refresh(); });

  if (resolving) {
    return (
      <form className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          act({ blocker_id: blockerId, action: 'resolve', resolution_note: note });
        }}>
        <input autoFocus value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="How it was cleared"
          className="h-8 w-44 rounded hairline bg-surface px-2 text-scale-5" />
        <Button size="sm" type="submit" disabled={pending}>Resolve</Button>
      </form>
    );
  }
  return (
    <div className="flex gap-2">
      {!responded ? (
        <Button size="sm" disabled={pending}
          onClick={() => act({ blocker_id: blockerId, action: 'got-it' })}>
          I&apos;ve got this
        </Button>
      ) : null}
      <Button size="sm" variant="secondary" onClick={() => setResolving(true)}>Resolved…</Button>
    </div>
  );
}
