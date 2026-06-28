// probing_questions — list (GET) + persist (POST) per-question (PR-12).
//
// POST: 한 suggest stream 결과의 N 질문 각각을 개별 row 로 insert. body 는
// 단일 질문 한 개. 클라이언트는 Promise.all 로 N 개를 병렬 전송한다.
// 응답은 insert 된 row — 클라이언트가 in-memory state 에 즉시 prepend.
//
// GET: 위젯 mount 시 호출. RLS 가 auth.uid() 로 scope 하므로 핸들러는 정렬
// + limit 만. Default 50, cap 50 — 개별 단위라 한 stream 당 10 row 가 쌓이므로
// 위젯이 한 번에 보여줄 history 가 set 단위 (10) 와 같은 부피.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';

export const runtime = 'nodejs';
export const maxDuration = 15;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 50;

const PostBody = z.object({
  text: z.string().min(1).max(2000),
  technique: z.string().max(64),
  why: z.string().max(2000).optional().default(''),
  guide_reference: z.string().max(2000).optional(),
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
  const { text, technique, why, guide_reference, transcript_cutoff } =
    parsed.data;

  const { data, error } = await supabase
    .from('probing_questions')
    .insert({
      org_id: org.org_id,
      user_id: user.id,
      text,
      technique,
      why: why ?? '',
      guide_reference: guide_reference ?? null,
      transcript_cutoff: transcript_cutoff ?? null,
    })
    .select(
      'id, text, technique, why, guide_reference, transcript_cutoff, is_core, created_at',
    )
    .single();
  if (error || !data) {
    console.error('[probing/questions] insert failed', error);
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
  // GET is widget-hydration only — when the user has no active org
  // (translate flow can be reached before org selection completes) we
  // return an empty list rather than 403. The widget renders as a fresh
  // session in that case, no toast.
  const org = await getActiveOrg();
  if (!org?.org_id) {
    return NextResponse.json({ rows: [] });
  }

  const url = new URL(req.url);
  const rawLimit = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(rawLimit)))
    : DEFAULT_LIMIT;

  const { data, error } = await supabase
    .from('probing_questions')
    .select(
      'id, text, technique, why, guide_reference, transcript_cutoff, is_core, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    // Treat as graceful empty so the probing widget renders normally on
    // pages that mount it as a side-effect (e.g. translate). The most
    // common cause in prod is the `probing_questions` migration not yet
    // applied, which would otherwise turn every page mount into a noisy
    // 500 in the console.
    console.error('[probing/questions] list failed (graceful empty)', error);
    return NextResponse.json({ rows: [] });
  }
  return NextResponse.json({ rows: data ?? [] });
}
