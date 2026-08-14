import 'server-only';
import { createClient } from '@supabase/supabase-js';

/**
 * Service-role client — bypasses RLS. Used ONLY by:
 *  - cron jobs (spawn, digests, escalation, rollup refresh)
 *  - rollup/dashboard reads that aggregate beyond the caller's row scope,
 *    where lib/permissions has already decided what the caller may see
 *  - auth admin calls (revoking sessions on deactivation)
 * Never import from a client component; never expose its output unfiltered.
 */
export function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
