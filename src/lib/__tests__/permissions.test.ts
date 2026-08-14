/**
 * The §6.1 permutation matrix and §5 visibility rules as unit tests, on the
 * seeded org chart. The SQL suite (supabase/tests/02) proves the same rules
 * hold in the database; this proves the TS mirror agrees.
 */
import { describe, expect, it } from 'vitest';
import {
  accessPreview, canAssignTo, canDeactivate, canEditCharter, canViewBlocker,
  canViewDayClose, canViewKpi, canViewTask, rollupScope, type Actor,
} from '../permissions';
import { runAssignmentGuards, titleSimilarity } from '../guards';

const actor = (
  id: string, role: Actor['access_role'], dept: Actor['department'],
  chain: string[], caps: Actor['capabilities'] = [],
): Actor => ({ id, access_role: role, department: dept, capabilities: caps, status: 'Active', chain });

// Seed org: Arjun ← Priya ← Rohan; Arjun ← Ananya ← Kabir; Arjun ← Vikram/Sneha/Meera
const arjun = actor('arjun', 'Owner', 'Management', []);
const priya = actor('priya', 'Department Head', 'Sales', ['arjun']);
const rohan = actor('rohan', 'Member', 'Sales', ['priya', 'arjun']);
const ananya = actor('ananya', 'Department Head', 'Marketing', ['arjun']);
const kabir = actor('kabir', 'Member', 'Marketing', ['ananya', 'arjun']);
const vikram = actor('vikram', 'Member', 'Operations', ['arjun']);
const sneha = actor('sneha', 'Member', 'Finance', ['arjun'], ['finance_admin']);
const meera = actor('meera', 'Member', 'HR', ['arjun'], ['hr_admin', 'people_admin']);
const iris = actor('iris', 'Observer', 'Management', ['arjun']);
const casey = actor('casey', 'Restricted', 'Marketing', ['ananya', 'arjun']);

const target = (a: Actor) => ({ id: a.id, department: a.department, status: 'Active', chain: a.chain });

describe('§6.1 the permutation matrix', () => {
  it('Owner: Direct to anyone', () => {
    expect(canAssignTo(arjun, target(rohan))).toBe('Direct');
    expect(canAssignTo(arjun, target(kabir))).toBe('Direct');
    expect(canAssignTo(arjun, target(arjun))).toBe('Direct');
  });

  it('Dept Head: Direct within own department (report, skip-level, peer)', () => {
    expect(canAssignTo(priya, target(rohan))).toBe('Direct');
    expect(canAssignTo(ananya, target(kabir))).toBe('Direct');
  });

  it('Dept Head → other department: Cross-department Request, never direct', () => {
    expect(canAssignTo(priya, target(kabir))).toBe('Cross-department Request');
    expect(canAssignTo(priya, target(vikram))).toBe('Cross-department Request');
  });

  it('Member → peer, same dept: Peer Request (the one 5 Circles wants)', () => {
    const dev = actor('dev', 'Member', 'Sales', ['priya', 'arjun']);
    expect(canAssignTo(rohan, target(dev))).toBe('Peer Request');
  });

  it('Member → other dept: Cross-department Request', () => {
    expect(canAssignTo(rohan, target(vikram))).toBe('Cross-department Request');
    expect(canAssignTo(rohan, target(kabir))).toBe('Cross-department Request');
  });

  it('upward is always an Ask — nothing lands on a senior board unasked', () => {
    expect(canAssignTo(rohan, target(priya))).toBe('Ask');
    expect(canAssignTo(rohan, target(arjun))).toBe('Ask');
    expect(canAssignTo(kabir, target(ananya))).toBe('Ask');
  });

  it('everyone may self-assign; Restricted only self; Observer nothing', () => {
    expect(canAssignTo(rohan, target(rohan))).toBe('Direct');
    expect(canAssignTo(casey, target(casey))).toBe('Direct');
    expect(canAssignTo(casey, target(kabir))).toBeNull();
    expect(canAssignTo(iris, target(rohan))).toBeNull();
  });

  it('nobody assigns to a deactivated person', () => {
    expect(canAssignTo(arjun, { ...target(rohan), status: 'Deactivated' })).toBeNull();
  });
});

