import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

// Anonymous booking endpoint. Validates input then delegates to the
// book_slot RPC which atomically transitions the slot 'open' → 'booked'
// and inserts the booking in one transaction. Concurrency safety lives
// in the SQL: a second caller racing for the same slot gets
// 'slot_unavailable'.

const Body = z.object({
  slot_id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  note: z.string().trim().max(2000).optional().or(z.literal('')),
  custom_fields: z.record(z.string(), z.string()).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', detail: parsed.error.flatten() }, { status: 400 });
  }
  const { slot_id, name, email, phone, note, custom_fields } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('book_slot', {
    p_slug: slug,
    p_slot_id: slot_id,
    p_name: name,
    p_email: email,
    p_phone: phone || null,
    p_note: note || null,
    p_custom_fields: custom_fields ?? {},
  });
  if (error) {
    if (error.message?.includes('slot_unavailable')) {
      return NextResponse.json({ error: 'slot_unavailable' }, { status: 409 });
    }
    if (error.message?.includes('link_not_found')) {
      return NextResponse.json({ error: 'link_not_found' }, { status: 404 });
    }
    console.error('[public/scheduler/:slug/book] rpc failed', error);
    return NextResponse.json({ error: 'book_failed' }, { status: 500 });
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return NextResponse.json({ error: 'book_failed' }, { status: 500 });
  return NextResponse.json({
    booking_id: row.booking_id,
    cancel_token: row.cancel_token,
    slot: {
      date: row.slot_date,
      start: String(row.slot_start).slice(0, 5),
      end: String(row.slot_end).slice(0, 5),
    },
    title: row.link_title,
  });
}
