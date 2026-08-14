'use client';
/**
 * §13.E — the Assign screen. Picking someone in another department visibly
 * switches the verb from Assign to Request with a one-line explanation.
 * §6.4 guards arrive from the server as amber inline notes, never blocking
 * dialogs; overriding records a reason.
 */
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { assignTask } from '@/server/actions/tasks';
import { sendAsk } from '@/server/actions/misc';
import type { GuardWarning } from '@/lib/guards';
import { Button, Card, CardBody, Field, GuardNote, Input, Select, Textarea, cn } from '@/components/ui';

interface Candidate {
  id: string; full_name: string; department: string;
  verb: string | null; open_count: number; on_leave: boolean;
}

const VERB_EXPLAIN: Record<string, string> = {
  'Direct': 'Lands on their board immediately as Not Started.',
  'Peer Request': 'They get 12 hours to accept, decline with a reason, or counter-propose. Nothing lands until they say yes.',
  'Cross-department Request': 'Goes to their department head first — their people’s time is not free.',
  'Ask': 'A senior’s board is theirs: this sends an Ask they can convert, answer, or decline.',
};

export function AssignForm({ me, candidates, kpis, startInAskMode }: {
  me: { id: string; name: string };
  candidates: Candidate[];
  kpis: { id: string; metric: string; person_id: string }[];
  startInAskMode: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [ownerId, setOwnerId] = useState(startInAskMode ? '' : me.id);
  const [priority, setPriority] = useState('P2 - Important');
  const [due, setDue] = useState('');
  const [dueTime, setDueTime] = useState('19:30');
  const [estHours, setEstHours] = useState('');
  const [visibility, setVisibility] = useState('Team');
  const [linkedKpi, setLinkedKpi] = useState('');
  const [askBody, setAskBody] = useState('');
  const [warnings, setWarnings] = useState<GuardWarning[]>([]);
  const [overrideReason, setOverrideReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const chosen = candidates.find((c) => c.id === ownerId);
  const verb = ownerId === me.id ? 'Direct' : chosen?.verb ?? null;
  const isAsk = verb === 'Ask';
  const maxOpen = Math.max(1, ...candidates.map((c) => c.open_count));
  const ownerKpis = useMemo(() => kpis.filter((k) => k.person_id === ownerId), [kpis, ownerId]);

  function submit(acknowledged: string[]) {
    setError(null);
    start(async () => {
      if (isAsk && chosen) {
        const res = await sendAsk({ to_person_id: chosen.id, body: `${title}${askBody ? ` — ${askBody}` : ''}` });
        if (!res.ok && 'error' in res) setError(res.error);
        else setSent('Your Ask is in their Inbox. Nothing lands on their board until they convert it.');
        return;
      }
      const res = await assignTask({
        title, description,
        owner_ids: [ownerId],
        priority,
        due_at: `${due}T${dueTime}:00+05:30`,
        est_hours: estHours === '' ? undefined : Number(estHours),
        visibility,
        linked_kpi_id: linkedKpi || undefined,
        support: [],
        acknowledged_guards: acknowledged,
        override_reason: acknowledged.length > 0 ? (overrideReason || 'Acknowledged at assign time') : undefined,
      });
      if (!res.ok) {
        if ('warnings' in res) { setWarnings(res.warnings); return; }
        setError(res.error);
        return;
      }
      setSent(
        verb === 'Direct'
          ? `On the board: ${res.task_codes.join(', ')}`
          : `Request sent (${res.task_codes.join(', ')}). The clock is running on their side.`,
      );
    });
  }

  if (sent) {
    return (
      <Card><CardBody className="space-y-3 py-8 text-center">
        <p className="text-scale-3">{sent}</p>
        <div className="flex justify-center gap-2">
          <Button variant="secondary" onClick={() => router.push('/board')}>Board</Button>
          <Button onClick={() => { setSent(null); setTitle(''); setWarnings([]); }}>Another</Button>
        </div>
      </CardBody></Card>
    );
  }

  return (
    <div className="space-y-4 pb-10">
      <Card><CardBody className="space-y-4">
        <Field label="Who">
          <div className="max-h-56 space-y-1 overflow-y-auto rounded hairline p-1">
            {[{ id: me.id, full_name: `${me.name} (me)`, department: '', verb: 'Direct', open_count: candidates.find(c => c.id === me.id)?.open_count ?? 0, on_leave: false } as Candidate,
              ...candidates.filter((c) => c.id !== me.id)].map((c) => (
              <button
                key={c.id} type="button"
                onClick={() => { setOwnerId(c.id); setWarnings([]); }}
                aria-pressed={ownerId === c.id}
                className={cn(
                  'flex w-full items-center gap-3 rounded px-2.5 py-2 text-left',
                  ownerId === c.id ? 'bg-navy-900 text-white' : 'hover:bg-paper',
                )}
              >
                <span className="min-w-0 flex-1 truncate text-scale-4">
                  {c.full_name}
                  {c.department ? <span className={ownerId === c.id ? 'text-white/70' : 'text-ink-muted'}> · {c.department}</span> : null}
                  {c.on_leave ? <span className="text-behind"> · on leave</span> : null}
                </span>
                {/* current-load bar */}
                <span className="flex h-1.5 w-16 overflow-hidden rounded-full bg-black/10" aria-label={`${c.open_count} open tasks`}>
                  <span
                    className={cn('h-full rounded-full', ownerId === c.id ? 'bg-white/80' : 'bg-steel-600')}
                    style={{ width: `${Math.min(100, (c.open_count / maxOpen) * 100)}%` }}
                  />
                </span>
                <span className={cn('tabular text-scale-6', ownerId === c.id ? 'text-white/70' : 'text-ink-muted')}>{c.open_count}</span>
              </button>
            ))}
          </div>
        </Field>

        {verb && verb !== 'Direct' ? (
          <div className="rounded bg-steel-600/10 px-3 py-2 text-scale-5 text-steel-600">
            <strong>{verb === 'Ask' ? 'This becomes an Ask.' : `This becomes a ${verb}.`}</strong>{' '}
            {VERB_EXPLAIN[verb]}
          </div>
        ) : null}

        <Field label={isAsk ? 'What do you need?' : 'Task'}>
          <Input required value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder={isAsk ? 'One line — they triage it' : 'What has to get done?'} />
        </Field>

        {isAsk ? (
          <Field label="Context (optional)">
            <Textarea value={askBody} onChange={(e) => setAskBody(e.target.value)} placeholder="Anything that helps them decide." />
          </Field>
        ) : (
          <>
            <Field label="Detail (optional)">
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Definition of done, links, context." />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Due date">
                <Input type="date" required value={due} onChange={(e) => setDue(e.target.value)} />
              </Field>
              <Field label="Due time">
                <Input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
              </Field>
              <Field label="Priority">
                <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
                  <option>P1 - Critical</option><option>P2 - Important</option><option>P3 - Nice to have</option>
                </Select>
              </Field>
              <Field label="Estimated hours">
                <Input type="number" min="0.5" step="0.5" value={estHours}
                  onChange={(e) => setEstHours(e.target.value)} placeholder="drives the load meter" />
              </Field>
              <Field label="Visibility">
                <Select value={visibility} onChange={(e) => setVisibility(e.target.value)}>
                  <option>Team</option><option>Department</option><option>Private</option>
                </Select>
              </Field>
              <Field label="Ties to a number (optional)">
                <Select value={linkedKpi} onChange={(e) => setLinkedKpi(e.target.value)}>
                  <option value="">—</option>
                  {ownerKpis.map((k) => <option key={k.id} value={k.id}>{k.metric}</option>)}
                </Select>
              </Field>
            </div>
          </>
        )}
      </CardBody></Card>

      {warnings.length > 0 ? (
        <div className="space-y-2">
          {warnings.map((w) => (
            <GuardNote key={w.code}>
              {w.message}
              {w.code === 'overload' && Array.isArray(w.detail) ? (
                <ul className="mt-1 list-disc pl-4 text-scale-6">
                  {(w.detail as { task_code?: string; code?: string; title: string }[]).map((d, i) => (
                    <li key={i}>{d.title}</li>
                  ))}
                </ul>
              ) : null}
              {w.suggestion?.due_at ? (
                <button type="button" className="mt-1 block font-medium underline"
                  onClick={() => { setDue(w.suggestion!.due_at!); setWarnings((prev) => prev.filter((x) => x.code !== w.code)); }}>
                  Move it there
                </button>
              ) : null}
            </GuardNote>
          ))}
          <Input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)}
            placeholder="Reason for going ahead anyway (recorded on the task)" />
          <Button disabled={pending || !overrideReason.trim()}
            onClick={() => submit(warnings.map((w) => w.code))}>
            Assign anyway
          </Button>
        </div>
      ) : (
        <Button className="w-full" size="lg"
          disabled={pending || !title.trim() || !ownerId || (!isAsk && !due)}
          onClick={() => submit([])}>
          {pending ? 'Sending…' : isAsk ? 'Send the Ask' : verb === 'Direct' ? 'Assign' : `Send ${verb ?? 'request'}`}
        </Button>
      )}

      {error ? <p className="text-scale-4 text-attention" role="alert">{error}</p> : null}
    </div>
  );
}
