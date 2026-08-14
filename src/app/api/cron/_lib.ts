import 'server-only';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

/** Vercel Cron authenticates with CRON_SECRET; everything else is refused. */
export function authorizeCron(request: Request): NextResponse | null {
  const header = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || header !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}

/** Every cron job is idempotent and logs its run — a digest that silently
 *  stops sending is how these systems die quietly (§18). */
export async function logCronRun(job: string, result: Record<string, unknown>) {
  const admin = supabaseAdmin();
  await admin.from('audit_log').insert({
    actor_id: null, action: 'CRON', entity: job, entity_id: null,
    before: null, after: result,
  });
}

export function todayIST(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

export function yesterdayIST(): string {
  return new Date(Date.now() + 330 * 60_000 - 86_400_000).toISOString().slice(0, 10);
}
