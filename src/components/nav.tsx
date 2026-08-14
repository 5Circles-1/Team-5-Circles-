'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { cn } from './ui';

export function NavTabs({ tabs }: { tabs: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1 overflow-x-auto scrollbar-none" aria-label="Primary">
      {tabs.map((t) => {
        const active = pathname === t.href || pathname.startsWith(t.href + '/');
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded px-2.5 py-1.5 text-scale-5 font-medium whitespace-nowrap transition-colors duration-150',
              active ? 'bg-white/15 text-white' : 'text-white/70 hover:text-white hover:bg-white/10',
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function UserMenu({ name, role }: { name: string; role: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const initials = name.split(' ').map((p) => p[0]).slice(0, 2).join('');

  async function signOut() {
    await supabaseBrowser().auth.signOut();
    router.push('/sign-in');
    router.refresh();
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-scale-6 font-semibold text-white hover:bg-white/25"
        title={`${name} · ${role}`}
      >
        {initials}
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 mt-2 w-52 rounded-lg bg-surface text-ink shadow-lg hairline p-1 z-50">
          <div className="px-3 py-2 hairline-b">
            <p className="text-scale-5 font-medium">{name}</p>
            <p className="text-scale-6 text-ink-muted">{role}</p>
          </div>
          <Link role="menuitem" href="/api/export/my-record" className="block rounded px-3 py-2 text-scale-5 hover:bg-paper">
            Export my complete record
          </Link>
          <button role="menuitem" onClick={signOut} className="block w-full rounded px-3 py-2 text-left text-scale-5 hover:bg-paper">
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
