import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { authorizeCron, logCronRun, todayIST, yesterdayIST } from '../_lib';

export const dynamic = 'force-dynamic';

/**
 * 00:05 IST daily (§7 recurring work):
 *  1. Yesterday's unfinished fixed instances → Missed (they feed Fixed %,
 *     they do not roll over and pile up)
 *  2. Spawn today's instances per cadence (idempotent by unique constraint)
 *  3. Refresh the rollup materialised views
 */
export async function GET(request: Request) {
  const unauthorized = authorizeCron(request);
  if (unauthorized) return unauthorized;

  const admin = supabaseAdmin();
  const [{ data: missed, error: e1 }, { data: spawned, error: e2 }, { error: e3 }] =
    await Promise.all([
      admin.rpc('mark_missed_fixed', { p_date: yesterdayIST() }),
      admin.rpc('spawn_fixed_tasks', { p_date: todayIST() }),
      admin.rpc('refresh_rollups'),
    ]);

  const result = {
    missed: missed ?? 0, spawned: spawned ?? 0,
    errors: [e1?.message, e2?.message, e3?.message].filter(Boolean),
  };
  await logCronRun('daily-spawn', result);
  return NextResponse.json(result);
}
