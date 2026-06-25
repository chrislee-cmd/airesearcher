// probing_suggestions — list (GET) + persist (POST).
//
// POST: called by probing-card after each suggest stream completes
// (fire-and-forget). Body { suggestion_set, transcript_cutoff? } → insert
// one row, return it so the client can replace the in-memory streaming
// card with the canonical DB row (carrying the real UUID + created_at).
//
// GET: called on widget mount to seed the historical list. RLS already
// scopes to auth.uid(), so the handler just orders by created_at DESC and
// applies the limit. Default 10, cap 50.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';

export const runtime = 'nodejs';
export const maxDuration = 15;

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const QuestionShape = z.object({
  text: z.string().min(1).max(2000),
  technique: z.string().max(64),
  why: z.string().max(2000),
});

const PostBody = z.object({
  suggestion_set: z.object({
    questions: z.array(QuestionShape).min(1).max(20),
  }),
  transcript_cutoff: z.string().max(60_000).optional(),
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
    return NextResponse.json({ error: 'no_organization' }, { status: 403 });
  }

  const parsed = PostBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  const { suggestion_set, transcript_cutoff } = parsed.data;

  const { data, error } = await supabase
    .from('probing_suggestions')
    .insert({
      org_id: org.org_id,
      user_id: user.id,
      suggestion_set,
      transcript_cutoff: transcript_cutoff ?? null,
    })
    .select('id, suggestion_set, transcript_cutoff, created_at')
    .single();
  if (error || !data) {
    console.error('[probing/suggestions] insert failed', error);
    return NextResponse.json({ error: 'insert_failed' }, { status: 500 });
  }
  return NextResponse.json({ row: data });
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
    return NextResponse.json({ error: 'no_organization' }, { status: 403 });
  }

  const url = new URL(req.url);
  const rawLimit = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(rawLimit)))
    : DEFAULT_LIMIT;

  const { data, error } = await supabase
    .from('probing_suggestions')
    .select('id, suggestion_set, transcript_cutoff, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('[probing/suggestions] list failed', error);
    return NextResponse.json({ error: 'fetch_failed' }, { status: 500 });
  }
  return NextResponse.json({ rows: data ?? [] });
}
