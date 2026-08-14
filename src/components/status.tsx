/**
 * Status pills and flags. One meaning per colour, shape+label as well as
 * colour (accessibility floor), red only for OVERDUE and sub-80%.
 */
import type { TaskStatus, Priority } from '@/lib/types';
import type { TaskFlag } from '@/lib/compute';
import { cn } from './ui';

const STATUS_STYLE: Record<TaskStatus, string> = {
  'Awaiting Acceptance': 'text-steel-600 border-steel-300',
  'Declined': 'text-ink-muted border-steel-300 line-through',
  'Not Started': 'text-ink-muted border-steel-300',
  'On Track': 'text-on-target border-on-target/40',
  'At Risk': 'text-behind border-behind/40',
  'Blocked': 'text-blocked border-blocked/40',
  'Pending Review': 'text-steel-600 border-steel-300',
  'Completed': 'text-on-target border-on-target/40',
  'Dropped': 'text-ink-muted border-steel-300',
  'Missed': 'text-ink-muted border-steel-300',
};

const STATUS_DOT: Record<TaskStatus, string> = {
  'Awaiting Acceptance': '◔', 'Declined': '⨯', 'Not Started': '○', 'On Track': '●',
  'At Risk': '◆', 'Blocked': '■', 'Pending Review': '◐', 'Completed': '✓',
  'Dropped': '—', 'Missed': '·',
};

export function StatusPill({ status, className }: { status: TaskStatus; className?: string }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded border bg-surface px-2 py-0.5 text-scale-6 font-medium whitespace-nowrap',
      STATUS_STYLE[status], className,
    )}>
      <span aria-hidden>{STATUS_DOT[status]}</span>
      {status}
    </span>
  );
}

export function FlagChip({ flag }: { flag: TaskFlag }) {
  if (!flag) return null;
  const style =
    flag === 'OVERDUE' ? 'text-attention border-attention/40'
    : flag === 'BLOCKED - needs you' ? 'text-blocked border-blocked/40'
    : flag === 'Due soon' ? 'text-behind border-behind/40'
    : 'text-ink-muted border-steel-300';
  return (
    <span className={cn('inline-flex items-center rounded border bg-surface px-2 py-0.5 text-scale-6 font-semibold', style)}>
      {flag}
    </span>
  );
}

export function PriorityMark({ priority }: { priority: Priority }) {
  const short = priority.slice(0, 2); // P1 / P2 / P3
  const style = priority === 'P1 - Critical' ? 'text-attention' : priority === 'P2 - Important' ? 'text-steel-600' : 'text-ink-muted';
  return <abbr title={priority} className={cn('tabular text-scale-6 font-semibold no-underline', style)}>{short}</abbr>;
}

/** 4px status bar for cards — where colour is allowed to live. */
export function StatusBar({ status }: { status: TaskStatus }) {
  const color =
    status === 'On Track' || status === 'Completed' ? 'bg-on-target'
    : status === 'At Risk' ? 'bg-behind'
    : status === 'Blocked' ? 'bg-blocked'
    : 'bg-steel-300';
  return <div className={cn('w-1 self-stretch rounded-full', color)} aria-hidden />;
}

export function PctText({ value, redBelow = 0.8 }: { value: number | null; redBelow?: number }) {
  if (value === null) return <span className="text-ink-muted">—</span>;
  const cls = value < redBelow ? 'text-attention' : value < 1 ? 'text-behind' : 'text-on-target';
  return <span className={cn('tabular font-medium', cls)}>{Math.round(value * 100)}%</span>;
}
