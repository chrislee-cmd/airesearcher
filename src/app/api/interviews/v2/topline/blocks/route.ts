import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';
import {
  getTopline,
  getProjectChunkIds,
  insertQaAfterAnchor,
  type ToplineBlock,
} from '@/lib/interview-v2/topline';

// 인터뷰 탑라인 blocks 편집 — drag-to-ask "유지" 병합.
//
// PATCH { project_id, anchor_block_id, question, selected_excerpt, answer_md,
//         citations }:
//   anchor 블록 바로 뒤에 inserted_qa 블록을 삽입해 blocks 를 영속한다.
//   citations 는 프로젝트 전체 chunk 집합에 대해 재검증(무효 chunk id drop —
//   verifyBlockCitations 와 동일 원리, "무효 id 0" 보장). content_hash 는
//   건드리지 않는다 — 이건 문서 셋 변경이 아니라 보고서 편집이라 stale 판정과
//   무관(사용자 결정 §C). 재생성(POST force)이 blocks 를 통째로 덮으면 삽입은
//   사라진다(클라가 경고 modal 로 명시 동의 받음 — 사용자 결정 3).
//
// "버리기"는 서버 미저장이라 클라 롤백으로 충분 — 이 라우트를 부르지 않는다.
//
// 격리: 프로젝트가 org 소유가 아니면 not_found. 쓰기는 admin client 지만
// 소유 검증 후에만 수행.

export const maxDuration = 30;

const Body = z.object({
  project_id: z.string().uuid(),
  anchor_block_id: z.string().trim().min(1).max(200),
  question: z.string().trim().min(1).max(2_000),
  selected_excerpt: z.string().trim().min(1).max(2_000),
  answer_md: z.string().trim().min(1).max(20_000),
  // 답변이 실제 인용한 chunk_id 목록(문자열). 서버가 project chunk 집합에
  // 대해 재검증한다.
  citations: z.array(z.string().trim().min(1)).max(50).optional().default([]),
});

export async function PATCH(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const org = await getActiveOrg();
  if (!org?.org_id) {
    return NextResponse.json({ error: 'no_org' }, { status: 403 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const {
    project_id,
    anchor_block_id,
    question,
    selected_excerpt,
    answer_md,
    citations,
  } = parsed.data;

  const admin = createAdminClient();

  // 프로젝트가 이 org 소유인지 확인 — 아니면 not_found(정보 누출 방지).
  const { data: projectRow } = await admin
    .from('interview_projects')
    .select('id')
    .eq('id', project_id)
    .eq('org_id', org.org_id)
    .maybeSingle();
  if (!projectRow) {
    return NextResponse.json({ error: 'project_not_found' }, { status: 404 });
  }

  const existing = await getTopline(admin, project_id);
  if (!existing) {
    return NextResponse.json({ error: 'topline_not_found' }, { status: 404 });
  }

  // 인용을 프로젝트 chunk 집합에 대해 재검증 — 지어낸/stale id drop.
  let validIds: Set<string>;
  try {
    validIds = await getProjectChunkIds(admin, org.org_id, project_id);
  } catch (e) {
    console.error('[v2/topline/blocks] chunk ids failed', e);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }
  const verifiedCitations = Array.from(
    new Set(citations.map((c) => c.trim())),
  ).filter((c) => validIds.has(c));

  const blocks = (existing.blocks ?? []) as ToplineBlock[];
  const nextBlocks = insertQaAfterAnchor(blocks, anchor_block_id, {
    id: `ins_${randomUUID()}`,
    md: answer_md,
    question,
    selected_excerpt,
    citations: verifiedCitations,
  });
  if (!nextBlocks) {
    // anchor 가 사라짐(그 사이 재생성 등) — 클라가 "삽입 위치를 못 찾음"으로
    // 안내하고 pending 을 버리게 한다.
    return NextResponse.json({ error: 'anchor_not_found' }, { status: 409 });
  }

  const { error: updErr } = await admin
    .from('interview_toplines')
    .update({ blocks: nextBlocks as unknown as object })
    .eq('id', existing.id);
  if (updErr) {
    console.error('[v2/topline/blocks] update failed', updErr);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }

  console.log('[v2/topline/blocks] merged', {
    project_id: project_id.slice(0, 8),
    anchor: anchor_block_id.slice(0, 24),
    citations_in: citations.length,
    citations_kept: verifiedCitations.length,
    blocks: nextBlocks.length,
  });

  return NextResponse.json({ ok: true, blocks: nextBlocks });
}
