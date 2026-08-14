import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

type CookieRecord = { name: string; value: string; options?: CookieOptions };

/**
 * User-scoped client for server components and actions. Every query runs
 * under RLS as the signed-in person — the default for all entity access.
 */
export function supabaseServer() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (all: CookieRecord[]) => {
          try {
            all.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Server components cannot set cookies; middleware refreshes the session.
          }
        },
      },
    },
  );
}
