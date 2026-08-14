'use server';
/**
 * The blocker channel (§12) — the sharpest tool in the product.
 * "I've got this" stamps first_response_at; resolution closes the clock.
 * Escalation is the cron's job and is not optional.
 */
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import { blockerResponseSchema } from '@/lib/schemas';
import { notify } from '@/lib/notify';
import type { ActionResult } from './tasks';

export async function respondToBlocker(raw: unknown): Promise<ActionResult> {
  const parsed = blockerResponseSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0].message };
  const input = parsed.data;

  const { person } = await requireSession();
  const supabase = supabaseServer();

  const { data: blocker } = await supabase.from('blockers')
    .select('id, raised_by_id, unblocker_id, task_id, first_response_at, resolved_at, description')
    .eq('id', input.blocker_id).single();
  if (!blocker) return { ok: false, error: 'Blocker not found.' };
  if (blocker.resolved_at) return { ok: false, error: 'Already resolved.' };

  if (input.action === 'got-it') {
    if (blocker.first_response_at) return { ok: true }; // idempotent tap
    const { error } = await supabase.from('blockers').update({
      first_response_at: new Date().toISOString(),
      first_responder_id: person.id,
    }).eq('id', blocker.id);
    if (error) return { ok: false, error: error.message };
    await notify({
      personId: blocker.raised_by_id, kind: 'blocker_resolved',
      payload: { blocker_id: blocker.id, got_it: true, by: person.full_name },
    });
  } else {
    const { error } = await supabase.from('blockers').update({
      resolved_at: new Date().toISOString(),
      resolution_note: input.resolution_note ?? null,
      first_response_at: blocker.first_response_at ?? new Date().toISOString(),
      first_responder_id: person.id,
    }).eq('id', blocker.id);
    if (error) return { ok: false, error: error.message };

    // Unblocked work flows back: Blocked task returns to At Risk for its owner
    if (blocker.task_id) {
      await supabase.from('tasks').update({ status: 'At Risk' })
        .eq('id', blocker.task_id).eq('status', 'Blocked');
    }
    await notify({
      personId: blocker.raised_by_id, kind: 'blocker_resolved',
      payload: { blocker_id: blocker.id, note: input.resolution_note },
    });
  }

  revalidatePath('/blockers');
  revalidatePath('/my-day');
  return { ok: true };
}
