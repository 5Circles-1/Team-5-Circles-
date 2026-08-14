'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { reviewDayClose } from '@/server/actions/day-close';
import { Button } from '@/components/ui';

export function ReviewActions({ closeId, reviewed }: { closeId: string; reviewed: boolean }) {
  const [pending, start] = useTransition();
  const [commenting, setCommenting] = useState(false);
  const [comment, setComment] = useState('');
  const router = useRouter();

  if (reviewed) {
    return <p className="mt-3 text-scale-5 text-on-target">Reviewed ✓</p>;
  }

  const react = (emoji: string, text?: string) =>
    start(async () => {
      await reviewDayClose(closeId, emoji, text);
      router.refresh();
    });

  return (
    <div className="mt-3 space-y-2">
      <div className="flex gap-2">
        {['👍', '💪', '👀'].map((e) => (
          <Button key={e} size="sm" variant="secondary" disabled={pending} onClick={() => react(e)}>
            {e}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => setCommenting((v) => !v)}>Comment…</Button>
      </div>
      {commenting ? (
        <form className="flex gap-2"
          onSubmit={(e) => { e.preventDefault(); react('💬', comment); }}>
          <input autoFocus required value={comment} onChange={(e) => setComment(e.target.value)}
            placeholder="One line back to them"
            className="h-8 flex-1 rounded hairline bg-surface px-2 text-scale-5" />
          <Button size="sm" type="submit" disabled={pending}>Send</Button>
        </form>
      ) : null}
    </div>
  );
}
