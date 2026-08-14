'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setKpiTarget } from '@/server/actions/misc';
import { weeklyTarget, monthlyTarget } from '@/lib/compute';
import { Button, GuardNote } from '@/components/ui';

export function KpiEditor({ personId, atCeiling, hasPrimary, current, workingDays }: {
  personId: string;
  atCeiling: boolean;
  hasPrimary: boolean;
  current: { id: string; metric: string }[];
  workingDays: { week: number; month: number };
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const [f, setF] = useState({
    metric: '', unit: 'Count', target_type: 'Volume', direction: 'Higher is better',
    daily_target: '', review_cadence: 'Weekly', is_primary: !hasPrimary, replaces: '',
  });

  const daily = parseFloat(f.daily_target);
  const live = useMemo(() => Number.isNaN(daily) ? null : {
    weekly: weeklyTarget(daily, f.target_type as 'Volume' | 'Rate', workingDays.week),
    monthly: monthlyTarget(daily, f.target_type as 'Volume' | 'Rate', workingDays.month),
  }, [daily, f.target_type, workingDays]);

  if (!open) {
    if (atCeiling) {
      return <GuardNote>Four KPIs is the ceiling. Change one by replacing it — the old row closes, history stays.</GuardNote>;
    }
    return <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Set a target</Button>;
  }

  return (
    <form
      className="space-y-2 rounded bg-paper p-3"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await setKpiTarget({
            person_id: personId, metric: f.metric, unit: f.unit as never,
            target_type: f.target_type as never, direction: f.direction as never,
            daily_target: daily, review_cadence: f.review_cadence as never,
            is_primary: f.is_primary,
          }, f.replaces || undefined);
          if (!res.ok) { setError('error' in res ? res.error : 'Refused.'); return; }
          setOpen(false);
          router.refresh();
        });
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <input required value={f.metric} onChange={(e) => setF({ ...f, metric: e.target.value })}
          placeholder="Metric" className="col-span-2 h-9 rounded hairline bg-surface px-3 text-scale-5" />
        <select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}
          className="h-9 rounded hairline bg-surface px-2 text-scale-5">
          {['INR', 'Count', '%', 'Hours', 'Days'].map((u) => <option key={u}>{u}</option>)}
        </select>
        <select value={f.target_type} onChange={(e) => setF({ ...f, target_type: e.target.value })}
          className="h-9 rounded hairline bg-surface px-2 text-scale-5">
          <option>Volume</option><option>Rate</option>
        </select>
        <select value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}
          className="h-9 rounded hairline bg-surface px-2 text-scale-5">
          <option>Higher is better</option><option>Lower is better</option>
        </select>
        <select value={f.review_cadence} onChange={(e) => setF({ ...f, review_cadence: e.target.value })}
          className="h-9 rounded hairline bg-surface px-2 text-scale-5">
          {['Daily', 'Weekly', 'Monthly'].map((c) => <option key={c}>{c}</option>)}
        </select>
        <input required type="number" step="any" min="0" value={f.daily_target}
          onChange={(e) => setF({ ...f, daily_target: e.target.value })}
          placeholder="Daily target" className="h-9 rounded hairline bg-surface px-3 text-scale-5 tabular" />
        <select value={f.replaces} onChange={(e) => setF({ ...f, replaces: e.target.value })}
          className="h-9 rounded hairline bg-surface px-2 text-scale-5">
          <option value="">New KPI (nothing replaced)</option>
          {current.map((k) => <option key={k.id} value={k.id}>Replaces: {k.metric}</option>)}
        </select>
      </div>
      {live ? (
        <p className="tabular text-scale-5 text-ink-muted">
          Weekly {live.weekly.toLocaleString('en-IN')} · Monthly {live.monthly.toLocaleString('en-IN')}
        </p>
      ) : null}
      <label className="flex items-center gap-2 text-scale-5">
        <input type="checkbox" checked={f.is_primary}
          onChange={(e) => setF({ ...f, is_primary: e.target.checked })} />
        Primary — pre-fills their Day Close
      </label>
      {error ? <p className="text-scale-5 text-attention">{error}</p> : null}
      <div className="flex gap-2">
        <Button size="sm" type="submit" disabled={pending}>Save target</Button>
        <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </form>
  );
}
