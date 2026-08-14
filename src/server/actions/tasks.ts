'use server';
/**
 * The assignment engine (§6) and task lifecycle (§7) as server actions.
 * Zod at the boundary, lib/permissions before every write, RLS + triggers
 * underneath regardless — the UI is assumed bypassable.
 */
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { requireSession, chainOf } from '@/lib/session';
import {
  assignTaskSchema, respondToRequestSchema, taskStatusChangeSchema,
  type AssignTaskInput,
} from '@/lib/schemas';
import { canAssignTo } from '@/lib/permissions';
import { runAssignmentGuards, titleSimilarity, type GuardWarning } from '@/lib/guards';
import { notify } from '@/lib/notify';
import { todayLocalISO } from '@/lib/dates';
import type { AssignmentVerb, Person } from '@/lib/types';

export type ActionResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: string }
  | { ok: false; warnings: GuardWarning[]; verb: AssignmentVerb };

const IST = '+05:30';

/** Guard context for one target — §6.4, assembled server-side. */
async function gatherGuards(
  target: Person,
  input: AssignTaskInput,
  verb: AssignmentVerb,
  holidays: Set<string>,
  weeklyOff: number[],
): Promise<GuardWarning[]> {
  const supabase = supabaseServer();
  const dueDateISO = new Date(new Date(input.due_at).getTime() + 330 * 60_000)
    .toISOString().slice(0, 10);

  const [{ data: p1s }, { data: dueDayTasks }, { data: duties }, { data: leave }] =
    await Promise.all([
      supabase.from('tasks')
        .select('task_code, title, due_at')
        .eq('owner_id', target.id).eq('priority', 'P1 - Critical')
        .not('status', 'in', '("Completed","Dropped","Declined","Missed")'),
      supabase.from('tasks')
        .select('est_hours, due_at')
        .eq('owner_id', target.id)
        .not('status', 'in', '("Completed","Dropped","Declined","Missed")')
        .gte('due_at', `${dueDateISO}T00:00:00${IST}`)
        .lte('due_at', `${dueDateISO}T23:59:59${IST}`),
      supabase.from('charter_tasks')
        .select('title, charters!inner(person_id)')
        .eq('charters.person_id', target.id).eq('active', true),
      supabase.from('leaves')
        .select('ends_on')
        .eq('person_id', target.id)
        .lte('starts_on', dueDateISO).gte('ends_on', todayLocalISO())
        .order('ends_on', { ascending: false }).limit(1),
    ]);

  const charterMatch =
    (duties ?? []).find((d) => titleSimilarity(d.title, input.title) >= 0.8) ?? null;

  let managerName: string | null = null;
  if (leave?.[0] && target.reports_to_id) {
    const { data: mgr } = await supabase.from('people')
      .select('full_name').eq('id', target.reports_to_id).single();
    managerName = mgr?.full_name ?? null;
  }

  const offDayName = new Date(dueDateISO + 'T00:00:00Z')
    .toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' });

  return runAssignmentGuards({
    targetName: target.full_name,
    targetFirstName: target.full_name.split(' ')[0],
    openP1: (p1s ?? []).map((p) => ({ code: p.task_code as string, title: p.title as string, due_at: p.due_at as string })),
    wipLimitP1: target.wip_limit_p1,
    priority: input.priority,
    dueDateISO,
    dueAtISO: input.due_at,
    dueDayHours: (dueDayTasks ?? []).reduce((s, t) => s + (t.est_hours ?? 0), 0),
    estHours: input.est_hours ?? null,
    dailyCapacityHours: target.daily_capacity_hours,
    charterMatch,
    weeklyOff,
    holidays,
    offDayName,
    isPeerRequest: verb === 'Peer Request',
    onLeaveUntil: leave?.[0]?.ends_on ?? null,
    managerId: target.reports_to_id,
    managerName,
  });
}

