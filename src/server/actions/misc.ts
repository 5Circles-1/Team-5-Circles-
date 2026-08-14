'use server';
/**
 * Comments, kudos, asks, approvals, charters, KPIs, announcements, settings.
 */
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import {
  askSchema, charterTaskSchema, commentSchema, kpiSchema, kudosSchema,
} from '@/lib/schemas';
import { canSetKpiTargets } from '@/lib/permissions';
import { notify } from '@/lib/notify';
import { todayLocalISO } from '@/lib/dates';
import type { ActionResult } from './tasks';

export async function addComment(raw: unknown): Promise<ActionResult> {
  const parsed = commentSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0].message };
  const input = parsed.data;
  const { person } = await requireSession();
  const supabase = supabaseServer();

  const { error } = await supabase.from('comments').insert({
    subject_type: input.subject_type, subject_id: input.subject_id,
    author_id: person.id, body: input.body, mentions: input.mentions,
  });
  if (error) return { ok: false, error: error.message };

  for (const pid of input.mentions) {
    if (pid === person.id) continue;
    await notify({
      personId: pid, kind: 'ask_received',
      payload: { mention: true, by: person.full_name, subject_type: input.subject_type, subject_id: input.subject_id },
    });
  }
  return { ok: true };
}

export async function strikeComment(commentId: string): Promise<ActionResult> {
  const supabase = supabaseServer();
  const { error } = await supabase.from('comments')
    .update({ struck_at: new Date().toISOString() }).eq('id', commentId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function sendKudos(raw: unknown): Promise<ActionResult> {
  const parsed = kudosSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0].message };
  const input = parsed.data;
  const { person } = await requireSession();
  const supabase = supabaseServer();
  const { error } = await supabase.from('kudos').insert({
    from_person_id: person.id, to_person_id: input.to_person_id,
    note: input.note, task_id: input.task_id ?? null,
  });
  if (error) return { ok: false, error: error.message };
  await notify({
    personId: input.to_person_id, kind: 'kudos',
    payload: { from: person.full_name, note: input.note },
  });
  return { ok: true };
}

// ── Asks (§6.1 ④): never a task on a senior's board without consent ────────
export async function sendAsk(raw: unknown): Promise<ActionResult> {
  const parsed = askSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0].message };
  const input = parsed.data;
  const { person } = await requireSession();
  const supabase = supabaseServer();
  const { error } = await supabase.from('asks').insert({
    from_person_id: person.id, to_person_id: input.to_person_id, body: input.body,
  });
  if (error) return { ok: false, error: error.message };
  await notify({
    personId: input.to_person_id, kind: 'ask_received',
    payload: { from: person.full_name, body: input.body },
  });
  revalidatePath('/my-day');
  return { ok: true };
}

export async function triageAsk(
  askId: string,
  outcome: { action: 'answer'; answer: string } | { action: 'decline'; answer?: string } | { action: 'convert'; owner_id: string; due_at: string; priority?: string },
): Promise<ActionResult> {
  const { person } = await requireSession();
  const supabase = supabaseServer();
  const { data: ask } = await supabase.from('asks')
    .select('id, from_person_id, to_person_id, body, status').eq('id', askId).single();
  if (!ask || ask.to_person_id !== person.id) return { ok: false, error: 'Not your Ask to triage.' };
  if (ask.status !== 'Open') return { ok: false, error: 'Already triaged.' };

  if (outcome.action === 'convert') {
    const { data: task, error } = await supabase.from('tasks').insert({
      title: ask.body.slice(0, 180),
      description: `Converted from an Ask by ${person.full_name}.\n\n${ask.body}`,
      owner_id: outcome.owner_id,
      accountable_id: person.id,
      department: person.department, // trigger re-derives from owner
      priority: (outcome.priority ?? 'P2 - Important') as 'P2 - Important',
      status: 'Not Started',
      assigned_by_id: person.id,
      due_at: outcome.due_at,
    }).select('id, task_code').single();
    if (error) return { ok: false, error: error.message };
    await supabase.from('asks').update({
      status: 'Converted', created_task_id: task.id, resolved_at: new Date().toISOString(),
    }).eq('id', askId);
  } else {
    await supabase.from('asks').update({
      status: outcome.action === 'answer' ? 'Answered' : 'Declined',
      answer: outcome.answer ?? null,
      resolved_at: new Date().toISOString(),
    }).eq('id', askId);
  }
  await notify({
    personId: ask.from_person_id, kind: 'approval_decided',
    payload: { ask_id: askId, outcome: outcome.action },
  });
  revalidatePath('/my-day');
  return { ok: true };
}

// ── Approvals (§9) ─────────────────────────────────────────────────────────
export async function requestApproval(input: {
  subject: string; context: string; task_id?: string; approver_id: string;
}): Promise<ActionResult> {
  const { person } = await requireSession();
  const supabase = supabaseServer();
  const { error } = await supabase.from('approvals').insert({
    requested_by_id: person.id,
    approver_id: input.approver_id,
    subject_type: input.task_id ? 'task_approval' : 'standalone',
    task_id: input.task_id ?? null,
    context: `${input.subject} — ${input.context}`,
    respond_by: new Date(Date.now() + 24 * 3_600_000).toISOString(),
  });
  if (error) return { ok: false, error: error.message };
  await notify({
    personId: input.approver_id, kind: 'approval_requested',
    payload: { subject: input.subject, from: person.full_name, task_id: input.task_id },
    emailSubject: `Approval needed: ${input.subject}`,
    emailBody: `${person.full_name} asks: ${input.context}\n\nApprove, decline (with a note), or ask a question. It shows as overdue after 24h.`,
  });
  return { ok: true };
}

