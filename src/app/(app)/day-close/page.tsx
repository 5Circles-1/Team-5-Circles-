import { requireSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase/server';
import { todayLocalISO, formatDayLong, isWorkingDay } from '@/lib/dates';
import { Card, CardBody, EmptyState } from '@/components/ui';
import { DayCloseForm } from './form';

export const metadata = { title: 'Day Close' };
export const dynamic = 'force-dynamic';

export default async function DayClosePage() {
  const { person, settings, holidays } = await requireSession();
  const supabase = supabaseServer();
  const today = todayLocalISO();

  if (!isWorkingDay(today, settings.weekly_off, holidays)) {
    return (
      <Card><CardBody>
        <EmptyState title="No Day Close today." hint="On weekends and holidays the form does not open, and nothing counts as missed." />
      </CardBody></Card>
    );
  }

  const [{ data: prefill }, { data: existing }, { data: teammates }, { data: kudosToday }] =
    await Promise.all([
      supabase.rpc('day_close_prefill', { p_person: person.id, p_date: today }),
      supabase.from('day_close').select('*').eq('person_id', person.id).eq('close_date', today).maybeSingle(),
      supabase.from('people').select('id, full_name, department')
        .neq('status', 'Deactivated').neq('id', person.id).order('full_name'),
      supabase.from('kudos').select('note, people!kudos_from_person_id_fkey(full_name)')
        .eq('to_person_id', person.id).gte('created_at', `${today}T00:00:00+05:30`),
    ]);

  if (!prefill) {
    return <Card><CardBody><EmptyState title="Could not load your day." hint="Try again in a moment." /></CardBody></Card>;
  }

  const windowClose = `${today}T${settings.window_close.slice(0, 5)}:00+05:30`;

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-4">
        <h1 className="font-display text-scale-1 font-bold">{formatDayLong(today)}</h1>
        <p className="text-scale-4 text-ink-muted">Close your day</p>
      </div>
      <DayCloseForm
        personName={person.full_name}
        today={today}
        prefill={prefill}
        existing={existing}
        teammates={teammates ?? []}
        windowCloseISO={windowClose}
        kudosToday={(kudosToday ?? []).map((k) => ({
          note: k.note,
          from: (k.people as unknown as { full_name: string } | null)?.full_name ?? 'Someone',
        }))}
      />
    </div>
  );
}
