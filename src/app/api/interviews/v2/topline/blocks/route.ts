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
  insertBlockAfterAnchor,
  editBlockMd,
  type ToplineBlock,
} from '@/lib/interview-v2/topline';

// 인터뷰 탑라인 blocks 편집 — drag-to-ask "유지" 병합 + 인라인 텍스트 편집 +
// 섹션 사이 삽입.
//
// 이 라우트는 PATCH 하나로 세 액션을 처리한다(action 필드로 구분, 없으면
// insert_qa = 하위호환):
//
// 1) insert_qa (기본) { project_id, anchor_block_id, question, selected_excerpt,
//    answer_md, citations }:
//    anchor 블록 바로 뒤에 inserted_qa 블록을 삽입해 blocks 를 영속한다.
//    citations 는 프로젝트 전체 chunk 집합에 대해 재검증(무효 chunk id drop —
//    verifyBlockCitations 와 동일 원리, "무효 id 0" 보장).
//
// 2) edit_block { action:'edit_block', project_id, block_id, md }:
//    기존 텍스트 블록의 md 를 새 내용으로 in-place 교체(인라인 편집 저장). 타입/
//    구조는 유지하고 텍스트만 바꾼다 — 스타일 편집 X(사용자 결정 1·3). table/
//    chart/pie 는 편집 대상이 아니라 editBlockMd 가 null → 422.
//
// 3) insert_section { action:'insert_section', project_id, anchor_block_id|null,
//    prompt, generated_md, citations }:
//    섹션 사이 gap 의 +버튼 → 명령 프롬프트로 section route 가 생성한 섹션 md 를
//    anchor 뒤(null = 최상단)에 inserted_section 블록으로 끼워 영속한다.
//
// content_hash 는 세 액션 모두 건드리지 않는다 — 문서 셋 변경이 아니라 보고서
// 편집이라 stale 판정과 무관(사용자 결정 §C). 삽입/편집분은 재생성(POST force)
// 에도 보존된다 — runTopline 이 사용자 삽입 블록(inserted_qa/inserted_section)을
// 새 보고서 끝에 다시 합친다(topline.ts extractInsertedBlocks/mergeInsertedBlocks).
//
// "버리기"는 서버 미저장이라 클라 롤백으로 충분 — 이 라우트를 부르지 않는다.
//
// 격리: 프로젝트가 org 소유가 아니면 not_found. 쓰기는 admin client 지만
// 소유 검증 후에만 수행.

export const maxDuration = 30;

const InsertQaBody = z.object({
  action: z.literal('insert_qa').optional(),
  project_id: z.string().uuid(),
  anchor_block_id: z.string().trim().min(1).max(200),
  question: z.string().trim().min(1).max(2_000),
  selected_excerpt: z.string().trim().min(1).max(2_000),
  answer_md: z.string().trim().min(1).max(20_000),
  // 답변이 실제 인용한 chunk_id 목록(문자열). 서버가 project chunk 집합에
  // 대해 재검증한다.
  citations: z.array(z.string().trim().min(1)).max(50).optional().default([]),
});

const EditBlockBody = z.object({
  action: z.literal('edit_block'),
  project_id: z.string().uuid(),
  block_id: z.string().trim().min(1).max(200),
  // 편집된 블록 텍스트(내용만). 빈 문자열 저장은 막는다(취소로 처리).
  md: z.string().trim().min(1).max(20_000),
});

