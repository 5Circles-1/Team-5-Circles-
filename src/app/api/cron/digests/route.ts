import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendMail } from '@/lib/notify';
import { authorizeCron, logCronRun, todayIST } from '../_lib';
import { PRODUCT_NAME } from '@/lib/constants';

export const dynamic = 'force-dynamic';

/**
 * §12 digests, selected by ?kind= (one Vercel cron entry each, all times IST):
 *  morning   08:30 — everyone: your day
 *  nudge     18:45 — non-submitters only. One nudge. Never a second.
 *  managers  19:45 — who closed, who did not, new blockers, went At Risk
 *  weekly    Mon 07:00 — Owner + Heads: the Monday pack
 *  monthly   1st 07:00 — Owner + Heads: rollup + charter review reminders
 */
export async function GET(request: Request) {
  const unauthorized = authorizeCron(request);
  if (unauthorized) return unauthorized;
  const kind = new URL(request.url).searchParams.get('kind') ?? 'morning';
  const admin = supabaseAdmin();
  const today = todayIST();
  let sent = 0;

  const { data: isWorking } = await admin.rpc('is_working_day', { d: today });
  if (!isWorking && (kind === 'morning' || kind === 'nudge' || kind === 'managers')) {
    await logCronRun(`digest-${kind}`, { skipped: 'non-working day' });
    return NextResponse.json({ skipped: 'non-working day' });
  }

  const { data: people } = await admin.from('people')
    .select('*').eq('status', 'Active');

  if (kind === 'morning') {
    for (const p of people ?? []) {
      if (p.access_role === 'Observer') continue;
      const [{ data: fixed }, { data: due }, { data: owed }] = await Promise.all([
        admin.from('tasks').select('title').eq('owner_id', p.id)
          .eq('task_type', 'Fixed').eq('spawn_date', today),
        admin.from('tasks').select('task_code, title, due_at').eq('owner_id', p.id)
          .neq('task_type', 'Fixed')
          .not('status', 'in', '("Completed","Dropped","Declined","Missed")')
          .lte('due_at', `${today}T23:59:59+05:30`).order('due_at'),
        admin.from('blockers').select('description').eq('unblocker_id', p.id).is('resolved_at', null),
      ]);
      const lines = [
        `Your day, ${today}:`,
        fixed?.length ? `\nFixed work (${fixed.length}):\n${fixed.map((f) => `  · ${f.title}`).join('\n')}` : '',
        due?.length ? `\nDue or overdue (${due.length}):\n${due.map((d) => `  · ${d.task_code} ${d.title}`).join('\n')}` : '',
        owed?.length ? `\nBlockers you owe someone (${owed.length}):\n${owed.map((b) => `  · ${b.description}`).join('\n')}` : '',
        `\nClose your day between 18:00 and 19:30.`,
      ].filter(Boolean);
      await sendMail({ to: p.email, subject: `${PRODUCT_NAME} · your day`, text: lines.join('\n') });
      sent += 1;
    }
  }

  if (kind === 'nudge') {
    const { data: closed } = await admin.from('day_close').select('person_id').eq('close_date', today);
    const closedIds = new Set((closed ?? []).map((c) => c.person_id));
    for (const p of people ?? []) {
      if (closedIds.has(p.id) || p.access_role === 'Observer') continue;
      const { data: onLeave } = await admin.from('leaves').select('id')
        .eq('person_id', p.id).lte('starts_on', today).gte('ends_on', today).limit(1);
      if (onLeave?.length) continue; // no close expected on leave
      await sendMail({
        to: p.email,
        subject: `${PRODUCT_NAME} · 45 minutes left on today`,
        text: 'Your Day Close is open until 19:30. Four things and a submit — under five minutes.\n\nThis is the only nudge you will get.',
      });
      sent += 1;
    }
  }

  if (kind === 'managers') {
    const managers = (people ?? []).filter((p) =>
      ['Owner', 'Department Head', 'Team Lead'].includes(p.access_role));
    const [{ data: closes }, { data: newBlockers }, { data: wentAtRisk }] = await Promise.all([
      admin.from('day_close').select('person_id').eq('close_date', today),
      admin.from('blockers').select('description, raised_by_id')
        .gte('raised_at', `${today}T00:00:00+05:30`),
      admin.from('tasks').select('task_code, title, owner_id').eq('status', 'At Risk'),
    ]);
    const closedIds = new Set((closes ?? []).map((c) => c.person_id));
    for (const m of managers) {
      const reports = (people ?? []).filter((p) => p.reports_to_id === m.id);
      if (reports.length === 0 && m.access_role !== 'Owner') continue;
      const scope = m.access_role === 'Owner'
        ? (people ?? []).filter((p) => p.access_role !== 'Observer' && p.id !== m.id)
        : reports;
      const closedNames = scope.filter((r) => closedIds.has(r.id)).map((r) => r.full_name);
      const openNames = scope.filter((r) => !closedIds.has(r.id)).map((r) => r.full_name);
      const text = [
        `Closed today: ${closedNames.join(', ') || 'nobody yet'}`,
        `Not closed: ${openNames.join(', ') || 'nobody'}`,
        newBlockers?.length ? `\nNew blockers:\n${newBlockers.map((b) => `  · ${b.description}`).join('\n')}` : '',
        wentAtRisk?.length ? `\nAt Risk right now:\n${wentAtRisk.slice(0, 10).map((t) => `  · ${t.task_code} ${t.title}`).join('\n')}` : '',
        '\nThe review queue clears eight people in four minutes.',
      ].filter(Boolean).join('\n');
      await sendMail({ to: m.email, subject: `${PRODUCT_NAME} · who closed, who did not`, text });
      sent += 1;
    }
  }

  if (kind === 'weekly' || kind === 'monthly') {
    const leadership = (people ?? []).filter((p) =>
      p.access_role === 'Owner' || p.access_role === 'Department Head');
    const url = process.env.NEXT_PUBLIC_APP_URL ?? '';
    for (const m of leadership) {
      await sendMail({
        to: m.email,
        subject: kind === 'weekly'
          ? `${PRODUCT_NAME} · the Monday pack`
          : `${PRODUCT_NAME} · monthly rollup`,
        text: kind === 'weekly'
          ? `Last week's rollup, this week's due P1s, open blockers and the review-rate warning are ready:\n\n${url}/rollups?period=week\n\nExport the familiar Excel from the same page.`
          : `The monthly rollup with per-person rating inputs and charter review reminders is ready:\n\n${url}/rollups?period=month`,
      });
      sent += 1;
    }
  }

  await logCronRun(`digest-${kind}`, { sent });
  return NextResponse.json({ kind, sent });
}