export async function decideApproval(
  approvalId: string, decision: 'Approved' | 'Declined' | 'Question', note?: string,
): Promise<ActionResult> {
  const supabase = supabaseServer();
  const { data: approval } = await supabase.from('approvals')
    .select('id, requested_by_id').eq('id', approvalId).single();
  if (!approval) return { ok: false, error: 'Approval not found.' };
  const { error } = await supabase.from('approvals')
    .update({ decision, note: note ?? null }).eq('id', approvalId);
  if (error) return { ok: false, error: error.message };
  await notify({
    personId: approval.requested_by_id, kind: 'approval_decided',
    payload: { approval_id: approvalId, decision, note },
  });
  revalidatePath('/my-day');
  return { ok: true };
}

// ── Charters (§4.2) ────────────────────────────────────────────────────────
export async function addCharterDuty(raw: unknown): Promise<ActionResult> {
  const parsed = charterTaskSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0].message };
  const input = parsed.data;
  const supabase = supabaseServer();
  const { error } = await supabase.from('charter_tasks').insert({
    charter_id: input.charter_id,
    title: input.title,
    cadence: input.cadence,
    definition_of_done: input.definition_of_done,
    weekday_mask: input.weekday_mask ?? null,
    month_day: input.month_day ?? null,
  });
  // The 5-duty ceiling raises with the spec's exact message — surface it as-is
  if (error) return { ok: false, error: error.message };
  revalidatePath('/charters');
  return { ok: true };
}

export async function retireCharterDuty(dutyId: string): Promise<ActionResult> {
  const supabase = supabaseServer();
  const { error } = await supabase.from('charter_tasks')
    .update({ active: false, suspended_reason: 'Retired' }).eq('id', dutyId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/charters');
  return { ok: true };
}

export async function markCharterReviewed(charterId: string): Promise<ActionResult> {
  const supabase = supabaseServer();
  const { error } = await supabase.from('charters')
    .update({ reviewed_on: todayLocalISO() }).eq('id', charterId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/charters');
  return { ok: true };
}

// ── KPIs (§4.3): close-and-insert, never overwrite ─────────────────────────
export async function setKpiTarget(raw: unknown, replacesKpiId?: string): Promise<ActionResult> {
  const parsed = kpiSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0].message };
  const input = parsed.data;
  const { actor } = await requireSession();
  const supabase = supabaseServer();

  const { data: target } = await supabase.from('people')
    .select('department').eq('id', input.person_id).single();
  if (!target) return { ok: false, error: 'Person not found.' };
  if (!canSetKpiTargets(actor, target)) {
    return { ok: false, error: 'Team Leads propose targets; Heads and the Owner set them.' };
  }

  if (replacesKpiId) {
    const { error } = await supabase.from('kpis')
      .update({ effective_to: todayLocalISO(), active: false, is_primary: false })
      .eq('id', replacesKpiId);
    if (error) return { ok: false, error: error.message };
  }
  if (input.is_primary) {
    await supabase.from('kpis').update({ is_primary: false })
      .eq('person_id', input.person_id).eq('is_primary', true)
      .is('effective_to', null);
  }
  const { error } = await supabase.from('kpis').insert({
    ...input, effective_from: todayLocalISO(),
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/targets');
  return { ok: true };
}

export async function closeKpi(kpiId: string): Promise<ActionResult> {
  const supabase = supabaseServer();
  const { error } = await supabase.from('kpis')
    .update({ effective_to: todayLocalISO(), active: false, is_primary: false })
    .eq('id', kpiId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/targets');
  return { ok: true };
}

// ── Announcements ──────────────────────────────────────────────────────────
export async function broadcast(body: string, ackRequired: boolean, department?: string): Promise<ActionResult> {
  const { person } = await requireSession();
  const supabase = supabaseServer();
  const { error } = await supabase.from('announcements').insert({
    author_id: person.id, body, ack_required: ackRequired,
    department: (department as never) ?? null,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/my-day');
  return { ok: true };
}

export async function acknowledgeAnnouncement(announcementId: string): Promise<ActionResult> {
  const { person } = await requireSession();
  const supabase = supabaseServer();
  const { error } = await supabase.from('announcement_acks').insert({
    announcement_id: announcementId, person_id: person.id,
  });
  if (error && error.code !== '23505') return { ok: false, error: error.message };
  revalidatePath('/my-day');
  return { ok: true };
}

// ── Settings (Owner only — RLS enforces too) ───────────────────────────────
export async function updateSettings(patch: Record<string, unknown>): Promise<ActionResult> {
  const supabase = supabaseServer();
  const { error } = await supabase.from('settings').update(patch).eq('id', 1);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings');
  return { ok: true };
}

export async function resetDemoData(): Promise<ActionResult> {
  const supabase = supabaseServer();
  const { error } = await supabase.rpc('reset_demo_data');
  if (error) return { ok: false, error: error.message };
  revalidatePath('/');
  return { ok: true };
}
