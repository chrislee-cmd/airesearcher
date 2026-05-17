import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Public read of a booking link by slug. Uses the get_booking_link RPC
// (security definer) so we don't depend on RLS plumbing for the join.
// Returns 404 when missing/closed/expired.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_booking_link', { p_slug: slug });
  if (error) {
    console.error('[public/scheduler/:slug] rpc failed', error);
    return NextResponse.json({ error: 'fetch_failed' }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const first = data[0];
  const link = {
    id: first.id,
    slug: first.slug,
    title: first.title,
    description: first.description,
    timezone: first.timezone,
    expires_at: first.expires_at,
  };
  // Each row is one slot; rows with slot_id null mean a link with zero slots.
  const slots = data
    .filter((r: { slot_id: string | null }) => r.slot_id)
    .map((r: {
      slot_id: string;
      slot_date: string;
      slot_start: string;
      slot_end: string;
      slot_status: string;
    }) => ({
      id: r.slot_id,
      date: r.slot_date,
      start: r.slot_start.slice(0, 5),
      end: r.slot_end.slice(0, 5),
      status: r.slot_status,
    }));
  return NextResponse.json({ link, slots });
}
