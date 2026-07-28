import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { contentDispositionHeader } from '@/lib/filename';
import {
  DELIVERABLE_REGISTRY,
  type DeliverableAdapter,
} from '@/lib/artifacts/registry';
import type { DeliverableFeature } from '@/lib/artifacts/types';
import { getRenderer, isGate } from '@/lib/artifacts/export-registry';
// 렌더러 등록 부수효과(4기능 × 포맷) — 이 import 가 레지스트리를 채운다.
import '@/lib/artifacts/renderers';

// GET /api/artifacts/[feature]/[id]/export/[format] — 산출물 export 단일 진입점.
//
// 라우트는 기능-blind: 모든 기능 지식은 registry(adapter)와 export-registry
// (렌더러)에 있고 여기엔 `if (feature === …)` 분기가 없다(리스트 라우트와 동형).
//   1. feature 해석(registry) → 없으면 404
//   2. format ∈ adapter.exportFormats → 아니면 404
//   3. 스코프 조회(adapter.table/idColumn/scopeColumn) → 없으면 404
//   4. 상태 ready(adapter.toRow(row).status) → 아니면 409
//   5. 렌더러 위임(getRenderer) → 스트림 반환
//
// docx 생성이 느릴 수 있어 여유를 둔다(desk export 라우트와 동형).
export const maxDuration = 60;

function isFeature(v: string): v is DeliverableFeature {
  return Object.prototype.hasOwnProperty.call(DELIVERABLE_REGISTRY, v);
}

function statusFromRow(
  adapter: DeliverableAdapter,
  row: Record<string, unknown>,
): string {
  // toRow 가 기능별 상태 로직(예: UT insight_status 우선)을 캡슐화하므로
  // 라우트는 정규화된 status 만 본다 — 기능 분기 없이 ready 게이트.
  try {
    return adapter.toRow(row).status;
  } catch {
    return 'error';
  }
}

export async function GET(
  req: Request,
  {
    params,
  }: { params: Promise<{ feature: string; id: string; format: string }> },
) {
  const { feature, id, format } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  if (!isFeature(feature)) {
    return NextResponse.json({ error: 'unknown_feature' }, { status: 404 });
  }
  const adapter = DELIVERABLE_REGISTRY[feature];

  // format 은 반드시 adapter 가 선언한 export 포맷이어야 한다(포맷 목록 SSOT).
  if (!adapter.exportFormats.includes(format)) {
    return NextResponse.json({ error: 'unsupported_format' }, { status: 404 });
  }
  const renderer = getRenderer(feature, format);
  if (!renderer) {
    // exportFormats 에 있으나 렌더러 미등록 — 방어(정상적으론 발생 안 함).
    return NextResponse.json({ error: 'unsupported_format' }, { status: 404 });
  }

  // 스코프: org 스코프 기능은 활성 org, user 스코프 기능은 user.id 로 검증.
  const org = await getActiveOrg();
  const scopeValue =
    adapter.scopeColumn === 'org_id' ? (org?.org_id ?? null) : user.id;
  if (!scopeValue) {
    // org 스코프인데 활성 org 없음 → 접근 불가(타 org 차단과 동일 취급).
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const { data: row, error } = await supabase
    .from(adapter.table)
    .select(adapter.selectColumns.join(','))
    .eq(adapter.idColumn, id)
    .eq(adapter.scopeColumn, scopeValue)
    .single();
  if (error || !row) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const featureRow = row as unknown as Record<string, unknown>;

  if (statusFromRow(adapter, featureRow) !== 'ready') {
    return NextResponse.json({ error: 'not_ready' }, { status: 409 });
  }

  const url = new URL(req.url);
  const result = await renderer(featureRow, {
    supabase,
    id,
    scopeValue,
    searchParams: url.searchParams,
  });

  if (isGate(result)) {
    return result.gate === 'not_found'
      ? NextResponse.json({ error: 'not_found' }, { status: 404 })
      : NextResponse.json({ error: 'not_ready' }, { status: 409 });
  }

  const body =
    typeof result.body === 'string' ? result.body : new Uint8Array(result.body);
  const contentLength =
    typeof result.body === 'string'
      ? Buffer.byteLength(result.body, 'utf8')
      : result.body.byteLength;
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': result.mime,
      'content-disposition': contentDispositionHeader(result.filename),
      'content-length': String(contentLength),
    },
  });
}
