import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PublicBookingClient } from '@/components/scheduler/public-booking-client';

type Slot = { id: string; date: string; start: string; end: string; status: 'open' | 'booked' };

type RpcRow = {
  id: string;
  slug: string;
  title: string;
  description: string;
  timezone: string;
  expires_at: string | null;
  slot_id: string | null;
  slot_date: string | null;
  slot_start: string | null;
  slot_end: string | null;
  slot_status: string | null;
};

export default async function PublicBookingPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_booking_link', { p_slug: slug });
  if (error || !data || (data as RpcRow[]).length === 0) notFound();

  const rows = data as RpcRow[];
  const first = rows[0];
  const link = {
    id: first.id,
    slug: first.slug,
    title: first.title,
    description: first.description,
    timezone: first.timezone,
    expires_at: first.expires_at,
  };
  const slots: Slot[] = rows
    .filter((r) => r.slot_id)
    .map((r) => ({
      id: r.slot_id!,
      date: r.slot_date!,
      start: String(r.slot_start).slice(0, 5),
      end: String(r.slot_end).slice(0, 5),
      status: (r.slot_status as 'open' | 'booked') ?? 'open',
    }));

  return <PublicBookingClient link={link} initialSlots={slots} />;
}
