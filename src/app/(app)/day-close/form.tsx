'use client';
/**
 * The 5-minute form (§10). 80%+ pre-filled; the person types four things and
 * hits submit. Every field drafts to localStorage on change — a phone dying
 * at 19:25 loses nothing. One submission per day; the server stamps the
 * window; the countdown turns amber at 15 minutes and never red.
 */
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { submitDayClose } from '@/server/actions/day-close';
import { Button, Card, CardBody, cn, GuardNote } from '@/components/ui';
import { CloseCountdown } from '@/components/countdown';

interface FixedItem { id: string; title: string; definition_of_done: string | null; status: string }
interface OpenTask { id: string; code: string; title: string; status: string; priority: string; due_at: string }

interface Prefill {
  primary_metric: string | null;
  target: number | null;
  direction: 'Higher is better' | 'Lower is better' | null;
  unit: string | null;
  fixed: FixedItem[];
  open_tasks: OpenTask[];
  suggested_top3: string[];
}

const REACTIVE_CHIPS = ['Client escalation', 'Internal request', 'Systems down', 'Meeting overrun'];

export function DayCloseForm({
  personName, today, prefill, existing, teammates, windowCloseISO, kudosToday,
}: {
  personName: string;
  today: string;
  prefill: Prefill;
  existing: Record<string, unknown> | null;
  teammates: { id: string; full_name: string; department: string }[];
  windowCloseISO: string;
  kudosToday: { note: string; from: string }[];
}) {
  const draftKey = `day-close-${today}`;
  const openedAt = useRef(new Date().toISOString());
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [doneScreen, setDoneScreen] = useState<{ streak: number } | null>(null);

  const [ticked, setTicked] = useState<string[]>(
    prefill.fixed.filter((f) => f.status === 'Completed').map((f) => f.id),
  );
  const [actual, setActual] = useState<string>('');
  const [pills, setPills] = useState<Record<string, string>>({});
  const [reactive, setReactive] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [blocked, setBlocked] = useState(false);
  const [blockerDesc, setBlockerDesc] = useState('');
  const [unblockerId, setUnblockerId] = useState('');
  const [severity, setSeverity] = useState<'Low' | 'Medium' | 'High'>('Medium');
  const [top3, setTop3] = useState<string[]>([
    prefill.suggested_top3[0] ?? '', prefill.suggested_top3[1] ?? '', prefill.suggested_top3[2] ?? '',
  ]);

  // Restore any draft: nothing typed is ever lost
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (d.actual !== undefined) setActual(d.actual);
      if (d.reactive !== undefined) setReactive(d.reactive);
      if (d.tags) setTags(d.tags);
      if (d.blocked !== undefined) setBlocked(d.blocked);
      if (d.blockerDesc) setBlockerDesc(d.blockerDesc);
      if (d.unblockerId) setUnblockerId(d.unblockerId);
      if (d.top3) setTop3(d.top3);
      if (d.ticked) setTicked((prev) => [...new Set([...prev, ...d.ticked])]);
      if (d.pills) setPills(d.pills);
    } catch { /* a broken draft never blocks the form */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const draft = { actual, reactive, tags, blocked, blockerDesc, unblockerId, top3, ticked, pills };
    try { localStorage.setItem(draftKey, JSON.stringify(draft)); } catch { /* full storage is fine */ }
  }, [actual, reactive, tags, blocked, blockerDesc, unblockerId, top3, ticked, pills, draftKey]);

  const target = prefill.target;
  const ringPct = useMemo(() => {
    const a = parseFloat(actual);
    if (!target || Number.isNaN(a)) return 0;
    if (prefill.direction === 'Lower is better') return a === 0 ? 1 : Math.min(1, target / a);
    return Math.min(1, a / target);
  }, [actual, target, prefill.direction]);

  function submit() {
    setError(null);
    start(async () => {
      const res = await submitDayClose({
        close_date: today,
        fixed_done_task_ids: ticked,
        actual: actual === '' ? null : Number(actual),
        reactive_hours: reactive,
        reactive_tags: tags,
        blocker: blocked
          ? { description: blockerDesc, unblocker_id: unblockerId, severity }
          : null,
        top_3_tomorrow: top3.filter((t) => t.trim() !== ''),
        assigned_status_changes: Object.entries(pills).map(([task_id, status]) => ({
          task_id, status: status as 'On Track' | 'At Risk' | 'Completed',
        })),
        opened_at: openedAt.current,
      });
      if (!res.ok) { setError('error' in res ? res.error : 'Something refused the submit.'); return; }
      localStorage.removeItem(draftKey);
      setDoneScreen({ streak: res.streak });
    });
  }

  if (existing && !doneScreen) {
    return (
      <Card><CardBody className="text-center py-8 space-y-2">
        <p className="font-display text-scale-2 font-semibold">Today is closed.</p>
        <p className="text-scale-4 text-ink-muted">
          Edits stay open until 09:00 tomorrow; after that your manager can unlock it.
        </p>
      </CardBody></Card>
    );
  }

  if (doneScreen) {
    return (
      <Card><CardBody className="text-center py-10 space-y-3">
        <p className="font-display text-scale-1 font-bold text-on-target">Day closed.</p>
        <p className="text-scale-3">
          {doneScreen.streak} day{doneScreen.streak === 1 ? '' : 's'} in a row.
        </p>
        {kudosToday.map((k, i) => (
          <p key={i} className="text-scale-4 text-ink">💛 {k.from}: “{k.note}”</p>
        ))}
        <Button variant="secondary" onClick={() => router.push('/my-day')}>Back to My Day</Button>
      </CardBody></Card>
    );
  }

  return (
    <div className="space-y-4 pb-16">
      <div className="flex justify-end"><CloseCountdown deadline={windowCloseISO} /></div>

      {/* 1 · Fixed work — tap-to-tick; the count fills itself */}
      <Card>
        <CardBody>
          <SectionTitle n={1} title="Fixed work" meta={`${ticked.length}/${prefill.fixed.length}`} />
          {prefill.fixed.length === 0 ? (
            <p className="text-scale-5 text-ink-muted">No fixed duties today.</p>
          ) : (
            <ul className="space-y-1">
              {prefill.fixed.map((f) => {
                const on = ticked.includes(f.id);
                return (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => setTicked((prev) => on ? prev.filter((x) => x !== f.id) : [...prev, f.id])}
                      className="flex w-full items-start gap-3 rounded px-2 py-2 text-left hover:bg-paper"
                      role="checkbox" aria-checked={on}
                    >
                      <span className={cn(
                        'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border',
                        on ? 'bg-on-target border-on-target text-white' : 'border-steel-300',
                      )}>{on ? '✓' : ''}</span>
                      <span className="min-w-0">
                        <span className={cn('block text-scale-4', on && 'text-ink-muted line-through')}>{f.title}</span>
                        {f.definition_of_done ? (
                          <span className="block text-scale-6 text-ink-muted">{f.definition_of_done}</span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* 2 · Your number — single field, live ring */}
      <Card>
        <CardBody>
          <SectionTitle
            n={2} title="Your number"
            meta={prefill.primary_metric ? `${prefill.primary_metric} · target ${fmtTarget(target, prefill.unit)}` : 'No primary KPI set'}
          />
          {prefill.primary_metric ? (
            <div className="flex items-center gap-4">
              <input
                type="number" inputMode="decimal" step="any" min="0"
                value={actual}
                onChange={(e) => setActual(e.target.value)}
                placeholder="0"
                aria-label={`${prefill.primary_metric} actual`}
                className="h-14 w-36 rounded hairline bg-surface px-3 text-scale-1 font-display font-semibold tabular"
              />
              <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden>
                <circle cx="28" cy="28" r="24" fill="none" stroke="var(--hairline)" strokeWidth="6" />
                <circle
                  cx="28" cy="28" r="24" fill="none" stroke="var(--on-target)" strokeWidth="6"
                  strokeLinecap="round" strokeDasharray={`${2 * Math.PI * 24 * ringPct} ${2 * Math.PI * 24}`}
                  transform="rotate(-90 28 28)"
                  style={{ transition: 'stroke-dasharray 150ms ease-out' }}
                />
              </svg>
              <span className="tabular text-scale-4 text-ink-muted">{Math.round(ringPct * 100)}%</span>
            </div>
          ) : (
            <p className="text-scale-5 text-ink-muted">Ask your manager to mark one KPI as primary.</p>
          )}
        </CardBody>
      </Card>

      {/* 3 · Assigned work — pills update the real tasks */}
      <Card>
        <CardBody>
          <SectionTitle n={3} title="Assigned work" meta={`${prefill.open_tasks.length} open`} />
          {prefill.open_tasks.length === 0 ? (
            <p className="text-scale-5 text-ink-muted">Nothing assigned and open.</p>
          ) : (
            <ul className="space-y-2">
              {prefill.open_tasks.map((t) => {
                const current = pills[t.id] ?? (['On Track', 'At Risk', 'Completed'].includes(t.status) ? t.status : 'On Track');
                return (
                  <li key={t.id} className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-scale-4">{t.title}</span>
                    <div role="radiogroup" aria-label={`${t.title} status`} className="flex gap-1">
                      {(['On Track', 'At Risk', 'Completed'] as const).map((s) => (
                        <button
                          key={s} type="button" role="radio" aria-checked={current === s}
                          onClick={() => setPills((p) => ({ ...p, [t.id]: s }))}
                          className={cn(
                            'rounded border px-2 py-1 text-scale-6 font-medium',
                            current === s
                              ? s === 'At Risk'
                                ? 'border-behind bg-behind/10 text-behind'
                                : 'border-on-target bg-on-target/10 text-on-target'
                              : 'border-[--hairline] text-ink-muted hover:bg-paper',
                          )}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* 4 · Reactive hours — stepper + chips */}
      <Card>
        <CardBody>
          <SectionTitle n={4} title="Reactive hours" meta="what pulled you off plan" />
          <div className="flex items-center gap-3">
            <Button type="button" variant="secondary" size="sm" aria-label="less"
              onClick={() => setReactive((r) => Math.max(0, r - 0.5))}>−</Button>
            <span className="tabular w-14 text-center text-scale-2 font-display font-semibold">{reactive}</span>
            <Button type="button" variant="secondary" size="sm" aria-label="more"
              onClick={() => setReactive((r) => Math.min(24, r + 0.5))}>+</Button>
            <span className="text-scale-5 text-ink-muted">hours</span>
          </div>
          {reactive > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {REACTIVE_CHIPS.map((c) => {
                const on = tags.includes(c);
                return (
                  <button key={c} type="button"
                    onClick={() => setTags((t) => on ? t.filter((x) => x !== c) : [...t, c])}
                    className={cn(
                      'rounded border px-2.5 py-1 text-scale-6',
                      on ? 'border-steel-600 bg-steel-600/10 text-steel-600' : 'border-[--hairline] text-ink-muted',
                    )}>
                    {c}
                  </button>
                );
              })}
            </div>
          ) : null}
        </CardBody>
      </Card>

      {/* 5 · Blocked by anything? — default No */}
      <Card>
        <CardBody>
          <SectionTitle n={5} title="Blocked by anything?" />
          <div className="flex gap-2">
            {(['No', 'Yes'] as const).map((v) => (
              <button key={v} type="button"
                onClick={() => setBlocked(v === 'Yes')}
                aria-pressed={blocked === (v === 'Yes')}
                className={cn(
                  'rounded border px-4 py-1.5 text-scale-4 font-medium',
                  blocked === (v === 'Yes')
                    ? 'border-navy-900 bg-navy-900 text-white'
                    : 'border-[--hairline] text-ink-muted hover:bg-paper',
                )}>
                {v}
              </button>
            ))}
          </div>
          {blocked ? (
            <div className="mt-3 space-y-3">
              <textarea
                value={blockerDesc} onChange={(e) => setBlockerDesc(e.target.value)}
                placeholder="What is stopping you?"
                className="w-full rounded hairline bg-surface px-3 py-2 text-scale-4 min-h-[70px]"
              />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <select value={unblockerId} onChange={(e) => setUnblockerId(e.target.value)}
                  aria-label="Who can unblock"
                  className="h-10 rounded hairline bg-surface px-3 text-scale-4">
                  <option value="">Who can unblock?</option>
                  {teammates.map((t) => (
                    <option key={t.id} value={t.id}>{t.full_name} · {t.department}</option>
                  ))}
                </select>
                <select value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)}
                  aria-label="Severity"
                  className="h-10 rounded hairline bg-surface px-3 text-scale-4">
                  <option>Low</option><option>Medium</option><option>High</option>
                </select>
              </div>
              <GuardNote>
                Submitting starts a 24-hour clock, tells them now, and copies both managers.
                Raising a blocker counts for you, never against you.
              </GuardNote>
            </div>
          ) : null}
        </CardBody>
      </Card>

      {/* 6 · Top 3 for tomorrow — pre-seeded */}
      <Card>
        <CardBody>
          <SectionTitle n={6} title="Top 3 for tomorrow" meta="becomes tomorrow's My Day" />
          <div className="space-y-2">
            {top3.map((t, i) => (
              <input key={i} value={t}
                onChange={(e) => setTop3((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                placeholder={`${i + 1}.`}
                className="h-10 w-full rounded hairline bg-surface px-3 text-scale-4"
              />
            ))}
          </div>
        </CardBody>
      </Card>

      {error ? <p className="text-scale-4 text-attention" role="alert">{error}</p> : null}

      <Button className="w-full" size="lg" disabled={pending || (blocked && (!blockerDesc.trim() || !unblockerId))}
        onClick={submit}>
        {pending ? 'Closing…' : `Submit ${personName.split(' ')[0]}'s day`}
      </Button>
    </div>
  );
}

function SectionTitle({ n, title, meta }: { n: number; title: string; meta?: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-2">
      <h2 className="font-display text-scale-3 font-semibold">
        <span className="text-ink-muted mr-1.5">{n}</span>{title}
      </h2>
      {meta ? <span className="text-scale-6 text-ink-muted">{meta}</span> : null}
    </div>
  );
}

function fmtTarget(target: number | null, unit: string | null): string {
  if (target === null) return '—';
  if (unit === '%') return `${Math.round(target * 100)}%`;
  if (unit === 'INR') return `₹${target.toLocaleString('en-IN')}`;
  return String(target);
}
