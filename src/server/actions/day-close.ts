'use server';
/**
 * Day Close (§10): pre-fill comes from the server, the person types four
 * things, submit writes everything in one pass — tick fixed work, apply
 * status pills to real tasks, raise the blocker with its 24h clock, snapshot
 * the counts, stamp the window server-side.
 */
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import { dayCloseSchema } from '@/lib/schemas';
import { notify } from '@/lib/notify';
import { notifyBlockerParties } from './tasks';
import { todayLocalISO } from '@/lib/dates';
import type { ActionResult } from './tasks';

export async function submitDayClose(raw: unknown): Promise<ActionResult<{ streak: number }>> {
  const parsed = dayCloseSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0].message };
  const input = parsed.data;

  const { person } = await requireSession();
  const supabase = supabaseServer();

  if (input.close_date !== todayLocalISO()) {
    return { ok: false, error: 'A Day Close is for today — the window opens at 18:00.' };
  }

  // Server-side pre-fill is the source of truth for the green columns
  const { data: prefill, error: pErr } = await supabase.rpc('day_close_prefill', {
    p_person: person.id, p_date: input.close_date,
  });
  if (pErr || !prefill) return { ok: false, error: pErr?.message ?? 'Could not pre-fill.' };

  // 1 · Tap-to-tick fixed work marks the real instances Completed
  const fixedIds = (prefill.fixed as { id: string }[]).map((f) => f.id);
  const tickable = input.fixed_done_task_ids.filter((id) => fixedIds.includes(id));
  for (const id of tickable) {
    await supabase.from('tasks').update({ status: 'Completed' }).eq('id', id)
      .neq('status', 'Completed');
  }

  // 2 · Inline status pills update the actual tasks — no separate place
  for (const change of input.assigned_status_changes) {
    await supabase.from('tasks').update({ status: change.status }).eq('id', change.task_id);
  }

  // 3 · Live counts after those changes (the workbook's M/N/O, pre-filled)
  const { data: openNow } = await supabase.from('tasks')
    .select('id, status, completed_at')
    .eq('owner_id', person.id).neq('task_type', 'Fixed');
  const onTrack = (openNow ?? []).filter((t) => t.status === 'On Track' || t.status === 'Not Started').length;
  const atRisk = (openNow ?? []).filter((t) => t.status === 'At Risk' || t.status === 'Blocked').length;
  const completedToday = (openNow ?? []).filter(
    (t) => t.status === 'Completed' && (t.completed_at ?? '').slice(0, 10) === input.close_date,
  ).length;

  // 4 · The close row (trigger stamps week, month, window verdict)
  const { data: close, error } = await supabase.from('day_close').insert({
    person_id: person.id,
    close_date: input.close_date,
    week_starting: input.close_date, // restamped by trigger
    month: input.close_date.slice(0, 7),
    department: person.department,
    fixed_tasks_due: fixedIds.length,
    fixed_tasks_done: tickable.length,
    fixed_done_task_ids: tickable,
    primary_metric: prefill.primary_metric ?? null,
    target: prefill.target ?? null,
    direction: prefill.direction ?? null,
    actual: input.actual,
    assigned_on_track: onTrack,
    assigned_at_risk: atRisk,
    assigned_completed_today: completedToday,
    reactive_hours: input.reactive_hours,
    reactive_tags: input.reactive_tags,
    blocker: !!input.blocker,
    top_3_tomorrow: input.top_3_tomorrow.filter((t) => t.trim() !== ''),
  }).select('id, submitted_on_time').single();
  if (error) {
    if (error.code === '23505') return { ok: false, error: 'You already closed today. Edit it instead.' };
    return { ok: false, error: error.message };
  }

  // 5 · Blocker → first-class record, clock running, unblocker notified now
  if (input.blocker) {
    const { data: blocker, error: bErr } = await supabase.from('blockers').insert({
      raised_by_id: person.id,
      unblocker_id: input.blocker.unblocker_id,
      day_close_id: close.id,
      description: input.blocker.description,
      severity: input.blocker.severity,
    }).select('id').single();
    if (bErr) return { ok: false, error: bErr.message };
    await notifyBlockerParties(
      blocker.id, input.blocker.unblocker_id, person.id, person.full_name, input.blocker.description,
    );
  }

  // 6 · The five-minute promise is measured (§16)
  if (input.opened_at) {
    const seconds = Math.max(0, Math.round((Date.now() - new Date(input.opened_at).getTime()) / 1000));
    await supabase.from('form_timings').insert({
      person_id: person.id, form: 'day_close',
      opened_at: input.opened_at, seconds,
    });
  }

  // Streak: consecutive submitted working days, for the post-submit moment
  const { data: recent } = await supabase.from('day_close')
    .select('close_date').eq('person_id', person.id)
    .order('close_date', { ascending: false }).limit(60);
  let streak = 0;
  const dates = new Set((recent ?? []).map((r) => r.close_date));
  const cursor = new Date(input.close_date + 'T00:00:00Z');
  for (let i = 0; i < 60; i++) {
    const iso = cursor.toISOString().slice(0, 10);
    if (dates.has(iso)) streak += 1;
    else if (cursor.getUTCDay() !== 0) break; // Sundays don't break streaks
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  revalidatePath('/my-day');
  revalidatePath('/day-close');
  return { ok: true, streak };
}

/** Manager reaction sets manager_reviewed — cheap enough to happen daily. */
export async function reviewDayClose(closeId: string, reaction: string, comment?: string): Promise<ActionResult> {
  const { person } = await requireSession();
  const supabase = supabaseServer();

  const { data: close } = await supabase.from('day_close')
    .select('id, person_id, close_date').eq('id', closeId).single();
  if (!close) return { ok: false, error: 'Close not found.' };

  const { error } = await supabase.from('day_close').update({
    manager_reviewed: true,
    reviewed_by_id: person.id,
    reviewed_at: new Date().toISOString(),
    review_reaction: reaction,
  }).eq('id', closeId);
  if (error) return { ok: false, error: error.message };

  if (comment?.trim()) {
    await supabase.from('comments').insert({
      subject_type: 'day_close', subject_id: closeId,
      author_id: person.id, body: comment.trim(),
    });
  }
  await notify({
    personId: close.person_id, kind: 'close_reviewed',
    payload: { day_close_id: closeId, close_date: close.close_date, reaction },
  });
  revalidatePath('/review');
  return { ok: true };
}

/** Manager unlock for post-grace edits (§10 rules). */
export async function unlockDayClose(closeId: string, hours = 2): Promise<ActionResult> {
  const { person } = await requireSession();
  const supabase = supabaseServer();
  const { error } = await supabase.from('day_close').update({
    unlock_by_id: person.id,
    unlocked_until: new Date(Date.now() + hours * 3_600_000).toISOString(),
  }).eq('id', closeId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
