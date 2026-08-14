'use server';
/**
 * People lifecycle (§8): the add wizard, access changes, leave, and the
 * Handover wizard — the feature that stops the system rotting. Deactivation
 * is blocked by the database until every open item is placed; this action
 * places them, then flips the switch, then revokes login.
 */
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireSession } from '@/lib/session';
import { addPersonSchema, handoverSchema } from '@/lib/schemas';
import { canManagePeople, canDeactivate } from '@/lib/permissions';
import { notify } from '@/lib/notify';
import { todayLocalISO } from '@/lib/dates';
import type { ActionResult } from './tasks';

export async function addPerson(raw: unknown): Promise<ActionResult<{ person_id: string }>> {
  const parsed = addPersonSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0].message };
  const input = parsed.data;

  const { actor } = await requireSession();
  if (!canManagePeople(actor)) return { ok: false, error: 'Adding people needs people_admin (or the Owner).' };

  const supabase = supabaseServer();
  const settling = new Date();
  settling.setDate(settling.getDate() + 14); // 14-day grace: "Settling in"

  const { data: person, error } = await supabase.from('people').insert({
    full_name: input.full_name,
    email: input.email.toLowerCase(),
    phone: input.phone ?? null,
    department: input.department,
    designation: input.designation,
    reports_to_id: input.reports_to_id,
    joined_on: input.joined_on,
    access_role: input.access_role,
    capabilities: input.capabilities,
    daily_capacity_hours: input.daily_capacity_hours,
    wip_limit_p1: input.wip_limit_p1,
    settling_in_until: settling.toISOString().slice(0, 10),
  }).select('id, employee_code').single();
  if (error) return { ok: false, error: error.message };

  // Charter shell so duties can be added right away
  await supabase.from('charters').insert({ person_id: person.id, reviewed_on: todayLocalISO() });

  // Welcome mail with a magic link (Supabase invite covers the link itself)
  const admin = supabaseAdmin();
  await admin.auth.admin.inviteUserByEmail(input.email.toLowerCase(), {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/auth/callback`,
  }).catch(() => undefined); // mail config may be absent locally

  revalidatePath('/people');
  return { ok: true, person_id: person.id };
}

export async function updateAccess(
  personId: string,
  patch: { access_role?: string; capabilities?: string[]; reports_to_id?: string },
): Promise<ActionResult> {
  const { actor } = await requireSession();
  if (!canManagePeople(actor)) return { ok: false, error: 'Access changes need people_admin (or the Owner).' };
  const supabase = supabaseServer();
  const { error } = await supabase.from('people').update(patch).eq('id', personId);
  if (error) return { ok: false, error: error.message };

  // Re-parenting reroutes pending approvals to the new shared-manager reality (§8.2)
  if (patch.reports_to_id) {
    await supabase.from('approvals')
      .update({ approver_id: patch.reports_to_id })
      .eq('requested_by_id', personId).eq('decision', 'Pending')
      .eq('subject_type', 'task_approval');
  }
  revalidatePath('/people');
  return { ok: true };
}

export async function recordLeave(
  personId: string, startsOn: string, endsOn: string, coverPersonId?: string,
): Promise<ActionResult> {
  const { person } = await requireSession();
  const supabase = supabaseServer();
  const { error } = await supabase.from('leaves').insert({
    person_id: personId, starts_on: startsOn, ends_on: endsOn,
    cover_person_id: coverPersonId ?? null, created_by_id: person.id,
  });
  if (error) return { ok: false, error: error.message };
  await supabase.from('people').update({ status: 'On Leave' })
    .eq('id', personId).eq('status', 'Active');
  revalidatePath('/people');
  return { ok: true };
}

/**
 * §8.3 — the Handover wizard commits every placement, then deactivates.
 * Runs on the service client so system semantics apply (ownership transfers
 * reset delegation chains); the database's footprint check still gates the
 * final flip, so a missed item aborts before anything is lost.
 */
export async function executeHandover(raw: unknown): Promise<ActionResult<{ summary: string }>> {
  const parsed = handoverSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0].message };
  const input = parsed.data;

  const { actor, person: executor } = await requireSession();
  if (!canDeactivate(actor, { id: input.from_person_id })) {
    return { ok: false, error: 'Deactivation needs people_admin (or the Owner), and never on yourself.' };
  }

  const admin = supabaseAdmin();
  const { data: leaver } = await admin.from('people')
    .select('id, full_name, reports_to_id, auth_user_id, department')
    .eq('id', input.from_person_id).single();
  if (!leaver) return { ok: false, error: 'Person not found.' };

  // 1 · Open tasks they own → reassign or drop
  for (const move of input.task_moves) {
    if (move.action === 'reassign' && move.to_person_id) {
      const { error } = await admin.from('tasks')
        .update({ owner_id: move.to_person_id }).eq('id', move.task_id);
      if (error) return { ok: false, error: `Task move failed: ${error.message}` };
    } else {
      const { error } = await admin.from('tasks')
        .update({ status: 'Dropped', drop_reason: move.reason ?? `Dropped in ${leaver.full_name}'s handover` })
        .eq('id', move.task_id);
      if (error) return { ok: false, error: `Task drop failed: ${error.message}` };
    }
  }

  // 2 · Support seats → remove or swap
  for (const swap of input.support_swaps) {
    await admin.from('task_participants')
      .update({ removed_at: new Date().toISOString(), removed_reason: 'Handover' })
      .eq('id', swap.participant_id);
    if (swap.action === 'swap' && swap.to_person_id) {
      const { data: seat } = await admin.from('task_participants')
        .select('task_id, support_role').eq('id', swap.participant_id).single();
      if (seat) {
        await admin.from('task_participants').insert({
          task_id: seat.task_id, person_id: swap.to_person_id,
          support_role: seat.support_role, added_by_id: executor.id,
        });
      }
    }
  }

  // 3 · Tasks they assigned that are still open → accountability to their manager
  if (leaver.reports_to_id) {
    await admin.from('tasks')
      .update({ accountable_id: leaver.reports_to_id })
      .eq('accountable_id', leaver.id)
      .not('status', 'in', '("Completed","Dropped","Declined","Missed")');
    await admin.from('tasks')
      .update({ assigned_by_id: leaver.reports_to_id })
      .eq('assigned_by_id', leaver.id)
      .eq('status', 'Awaiting Acceptance');
    await admin.from('tasks')
      .update({ pending_with_id: leaver.reports_to_id })
      .eq('pending_with_id', leaver.id)
      .eq('status', 'Awaiting Acceptance');
  }

  // 4 · Blockers pointing at them — a blocker aimed at a deactivated person
  //     is invisible failure, so every one must be re-aimed
  for (const move of input.blocker_moves) {
    const { error } = await admin.from('blockers')
      .update({ unblocker_id: move.to_person_id }).eq('id', move.blocker_id);
    if (error) return { ok: false, error: `Blocker move failed: ${error.message}` };
  }

  // 5 · Charter duties → another person's charter, or Suspended (a deliberate
  //     red gap on the department view)
  let suspended = 0;
  for (const move of input.duty_moves) {
    if (move.action === 'reassign' && move.to_person_id) {
      let { data: charter } = await admin.from('charters')
        .select('id').eq('person_id', move.to_person_id).single();
      if (!charter) {
        const created = await admin.from('charters')
          .insert({ person_id: move.to_person_id }).select('id').single();
        charter = created.data;
      }
      const { error } = await admin.from('charter_tasks')
        .update({ charter_id: charter!.id }).eq('id', move.charter_task_id);
      if (error) return { ok: false, error: `Duty move failed: ${error.message}` }; // 5-duty ceiling can fire here
    } else {
      suspended += 1;
      await admin.from('charter_tasks')
        .update({ active: false, suspended_reason: 'Suspended — no owner' })
        .eq('id', move.charter_task_id);
    }
  }

  // 6 · KPIs → transfer (close + recreate on the recipient) or close
  for (const move of input.kpi_moves) {
    const { data: kpi } = await admin.from('kpis').select('*').eq('id', move.kpi_id).single();
    if (!kpi) continue;
    await admin.from('kpis')
      .update({ effective_to: todayLocalISO(), active: false, is_primary: false })
      .eq('id', move.kpi_id);
    if (move.action === 'transfer' && move.to_person_id) {
      const { error } = await admin.from('kpis').insert({
        person_id: move.to_person_id, metric: kpi.metric, unit: kpi.unit,
        target_type: kpi.target_type, direction: kpi.direction,
        daily_target: kpi.daily_target, review_cadence: kpi.review_cadence,
        is_primary: false, effective_from: todayLocalISO(),
      });
      if (error) return { ok: false, error: `KPI transfer failed: ${error.message}` }; // 4-KPI ceiling can fire here
    }
  }

  // 7 · Pending approvals where they decide → new approver
  for (const move of input.approval_moves) {
    await admin.from('approvals').update({ approver_id: move.to_person_id })
      .eq('id', move.approval_id).eq('decision', 'Pending');
  }

  // 8 · Direct reports must be re-parented before the wizard will finish
  for (const move of input.report_moves) {
    const { error } = await admin.from('people')
      .update({ reports_to_id: move.new_manager_id }).eq('id', move.person_id);
    if (error) return { ok: false, error: `Re-parenting failed: ${error.message}` };
  }

  // 9 · The flip — the trigger re-checks the whole footprint structurally
  const { error: deactErr } = await admin.from('people')
    .update({ status: 'Deactivated', deactivated_on: todayLocalISO() })
    .eq('id', leaver.id);
  if (deactErr) return { ok: false, error: deactErr.message };

  // 10 · Login revoked instantly
  if (leaver.auth_user_id) {
    await admin.auth.admin.updateUserById(leaver.auth_user_id, { ban_duration: '87600h' })
      .catch(() => undefined);
  }

  // 11 · One handover record + the department feed summary
  const movedTasks = input.task_moves.filter((m) => m.action === 'reassign').length;
  const movedDuties = input.duty_moves.filter((m) => m.action === 'reassign').length;
  const recipients = new Set([
    ...input.task_moves.map((m) => m.to_person_id),
    ...input.duty_moves.map((m) => m.to_person_id),
  ].filter(Boolean) as string[]);
  const { data: names } = recipients.size
    ? await admin.from('people').select('full_name').in('id', [...recipients])
    : { data: [] as { full_name: string }[] };
  const toText = (names ?? []).map((n) => n.full_name).join(', ') || 'the team';
  const when = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const summary =
    `${leaver.full_name}'s ${movedTasks} open task${movedTasks === 1 ? '' : 's'} and ` +
    `${movedDuties} fixed dut${movedDuties === 1 ? 'y' : 'ies'} moved to ${toText} on ${when}.` +
    (suspended > 0 ? ` ${suspended} dut${suspended === 1 ? 'y is' : 'ies are'} unassigned.` : '');

  await admin.from('handovers').insert({
    from_person_id: leaver.id,
    to_person_id: [...recipients][0] ?? null,
    task_ids: input.task_moves.map((m) => m.task_id),
    charter_items: input.duty_moves.map((m) => m.charter_task_id),
    kpi_items: input.kpi_moves.map((m) => m.kpi_id),
    blocker_ids: input.blocker_moves.map((m) => m.blocker_id),
    detail: input as unknown as Record<string, unknown>,
    summary,
    executed_by_id: executor.id,
  });
  await admin.from('announcements').insert({
    author_id: executor.id, body: summary, department: leaver.department, pinned: false,
  });
  for (const pid of recipients) {
    await notify({
      personId: pid, kind: 'handover_affecting_you',
      payload: { from: leaver.full_name, summary },
      emailSubject: `Handover: work moved to you from ${leaver.full_name}`,
      emailBody: summary,
    });
  }

  revalidatePath('/people');
  revalidatePath('/board');
  return { ok: true, summary };
}
