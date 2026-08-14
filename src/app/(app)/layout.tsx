import Link from 'next/link';
import { requireSession } from '@/lib/session';
import { PRODUCT_NAME } from '@/lib/constants';
import { rollupScope, canManagePeople, canSeeCrossDeptRollup } from '@/lib/permissions';
import { NavTabs, UserMenu } from '@/components/nav';
import { todayLocalISO } from '@/lib/dates';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { person, actor, settings } = await requireSession();

  const scope = rollupScope(actor);
  const diagnostic =
    !!settings.diagnostic_until && settings.diagnostic_until >= todayLocalISO();

  const tabs = [
    { href: '/my-day', label: 'My Day' },
    { href: '/board', label: 'Board' },
    { href: '/day-close', label: 'Day Close' },
    ...(scope.kind === 'all' || scope.kind === 'department'
      ? [{ href: '/review', label: 'Review' }]
      : []),
    { href: '/blockers', label: 'Blockers' },
    { href: '/rollups', label: 'Rollups' },
    { href: '/charters', label: 'Charters' },
    { href: '/targets', label: 'Targets' },
    ...(canManagePeople(actor) || canSeeCrossDeptRollup(actor)
      ? [{ href: '/people', label: 'People' }]
      : []),
    ...(actor.access_role === 'Owner' ? [{ href: '/settings', label: 'Settings' }] : []),
  ];

  return (
    <div className="min-h-screen bg-paper">
      {/* Persistent 56px navy top rail carrying the 5 Circles mark (§14.4) */}
      <header className="sticky top-0 z-40 h-rail bg-navy-900 text-white">
        <div className="mx-auto flex h-full max-w-content items-center gap-4 px-4">
          <Link href="/my-day" className="flex items-center gap-2.5 shrink-0" aria-label={PRODUCT_NAME}>
            <svg width="22" height="22" viewBox="0 0 28 28" aria-hidden>
              {[12, 9.5, 7, 4.5, 2].map((r, i) => (
                <circle key={r} cx="14" cy="14" r={r} fill="none" stroke="white"
                  strokeOpacity={1 - i * 0.16} strokeWidth="1.5" />
              ))}
            </svg>
            <span className="font-display font-semibold text-scale-4 tracking-tight hidden sm:inline">
              {PRODUCT_NAME}
            </span>
          </Link>
          <NavTabs tabs={tabs} />
          <div className="ml-auto flex items-center gap-3">
            {diagnostic ? (
              <span className="hidden md:inline rounded border border-white/30 px-2 py-0.5 text-scale-6 uppercase tracking-wide text-white/80">
                Calibrating
              </span>
            ) : null}
            <UserMenu name={person.full_name} role={person.access_role} />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-content px-4 py-6 pb-24 md:pb-8">{children}</main>
    </div>
  );
}