export async function assignTask(raw: unknown): Promise<ActionResult<{ task_codes: string[] }>> {
  const parsed = assignTaskSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0].message };
  const input = parsed.data;

  const { actor, settings, holidays, person } = await requireSession();
  const supabase = supabaseServer();

  const { data: targets } = await supabase.from('people')
    .select('*').in('id', input.owner_ids);
  if (!targets || targets.length !== input.owner_ids.length) {
    return { ok: false, error: 'Could not load the people you picked.' };
  }

  // Verb per target from the §6.1 matrix — server-decided, never client-sent
  const verbs = new Map<string, AssignmentVerb>();
  for (const t of targets) {
    const chain = await chainOf(t.id);
    const verb = canAssignTo(actor, { id: t.id, department: t.department, status: t.status, chain });
    if (!verb) return { ok: false, error: `You cannot assign to ${t.full_name}.` };
    if (verb === 'Ask') {
      return { ok: false, error: `${t.full_name} is senior to you here — send an Ask instead (it never lands unasked).` };
    }
    verbs.set(t.id, verb);
  }

  // Fire the guards; unacknowledged warnings return to the UI as amber notes
  const allWarnings: GuardWarning[] = [];
  for (const t of targets) {
    const w = await gatherGuards(t as Person, input, verbs.get(t.id)!, holidays, settings.weekly_off);
    allWarnings.push(...w);
  }
  const unacknowledged = allWarnings.filter((w) => !input.acknowledged_guards.includes(w.code));
  if (unacknowledged.length > 0 && !input.override_reason) {
    return { ok: false, warnings: unacknowledged, verb: verbs.get(targets[0].id)! };
  }

  const batchId = targets.length > 1 ? crypto.randomUUID() : null;
  const codes: string[] = [];

  for (const t of targets) {
    const verb = verbs.get(t.id)!;
    const { data: task, error } = await supabase.from('tasks').insert({
      title: input.title,
      description: input.description || null,
      owner_id: t.id,
      accountable_id: person.id,
      department: t.department, // trigger re-derives; harmless
      priority: input.priority,
      status: verb === 'Direct' ? 'Not Started' : 'Awaiting Acceptance',
      assigned_by_id: person.id,
      due_at: input.due_at,
      est_hours: input.est_hours ?? null,
      linked_kpi_id: input.linked_kpi_id ?? null,
      parent_task_id: input.parent_task_id ?? null,
      visibility: input.visibility,
      batch_id: batchId,
      override_reason: allWarnings.length > 0 ? input.override_reason ?? null : null,
    }).select('id, task_code, pending_with_id').single();
    if (error) return { ok: false, error: error.message };
    codes.push(task.task_code);

    for (const s of input.support) {
      if (s.person_id === t.id) continue;
      await supabase.from('task_participants').insert({
        task_id: task.id, person_id: s.person_id, support_role: s.role,
        added_by_id: person.id,
      });
      await notify({
        personId: s.person_id, kind: 'added_as_support',
        payload: { task_id: task.id, task_code: task.task_code, title: input.title, role: s.role },
        emailSubject: `You're supporting: ${input.title}`,
        emailBody: `${person.full_name} added you as ${s.role} on ${task.task_code} "${input.title}".`,
      });
    }

    if (verb === 'Direct' && t.id !== person.id) {
      await notify({
        personId: t.id, kind: 'task_assigned',
        payload: { task_id: task.id, task_code: task.task_code, title: input.title, due_at: input.due_at },
        emailSubject: `New task from ${person.full_name}: ${input.title}`,
        emailBody: `${task.task_code} "${input.title}" is on your board, due soon. Open My Day to see it in place.`,
      });
    } else if (verb === 'Peer Request') {
      await notify({
        personId: t.id, kind: 'peer_request_received',
        payload: { task_id: task.id, task_code: task.task_code, title: input.title },
        emailSubject: `${person.full_name} is asking for your help: ${input.title}`,
        emailBody: `A peer request is waiting in your Inbox with a 12-hour clock. Accept, decline with a reason, or counter-propose.`,
      });
    } else if (verb === 'Cross-department Request' && task.pending_with_id) {
      await notify({
        personId: task.pending_with_id, kind: 'peer_request_received',
        payload: { task_id: task.id, task_code: task.task_code, title: input.title, cross_dept: true },
        emailSubject: `Cross-department request for your team: ${input.title}`,
        emailBody: `${person.full_name} is requesting work from your department. Assign it onward, pick someone else, or decline with a reason.`,
      });
    }
  }

  revalidatePath('/board');
  revalidatePath('/my-day');
  return { ok: true, task_codes: codes };
}

