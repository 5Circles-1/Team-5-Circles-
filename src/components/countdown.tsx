'use client';
/**
 * Live clocks: the Day Close countdown (amber at 15 minutes, never red —
 * pressure, not panic) and blocker SLA clocks. Client-rendered display only;
 * the server clock remains the truth for the actual deadline.
 */
import { useEffect, useState } from 'react';
import { cn } from './ui';

function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function CloseCountdown({ deadline }: { deadline: string }) {
  const now = useNow(15_000);
  const ms = new Date(deadline).getTime() - now;
  if (ms <= 0) return <span className="text-scale-5 text-ink-muted">Window closed — grace until 09:00</span>;
  const mins = Math.floor(ms / 60_000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const amber = mins <= 15;
  return (
    <span className={cn('tabular text-scale-4 font-medium', amber ? 'text-behind' : 'text-ink-muted')}>
      {h > 0 ? `${h}h ${m}m` : `${m}m`} to close
    </span>
  );
}

export function SlaClock({ due, resolved }: { due: string; resolved?: boolean }) {
  const now = useNow(30_000);
  if (resolved) return <span className="text-scale-5 text-on-target">Resolved</span>;
  const ms = new Date(due).getTime() - now;
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const text = `${h}h ${String(m).padStart(2, '0')}m`;
  return ms >= 0 ? (
    <span className="tabular text-scale-5 font-medium text-ink">{text} left</span>
  ) : (
    <span className="tabular text-scale-5 font-semibold text-attention">{text} over</span>
  );
}
