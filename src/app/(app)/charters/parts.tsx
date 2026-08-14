'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addCharterDuty, retireCharterDuty } from '@/server/actions/misc';
import { Button, GuardNote } from '@/components/ui';

export function AddDutyForm({ charterId, atCeiling }: { charterId: string; atCeiling: boolean }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [cadence, setCadence] = useState('Daily');
  const [dod, setDod] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  if (atCeiling && !error) {
    return (
      <GuardNote>
        Five is the ceiling. A person with fourteen daily duties has none. Retire one first.
      </GuardNote>
    );
  }

  if (!open) {
    return <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Add a fixed duty</Button>;
  }

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await addCharterDuty({
            charter_id: charterId, title, cadence: cadence as never, definition_of_done: dod,
          });
          if (!res.ok) { setError('error' in res ? res.error : 'Refused.'); return; }
          setOpen(false); setTitle(''); setDod('');
          router.refresh();
        });
      }}
    >
      <input required value={title} onChange={(e) => setTitle(e.target.value)}
        placeholder="The duty (same every day/week)"
        className="h-9 w-full rounded hairline bg-surface px-3 text-scale-5" />
      <div className="flex gap-2">
        <select value={cadence} onChange={(e) => setCadence(e.target.value)}
          className="h-9 rounded hairline bg-surface px-2 text-scale-5">
          {['Daily', 'Weekly', 'Fortnightly', 'Monthly', 'Quarterly'].map((c) => <option key={c}>{c}</option>)}
        </select>
        <input required value={dod} onChange={(e) => setDod(e.target.value)}
          placeholder="Definition of done"
          className="h-9 flex-1 rounded hairline bg-surface px-3 text-scale-5" />
        <Button size="sm" type="submit" disabled={pending}>Add</Button>
      </div>
      {error ? <p className="text-scale-5 text-attention">{error}</p> : null}
    </form>
  );
}

export function RetireDutyButton({ dutyId }: { dutyId: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      className="text-scale-6 text-ink-muted hover:text-attention"
      disabled={pending}
      onClick={() => start(async () => { await retireCharterDuty(dutyId); router.refresh(); })}
      title="Retire this duty"
    >
      retire
    </button>
  );
}
