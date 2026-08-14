/**
 * THE permission module (§3, non-negotiable rule 2).
 *
 * All authorization logic lives here as pure functions. Components call these
 * to decide what to render; server actions call them before writing; the RLS
 * policies in supabase/migrations/00003+00005 mirror them one-for-one. If a
 * rule changes, it changes here AND in the matching app.* SQL function —
 * nowhere else. Nothing in the UI may re-implement a rule inline.
 */
import type { AccessRole, AssignmentVerb, Capability, Department, TaskVisibility } from './types';

/** The minimal person shape permissions reason about. */
export interface Actor {
  id: string;
  access_role: AccessRole;
  department: Department;
  capabilities: Capability[];
  status: string;
  /** Management chain of this person, nearest manager first. */
  chain: string[];
}

export interface TaskScope {
  owner_id: string;
  accountable_id: string;
  assigned_by_id: string;
  pending_with_id: string | null;
  department: Department;
  visibility: TaskVisibility;
  participant_ids: string[];
  owner_chain: string[];
}

const isOwnerRole = (a: Actor) => a.access_role === 'Owner';
export const hasCapability = (a: Actor, cap: Capability) => a.capabilities.includes(cap);

/** Is `manager` anywhere up `target`'s reporting chain? */
export const manages = (managerId: string, targetChain: string[]) =>
  targetChain.includes(managerId);

// ── §6.1 The permutation matrix: actor (row) → target (column) ─────────────
export function canAssignTo(
  actor: Actor,
  target: { id: string; department: Department; status: string; chain: string[] },
): AssignmentVerb | null {
  if (target.status === 'Deactivated') return null;
  if (actor.id === target.id) return 'Direct';               // Self: everyone
  if (isOwnerRole(actor)) return 'Direct';                   // Owner: anyone
  if (actor.access_role === 'Observer') return null;         // Read. Nothing else.
  if (manages(target.id, actor.chain)) return 'Ask';         // Upward: consent first
  if (actor.access_role === 'Restricted') return null;       // Self only

  if (actor.department === target.department) {
    if (actor.access_role === 'Department Head') return 'Direct'; // report/skip/peer
    if (manages(actor.id, target.chain)) return 'Direct';         // Lead → pod member
    return 'Peer Request';                                        // rep → rep
  }
  return 'Cross-department Request';                              // their head decides
}

// ── Task visibility (§5 scope + §4.4 visibility) ───────────────────────────
export function canViewTask(actor: Actor, task: TaskScope): boolean {
  if (isOwnerRole(actor)) return true;
  if ([task.owner_id, task.accountable_id, task.assigned_by_id].includes(actor.id)) return true;
  if (task.pending_with_id === actor.id) return true;
  if (task.participant_ids.includes(actor.id)) return true;
  if (actor.access_role === 'Observer') return false;   // aggregates only
  if (task.visibility === 'Private') return false;      // participants + Owner only
  if (actor.access_role === 'Restricted') return false; // own or supported work only
  if (manages(actor.id, task.owner_chain)) return true; // manager chain sees reports' work
  if (task.visibility === 'Team') return actor.department === task.department;
  // 'Department': the department's leadership only
  return (
    actor.department === task.department &&
    (actor.access_role === 'Department Head' || actor.access_role === 'Team Lead')
  );
}

// ── Day Close: full rows for self + chain + dept head + Owner; teammates
//    get submission status only ───────────────────────────────────────────
export function canViewDayClose(
  actor: Actor,
  person: { id: string; chain: string[]; department: Department },
): boolean {
  return (
    actor.id === person.id ||
    isOwnerRole(actor) ||
    manages(actor.id, person.chain) ||
    (actor.access_role === 'Department Head' && actor.department === person.department)
  );
}

export function canReviewDayClose(
  actor: Actor,
  person: { id: string; chain: string[]; department: Department },
): boolean {
  return (
    manages(actor.id, person.chain) ||
    isOwnerRole(actor) ||
    (actor.access_role === 'Department Head' && actor.department === person.department)
  );
}

// ── Blockers are not gossip (§5.3) ─────────────────────────────────────────
export function canViewBlocker(
  actor: Actor,
  blocker: { raised_by_id: string; unblocker_id: string; raiser_chain: string[]; unblocker_chain: string[] },
): boolean {
  return (
    isOwnerRole(actor) ||
    actor.id === blocker.raised_by_id ||
    actor.id === blocker.unblocker_id ||
    manages(actor.id, blocker.raiser_chain) ||
    manages(actor.id, blocker.unblocker_chain)
  );
}

// ── Charters ───────────────────────────────────────────────────────────────
export function canEditCharter(actor: Actor, person: { id: string; department: Department }): boolean {
  return (
    isOwnerRole(actor) ||
    (actor.access_role === 'Department Head' && actor.department === person.department)
  );
}