export async function respondToRequest(raw: unknown): Promise<ActionResult> {
  const parsed = respondToRequestSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0].message };
  const input = parsed.data;

  const { person } = await requireSession();
  const supabase = supabaseServer();

  const { data: task } = await supabase.from('tasks')
    .select('id, title, task_code, status, owner_id, assigned_by_id, pending_with_id, origin_verb, priority, est_hours')
    .eq('id', input.task_id).single();
  if (!task) return { ok: false, error: 'Request not found (or not yours to answer).' };
  if (task.pending_with_id !== person.id) {
    return { ok: false, error: 'This request is not waiting on you.' };
  }

  if (input.response === 'accept') {
    const { error } = await supabase.from('tasks')
      .update({ status: 'Not Started' }).eq('id', task.id);
    if (error) return { ok: false, error: error.message };
    await notify({
      personId: task.assigned_by_id, kind: 'request_accepted',
      payload: { task_id: task.id, task_code: task.task_code, title: task.title },
    });
    // Managers hear about it only when it is heavy (§6.1 ②)
    if (task.priority === 'P1 - Critical' || (task.est_hours ?? 0) > 4) {
      const [{ data: a }, { data: b }] = await Promise.all([
        supabase.from('people').select('reports_to_id').eq('id', task.owner_id).single(),
        supabase.from('people').select('reports_to_id').eq('id', task.assigned_by_id).single(),
      ]);
      for (const mgr of new Set([a?.reports_to_id, b?.reports_to_id].filter(Boolean) as string[])) {
        await notify({
          personId: mgr, kind: 'request_accepted',
          payload: { task_id: task.id, task_code: task.task_code, title: task.title, heavy: true },
        });
      }
    }
  } else if (input.response === 'decline') {
    const { error } = await supabase.from('tasks')
      .update({ status: 'Declined', declined_reason: input.declined_reason })
      .eq('id', task.id);
    if (error) return { ok: false, error: error.message };
    await notify({
      personId: task.assigned_by_id, kind: 'request_declined',
      payload: { task_id: task.id, task_code: task.task_code, title: task.title, reason: input.declined_reason },
    });
  } else {
    const { error } = await supabase.from('tasks').update({
      proposed_due_at: input.proposed_due_at ?? null,
      proposed_owner_id: input.proposed_owner_id ?? null,
      counter_note: input.counter_note ?? null,
      pending_with_id: task.assigned_by_id, // ball returns to the sender
    }).eq('id', task.id);
    if (error) return { ok: false, error: error.message };
    await notify({
      personId: task.assigned_by_id, kind: 'request_countered',
      payload: { task_id: task.id, task_code: task.task_code, title: task.title, note: input.counter_note },
    });
  }

  revalidatePath('/my-day');
  return { ok: true };
}

export async function changeTaskStatus(raw: unknown): Promise<ActionResult> {
  const parsed = taskStatusChangeSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0].message };
  const input = parsed.data;

  const { person } = await requireSession();
  const supabase = supabaseServer();

  const { data: task } = await supabase.from('tasks')
    .select('id, title, task_code, status, owner_id, assigned_by_id, accountable_id')
    .eq('id', input.task_id).single();
  if (!task) return { ok: false, error: 'Task not found.' };

  // Blocked demands a named unblocker first — there is no anonymous blocking
  if (input.status === 'Blocked') {
    if (!input.blocker) return { ok: false, error: 'Say what is blocking this and who can clear it.' };
    const { data: blocker, error: bErr } = await supabase.from('blockers').insert({
      raised_by_id: person.id,
      unblocker_id: input.blocker.unblocker_id,
      task_id: task.id,
      description: input.blocker.description,
      severity: input.blocker.severity,
    }).select('id, sla_due_at').single();
    if (bErr) return { ok: false, error: bErr.message };
    await notifyBlockerParties(blocker.id, input.blocker.unblocker_id, person.id, person.full_name, input.blocker.description);
  }

  const patch: Record<string, unknown> = { status: input.status };
  if (input.status === 'Dropped') patch.drop_reason = input.drop_reason ?? '';
  const { error } = await supabase.from('tasks').update(patch).eq('id', task.id);
  if (error) return { ok: false, error: error.message };

  await supabase.from('comments').insert({
    subject_type: 'task', subject_id: task.id, author_id: person.id,
    body: `moved ${task.task_code} to ${input.status}`, is_system: true,
  });

  revalidatePath('/board');
  revalidatePath('/my-day');
  revalidatePath(`/tasks/${task.task_code}`);
  return { ok: true };
}

export async function notifyBlockerParties(
  blockerId: string, unblockerId: string, raiserId: string, raiserName: string, description: string,
) {
  const supabase = supabaseServer();
  await notify({
    personId: unblockerId, kind: 'blocker_raised_on_you',
    payload: { blocker_id: blockerId, raised_by: raiserId, description },
    emailSubject: `${raiserName} is blocked on you`,
    emailBody: `"${description}"\n\nA 24-hour clock is running. Open Blockers and tap "I've got this" to stop it.`,
    isP1Escalation: true, // immediate, even in quiet hours
  });
  // Copy both managers (§10 step 6)
  const { data: pair } = await supabase.from('people')
    .select('id, reports_to_id').in('id', [unblockerId, raiserId]);
  for (const mgr of new Set((pair ?? []).map((p) => p.reports_to_id).filter(Boolean) as string[])) {
    await notify({
      personId: mgr, kind: 'blocker_raised_on_you',
      payload: { blocker_id: blockerId, fyi: true, description },
      emailSubject: `Blocker raised in your team`,
      emailBody: `${raiserName} raised a blocker: "${description}". The named unblocker has 24 hours.`,
    });
  }
}