const InsertSectionBody = z.object({
  action: z.literal('insert_section'),
  project_id: z.string().uuid(),
  // 삽입 지점 바로 위 블록 id. null = 최상단 gap(맨 앞 삽입). insert_qa 와 달리
  // gap 기반이라 최상단을 표현할 nullable anchor 를 받는다.
  anchor_block_id: z.string().trim().min(1).max(200).nullable(),
  // 사용자가 준 자연어 지시(섹션 라벨/문맥). 생성 시드는 section route 가 이미 씀.
  prompt: z.string().trim().min(1).max(2_000),
  // 생성된 섹션 markdown. section route 가 코퍼스 근거로 생성한 결과.
  generated_md: z.string().trim().min(1).max(20_000),
  // 섹션이 인용한 chunk_id — 서버가 project chunk 집합에 대해 재검증(무효 drop).
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

  const raw = (await req.json().catch(() => null)) as { action?: unknown } | null;
  const admin = createAdminClient();

  // ── 액션 2: 인라인 텍스트 편집(기존 블록 md 교체) ─────────────────────
  if (raw && raw.action === 'edit_block') {
    const parsed = EditBlockBody.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    }
    const { project_id, block_id, md } = parsed.data;

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

    const blocks = (existing.blocks ?? []) as ToplineBlock[];
    const nextBlocks = editBlockMd(blocks, block_id, md);
    if (!nextBlocks) {
      // 블록이 없거나(그 사이 재생성 등) 편집 불가 타입(table/chart/pie).
      // 클라가 편집 모드를 닫고 최신 blocks 로 되돌리게 한다.
      return NextResponse.json({ error: 'block_not_editable' }, { status: 422 });
    }

    const { error: editErr } = await admin
      .from('interview_toplines')
      .update({ blocks: nextBlocks as unknown as object })
      .eq('id', existing.id);
    if (editErr) {
      console.error('[v2/topline/blocks] edit update failed', editErr);
      return NextResponse.json({ error: 'db_error' }, { status: 500 });
    }

    console.log('[v2/topline/blocks] edited', {
      project_id: project_id.slice(0, 8),
      block: block_id.slice(0, 24),
      md_len: md.length,
      blocks: nextBlocks.length,
    });

    return NextResponse.json({ ok: true, blocks: nextBlocks });
  }

  // ── 액션 3: 섹션 사이 삽입(inserted_section 삽입·영속) ─────────────────
  // 섹션 gap 의 +버튼 → 명령 프롬프트로 section route 가 생성한 md 를 anchor
  // (gap 위 블록, null=최상단) 뒤에 끼워 영속한다. insert_qa 와 동일 원리 —
  // 재생성(force)에도 보존된다(topline.ts extractInsertedBlocks).
  if (raw && raw.action === 'insert_section') {
    const parsedSection = InsertSectionBody.safeParse(raw);
    if (!parsedSection.success) {
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
    }
    const { project_id, anchor_block_id, prompt, generated_md, citations } =
      parsedSection.data;

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
    let validSectionIds: Set<string>;
    try {
      validSectionIds = await getProjectChunkIds(admin, org.org_id, project_id);
    } catch (e) {
      console.error('[v2/topline/blocks] chunk ids failed', e);
      return NextResponse.json({ error: 'db_error' }, { status: 500 });
    }
    const verifiedSectionCitations = Array.from(
      new Set(citations.map((c) => c.trim())),
    ).filter((c) => validSectionIds.has(c));

    const blocks = (existing.blocks ?? []) as ToplineBlock[];
    const nextBlocks = insertBlockAfterAnchor(blocks, anchor_block_id, {
      id: `sec_${randomUUID()}`,
      type: 'inserted_section',
      md: generated_md,
      prompt,
      anchor_block_id,
      citations: verifiedSectionCitations,
    });
    if (!nextBlocks) {
      // anchor 가 사라짐(그 사이 재생성 등) — 클라가 "삽입 위치를 못 찾음"으로
      // 안내하고 pending 을 버리게 한다.
      return NextResponse.json({ error: 'anchor_not_found' }, { status: 409 });
    }

    const { error: secErr } = await admin
      .from('interview_toplines')
      .update({ blocks: nextBlocks as unknown as object })
      .eq('id', existing.id);
    if (secErr) {
      console.error('[v2/topline/blocks] section insert failed', secErr);
      return NextResponse.json({ error: 'db_error' }, { status: 500 });
    }

    console.log('[v2/topline/blocks] section inserted', {
      project_id: project_id.slice(0, 8),
      anchor: anchor_block_id ? anchor_block_id.slice(0, 24) : 'top',
      citations_in: citations.length,
      citations_kept: verifiedSectionCitations.length,
      blocks: nextBlocks.length,
    });

    return NextResponse.json({ ok: true, blocks: nextBlocks });
  }

  // ── 액션 1: drag-to-ask "유지" 병합(inserted_qa 삽입) ─────────────────
  const parsed = InsertQaBody.safeParse(raw);
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
