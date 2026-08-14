import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { notify } from '@/lib/notify';
import { authorizeCron, logCronRun } from '../_lib';

export const dynamic = 'force-dynamic';

/**
 * Hourly sweep — the clocks that make criterion 3 true:
 *  - Blockers: 12h unanswered → nudge the unblocker; 24h → auto-escalate to
 *    their manager AND the Owner, visibly to the raiser. Not optional.
 *  - Peer requests: 12h → nudge; 24h → surface on the shared manager's board.
 *  - Overdue tasks: one email, once.
 *  - Due-tomorrow tasks: in-app note.
 */
export async function GET(request: Request) {
  const unauthorized = authorizeCron(request);
  if (unauthorized) return unauthorized;

  const admin = supabaseAdmin();
  const now = new Date();
  const nowISO = now.toISOString();
  const counters = { nudged: 0, escalated: 0, requestNudges: 0, requestSurfaced: 0, overdueMails: 0, dueTomorrow: 0 };

  // ── Blockers ─────────────────────────────────────────────────────────────
  const { data: openBlockers } = await admin.from('blockers')
    .select('*, unblocker:people!blockers_unblocker_id_fkey(id, full_name, reports_to_id, access_role), raiser:people!blockers_raised_by_id_fkey(id, full_name)')
    .is('resolved_at', null);

  for (const b of openBlockers ?? []) {
    const unblocker = b.unblocker as { id: string; full_name: string; reports_to_id: string | null; access_role: string };
    const raiser = b.raiser as { id: string; full_name: string };
    const twelveHoursIn = new Date(new Date(b.raised_at).getTime() + 12 * 3_600_000);

    if (!b.first_response_at && !b.nudged_at && now >= twelveHoursIn) {
      await admin.from('blockers').update({ nudged_at: nowISO }).eq('id', b.id).is('nudged_at', null);
      await notify({
        personId: unblocker.id, kind: 'blocker_raised_on_you',
        payload: { blocker_id: b.id, nudge: true },
        emailSubject: `Still waiting: ${raiser.full_name} is blocked on you`,
        emailBody: `"${b.description}"\n\n12 hours gone, 12 left on the clock. One tap — "I've got this" — stops the escalation.`,
        isP1Escalation: b.severity === 'High',
      });
      counters.nudged += 1;
    }

    if (!b.escalated_at && new Date(b.sla_due_at) <= now) {
      // Manager is the one blocked and reports to nobody → straight to the
      // founder view with no extra wait (§15)
      const escalateTo = unblocker.reports_to_id;
      const { data: owners } = await admin.from('people')
        .select('id').eq('access_role', 'Owner').neq('status', 'Deactivated');
      const targets = new Set<string>([...(owners ?? []).map((o) => o.id)]);
      if (escalateTo) targets.add(escalateTo);

      await admin.from('blockers').update({
        escalated_at: nowISO, escalated_to_id: escalateTo ?? [...targets][0] ?? null,
      }).eq('id', b.id).is('escalated_at', null);

      for (const pid of targets) {
        await notify({
          personId: pid, kind: 'blocker_escalated',
          payload: { blocker_id: b.id, unblocker: unblocker.full_name, raiser: raiser.full_name },
          emailSubject: `Escalation: a blocker sat 24h with ${unblocker.full_name}`,
          emailBody: `${raiser.full_name} raised: "${b.description}"\n\nNo response inside the SLA. It is now on your plate.`,
          isP1Escalation: true,
        });
      }
      // The raiser sees the system carried it — they did not have to chase
      await notify({
        personId: raiser.id, kind: 'blocker_escalated',
        payload: { blocker_id: b.id, carried: true },
      });
      counters.escalated += 1;
    }
  }

  // ── Peer / cross-department requests ─────────────────────────────────────
  const { data: pendingRequests } = await admin.from('tasks')
    .select('id, task_code, title, respond_by, request_nudged_at, pending_with_id, assigned_by_id, owner_id')
    .eq('status', 'Awaiting Acceptance').not('respond_by', 'is', null);

  for (const r of pendingRequests ?? []) {
    if (!r.pending_with_id) continue;
    const overBy = now.getTime() - new Date(r.respond_by!).getTime();
    if (overBy >= 0 && !r.request_nudged_at) {
      await admin.from('tasks').update({ request_nudged_at: nowISO }).eq('id', r.id);
      await notify({
        personId: r.pending_with_id, kind: 'peer_request_received',
        payload: { task_id: r.id, nudge: true, title: r.title },
        emailSubject: `Unanswered request: ${r.title}`,
        emailBody: 'It has waited its full clock. Accept, decline with a reason, or counter-propose.',
      });
      counters.requestNudges += 1;
    } else if (overBy >= 12 * 3_600_000 && r.request_nudged_at) {
      // 24h total: shared manager's dashboard — "Unanswered peer request"
      const { data: shared } = await admin.rpc('chain_of', { pid: r.pending_with_id });
      const managerId = (shared as string[] | null)?.[0];
      if (managerId) {
        const { data: already } = await admin.from('notifications')
          .select('id').eq('person_id', managerId).eq('kind', 'unanswered_peer_request')
          .contains('payload', { task_id: r.id }).limit(1);
        if (!already?.length) {
          await notify({
            personId: managerId, kind: 'unanswered_peer_request',
            payload: { task_id: r.id, task_code: r.task_code, title: r.title },
          });
          counters.requestSurfaced += 1;
        }
      }
    }
  }

  // ── Overdue (email once) and due-tomorrow (in-app) ───────────────────────
  const { data: overdue } = await admin.from('tasks')
    .select('id, task_code, title, owner_id, due_at')
    .lt('due_at', nowISO)
    .not('status', 'in', '("Completed","Dropped","Declined","Missed","Awaiting Acceptance")')
    .neq('task_type', 'Fixed');
  for (const t of overdue ?? []) {
    const { data: already } = await admin.from('notifications')
      .select('id').eq('person_id', t.owner_id).eq('kind', 'task_overdue')
      .contains('payload', { task_id: t.id }).limit(1);
    if (already?.length) continue;
    await notify({
      personId: t.owner_id, kind: 'task_overdue',
      payload: { task_id: t.id, task_code: t.task_code },
      emailSubject: `Overdue: ${t.title}`,
      emailBody: `${t.task_code} passed its due date. Move it, renegotiate the date, or drop it with a reason — anything over 8 days is dead.`,
    });
    counters.overdueMails += 1;
  }

  const tomorrowStart = new Date(now.getTime() + 24 * 3_600_000);
  const dayAfter = new Date(now.getTime() + 48 * 3_600_000);
  const { data: dueSoon } = await admin.from('tasks')
    .select('id, task_code, title, owner_id')
    .gte('due_at', tomorrowStart.toISOString()).lt('due_at', dayAfter.toISOString())
    .not('status', 'in', '("Completed","Dropped","Declined","Missed")')
    .neq('task_type', 'Fixed');
  for (const t of dueSoon ?? []) {
    const { data: already } = await admin.from('notifications')
      .select('id').eq('person_id', t.owner_id).eq('kind', 'task_due_tomorrow')
      .contains('payload', { task_id: t.id }).limit(1);
    if (already?.length) continue;
    await notify({
      personId: t.owner_id, kind: 'task_due_tomorrow',
      payload: { task_id: t.id, task_code: t.task_code, title: t.title },
    });
    counters.dueTomorrow += 1;
  }

  await logCronRun('sla-sweep', counters);
  return NextResponse.json(counters);
}
