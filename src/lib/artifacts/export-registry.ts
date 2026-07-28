// Artifact 통합(narrow-waist) — Export 렌더러 레지스트리 = the export waist.
//
// registry.ts 가 리스팅(read-model)의 결합점이라면, 이 파일은 **다운로드
// (export)의 결합점**이다. 각 기능은 자기 (feature, format) 렌더러를 여기에
// 한 번 등록하고, 단일 진입점 라우트
//   GET /api/artifacts/[feature]/[id]/export/[format]
// 는 이 레지스트리만 조회해 스트림을 위임한다. 라우트에는 `if (feature ===
// 'transcript')` 같은 기능 분기가 없다 — 전부 렌더러 위임(리스트 라우트가
// adapter 에 위임하는 것과 동형).
//
// 렌더러 시그니처는 `(featureRow, ctx) => {body, mime, filename}`. featureRow 는
// 라우트가 스코프/상태 게이트를 위해 이미 조회한 가벼운 행(adapter.selectColumns).
// 본문(markdown/output/insight 등 무거운 컬럼)은 렌더러가 ctx.supabase 로
// 자기가 필요한 만큼 다시 조회한다 — CD BUILD-SPEC §5.2 의 "the document
// generator reads the full artifact, not the row" 경계를 그대로 따른다.

import type { DeliverableFeature } from './types';

type SupabaseServer = Awaited<
  ReturnType<typeof import('@/lib/supabase/server').createClient>
>;

// 성공 산출물. body 는 텍스트(md/txt/srt/csv) 또는 바이너리(docx) 스트림.
export type ExportResult = {
  body: Uint8Array | string;
  mime: string;
  filename: string;
};

// 렌더러 내부에서 자원이 준비 안 됐음을 라우트에 알리는 게이트(HTTP 상태로 매핑).
// 라우트가 이미 상태 게이트를 하지만, 이동(move)한 기존 렌더러가 자기만 아는
// 세부 조건(예: status=done 인데 markdown 이 비어있음)을 방어적으로 재확인할 수
// 있게 열어둔다.
export type ExportGate = { gate: 'not_found' | 'not_ready' };

export type ExportOutput = ExportResult | ExportGate;

export type ExportContext = {
  supabase: SupabaseServer;
  id: string;
  // 라우트가 검증한 스코프 값(org_id 또는 user_id) — 렌더러 재조회 시 재사용.
  scopeValue: string;
  searchParams: URLSearchParams;
};

export type ExportRenderer = (
  featureRow: Record<string, unknown>,
  ctx: ExportContext,
) => Promise<ExportOutput>;

const registry = new Map<string, ExportRenderer>();

function keyOf(feature: DeliverableFeature, format: string): string {
  return `${feature}:${format}`;
}

export function registerRenderer(
  feature: DeliverableFeature,
  format: string,
  fn: ExportRenderer,
): void {
  registry.set(keyOf(feature, format), fn);
}

export function getRenderer(
  feature: DeliverableFeature,
  format: string,
): ExportRenderer | null {
  return registry.get(keyOf(feature, format)) ?? null;
}

export function isGate(o: ExportOutput): o is ExportGate {
  return 'gate' in o;
}
