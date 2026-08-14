import Link from 'next/link';
import { requireSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase/server';
import { computeRings, achievementPct, isOverdue } from '@/lib/compute';
import { todayLocalISO, formatDayLong, daysLeft } from '@/lib/dates';
import { FiveRings } from '@/components/five-rings';
import { Card, CardBody, CardHeader, CardTitle, EmptyState, Button } from '@/components/ui';
import { StatusPill, FlagChip, PriorityMark } from '@/components/status';
import { CloseCountdown, SlaClock } from '@/components/countdown';
import { taskFlag } from '@/lib/compute';
import { TickDuty, InboxRequestActions, InboxAskActions, InboxApprovalActions, GotThisButton } from './parts';

export const metadata = { title: 'My Day' };
export const dynamic = 'force-dynamic';

export default async function MyDayPage() {
  const { person, settings } = await requireSession();
  const supabase = supabaseServer();
  const today = todayLocalISO();

  const [fixedRes, openRes, closeRes, inboxRes, approvalsRes, blockersRes, asksRes, announceRes] =
    await Promise.all([
      supabase.from('tasks').select('id, title, description, status')
        .eq('owner_id', person.id).eq('task_type', 'Fixed').eq('spawn_date', today)
        .order('created_at'),
      supabase.from('tasks').select('*')
        .eq('owner_id', person.id).neq('task_type', 'Fixed')
        .not('status', 'in', '("Completed","Dropped","Declined","Missed","Awaiting Acceptance")')
        .order('due_at').limit(30),
      supabase.from('day_close').select('id, top_3_tomorrow, actual, target, direction, fixed_tasks_done, fixed_tasks_due')
        .eq('person_id', person.id).order('close_date', { ascending: false }).limit(2),
      supabase.from('tasks').select('id, task_code, title, assigned_by_id, due_at, respond_by, urgent, origin_verb, proposed_due_at, counter_note, people!tasks_assigned_by_id_fkey(full_name)')
        .eq('pending_with_id', person.id).eq('status', 'Awaiting Acceptance'),
      supabase.from('approvals').select('id, context, requested_by_id, respond_by, created_at, people!approvals_requested_by_id_fkey(full_name)')
        .eq('approver_id', person.id).eq('decision', 'Pending'),
      supabase.from('blockers').select('id, description, raised_by_id, sla_due_at, severity, first_response_at, people!blockers_raised_by_id_fkey(full_name)')
        .eq('unblocker_id', person.id).is('resolved_at', null),
      supabase.from('asks').select('id, body, from_person_id, created_at, people!asks_from_person_id_fkey(full_name)')
        .eq('to_person_id', person.id).eq('status', 'Open'),
      supabase.from('announcements').select('id, body, ack_required, created_at, announcement_acks(person_id)')
        .eq('pinned', true).order('created_at', { ascending: false }).limit(3),
    ]);

  const fixed = fixedRes.data ?? [];
  const open = openRes.data ?? [];
  const closes = closeRes.data ?? [];
  const todayClose = closes.find(() => true); // most recent; today if submitted
  const submittedToday = !!(closes.length && (closes[0] as { id: string } & Record<string, unknown>));
  const { count: submittedCount } = await supabase.from('day_close')
    .select('id', { count: 'exact', head: true })
    .eq('person_id', person.id).eq('close_date', today);
  const hasClosedToday = (submittedCount ?? 0) > 0;

  const dueToday = open.filter((t) => daysLeft(t.due_at) === 0);
  const overdue = open.filter((t) => isOverdue(t.due_at, t.status));
  const fixedDone = fixed.filter((f) => f.status === 'Completed').length;
  const openBlockersPastSla = (blockersRes.data ?? []).filter((b) => b.sla_due_at < new Date().toISOString()).length;

  const lastClose = hasClosedToday ? closes[1] : closes[0];
  const achievement = todayClose
    ? achievementPct(todayClose.actual, todayClose.target, todayClose.direction ?? 'Higher is better')
    : null;
  const rings = computeRings({
    submitted: hasClosedToday,
    fixedDone, fixedDue: fixed.length,
    achievement: hasClosedToday ? achievement : null,
    assignedOpen: open.length,
    assignedOverdue: overdue.length,
    blockersPastSla: openBlockersPastSla,
  });
  const diagnostic = !!settings.diagnostic_until && settings.diagnostic_until >= today;
  const nowMin = new Date(new Date().getTime() + 330 * 60_000);
  const afterOpen = nowMin.getUTCHours() >= parseInt(settings.window_open.slice(0, 2), 10);
  const closeDeadline = `${today}T${settings.window_close.length === 5 ? settings.window_close + ':00' : settings.window_close}+05:30`;

  const inboxCount =
    (inboxRes.data?.length ?? 0) + (approvalsRes.data?.length ?? 0) +
    (blockersRes.data?.length ?? 0) + (asksRes.data?.length ?? 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-scale-1 font-bold">
            {greeting()} {person.full_name.split(' ')[0]}
          </h1>
          <p className="text-scale-4 text-ink-muted">{formatDayLong(today)}</p>
        </div>
        <div className="flex items-center gap-3">
          {afterOpen && !hasClosedToday ? <CloseCountdown deadline={closeDeadline} /> : null}
          <Link href="/assign"><Button variant="secondary" size="sm">New task</Button></Link>
          <Link href="/assign?mode=ask"><Button variant="secondary" size="sm">Ask someone</Button></Link>
          <Link href="/day-close">
            <Button size="sm">{hasClosedToday ? 'Edit my close' : 'Close my day'}</Button>
          </Link>
        </div>
      </div>

      {(announceRes.data ?? []).map((a) => (
        <div key={a.id} className="rounded-lg bg-navy-900 text-white px-4 py-3 text-scale-4 flex items-start justify-between gap-3">
          <p>{a.body}</p>
        </div>
      ))}

      <div className="grid gap-5 md:grid-cols-[auto_1fr]">
        <Card className="p-5 flex flex-col items-center justify-center gap-2">
          <FiveRings
            rings={rings}
            centre={achievement === null ? (hasClosedToday ? '—' : 'open') : `${Math.round(achievement * 100)}%`}
            diagnostic={diagnostic}
          />
          <div className="flex gap-3 text-scale-6 text-ink-muted">
            <span>Closed</span><span>Fixed</span><span>Target</span><span>Assigned</span><span>Clear</span>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Today&apos;s fixed work</CardTitle>
            <span className="tabular text-scale-5 text-ink-muted">{fixedDone}/{fixed.length}</span>
          </CardHeader>
          <CardBody className="p-0">
            {fixed.length === 0 ? (
              <EmptyState title="No fixed duties spawn today." hint="Charter items appear here each working morning." />
            ) : (
              <ul className="divide-y divide-[--hairline]">
                {fixed.map((f) => (
                  <TickDuty key={f.id} id={f.id} title={f.title}
                    definitionOfDone={f.description} done={f.status === 'Completed'} />
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {inboxCount > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Inbox</CardTitle>
            <span className="tabular text-scale-5 text-ink-muted">{inboxCount} waiting on you</span>
          </CardHeader>
          <CardBody className="p-0">
            <ul className="divide-y divide-[--hairline]">
              {(blockersRes.data ?? []).map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="h-2 w-2 rounded-full bg-blocked" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-scale-4">
                      <strong>{(b.people as unknown as { full_name: string } | null)?.full_name}</strong> is blocked: {b.description}
                    </p>
                    <SlaClock due={b.sla_due_at} />
                  </div>
                  <GotThisButton blockerId={b.id} responded={!!b.first_response_at} />
                </li>
              ))}
              {(inboxRes.data ?? []).map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="h-2 w-2 rounded-full bg-steel-600" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-scale-4">
                      <strong>{(r.people as unknown as { full_name: string } | null)?.full_name}</strong>
                      {r.origin_verb === 'Cross-department Request' ? ' requests your team: ' : ' asks you: '}
                      {r.title} {r.urgent ? <span className="text-behind font-semibold">· Urgent</span> : null}
                    </p>
                    {r.respond_by ? <SlaClock due={r.respond_by} /> : null}
                  </div>
                  <InboxRequestActions taskId={r.id} />
                </li>
              ))}
              {(approvalsRes.data ?? []).map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="h-2 w-2 rounded-full bg-behind" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-scale-4">
                      <strong>{(a.people as unknown as { full_name: string } | null)?.full_name}</strong> needs approval: {a.context}
                    </p>
                    {a.respond_by ? <SlaClock due={a.respond_by} /> : null}
                  </div>
                  <InboxApprovalActions approvalId={a.id} />
                </li>
              ))}
              {(asksRes.data ?? []).map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="h-2 w-2 rounded-full bg-steel-300" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-scale-4">
                      <strong>{(a.people as unknown as { full_name: string } | null)?.full_name}</strong> asks: {a.body}
                    </p>
                  </div>
                  <InboxAskActions askId={a.id} />
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Due today &amp; overdue</CardTitle>
          <Link href="/board" className="text-scale-5 text-steel-600 hover:underline">Board →</Link>
        </CardHeader>
        <CardBody className="p-0">
          {dueToday.length + overdue.length === 0 ? (
            <EmptyState
              title="Nothing assigned to you."
              hint="Add your own, or ask your manager for the next thing."
            />
          ) : (
            <ul className="divide-y divide-[--hairline]">
              {[...overdue, ...dueToday.filter((t) => !overdue.includes(t))].map((t) => (
                <li key={t.id}>
                  <Link href={`/tasks/${t.task_code}`} className="flex items-center gap-3 px-4 py-3 hover:bg-paper">
                    <PriorityMark priority={t.priority} />
                    <span className="min-w-0 flex-1 truncate text-scale-4">{t.title}</span>
                    <FlagChip flag={taskFlag(t.due_at, t.status)} />
                    <StatusPill status={t.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {lastClose?.top_3_tomorrow?.length ? (
        <Card>
          <CardHeader><CardTitle>Your top 3, from last night</CardTitle></CardHeader>
          <CardBody>
            <ol className="list-decimal space-y-1 pl-5 text-scale-4">
              {lastClose.top_3_tomorrow.map((t: string, i: number) => <li key={i}>{t}</li>)}
            </ol>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

function greeting() {
  const h = new Date(Date.now() + 330 * 60_000).getUTCHours();
  if (h < 12) return 'Good morning,';
  if (h < 17) return 'Good afternoon,';
  return 'Good evening,';
}
