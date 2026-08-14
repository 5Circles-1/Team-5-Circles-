/**
 * The Five Rings (§14.3) — the one element the product is remembered by.
 * Five concentric arcs, outside in, each a discipline of the day:
 *   1 Closed · 2 Fixed · 3 Target · 4 Assigned · 5 Clear
 * Draw-in over 600ms staggered 80ms outermost-first is the product's only
 * orchestrated motion; prefers-reduced-motion renders them already drawn
 * (handled in globals.css). During diagnostic mode they render as thin grey
 * outlines labelled "calibrating" — no colour, no judgement.
 */
import type { RingsOutput } from '@/lib/compute';

const RING_DEFS = [
  { key: 'closed', color: 'var(--navy-900)', label: 'Closed' },
  { key: 'fixed', color: 'var(--steel-600)', label: 'Fixed' },
  { key: 'target', color: 'var(--on-target)', label: 'Target' },
  { key: 'assigned', color: 'var(--navy-800)', label: 'Assigned' },
  { key: 'clear', color: 'var(--blocked)', label: 'Clear' },
] as const;

export function FiveRings({
  rings,
  centre,
  size = 160,
  diagnostic = false,
  title,
}: {
  rings: RingsOutput;
  /** The achievement figure shown in the middle, e.g. "112%". */
  centre?: string;
  size?: number;
  diagnostic?: boolean;
  title?: string;
}) {
  const stroke = size >= 100 ? 8 : 3.5;
  const gap = size >= 100 ? 5 : 2;
  const c = size / 2;

  const arcs = RING_DEFS.map((def, i) => {
    const r = c - stroke / 2 - i * (stroke + gap);
    const circ = 2 * Math.PI * r;
    const raw = rings[def.key as keyof RingsOutput];
    // Ring 5 (“Clear”) breaks — shows --blocked — when an SLA is blown;
    // whole when nothing is past its clock.
    const value = diagnostic ? 0 : raw;
    const dash = circ * Math.max(0.001, Math.min(1, value));
    return { def, r, circ, dash, i, broken: def.key === 'clear' && raw === 0 };
  });

  const label =
    title ??
    `Five rings: ${RING_DEFS.map(
      (d) => `${d.label} ${Math.round((rings[d.key as keyof RingsOutput] ?? 0) * 100)}%`,
    ).join(', ')}`;

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={diagnostic ? 'Calibrating' : label}>
        {arcs.map(({ def, r }) => (
          <circle
            key={`track-${def.key}`}
            cx={c} cy={c} r={r} fill="none"
            stroke={diagnostic ? 'var(--hairline)' : 'var(--hairline)'}
            strokeWidth={diagnostic ? 1 : stroke}
          />
        ))}
        {!diagnostic &&
          arcs.map(({ def, r, circ, dash, i, broken }) => (
            <circle
              key={def.key}
              className="ring-arc"
              cx={c} cy={c} r={r} fill="none"
              stroke={broken ? 'var(--blocked)' : def.color}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${dash} ${circ}`}
              transform={`rotate(-90 ${c} ${c})`}
              style={{ ['--ring-circ' as string]: `${circ}`, ['--ring-delay' as string]: `${i * 80}ms`, strokeDashoffset: 0 }}
            />
          ))}
      </svg>
      {size >= 100 ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {diagnostic ? (
            <span className="text-scale-6 uppercase tracking-wide text-ink-muted">calibrating</span>
          ) : (
            <span className="font-display font-bold text-scale-2 text-ink tabular">{centre ?? '—'}</span>
          )}
        </div>
      ) : null}
    </div>
  );
}
