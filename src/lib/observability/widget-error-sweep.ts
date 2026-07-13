// 중앙 에러 관측 Phase 1 — 위젯 job-fail 스윕 (docs/error-observability.md §3).
//
// admin/analytics.ts 의 widgetHealth 레지스트리(WIDGET_HEALTH_SOURCES)를 SSOT 로
// 재사용해, 각 위젯 job 테이블의 신규 fail 행을 error_events 로 적재한다. 개별
// catch 계측 없이 desk/insights/transcript/interview/translate 등 전 위젯의 job
// 실패를 자동 커버하는 게 목적(대량 커버리지).
//
// ── dedup / 워터마크 (별도 config 테이블 없이) ──
// 테이블 T 의 실패는 signature(feature='<key>', code='job_failed') 하나로
// collapse 된다 — occurrence flood 가 error_events 행 1개의 count 로 집계된다
// (spec §4). 재집계(같은 fail 을 매 스윕마다 다시 count)를 막기 위해, 그 시그니처
// error_event 의 last_seen 을 워터마크로 삼는다: created_at > last_seen 인 fail
// 행만 신규로 보고 record_error_event 를 호출한다(호출이 last_seen 을 now() 로
// 밀어올리므로 다음 스윕에서 재집계되지 않음).
//
// 최초 스윕(해당 시그니처 행이 아직 없음)은 워터마크가 없으므로 FIRST_RUN_WINDOW
// 안의 최근 실패만 집계한다 — 오래된 역사적 백로그가 하루치 flood 로 잡히는 걸
// 방지. 트레이드오프: 아주 오래된 실패는 소스에 안 들어오지만, 관측 목적(현재
// 열려있는 실패의 신선도)엔 최근 창이면 충분.
//
// 코스(coarse) 설계 의도: 이 스윕은 테이블 단위 커버리지다. 세분 원인 grouping 은
// 개별 catch 의 logError(code 로 원인 구분)가 담당한다.

import { createAdminClient } from '@/lib/supabase/admin';
import { WIDGET_HEALTH_SOURCES } from '@/lib/admin/analytics';
import { computeSignature, logError } from '@/lib/observability/log-error';

type Admin = ReturnType<typeof createAdminClient>;

// 최초 스윕에서 되돌아볼 최대 창 — 역사적 백로그 flood 방지.
const FIRST_RUN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
// 한 스윕에서 테이블당 처리할 신규 fail 행 상한(RPC 호출 폭주 방지).
const MAX_ROWS_PER_TABLE = 500;

// 이 시그니처의 마지막 집계 시각(워터마크). 행이 없으면 null.
async function watermarkFor(admin: Admin, signature: string): Promise<string | null> {
  const { data } = await admin
    .from('error_events')
    .select('last_seen')
    .eq('signature', signature)
    .maybeSingle();
  return (data?.last_seen as string | undefined) ?? null;
}

export type WidgetSweepResult = {
  table: string;
  feature: string;
  newFails: number;
  skipped?: string; // 테이블 없음(마이그 미적용) 등으로 건너뛴 사유.
};

// 한 테이블의 신규 fail 을 워터마크 이후로 집계해 error_events 로 적재.
async function sweepOne(
  admin: Admin,
  src: (typeof WIDGET_HEALTH_SOURCES)[number],
): Promise<WidgetSweepResult> {
  const statusCol = src.statusColumn ?? 'status';
  // 이 테이블의 실패를 대표하는 단일 시그니처(코스 집계).
  const signature = computeSignature({
    feature: src.feature,
    code: 'job_failed',
    message: `${src.table} job failed`,
  });

  const watermark = await watermarkFor(admin, signature);
  const cutoffIso = watermark ?? new Date(Date.now() - FIRST_RUN_WINDOW_MS).toISOString();

  // 실패 상태 행 중 cutoff 이후 생성분만. status 컬럼은 테이블마다 다를 수 있어
  // 별칭으로 통일(analytics.ts 와 동일 관례). created_at 은 전 job 테이블 공통.
  const selectCols =
    statusCol === 'status'
      ? 'id, status, created_at'
      : `id, status:${statusCol}, created_at`;
  const { data, error } = await admin
    .from(src.table)
    .select(selectCols)
    .in(statusCol, src.fail)
    .gt('created_at', cutoffIso)
    .order('created_at', { ascending: true })
    .limit(MAX_ROWS_PER_TABLE);
  if (error) {
    // 테이블 없음(이 env 에 마이그 미적용) 등 — 대시보드처럼 degrade.
    return { table: src.table, feature: src.feature, newFails: 0, skipped: error.message };
  }

  const rows = (data ?? []) as unknown as { id: string; status: string | null; created_at: string }[];
  if (rows.length === 0) {
    return { table: src.table, feature: src.feature, newFails: 0 };
  }

  // 신규 fail 마다 한 번씩 upsert — 같은 시그니처라 count 만 오르고 행은 1개.
  // context 는 최신 샘플(마지막 행)로 남는다. logError 는 절대 throw 안 함.
  for (const r of rows) {
    await logError({
      feature: src.feature,
      code: 'job_failed',
      message: `${src.table} job failed (status=${r.status ?? 'unknown'})`,
      context: { table: src.table, sample_id: r.id, status: r.status, created_at: r.created_at },
      severity: 'error',
      source: 'job-sweep',
    });
  }

  return { table: src.table, feature: src.feature, newFails: rows.length };
}

// 전 위젯 테이블 스윕. best-effort — 개별 테이블 실패가 전체를 막지 않는다.
export async function sweepWidgetErrors(admin?: Admin): Promise<WidgetSweepResult[]> {
  const db = admin ?? createAdminClient();
  const results: WidgetSweepResult[] = [];
  for (const src of WIDGET_HEALTH_SOURCES) {
    try {
      results.push(await sweepOne(db, src));
    } catch (e) {
      results.push({
        table: src.table,
        feature: src.feature,
        newFails: 0,
        skipped: e instanceof Error ? e.message : 'sweep_error',
      });
    }
  }
  return results;
}
