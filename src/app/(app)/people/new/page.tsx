import { requireSession } from '@/lib/session';
import { supabaseServer } from '@/lib/supabase/server';
import { canManagePeople } from '@/lib/permissions';
import { Card, EmptyState } from '@/components/ui';
import { AddPersonWizard } from './wizard';

export const metadata = { title: 'Add a person' };
export const dynamic = 'force-dynamic';

export default async function NewPersonPage() {
  const { actor } = await requireSession();
  if (!canManagePeople(actor)) {
    return <Card><EmptyState title="Adding people needs people_admin (or the Owner)." /></Card>;
  }
  const supabase = supabaseServer();
  const { data: managers } = await supabase.from('people')
    .select('id, full_name, department').neq('status', 'Deactivated').order('full_name');

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="mb-4 font-display text-scale-1 font-bold">Add a person</h1>
      <AddPersonWizard managers={managers ?? []} />
    </div>
  );
}
