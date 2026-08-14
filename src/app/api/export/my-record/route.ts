import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { getSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase/server';
import { todayLocalISO } from '@/lib/dates';

export const dynamic = 'force-dynamic';

/** §16: every person can export their own complete record at any time.
 *  Their work, their data. RLS already scopes every query to them. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'sign in first' }, { status: 401 });
  const { person } = session;
  const supabase = supabaseServer();

  const [{ data: closes }, { data: tasks }, { data: kudos }, { data: blockers }] =
    await Promise.all([
      supabase.from('day_close').select('*').eq('person_id', person.id).order('close_date'),
      supabase.from('tasks').select('*')
        .or(`owner_id.eq.${person.id},assigned_by_id.eq.${person.id}`)
        .order('assigned_on'),
      supabase.from('kudos').select('*').eq('to_person_id', person.id).order('created_at'),
      supabase.from('blockers').select('*')
        .or(`raised_by_id.eq.${person.id},unblocker_id.eq.${person.id}`)
        .order('raised_at'),
    ]);

  const wb = new ExcelJS.Workbook();

  const sheet = (name: string, rows: Record<string, unknown>[] | null) => {
    const ws = wb.addWorksheet(name);
    if (!rows?.length) { ws.getCell('A1').value = 'No rows.'; return; }
    const cols = Object.keys(rows[0]);
    ws.getRow(1).values = cols;
    ws.getRow(1).font = { name: 'Arial', bold: true };
    rows.forEach((r, i) => {
      ws.getRow(2 + i).values = cols.map((c) => {
        const v = r[c];
        return Array.isArray(v) || (v && typeof v === 'object') ? JSON.stringify(v) : (v as string);
      });
    });
    ws.columns.forEach((c) => { c.width = 18; });
  };

  sheet('My Day Closes', closes);
  sheet('My Tasks', tasks);
  sheet('Kudos Received', kudos);
  sheet('My Blockers', blockers);

  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="my-record-${todayLocalISO()}.xlsx"`,
    },
  });
}