export async function delegateTask(taskId: string, newOwnerId: string): Promise<ActionResult> {
  const { actor } = await requireSession();
  const supabase = supabaseServer();

  const { data: target } = await supabase.from('people')
    .select('id, full_name, department, status').eq('id', newOwnerId).single();
  if (!target) return { ok: false, error: 'Person not found.' };
  const chain = await chainOf(newOwnerId);
  const verb = canAssignTo(actor, { id: target.id, department: target.department, status: target.status, chain });
  if (verb !== 'Direct') {
    return { ok: false, error: `You can only delegate to someone you may assign to directly.` };
  }

  const { error } = await supabase.from('tasks')
    .update({ owner_id: newOwnerId }).eq('id', taskId);
  if (error) return { ok: false, error: error.message }; // depth cap raises here

  await notify({
    personId: newOwnerId, kind: 'task_assigned',
    payload: { task_id: taskId, delegated: true },
    emailSubject: 'A task was delegated to you',
    emailBody: 'It is on your My Day. The delegator stays on as Reviewer; the original assigner stays accountable.',
  });
  revalidatePath('/board');
  return { ok: true };
}

export async function signOffReview(taskId: string): Promise<ActionResult> {
  const { person } = await requireSession();
  const supabase = supabaseServer();
  const { error } = await supabase.from('task_participants')
    .update({ signed_off_at: new Date().toISOString() })
    .eq('task_id', taskId).eq('person_id', person.id)
    .eq('support_role', 'Reviewer').is('removed_at', null);
  if (error) return { ok: false, error: error.message };

  // If every gate is now clear, land the task
  const { data: open } = await supabase.from('task_participants')
    .select('id').eq('task_id', taskId).eq('support_role', 'Reviewer')
    .is('removed_at', null).is('signed_off_at', null);
  const { data: approvals } = await supabase.from('approvals')
    .select('id').eq('task_id', taskId).eq('decision', 'Pending');
  if ((open ?? []).length === 0 && (approvals ?? []).length === 0) {
    await supabase.from('tasks').update({ status: 'Completed' }).eq('id', taskId)
      .eq('status', 'Pending Review');
  }
  revalidatePath('/board');
  return { ok: true };
}

export async function removeSelfFromTask(taskId: string, reason: string): Promise<ActionResult> {
  const { person } = await requireSession();
  const supabase = supabaseServer();

  const { data: task } = await supabase.from('tasks')
    .select('id, task_code, title, status, owner_id, assigned_by_id').eq('id', taskId).single();
  if (!task) return { ok: false, error: 'Task not found.' };

  // Last support leaving an At Risk task deserves the confirm the UI shows;
  // server-side we simply record the removal with its reason.
  const { error } = await supabase.from('task_participants')
    .update({ removed_at: new Date().toISOString(), removed_reason: reason })
    .eq('task_id', taskId).eq('person_id', person.id).is('removed_at', null);
  if (error) return { ok: false, error: error.message };

  for (const pid of new Set([task.owner_id, task.assigned_by_id])) {
    if (pid === person.id) continue;
    await notify({
      personId: pid, kind: 'support_removed',
      payload: { task_id: taskId, task_code: task.task_code, person: person.full_name, reason },
    });
  }
  revalidatePath(`/tasks/${task.task_code}`);
  return { ok: true };
}

export async function acceptCounterProposal(taskId: string): Promise<ActionResult> {
  const { person } = await requireSession();
  const supabase = supabaseServer();
  const { data: task } = await supabase.from('tasks')
    .select('id, assigned_by_id, pending_with_id, proposed_due_at, proposed_owner_id, owner_id')
    .eq('id', taskId).single();
  if (!task || task.pending_with_id !== person.id || task.assigned_by_id !== person.id) {
    return { ok: false, error: 'This counter-proposal is not waiting on you.' };
  }
  const patch: Record<string, unknown> = {
    pending_with_id: task.proposed_owner_id ?? task.owner_id,
    proposed_due_at: null, proposed_owner_id: null, counter_note: null,
  };
  if (task.proposed_due_at) patch.due_at = task.proposed_due_at;
  if (task.proposed_owner_id) patch.owner_id = task.proposed_owner_id;
  const { error } = await supabase.from('tasks').update(patch).eq('id', taskId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/my-day');
  return { ok: true };
}
