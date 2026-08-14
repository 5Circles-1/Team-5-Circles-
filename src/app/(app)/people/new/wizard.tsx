'use client';
/** §8.1 — the 4-step add wizard: Identity → Access (with plain-English
 *  preview) → Charter → Targets. Charter and targets open on the person's
 *  pages after creation; ceilings enforce themselves there. */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addPerson } from '@/server/actions/people';
import { accessPreview } from '@/lib/permissions';
import type { AccessRole, Capability } from '@/lib/types';
import { Button, Card, CardBody, Field, Input, Select, cn } from '@/components/ui';

const STEPS = ['Identity', 'Access', 'Charter', 'Targets'] as const;

export function AddPersonWizard({ managers }: {
  managers: { id: string; full_name: string; department: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({
    full_name: '', email: '', phone: '', department: 'Sales', designation: '',
    reports_to_id: '', joined_on: new Date().toISOString().slice(0, 10),
    access_role: 'Member' as AccessRole, capabilities: [] as Capability[],
    daily_capacity_hours: 8, wip_limit_p1: 3,
  });

  const set = (patch: Partial<typeof f>) => setF((prev) => ({ ...prev, ...patch }));
  const toggleCap = (c: Capability) =>
    set({ capabilities: f.capabilities.includes(c) ? f.capabilities.filter((x) => x !== c) : [...f.capabilities, c] });

  function finish() {
    setError(null);
    start(async () => {
      const res = await addPerson({ ...f, phone: f.phone || undefined });
      if (!res.ok) { setError('error' in res ? res.error : 'Could not add.'); return; }
      router.push(`/people/${res.person_id}`);
    });
  }

  return (
    <div className="space-y-4">
      <ol className="flex gap-2 text-scale-6">
        {STEPS.map((s, i) => (
          <li key={s} className={cn(
            'rounded px-2 py-1',
            i === step ? 'bg-navy-900 text-white' : i < step ? 'text-on-target' : 'text-ink-muted',
          )}>
            {i + 1} · {s}
          </li>
        ))}
      </ol>

      <Card><CardBody className="space-y-4">
        {step === 0 ? (
          <>
            <Field label="Full name"><Input required value={f.full_name} onChange={(e) => set({ full_name: e.target.value })} /></Field>
            <Field label="Email (login identity)"><Input type="email" required value={f.email} onChange={(e) => set({ email: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Phone (optional)"><Input value={f.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
              <Field label="Joined on"><Input type="date" value={f.joined_on} onChange={(e) => set({ joined_on: e.target.value })} /></Field>
              <Field label="Department">
                <Select value={f.department} onChange={(e) => set({ department: e.target.value })}>
                  {['Sales', 'Marketing', 'Operations', 'Finance', 'HR', 'Management'].map((d) => <option key={d}>{d}</option>)}
                </Select>
              </Field>
              <Field label="Designation (a label, not power)">
                <Input required value={f.designation} onChange={(e) => set({ designation: e.target.value })}
                  placeholder='"Sales Manager", "Content Executive"' />
              </Field>
            </div>
            <Field label="Reports to">
              <Select required value={f.reports_to_id} onChange={(e) => set({ reports_to_id: e.target.value })}>
                <option value="">Pick a manager</option>
                {managers.map((m) => <option key={m.id} value={m.id}>{m.full_name} · {m.department}</option>)}
              </Select>
            </Field>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <Field label="Access role (power, separate from designation)">
              <Select value={f.access_role} onChange={(e) => set({ access_role: e.target.value as AccessRole })}>
                {['Member', 'Team Lead', 'Department Head', 'Restricted', 'Observer', 'Owner'].map((r) => <option key={r}>{r}</option>)}
              </Select>
            </Field>
            <Field label="Capability overlays (additive)">
              <div className="flex flex-wrap gap-2">
                {(['people_admin', 'hr_admin', 'finance_admin'] as Capability[]).map((c) => (
                  <button key={c} type="button" onClick={() => toggleCap(c)}
                    aria-pressed={f.capabilities.includes(c)}
                    className={cn(
                      'rounded border px-2.5 py-1 text-scale-5',
                      f.capabilities.includes(c)
                        ? 'border-steel-600 bg-steel-600/10 text-steel-600'
                        : 'border-[--hairline] text-ink-muted',
                    )}>
                    {c}
                  </button>
                ))}
              </div>
            </Field>
            {f.full_name ? (
              <p className="rounded bg-paper px-3 py-2 text-scale-4">
                {accessPreview(f.full_name, f.access_role, f.capabilities)}
              </p>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Daily capacity (hours)">
                <Input type="number" min={1} max={16} value={f.daily_capacity_hours}
                  onChange={(e) => set({ daily_capacity_hours: Number(e.target.value) })} />
              </Field>
              <Field label="P1 limit (overload guard)">
                <Input type="number" min={1} max={10} value={f.wip_limit_p1}
                  onChange={(e) => set({ wip_limit_p1: Number(e.target.value) })} />
              </Field>
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <p className="text-scale-4 text-ink-muted">
            The charter opens right after creation — add up to <strong>5 fixed duties</strong> on
            their Charters page, from a template or cloned from a teammate. The ceiling is enforced
            there: a person with fourteen daily duties has none.
          </p>
        ) : null}

        {step === 3 ? (
          <p className="text-scale-4 text-ink-muted">
            Targets live on the Targets page — up to <strong>4 KPIs</strong>, exactly one primary
            (it pre-fills their Day Close). Weekly and monthly figures compute live from the daily
            number. Finishing sends the welcome email with a magic link; their first 14 days read
            <em> Settling in</em> and stay out of department averages.
          </p>
        ) : null}

        {error ? <p className="text-scale-5 text-attention" role="alert">{error}</p> : null}

        <div className="flex justify-between">
          <Button variant="secondary" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>Back</Button>
          {step < STEPS.length - 1 ? (
            <Button
              onClick={() => setStep((s) => s + 1)}
              disabled={step === 0 ? !(f.full_name && f.email && f.designation && f.reports_to_id) : false}>
              Next
            </Button>
          ) : (
            <Button onClick={finish} disabled={pending}>
              {pending ? 'Creating…' : 'Create and send welcome'}
            </Button>
          )}
        </div>
      </CardBody></Card>
    </div>
  );
}