describe('§5 task visibility', () => {
  const tsk = (owner: Actor, visibility: 'Team' | 'Department' | 'Private') => ({
    owner_id: owner.id, accountable_id: 'arjun', assigned_by_id: 'arjun',
    pending_with_id: null, department: owner.department, visibility,
    participant_ids: [] as string[], owner_chain: owner.chain,
  });

  it('teammates see Team work in their department; other departments do not', () => {
    expect(canViewTask(rohan, tsk(priya, 'Team'))).toBe(true);
    expect(canViewTask(kabir, tsk(rohan, 'Team'))).toBe(false);
  });

  it('managers up the chain always see reports’ non-private work', () => {
    expect(canViewTask(priya, tsk(rohan, 'Team'))).toBe(true);
    expect(canViewTask(arjun, tsk(rohan, 'Private'))).toBe(true); // Owner role
  });

  it('Private is participants + Owner only', () => {
    expect(canViewTask(priya, tsk(rohan, 'Private'))).toBe(false);
    const withSupport = { ...tsk(rohan, 'Private'), participant_ids: ['kabir'] };
    expect(canViewTask(kabir, withSupport)).toBe(true);
  });

  it('Observer sees no tasks; Restricted only their own footprint', () => {
    expect(canViewTask(iris, tsk(rohan, 'Team'))).toBe(false);
    expect(canViewTask(casey, tsk(kabir, 'Team'))).toBe(false);
    const supported = { ...tsk(kabir, 'Team'), participant_ids: ['casey'] };
    expect(canViewTask(casey, supported)).toBe(true);
  });
});

describe('§5 close, blocker, KPI, charter scopes', () => {
  it('Day Close text: self + chain + own dept head + Owner only', () => {
    const rohanRef = { id: 'rohan', chain: rohan.chain, department: 'Sales' as const };
    expect(canViewDayClose(rohan, rohanRef)).toBe(true);
    expect(canViewDayClose(priya, rohanRef)).toBe(true);
    expect(canViewDayClose(kabir, rohanRef)).toBe(false);
    expect(canViewDayClose(ananya, rohanRef)).toBe(false); // head of a different dept
  });

  it('blockers are not gossip', () => {
    const b = {
      raised_by_id: 'ananya', unblocker_id: 'vikram',
      raiser_chain: ananya.chain, unblocker_chain: vikram.chain,
    };
    expect(canViewBlocker(vikram, b)).toBe(true);
    expect(canViewBlocker(arjun, b)).toBe(true);   // both chains end at Arjun
    expect(canViewBlocker(priya, b)).toBe(false);  // not her people
  });

  it('the Meera rule: hr_admin ≠ commercial data; finance_admin sees KPI values', () => {
    const snehaKpiOwner = { id: 'sneha', department: 'Finance' as const, chain: sneha.chain };
    expect(canViewKpi(meera, snehaKpiOwner)).toBe(false);
    expect(canViewKpi(sneha, { id: 'rohan', department: 'Sales', chain: rohan.chain })).toBe(true);
  });

  it('charters: own dept head edits; sideways never', () => {
    expect(canEditCharter(priya, { id: 'rohan', department: 'Sales' })).toBe(true);
    expect(canEditCharter(priya, { id: 'kabir', department: 'Marketing' })).toBe(false);
    expect(canEditCharter(rohan, { id: 'priya', department: 'Sales' })).toBe(false);
  });

  it('deactivation is people_admin/Owner, never self', () => {
    expect(canDeactivate(meera, { id: 'vikram' })).toBe(true);
    expect(canDeactivate(meera, { id: 'meera' })).toBe(false);
    expect(canDeactivate(priya, { id: 'rohan' })).toBe(false);
  });

  it('rollup scopes per §11.4', () => {
    expect(rollupScope(arjun)).toEqual({ kind: 'all' });
    expect(rollupScope(priya)).toEqual({ kind: 'department', department: 'Sales' });
    expect(rollupScope(rohan)).toEqual({ kind: 'self' });
    expect(rollupScope(iris)).toEqual({ kind: 'aggregate' });
  });

  it('access preview says it in plain English', () => {
    expect(accessPreview('Rohan Mehta', 'Member', [])).toContain('peer requests');
    expect(accessPreview('Meera Kapoor', 'Member', ['hr_admin'])).toContain('leave');
  });
});

