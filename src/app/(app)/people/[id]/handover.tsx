'use client';
/**
 * §8.3 — the Handover wizard. Deactivation is blocked until every open item
 * is placed; this walks the leaver's footprint and commits it in one go.
 * The database re-checks structurally, so nothing can slip through.
 */
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { executeHandover } from '@/server/actions/people';
import { Button, GuardNote, cn } from '@/components/ui';

interface Candidate { id: string; full_name: string; department: string }

interface HandoverData {
  tasks: { id: string; task_code: string; title: string }[];
  supports: { id: string; role: string; task: string }[];
  duties: { id: string; title: string; cadence: string }[];
  blockers: { id: string; description: string }[];
  kpis: { id: string; metric: string }[];
  reports: { id: string; full_name: string }[];
  approvals: { id: string; context: string }[];
  candidates: Candidate[];
}

type Placement = { action: string; to?: string };

export function HandoverWizard({ person, data }: {
  person: { id: string; name: string };
  data: HandoverData;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const [taskTo, setTaskTo] = useState<Record<string, Placement>>({});
  const [dutyTo, setDutyTo] = useState<Record<string, Placement>>({});
  const [blockerTo, setBlockerTo] = useState<Record<string, string>>({});
  const [kpiTo, setKpiTo] = useState<Record<string, Placement>>({});
  const [reportTo, setReportTo] = useState<Record<string, string>>({});
  const [approvalTo, setApprovalTo] = useState<Record<string, string>>({});

  const total =
    data.tasks.length + data.duties.length + data.blockers.length +
    data.kpis.length + data.reports.length + data.approvals.length;

  const placed = useMemo(() =>
    data.tasks.filter((t) => taskTo[t.id]?.action).length +
    data.duties.filter((d) => dutyTo[d.id]?.action).length +
    data.blockers.filter((b) => blockerTo[b.id]).length +
    data.kpis.filter((k) => kpiTo[k.id]?.action).length +
    data.reports.filter((r) => reportTo[r.id]).length +
    data.approvals.filter((a) => approvalTo[a.id]).length,
  [data, taskTo, dutyTo, blockerTo, kpiTo, reportTo, approvalTo]);

  const complete = placed === total;

  function commit() {
    setError(null);
    start(async () => {
      const res = await executeHandover({
        from_person_id: person.id,
        task_moves: data.tasks.map((t) => ({
          task_id: t.id,
          action: (taskTo[t.id]?.action ?? 'reassign') as 'reassign' | 'drop',
          to_person_id: taskTo[t.id]?.to,
          reason: taskTo[t.id]?.action === 'drop' ? `Dropped in ${person.name}'s handover` : undefined,
        })),
        support_swaps: data.supports.map((s) => ({ participant_id: s.id, action: 'remove' as const })),
        duty_moves: data.duties.map((d) => ({
          charter_task_id: d.id,
          action: (dutyTo[d.id]?.action ?? 'suspend') as 'reassign' | 'suspend',
          to_person_id: dutyTo[d.id]?.to,
        })),
        blocker_moves: data.blockers.map((b) => ({ blocker_id: b.id, to_person_id: blockerTo[b.id] })),
        kpi_moves: data.kpis.map((k) => ({
          kpi_id: k.id,
          action: (kpiTo[k.id]?.action ?? 'close') as 'transfer' | 'close',
          to_person_id: kpiTo[k.id]?.to,
        })),
        approval_moves: data.approvals.map((a) => ({ approval_id: a.id, to_person_id: approvalTo[a.id] })),
        report_moves: data.reports.map((r) => ({ person_id: r.id, new_manager_id: reportTo[r.id] })),
      });
      if (!res.ok) { setError('error' in res ? res.error : 'The handover was refused.'); return; }
      setDone(res.summary);
      router.refresh();
    });
  }

  if (done) {
    return <p className="text-scale-4 text-on-target">{done} Login revoked; history intact.</p>;
  }

  if (!open) {
    return (
      <div className="space-y-3">
        <p className="text-scale-4 text-ink-muted">
          {total === 0
            ? `${person.name} has no open footprint — deactivation will go straight through.`
            : `${person.name} holds ${data.tasks.length} open tasks, ${data.duties.length} fixed duties, ${data.blockers.length} blockers to clear, ${data.kpis.length} KPIs, ${data.approvals.length} pending approvals and ${data.reports.length} direct reports. Every one must be placed first.`}
        </p>
        <Button variant="danger" onClick={() => (total === 0 ? commit() : setOpen(true))} disabled={pending}>
          {total === 0 ? (pending ? 'Deactivating…' : 'Deactivate') : 'Start the Handover wizard'}
        </Button>
        {error ? <p className="text-scale-5 text-attention">{error}</p> : null}
      </div>
    );
  }

  const People = ({ value, onPick }: { value?: string; onPick: (id: string) => void }) => (
    <select value={value ?? ''} onChange={(e) => onPick(e.target.value)}
      className="h-8 rounded hairline bg-surface px-2 text-scale-6">
      <option value="">to…</option>
      {data.candidates.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
    </select>
  );

  return (
    <div className="space-y-5">
      <p className="text-scale-5 text-ink-muted tabular">{placed}/{total} placed</p>

      <Section title={`Open tasks they own (${data.tasks.length})`}>
        {data.tasks.map((t) => (
          <Row key={t.id} label={`${t.task_code} · ${t.title}`}>
            <Choice
              options={['reassign', 'drop']}
              value={taskTo[t.id]?.action}
              onPick={(a) => setTaskTo((p) => ({ ...p, [t.id]: { ...p[t.id], action: a } }))}
            />
            {taskTo[t.id]?.action === 'reassign' ? (
              <People value={taskTo[t.id]?.to}
                onPick={(id) => setTaskTo((p) => ({ ...p, [t.id]: { action: 'reassign', to: id } }))} />
            ) : null}
          </Row>
        ))}
      </Section>

      <Section title={`Blockers where they are the unblocker (${data.blockers.length})`}
        note="A blocker pointing at a deactivated person is invisible failure — every one must be re-aimed.">
        {data.blockers.map((b) => (
          <Row key={b.id} label={b.description}>
            <People value={blockerTo[b.id]} onPick={(id) => setBlockerTo((p) => ({ ...p, [b.id]: id }))} />
          </Row>
        ))}
      </Section>

      <Section title={`Charter fixed duties (${data.duties.length})`}
        note="Suspended duties appear as a red gap on the department view, deliberately.">
        {data.duties.map((d) => (
          <Row key={d.id} label={`${d.title} · ${d.cadence}`}>
            <Choice options={['reassign', 'suspend']} value={dutyTo[d.id]?.action}
              onPick={(a) => setDutyTo((p) => ({ ...p, [d.id]: { ...p[d.id], action: a } }))} />
            {dutyTo[d.id]?.action === 'reassign' ? (
              <People value={dutyTo[d.id]?.to}
                onPick={(id) => setDutyTo((p) => ({ ...p, [d.id]: { action: 'reassign', to: id } }))} />
            ) : null}
          </Row>
        ))}
      </Section>

      <Section title={`KPIs (${data.kpis.length})`}>
        {data.kpis.map((k) => (
          <Row key={k.id} label={k.metric}>
            <Choice options={['transfer', 'close']} value={kpiTo[k.id]?.action}
              onPick={(a) => setKpiTo((p) => ({ ...p, [k.id]: { ...p[k.id], action: a } }))} />
            {kpiTo[k.id]?.action === 'transfer' ? (
              <People value={kpiTo[k.id]?.to}
                onPick={(id) => setKpiTo((p) => ({ ...p, [k.id]: { action: 'transfer', to: id } }))} />
            ) : null}
          </Row>
        ))}
      </Section>

      <Section title={`Pending approvals they decide (${data.approvals.length})`}>
        {data.approvals.map((a) => (
          <Row key={a.id} label={a.context}>
            <People value={approvalTo[a.id]} onPick={(id) => setApprovalTo((p) => ({ ...p, [a.id]: id }))} />
          </Row>
        ))}
      </Section>

      <Section title={`Direct reports to re-parent (${data.reports.length})`}>
        {data.reports.map((r) => (
          <Row key={r.id} label={r.full_name}>
            <People value={reportTo[r.id]} onPick={(id) => setReportTo((p) => ({ ...p, [r.id]: id }))} />
          </Row>
        ))}
      </Section>

      {data.supports.length > 0 ? (
        <p className="text-scale-6 text-ink-muted">
          Their {data.supports.length} support seat{data.supports.length === 1 ? '' : 's'} will be released automatically.
        </p>
      ) : null}

      <GuardNote>
        Finishing writes one handover record, posts a summary to the department feed, flips
        {' '}{person.name} to Deactivated, revokes login, and keeps all history intact.
        No delete button exists anywhere in the product.
      </GuardNote>

      {error ? <p className="text-scale-5 text-attention" role="alert">{error}</p> : null}

      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
        <Button variant="danger" disabled={!complete || pending} onClick={commit}
          title={complete ? undefined : 'Every open item must be placed first'}>
          {pending ? 'Executing…' : `Execute handover & deactivate ${person.name.split(' ')[0]}`}
        </Button>
      </div>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 text-scale-4 font-semibold">{title}</h3>
      {note ? <p className="mb-2 text-scale-6 text-ink-muted">{note}</p> : null}
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded bg-paper px-3 py-2">
      <span className="min-w-0 flex-1 text-scale-5">{label}</span>
      {children}
    </div>
  );
}

function Choice({ options, value, onPick }: {
  options: string[]; value?: string; onPick: (v: string) => void;
}) {
  return (
    <div className="flex gap-1">
      {options.map((o) => (
        <button key={o} type="button" onClick={() => onPick(o)}
          aria-pressed={value === o}
          className={cn(
            'rounded border px-2 py-1 text-scale-6 capitalize',
            value === o ? 'border-navy-900 bg-navy-900 text-white' : 'border-[--hairline] text-ink-muted',
          )}>
          {o}
        </button>
      ))}
    </div>
  );
}
