import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { supabaseServer } from './supabase/server';
import type { Person, Settings } from './types';
import type { Actor } from './permissions';

export interface SessionContext {
  person: Person;
  actor: Actor;
  settings: Settings;
  holidays: Set<string>;
}

/**
 * Resolve the signed-in person once per request. Server actions re-validate
 * permissions with this rather than trusting anything from the client (§18).
 */
export const getSession = cache(async (): Promise<SessionContext | null> => {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // Link auth → person on first visit (fallback when the auth trigger is absent)
  const { data: personId } = await supabase.rpc('link_me');
  if (!personId) return null;

  const [{ data: person }, { data: settings }, { data: holidayRows }, { data: chain }] =
    await Promise.all([
      supabase.from('people').select('*').eq('id', personId).single(),
      supabase.from('settings').select('*').eq('id', 1).single(),
      supabase.from('holidays').select('day'),
      supabase.rpc('chain_of', { pid: personId }),
    ]);
  if (!person || person.status === 'Deactivated' || !settings) return null;

  return {
    person: person as Person,
    actor: {
      id: person.id,
      access_role: person.access_role,
      department: person.department,
      capabilities: person.capabilities ?? [],
      status: person.status,
      chain: (chain as string[] | null) ?? [],
    },
    settings: settings as Settings,
    holidays: new Set((holidayRows ?? []).map((h: { day: string }) => h.day)),
  };
});

/** For pages that require a signed-in, linked person. */
export async function requireSession(): Promise<SessionContext> {
  const s = await getSession();
  if (!s) redirect('/sign-in');
  return s;
}

/** Chains for arbitrary people (permission checks on targets). */
export async function chainOf(personId: string): Promise<string[]> {
  const supabase = supabaseServer();
  const { data } = await supabase.rpc('chain_of', { pid: personId });
  return (data as string[] | null) ?? [];
}
