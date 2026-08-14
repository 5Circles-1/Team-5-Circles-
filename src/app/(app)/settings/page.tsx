import { requireSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase/server';
import { canEditSettings } from '@/lib/permissions';
import { Card, CardBody, CardHeader, CardTitle, EmptyState } from '@/components/ui';
import { SettingsForm, ResetDemoButton } from './parts';

export const metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const { actor, settings } = await requireSession();
  if (!canEditSettings(actor)) {
    return <Card><EmptyState title="Settings belong to the Owner." /></Card>;
  }
  const supabase = supabaseServer();
  const { data: timings } = await supabase.from('form_timings')
    .select('seconds').eq('form', 'day_close')
    .order('submitted_at', { ascending: false }).limit(200);

  const seconds = (timings ?? []).map((t) => t.seconds).sort((a, b) => a - b);
  const median = seconds.length ? seconds[Math.floor(seconds.length / 2)] : null;
  const overFive = median !== null && median > 300;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="font-display text-scale-1 font-bold">Settings</h1>

      {overFive ? (
        <Card className="border-attention/40">
          <CardBody>
            <p className="text-scale-4 text-attention font-medium">
              Day Close is taking {Math.round((median ?? 0) / 60)}m {Math.round((median ?? 0) % 60)}s at the median.
              Something has been added that should not have been.
            </p>
          </CardBody>
        </Card>
      ) : median !== null ? (
        <p className="text-scale-5 text-ink-muted">
          Median Day Close time: {Math.floor(median / 60)}m {median % 60}s — the five-minute promise holds.
        </p>
      ) : null}

      <Card>
        <CardHeader><CardTitle>Operating rules</CardTitle></CardHeader>
        <CardBody>
          <SettingsForm settings={settings} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Demo data</CardTitle></CardHeader>
        <CardBody className="space-y-2">
          <p className="text-scale-5 text-ink-muted">
            The workbook&apos;s seed (8 people, 40 duties, 28 KPI rows) is illustrative placeholder
            data. Reset clears it and leaves the schema — your own account survives as root Owner.
          </p>
          <ResetDemoButton />
        </CardBody>
      </Card>
    </div>
  );
}
