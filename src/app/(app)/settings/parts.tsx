'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateSettings, resetDemoData } from '@/server/actions/misc';
import type { Settings } from '@/lib/types';
import { Button, Field, Input } from '@/components/ui';

export function SettingsForm({ settings }: { settings: Settings }) {
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const router = useRouter();
  const [f, setF] = useState({
    working_days_per_week: settings.working_days_per_week,
    working_days_per_month: settings.working_days_per_month,
    window_open: settings.window_open.slice(0, 5),
    window_close: settings.window_close.slice(0, 5),
    grace_until: settings.grace_until.slice(0, 5),
    blocker_sla_hours: settings.blocker_sla_hours,
    diagnostic_until: settings.diagnostic_until ?? '',
  });

  return (
    <form
      className="grid grid-cols-2 gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        start(async () => {
          const res = await updateSettings({
            ...f,
            diagnostic_until: f.diagnostic_until || null,
          });
          if (res.ok) { setSaved(true); router.refresh(); }
        });
      }}
    >
      <Field label="Working days / week">
        <Input type="number" min={1} max={7} value={f.working_days_per_week}
          onChange={(e) => setF({ ...f, working_days_per_week: Number(e.target.value) })} />
      </Field>
      <Field label="Working days / month">
        <Input type="number" min={1} max={31} value={f.working_days_per_month}
          onChange={(e) => setF({ ...f, working_days_per_month: Number(e.target.value) })} />
      </Field>
      <Field label="Window opens">
        <Input type="time" value={f.window_open}
          onChange={(e) => setF({ ...f, window_open: e.target.value })} />
      </Field>
      <Field label="Window closes (on-time until)">
        <Input type="time" value={f.window_close}
          onChange={(e) => setF({ ...f, window_close: e.target.value })} />
      </Field>
      <Field label="Grace until (next morning)">
        <Input type="time" value={f.grace_until}
          onChange={(e) => setF({ ...f, grace_until: e.target.value })} />
      </Field>
      <Field label="Blocker SLA (hours)">
        <Input type="number" min={1} max={168} value={f.blocker_sla_hours}
          onChange={(e) => setF({ ...f, blocker_sla_hours: Number(e.target.value) })} />
      </Field>
      <Field label="Diagnostic mode ends" hint="No red, no ratings until this date. Punish an early red cell and every future entry becomes optimistic fiction.">
        <Input type="date" value={f.diagnostic_until}
          onChange={(e) => setF({ ...f, diagnostic_until: e.target.value })} />
      </Field>
      <div className="col-span-2 flex items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save settings'}</Button>
        {saved ? <span className="text-scale-5 text-on-target">Saved.</span> : null}
      </div>
    </form>
  );
}

export function ResetDemoButton() {
  const [arm, setArm] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  if (!arm) {
    return <Button variant="danger" onClick={() => setArm(true)}>Reset demo data…</Button>;
  }
  return (
    <div className="flex items-center gap-2">
      <Button variant="danger" disabled={pending}
        onClick={() => start(async () => { await resetDemoData(); router.refresh(); })}>
        {pending ? 'Clearing…' : 'Yes, clear everything except me'}
      </Button>
      <Button variant="ghost" onClick={() => setArm(false)}>Cancel</Button>
    </div>
  );
}
