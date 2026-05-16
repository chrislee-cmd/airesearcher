import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { expandRequirementSlots } from '@/lib/scheduler/slots';
import type { Requirement } from '@/lib/scheduler/types';

// POST creates a public booking link from a requirement snapshot. Slots are
// fan-out into scheduler_booking_slots and start as 'open'. The slug is the
// user-facing token in /book/<slug>; we pick a short random base32 string.
//
// GET lists the caller's links (org-scoped). UI renders these as the
// "active links" panel under the scheduler canvas.

const Body = z.object({
  session_id: z.string().uuid().nullable().optional(),
  project_id: z.string().uuid().nullable().optional(),
  title: z.string().max(120).optional(),
  description: z.string().max(2000).optional(),
  timezone: z.string().max(80).optional(),
  expires_at: z.string().datetime().nullable().optional(),
  requirement: z.object({
    startDate: z.string(),
    endDate: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    durationMin: z.number(),
    daysOfWeek: z.array(z.number()),
    explicitSlots: z.array(z.any()).default([]),
    timezone: z.string().optional(),
  }),
});

function randomSlug(len = 10): string {
  // crockford-ish base32 minus easily confused chars
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org?.org_id) return NextResponse.json({ error: 'no_org' }, { status: 400 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid', detail: parsed.error.flatten() }, { status: 400 });
  }
  const body = parsed.data;
  const requirement = body.requirement as Requirement;
  const slots = expandRequirementSlots(requirement);
  if (slots.length === 0) {
    return NextResponse.json({ error: 'no_slots' }, { status: 400 });
  }

  // 3 attempts to avoid the rare slug collision
  let slug = randomSlug();
  let linkId: string | null = null;
  let lastErr: unknown = null;
  for (let i = 0; i < 3; i++) {
    const { data, error } = await supabase
      .from('scheduler_booking_links')
      .insert({
        org_id: org.org_id,
        user_id: user.id,
        session_id: body.session_id ?? null,
        project_id: body.project_id ?? null,
        slug,
        title: body.title ?? '',
        description: body.description ?? '',
        timezone: body.timezone || requirement.timezone || 'Asia/Seoul',
        requirement,
        expires_at: body.expires_at ?? null,
      })
      .select('id')
      .single();
    if (!error && data) {
      linkId = data.id;
      break;
    }
    lastErr = error;
    if (error?.code === '23505') {
      slug = randomSlug();
      continue;
    }
    break;
  }
  if (!linkId) {
    console.error('[scheduler/links] insert failed', lastErr);
    return NextResponse.json({ error: 'insert_failed' }, { status: 500 });
  }

  const rows = slots.map((s) => ({
    link_id: linkId,
    date: s.date,
    start_time: s.start,
    end_time: s.end,
  }));
  const { error: slotErr } = await supabase.from('scheduler_booking_slots').insert(rows);
  if (slotErr) {
    console.error('[scheduler/links] slot insert failed', slotErr);
    await supabase.from('scheduler_booking_links').delete().eq('id', linkId);
    return NextResponse.json({ error: 'slot_insert_failed' }, { status: 500 });
  }

  return NextResponse.json({ id: linkId, slug });
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const org = await getActiveOrg();
  if (!org?.org_id) return NextResponse.json({ links: [] });

  const { data: links, error } = await supabase
    .from('scheduler_booking_links')
    .select('id, slug, title, description, timezone, status, expires_at, created_at, requirement')
    .eq('org_id', org.org_id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    console.error('[scheduler/links] list failed', error);
    return NextResponse.json({ error: 'list_failed' }, { status: 500 });
  }
  if (!links || links.length === 0) return NextResponse.json({ links: [] });

  const ids = links.map((l) => l.id);
  const { data: slots } = await supabase
    .from('scheduler_booking_slots')
    .select('id, link_id, date, start_time, end_time, status')
    .in('link_id', ids);
  const { data: bookings } = await supabase
    .from('scheduler_bookings')
    .select('id, link_id, slot_id, name, email, created_at')
    .in('link_id', ids)
    .order('created_at', { ascending: false });

  const slotsByLink = new Map<string, typeof slots>();
  for (const s of slots ?? []) {
    const cur = slotsByLink.get(s.link_id) ?? [];
    cur.push(s);
    slotsByLink.set(s.link_id, cur);
  }
  const bookingsByLink = new Map<string, typeof bookings>();
  for (const b of bookings ?? []) {
    const cur = bookingsByLink.get(b.link_id) ?? [];
    cur.push(b);
    bookingsByLink.set(b.link_id, cur);
  }

  return NextResponse.json({
    links: links.map((l) => ({
      ...l,
      slots: slotsByLink.get(l.id) ?? [],
      bookings: bookingsByLink.get(l.id) ?? [],
    })),
  });
}
