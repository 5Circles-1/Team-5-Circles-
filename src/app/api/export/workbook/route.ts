import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { getSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase/server';
import { buildRollup, buildDeptRollup } from '@/lib/rollup';
import { weekStartISO, todayLocalISO } from '@/lib/dates';
import { weeklyTarget, monthlyTarget, taskFlag, taskDaysLeft } from '@/lib/compute';
import { DEPARTMENTS, type DayClose, type Person } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * §11.4 export: the exact layout of the source workbook — same tab names,
 * column order and header styling — so the founder still opens a familiar
 * file. Rows come through the caller's RLS scope, nothing wider.
 */
const NAVY = 'FF1F3864';
const STEEL = 'FF2E5C8A';
const CREAM = 'FFFFF2CC';
const WHITE = 'FFFFFFFF';

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'sign in first' }, { status: 401 });
  const { settings } = session;
  const url = new URL(request.url);
  const week = url.searchParams.get('week') ?? weekStartISO(todayLocalISO());
  const month = url.searchParams.get('month') ?? todayLocalISO().slice(0, 7);

  const supabase = supabaseServer();
  const [{ data: people }, { data: charters }, { data: duties }, { data: kpis },
         { data: tasks }, { data: closes }] = await Promise.all([
    supabase.from('people').select('*').order('employee_code'),
    supabase.from('charters').select('*, person:people!charters_person_id_fkey(full_name, department)'),
    supabase.from('charter_tasks').select('*, charters!inner(person_id)').eq('active', true).order('sort_order'),
    supabase.from('kpis').select('*, person:people!kpis_person_id_fkey(full_name, department)')
      .eq('active', true).is('effective_to', null),
    supabase.from('tasks').select('*, owner:people!tasks_owner_id_fkey(full_name), assigner:people!tasks_assigned_by_id_fkey(full_name)')
      .neq('task_type', 'Fixed').order('task_code'),
    supabase.from('day_close').select('*, person:people!day_close_person_id_fkey(full_name)')
      .order('close_date'),
  ]);

  const wb = new ExcelJS.Workbook();
  wb.creator = settings.product_name;

  const header = (ws: ExcelJS.Worksheet, cells: string[], row = 4) => {
    const r = ws.getRow(row);
    cells.forEach((c, i) => {
      const cell = r.getCell(i + 1);
      cell.value = c;
      cell.font = { name: 'Arial', bold: true, color: { argb: WHITE }, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STEEL } };
    });
    r.commit?.();
  };
  const banner = (ws: ExcelJS.Worksheet, title: string) => {
    const cell = ws.getCell('A1');
    cell.value = title;
    cell.font = { name: 'Arial', bold: true, size: 14, color: { argb: WHITE } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    ws.getRow(1).height = 24;
  };
  const arial = (ws: ExcelJS.Worksheet) => {
    ws.eachRow((row) => row.eachCell((c) => {
      if (!c.font?.bold) c.font = { name: 'Arial', size: 10, ...c.font };
    }));
  };

  // 1 · START HERE
  const start = wb.addWorksheet('START HERE');
  banner(start, 'TEAM OPERATING SYSTEM  —  Task Allocation & Daily EOD Reporting');
  const rules = [
    ['', ''],
    ['RULES THAT KEEP THIS ALIVE', ''],
    ['•  Submission window: 6:00 PM - 7:30 PM. A report filed next morning is marked late.', ''],
    ['•  The form must take under 5 minutes. If it takes longer, people stop filing honestly.', ''],
    ['•  You must respond to every blocker within 24 hours. Stop doing this and the blocker column goes blank.', ''],
    ['•  Review targets WEEKLY or MONTHLY, never daily. Daily numbers are noise and reacting to them causes gaming.', ''],
    ['•  First 3-4 weeks: use this data diagnostically, not punitively.', ''],
    ['•  Max 4 KPIs and roughly 5 fixed tasks per person. A person with 14 daily fixed tasks has zero.', ''],
    ['', ''],
    [`Exported from ${settings.product_name} on ${todayLocalISO()}. The live system is the source of truth.`, ''],
  ];
  rules.forEach((r, i) => { start.getCell(`B${3 + i}`).value = r[0]; });
  arial(start);

  // 2 · Team Directory (columns A–G exactly)
  const dir = wb.addWorksheet('Team Directory');
  banner(dir, 'TEAM DIRECTORY');
  header(dir, ['Employee ID', 'Team Member', 'Department', 'Role / Designation', 'Reports To', 'Email', 'Active?']);
  const nameOf = (id: string | null) => (people ?? []).find((p) => p.id === id)?.full_name ?? '—';
  (people ?? []).forEach((p, i) => {
    dir.getRow(5 + i).values = [
      p.employee_code, p.full_name, p.department, p.designation,
      p.reports_to_id ? nameOf(p.reports_to_id) : '—', p.email,
      p.status === 'Deactivated' ? 'No' : 'Yes',
    ];
  });
  dir.columns.forEach((c) => { c.width = 22; });
  arial(dir);

  // 3 · Lists
  const lists = wb.addWorksheet('Lists');
  banner(lists, 'DROPDOWN LISTS  —  source data for data validation');
  header(lists, ['Departments', 'Cadence', 'Task Status', 'Priority', 'Yes/No', 'Target Type', 'Direction'], 3);
  const listCols = [
    DEPARTMENTS,
    ['Daily', 'Weekly', 'Fortnightly', 'Monthly', 'Quarterly'],
    ['Not Started', 'On Track', 'At Risk', 'Blocked', 'Completed', 'Dropped', 'Awaiting Acceptance', 'Declined', 'Pending Review'],
    ['P1 - Critical', 'P2 - Important', 'P3 - Nice to have'],
    ['Yes', 'No'],
    ['Volume', 'Rate'],
    ['Higher is better', 'Lower is better'],
  ];
  listCols.forEach((col, c) => col.forEach((v, r) => { lists.getCell(4 + r, c + 1).value = v; }));
  lists.columns.forEach((c) => { c.width = 20; });
  arial(lists);

  // 4 · Role Charters (A–H exactly)
  const rc = wb.addWorksheet('Role Charters');
  banner(rc, 'ROLE CHARTERS  —  fixed tasks, outcomes owned, decision rights');
  header(rc, ['Department', 'Team Member', 'Owns (Outcome, not activity)', 'Fixed Task', 'Cadence', 'Definition of Done', 'Can Decide Alone', 'Needs Your Approval']);
  let rcRow = 5;
  for (const c of charters ?? []) {
    const person = c.person as { full_name: string; department: string } | null;
    const mine = (duties ?? []).filter((d) => (d.charters as { person_id: string }).person_id === c.person_id);
    mine.forEach((d, i) => {
      rc.getRow(rcRow).values = [
        i === 0 ? person?.department : '', i === 0 ? person?.full_name : '',
        i === 0 ? c.owns_outcome : '', d.title, d.cadence, d.definition_of_done,
        i === 0 ? (c.can_decide_alone as string[]).join('; ') : '',
        i === 0 ? (c.needs_approval_for as string[]).join('; ') : '',
      ];
      rcRow += 1;
    });
    rcRow += 1;
  }
  rc.columns.forEach((c) => { c.width = 26; });
  arial(rc);

  // 5 · KPI Targets (A–J with computed weekly/monthly, assumptions block)
  const kt = wb.addWorksheet('KPI Targets');
  banner(kt, 'KPI TARGETS  —  the numbers each person owns');
  kt.getCell('A4').value = 'ASSUMPTIONS';
  kt.getCell('A5').value = 'Working days per week';
  kt.getCell('B5').value = settings.working_days_per_week;
  kt.getCell('B5').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CREAM } };
  kt.getCell('A6').value = 'Working days per month';
  kt.getCell('B6').value = settings.working_days_per_month;
  kt.getCell('B6').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CREAM } };
  header(kt, ['Department', 'Owner', 'Metric', 'Unit', 'Target Type', 'Direction', 'Daily Target', 'Weekly Target', 'Monthly Target', 'Review Cadence'], 8);
  (kpis ?? []).forEach((k, i) => {
    const person = k.person as { full_name: string; department: string } | null;
    kt.getRow(9 + i).values = [
      person?.department, person?.full_name, k.metric, k.unit, k.target_type, k.direction,
      k.daily_target,
      weeklyTarget(k.daily_target, k.target_type, settings.working_days_per_week),
      monthlyTarget(k.daily_target, k.target_type, settings.working_days_per_month),
      k.review_cadence,
    ];
  });
  kt.columns.forEach((c) => { c.width = 20; });
  arial(kt);

  // 6 · Assigned Tasks (A–K with live Days Left / Flag words)
  const at = wb.addWorksheet('Assigned Tasks');
  banner(at, 'ASSIGNED TASKS  —  project and one-off work');
  header(at, ['Task ID', 'Task Description', 'Owner', 'Department', 'Assigned By', 'Assigned On', 'Due Date', 'Priority', 'Status', 'Days Left', 'Flag']);
  (tasks ?? []).forEach((t, i) => {
    at.getRow(5 + i).values = [
      t.task_code, t.title,
      (t.owner as { full_name: string } | null)?.full_name, t.department,
      (t.assigner as { full_name: string } | null)?.full_name,
      t.assigned_on.slice(0, 10), t.due_at.slice(0, 10), t.priority, t.status,
      taskDaysLeft(t.due_at, t.status), taskFlag(t.due_at, t.status),
    ];
  });
  at.columns.forEach((c) => { c.width = 18; });
  at.getColumn(2).width = 42;
  arial(at);

  // 7 · Daily EOD Log (A–V exactly, computed columns included)
  const eod = wb.addWorksheet('Daily EOD Log');
  banner(eod, 'DAILY EOD LOG  —  one row per person per day');
  header(eod, ['Date', 'Week Starting', 'Month', 'Team Member', 'Department', 'Fixed Tasks Due', 'Fixed Tasks Done', 'Fixed %', 'Primary Metric', 'Target', 'Actual', 'Achievement %', 'Assigned: On Track', 'Assigned: At Risk', 'Assigned: Completed Today', 'Reactive Hours', 'Blocker?', 'Blocker Description', 'Who Can Unblock', 'Top 3 For Tomorrow', 'Submitted On Time?', 'Manager Reviewed?']);
  const { data: blockerRows } = await supabase.from('blockers')
    .select('day_close_id, description, unblocker:people!blockers_unblocker_id_fkey(full_name)');
  (closes ?? []).forEach((c, i) => {
    const blocker = (blockerRows ?? []).find((b) => b.day_close_id === c.id);
    eod.getRow(5 + i).values = [
      c.close_date, c.week_starting, c.month,
      (c.person as { full_name: string } | null)?.full_name, c.department,
      c.fixed_tasks_due, c.fixed_tasks_done,
      c.fixed_tasks_due ? c.fixed_tasks_done / c.fixed_tasks_due : '',
      c.primary_metric, c.target ?? '', c.actual ?? '',
      c.target ? (c.actual ?? 0) / c.target : '',
      c.assigned_on_track, c.assigned_at_risk, c.assigned_completed_today,
      c.reactive_hours, c.blocker ? 'Yes' : 'No',
      blocker?.description ?? '',
      (blocker?.unblocker as unknown as { full_name: string } | null)?.full_name ?? '',
      (c.top_3_tomorrow ?? []).join('; '),
      c.submitted_on_time ? 'Yes' : 'No', c.manager_reviewed ? 'Yes' : 'No',
    ];
  });
  eod.columns.forEach((c) => { c.width = 16; });
  arial(eod);

  // 8+9 · Weekly and Monthly Rollups with the cream control cell
  const visiblePeople = (people ?? []).filter((p) =>
    p.status !== 'Deactivated' && p.access_role !== 'Observer') as Person[];
  const rollupSheet = (
    name: string, label: string, control: string, expected: number,
    rows0: DayClose[], monthly: boolean,
  ) => {
    const ws = wb.addWorksheet(name);
    banner(ws, `${label}  —  auto-calculated from the Daily EOD Log`);
    ws.getCell('A4').value = monthly ? 'Month to view:' : 'Week to view:';
    ws.getCell('B4').value = control;
    ws.getCell('B4').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CREAM } };
    ws.getCell('A6').value = monthly ? 'Expected working days this month:' : 'Expected working days this week:';
    ws.getCell('B6').value = expected;
    const cols = ['Team Member', 'Department', 'Days Submitted', 'Submission Rate', 'On-Time Rate', 'Fixed Tasks Due', 'Fixed Tasks Done', 'Fixed Task %', 'Total Target', 'Total Actual', 'Achievement %'];
    header(ws, monthly ? [...cols, 'Reactive Hrs', 'Blockers Raised', 'Rating Input'] : [...cols, 'Status'], 8);
    const { rows, total } = buildRollup({ people: visiblePeople, closes: rows0, expectedDays: expected });
    rows.forEach((r, i) => {
      const base = [
        r.full_name, r.department, r.days_submitted,
        r.submission_rate ?? '', r.on_time_rate ?? '',
        r.fixed_due, r.fixed_done, r.fixed_pct ?? '',
        r.total_target, r.total_actual, r.achievement_pct ?? '',
      ];
      ws.getRow(9 + i).values = monthly
        ? [...base, r.reactive_hours, r.blockers_raised, r.rating]
        : [...base, r.status];
    });
    const totalRow = ws.getRow(9 + rows.length);
    totalRow.values = [
      'TEAM TOTAL', '', total.days_submitted, '', '',
      total.fixed_due, total.fixed_done, total.fixed_pct ?? '',
      total.total_target, total.total_actual, total.achievement_pct ?? '',
      ...(monthly ? [total.reactive_hours, total.blockers_raised, ''] : ['']),
    ];
    totalRow.font = { name: 'Arial', bold: true, size: 10 };
    ws.columns.forEach((c) => { c.width = 17; });
    if (monthly) {
      let r = 9 + rows.length + 3;
      ws.getCell(`A${r - 1}`).value = 'DEPARTMENT VIEW';
      const dv = buildDeptRollup(DEPARTMENTS, rows0,
        Object.fromEntries(DEPARTMENTS.map((d) => [d, visiblePeople.filter((p) => p.department === d).length])));
      header(ws, ['Department', 'Days Submitted', 'Fixed Task %', 'Total Target', 'Total Actual', 'Achievement %', 'Reactive Hrs'], r);
      dv.forEach((d, i) => {
        ws.getRow(r + 1 + i).values = d.active_people === 0
          ? [d.department, 'No active members']
          : [d.department, d.days_submitted, d.fixed_pct ?? '', d.total_target, d.total_actual, d.achievement_pct ?? '', d.reactive_hours];
      });
    }
    arial(ws);
  };

  const weekCloses = ((closes ?? []) as DayClose[]).filter((c) => c.week_starting === week);
  const monthCloses = ((closes ?? []) as DayClose[]).filter((c) => c.month === month);
  rollupSheet('Weekly Rollup', 'WEEK ROLLUP', week, settings.working_days_per_week, weekCloses, false);
  rollupSheet('Monthly Rollup', 'MONTH ROLLUP', month, settings.working_days_per_month, monthCloses, true);

  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="5C-Pulse-export-${todayLocalISO()}.xlsx"`,
    },
  });
}
