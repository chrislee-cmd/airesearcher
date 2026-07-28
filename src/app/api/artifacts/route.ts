import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { DELIVERABLE_REGISTRY, type DeliverableAdapter } from '@/lib/artifacts/registry';
import type {
  DeliverableFeature,
  DeliverableRow,
  DeliverableStatus,
} from '@/lib/artifacts/types';

// GET /api/artifacts — 통합 산출물 리스트(봉투 read-model union).
//
// 각 adapter 의 가벼운 selectColumns 로 자기 테이블을 스코프 조회 → toRow 투영
// → union → created_at DESC 정렬 → 커서 페이지네이션. 라우트는 기능-blind:
// 모든 기능 지식은 레지스트리(adapter)에 있고 여기엔 기능 분기가 없다.

// 각 기능 테이블에서 끌어올 최대 행 수(union+facets 정확도를 위해 스코프 전체를
// 가져오되 폭주 방지 상한). 페이지네이션은 union 후 메모리에서 적용한다.
const PER_FEATURE_CAP = 200;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const KNOWN_STATUSES: DeliverableStatus[] = ['draft', 'processing', 'ready', 'error'];

function isFeature(v: string | null): v is DeliverableFeature {
  return v != null && Object.prototype.hasOwnProperty.call(DELIVERABLE_REGISTRY, v);
}
function isStatus(v: string | null): v is DeliverableStatus {
  return v != null && (KNOWN_STATUSES as string[]).includes(v);
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // org 은 선택 — org 스코프 기능(transcript/desk)은 org 없으면 조용히 빠지고,
  // user 스코프 기능(ut/recruiting)은 org 없이도 조회된다.
  const org = await getActiveOrg();

  const url = new URL(req.url);
  const sp = url.searchParams;
  const featureParam = sp.get('feature');
  const featureFilter: DeliverableFeature | null = isFeature(featureParam)
    ? featureParam
    : null;
  // 알 수 없는 feature 값이 오면 매칭 0 (빈 결과).
  const featureUnknown = featureParam != null && featureFilter == null;
  const projectId = sp.get('project_id');
  const folderId = sp.get('folder_id');
  const statusParam = sp.get('status');
  const statusFilter: DeliverableStatus | null = isStatus(statusParam)
    ? statusParam
    : null;
  const statusUnknown = statusParam != null && statusFilter == null;
  const q = sp.get('q')?.trim().toLowerCase() || null;
  const cursor = sp.get('cursor');
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number.parseInt(sp.get('limit') ?? '', 10) || DEFAULT_LIMIT),
  );

  const emptyResponse = NextResponse.json({
    rows: [],
    next_cursor: null,
    facets: { by_feature: {}, by_status: {} },
  });
  if (featureUnknown || statusUnknown) return emptyResponse;

  const adapters = Object.values(DELIVERABLE_REGISTRY);

  // ── 스코프 조회 + 투영(기능-blind) ────────────────────────────────────
  const perFeature = await Promise.all(
    adapters.map((adapter) => fetchRows(supabase, adapter, org?.org_id ?? null, user.id, {
      projectId,
      folderId,
    })),
  );
  let rows: DeliverableRow[] = perFeature.flat();

  // 제목 검색(q)은 정규화된 title 에 대해 서버 JS 에서 적용 — 기능마다 title
  // 파생 컬럼이 달라 DB 단일 컬럼 push 가 불가.
  if (q) rows = rows.filter((r) => r.title.toLowerCase().includes(q));

  // ── facets(필터 레일 카운트) — 페이지네이션과 무관, 자기 차원 제외 ──────
  // by_feature: status 필터만 적용(feature 필터 제외) → 모든 기능 카운트 노출.
  // by_status:  feature 필터만 적용(status 필터 제외) → 모든 상태 카운트 노출.
  const facets = {
    by_feature: countBy(
      statusFilter ? rows.filter((r) => r.status === statusFilter) : rows,
      (r) => r.feature,
    ),
    by_status: countBy(
      featureFilter ? rows.filter((r) => r.feature === featureFilter) : rows,
      (r) => r.status,
    ),
  };

  // ── 결과 행: feature + status 필터 → 정렬 → 커서 페이지네이션 ──────────
  let result = rows;
  if (featureFilter) result = result.filter((r) => r.feature === featureFilter);
  if (statusFilter) result = result.filter((r) => r.status === statusFilter);
  result.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));

  if (cursor) result = result.filter((r) => r.created_at < cursor);
  const hasMore = result.length > limit;
  const page = result.slice(0, limit);
  const next_cursor = hasMore ? page[page.length - 1].created_at : null;

  return NextResponse.json({ rows: page, next_cursor, facets });
}

// 단일 adapter 의 산출물을 스코프 조회 → toRow 투영. 실패/미지원 시 [].
async function fetchRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  adapter: DeliverableAdapter,
  orgId: string | null,
  userId: string,
  filters: { projectId: string | null; folderId: string | null },
): Promise<DeliverableRow[]> {
  const scopeValue = adapter.scopeColumn === 'org_id' ? orgId : userId;
  if (!scopeValue) return []; // org 스코프인데 활성 org 없음 → 조용히 빠짐

  const supportsProject = adapter.selectColumns.includes('project_id');
  const supportsFolder = adapter.selectColumns.includes('folder_id');
  // project/folder 필터가 걸렸는데 이 기능이 그 컬럼을 안 가지면(예: ut) 매칭 0.
  if (filters.projectId && !supportsProject) return [];
  if (filters.folderId && !supportsFolder) return [];

  let query = supabase
    .from(adapter.table)
    .select(adapter.selectColumns.join(','))
    .eq(adapter.scopeColumn, scopeValue);
  if (filters.projectId) query = query.eq('project_id', filters.projectId);
  if (filters.folderId) query = query.eq('folder_id', filters.folderId);
  query = query.order('created_at', { ascending: false }).limit(PER_FEATURE_CAP);

  const { data, error } = await query;
  if (error || !data) return [];
  return (data as unknown as Record<string, unknown>[]).map((row) => adapter.toRow(row));
}

function countBy<T>(items: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) {
    const k = key(it);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