describe('§6.4 assignment guards', () => {
  const baseCtx = {
    targetName: 'Rohan Mehta', targetFirstName: 'Rohan',
    openP1: [], wipLimitP1: 3, priority: 'P2 - Important' as const,
    dueDateISO: '2026-08-17', dueAtISO: '2026-08-17T19:30:00+05:30',
    dueDayHours: 0, estHours: null, dailyCapacityHours: 8,
    charterMatch: null, weeklyOff: [7], holidays: new Set<string>(),
    offDayName: null, isPeerRequest: false, onLeaveUntil: null,
    managerId: null, managerName: null,
    now: new Date('2026-08-14T10:00:00+05:30'),
  };

  it('overload fires at the wip limit and lists the three', () => {
    const p1s = [
      { code: 'TSK-101', title: 'a', due_at: 'x' },
      { code: 'TSK-102', title: 'b', due_at: 'x' },
      { code: 'TSK-103', title: 'c', due_at: 'x' },
    ];
    const w = runAssignmentGuards({ ...baseCtx, priority: 'P1 - Critical', openP1: p1s });
    expect(w[0].code).toBe('overload');
    expect(w[0].message).toBe('Rohan already holds 3 critical tasks due this week. Assign anyway?');
    expect(w[0].detail).toEqual(p1s);
  });

  it('capacity guard phrases the day and the total', () => {
    const w = runAssignmentGuards({ ...baseCtx, estHours: 4, dueDayHours: 7 });
    expect(w[0].code).toBe('capacity');
    expect(w[0].message).toContain('11 hours');
  });

  it('non-working day offers the one-tap fix', () => {
    const w = runAssignmentGuards({
      ...baseCtx, dueDateISO: '2026-08-16', offDayName: 'Sunday', // a Sunday
    });
    expect(w[0].code).toBe('non_working_day');
    expect(w[0].message).toBe('Sunday is not a working day. Due Monday instead?');
    expect(w[0].suggestion?.due_at).toBe('2026-08-17');
  });

  it('same-day peer request forces urgency', () => {
    const w = runAssignmentGuards({
      ...baseCtx, isPeerRequest: true,
      dueDateISO: '2026-08-14', dueAtISO: '2026-08-14T18:00:00+05:30',
    });
    expect(w.some((x) => x.code === 'same_day_peer')).toBe(true);
  });

  it('leave clash offers the manager as fallback', () => {
    const w = runAssignmentGuards({
      ...baseCtx, onLeaveUntil: '2026-08-22', managerId: 'priya', managerName: 'Priya Nair',
    });
    expect(w[0].code).toBe('leave_clash');
    expect(w[0].message).toContain('on leave until 22 August');
    expect(w[0].suggestion?.fallback_owner_id).toBe('priya');
  });

  it('charter clash uses fuzzy title match at ≥80%', () => {
    expect(titleSimilarity(
      'Update CRM for every conversation',
      'Update CRM for every conversation today',
    )).toBeGreaterThanOrEqual(0.8);
    expect(titleSimilarity('Update CRM', 'Design landing page')).toBeLessThan(0.5);
  });
});