export function canViewCharter(
  actor: Actor,
  person: { id: string; department: Department; chain: string[] },
): boolean {
  return (
    actor.id === person.id ||
    isOwnerRole(actor) ||
    manages(actor.id, person.chain) ||
    (actor.department === person.department &&
      (actor.access_role === 'Department Head' || actor.access_role === 'Team Lead'))
  );
}

// ── KPIs: values are commercial data ───────────────────────────────────────
export function canViewKpi(
  actor: Actor,
  person: { id: string; department: Department; chain: string[] },
): boolean {
  return (
    actor.id === person.id ||
    isOwnerRole(actor) ||
    manages(actor.id, person.chain) ||
    (actor.department === person.department &&
      (actor.access_role === 'Department Head' || actor.access_role === 'Team Lead')) ||
    hasCapability(actor, 'finance_admin') // revenue/collections values across departments
  );
}

export function canSetKpiTargets(actor: Actor, person: { department: Department }): boolean {
  // Team Leads propose but never set (§5.1)
  return (
    isOwnerRole(actor) ||
    (actor.access_role === 'Department Head' && actor.department === person.department)
  );
}

// ── People lifecycle ───────────────────────────────────────────────────────
export function canManagePeople(actor: Actor): boolean {
  return isOwnerRole(actor) || hasCapability(actor, 'people_admin');
}

export function canDeactivate(actor: Actor, person: { id: string }): boolean {
  // The Handover wizard is the only path; the database still refuses while
  // any open item remains (trg_people_deactivation).
  return canManagePeople(actor) && actor.id !== person.id;
}

// ── Leave data (the Meera rule: Member + hr_admin, never a promotion) ──────
export function canViewLeave(actor: Actor, person: { id: string; chain: string[] }): boolean {
  return (
    actor.id === person.id ||
    isOwnerRole(actor) ||
    hasCapability(actor, 'hr_admin') ||
    manages(actor.id, person.chain)
  );
}

// ── Rollups / dashboards (§11.4) ───────────────────────────────────────────
export type RollupScope =
  | { kind: 'all' }                          // Owner: everything
  | { kind: 'department'; department: Department } // Head/Lead: own department
  | { kind: 'self' }                         // Member/Restricted: own trend only
  | { kind: 'aggregate' };                   // Observer: no names, no free text

export function rollupScope(actor: Actor): RollupScope {
  switch (actor.access_role) {
    case 'Owner': return { kind: 'all' };
    case 'Department Head':
    case 'Team Lead': return { kind: 'department', department: actor.department };
    case 'Observer': return { kind: 'aggregate' };
    default: return { kind: 'self' };
  }
}

/** Other departments appear at rollup level only for Heads (§5.1): names +
 *  status, no comment threads, no charters, no blocker text. */
export function canSeeCrossDeptRollup(actor: Actor): boolean {
  return isOwnerRole(actor) || actor.access_role === 'Department Head';
}

// ── Misc gates the screens ask about ───────────────────────────────────────
export function canBroadcast(actor: Actor): boolean {
  return isOwnerRole(actor) || actor.access_role === 'Department Head';
}

export function canDropTask(actor: Actor, task: { assigned_by_id: string; accountable_id: string }): boolean {
  return (
    isOwnerRole(actor) ||
    actor.id === task.assigned_by_id ||
    actor.id === task.accountable_id
  );
}

export function canEditSettings(actor: Actor): boolean {
  return isOwnerRole(actor);
}

/** Plain-English preview for the Access step of the add wizard (§8.1). */
export function accessPreview(name: string, role: AccessRole, caps: Capability[]): string {
  const first = name.split(' ')[0];
  const bits: string[] = [];
  switch (role) {
    case 'Owner':
      bits.push(`${first} will see everything and can do everything, including access changes.`);
      break;
    case 'Department Head':
      bits.push(`${first} will see their whole department, other departments at rollup level only, assign to anyone in their department, review Day Closes, and edit their department's charters and targets.`);
      break;
    case 'Team Lead':
      bits.push(`${first} will see their pod fully, assign to pod members, review their Day Closes, and propose (not set) targets.`);
      break;
    case 'Member':
      bits.push(`${first} will see their own work and teammates' task and Day Close status, submit a daily close, and send peer requests. They cannot assign to anyone but themselves.`);
      break;
    case 'Restricted':
      bits.push(`${first} will see only tasks they own or support and their own Day Close. No directory, no rollups, no other people's data.`);
      break;
    case 'Observer':
      bits.push(`${first} will see rollups and trends only, in aggregate — no individual names, no free text. Read only.`);
      break;
  }
  if (caps.includes('people_admin')) bits.push('They can add, edit and deactivate people, and run Handovers.');
  if (caps.includes('hr_admin')) bits.push('They can see attendance, leave and joining dates across all departments — but no commercial data.');
  if (caps.includes('finance_admin')) bits.push('They can see revenue and collections KPI values across all departments — but no charters or Day Close text.');
  return bits.join(' ');
}
