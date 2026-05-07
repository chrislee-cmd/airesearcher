import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';

// Persists scheduler state per (org, user). The scheduler is not a
// pipeline — it's a saved canvas of attendees + selected time slots.
// We auto-save the canvas on the client side and store one "latest
// session" per user so the next visit / next device hydrates with the
// same view. The dashboard reads the list to surface recent activity.

const Attendee = z.object({}).passthrough(); // shape lives in src/lib/scheduler/types
const Slot = z.object({}).passthrough();

const Body = z.object({
  project_id: z.string().uuid().nullable().optional(),
  name: z.string().max(120).optional(),
  attendees: z.array(Attendee),
  selected_slots: z.array(Slot),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const org = await getActiveOrg();
  if (!org?.org_id) {
    return NextResponse.json({ error: 'no_org' }, { status: 400 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  const { project_id, name, attendees, selected_slots, meta } = parsed.data;

  // One session per (org, user, project_id) — newest wins. Look up the
  // existing row first; if found, update it. Otherwise insert. We don't
  // use a unique constraint because project_id is nullable and uniqueness
  // semantics on NULL differ across versions.
  const existingQuery = supabase
    .from('scheduler_sessions')
    .select('id')
    .eq('org_id', org.org_id)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1);
  const { data: existing } = project_id
    ? await existingQuery.eq('project_id', project_id)
    : await existingQuery.is('project_id', null);

  const row = {
    org_id: org.org_id,
    project_id: project_id ?? null,
    user_id: user.id,
    name: name ?? '',
    attendees,
    selected_slots,
    meta: meta ?? {},
  };

  if (existing && existing.length > 0) {
    const { data, error } = await supabase
      .from('scheduler_sessions')
      .update(row)
      .eq('id', existing[0].id)
      .select('id')
      .single();
    if (error) {
      console.error('[scheduler/sessions] update error', error);
      return NextResponse.json({ error: 'update_failed' }, { status: 500 });
    }
    return NextResponse.json({ id: data.id, mode: 'updated' });
  }

  const { data, error } = await supabase
    .from('scheduler_sessions')
    .insert(row)
    .select('id')
    .single();
  if (error) {
    console.error('[scheduler/sessions] insert error', error);
    return NextResponse.json({ error: 'insert_failed' }, { status: 500 });
  }
  return NextResponse.json({ id: data.id, mode: 'inserted' });
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const org = await getActiveOrg();
  if (!org?.org_id) {
    return NextResponse.json({ sessions: [] });
  }

  const url = new URL(req.url);
  const projectId = url.searchParams.get('project_id');
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 20), 100);

  let query = supabase
    .from('scheduler_sessions')
    .select(
      'id, project_id, name, attendees, selected_slots, meta, created_at, updated_at',
    )
    .eq('org_id', org.org_id)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (projectId) query = query.eq('project_id', projectId);

  const { data, error } = await query;
  if (error) {
    console.error('[scheduler/sessions] list error', error);
    return NextResponse.json({ error: 'list_failed' }, { status: 500 });
  }
  return NextResponse.json({ sessions: data ?? [] });
}
