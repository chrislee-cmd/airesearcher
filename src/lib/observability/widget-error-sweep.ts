// 중앙 에러 관측 Phase 1 — 위젯 job-fail 스윕 (docs/error-observability.md §3).
//
// admin/analytics.ts 의 widgetHealth 레지스트리(WIDGET_HEALTH_SOURCES)를 SSOT 로
// 재사용해, 각 위젯 job 테이블의 신규 fail 행을 error_events 로 적재한다. 개별
// catch 계측 없이 desk/insights/transcript/interview/translate 등 전 위젯의 job
// 실패를 자동 커버하는 게 목적(대량 커버리지).
//
// ── dedup / 워터마크 (별도 config 테이블 없이) ──
// 각 fail 행은 그 원인에 맞는 signature 로 collapse 된다(아래 signatureFor). 재집계
// (같은 fail 을 매 스윕마다 다시 count)를 막기 위해, 그 시그니처 error_event 의
// last_seen 을 워터마크로 삼는다: created_at > last_seen 인 fail 행만 신규로 보고
// record_error_event 를 호출한다(호출이 last_seen 을 now() 로 밀어올리므로 다음
// 스윕에서 재집계되지 않음).
//
// 【정합 필수】 워터마크 조회와 record 는 **반드시 같은 signature** 를 써야 한다.
// (과거 버그: 워터마크는 `${table} job failed`(status 없음) 로 조회하고 record 는
// `${table} job failed (status=X)` 로 적재 → 두 signature 가 달라 워터마크가 항상
// null → 매 스윕마다 7일치 재스캔·재카운트 → count 인플레(translate 실제 4 → 28).)
// 그래서 이 파일은 signatureFor() 한 곳에서 (feature, status, error_message) 로
// signature/code/message 를 계산하고, 그 결과를 워터마크 맵 조회와 logError 에
// 동일하게 흘려보낸다.
//
// ── 원인별 분리 (error_message 를 signature 에 반영) ──
// 테이블에 error_message(insights 는 failure_reason) 컬럼이 있으면 그 값을 읽어
// 원인별로 signature 를 가른다 — webrtc_failed 와 translate_timeout 이 별 incident
// 로 분리되어 이메일/메모에 원인 문자열이 바로 표시된다. 자유텍스트 과분할을
// 막으려고 code 축의 원인 토큰도 logError 와 같은 normalizeMessage 를 태운다
// (숫자/uuid/타임스탬프 마스킹). 컬럼 없음/값 null 은 coarse `job_failed` 폴백.
//
// 최초 스윕(해당 시그니처 행이 아직 없음)은 워터마크가 없으므로 FIRST_RUN_WINDOW
// 안의 최근 실패만 집계한다 — 오래된 역사적 백로그가 하루치 flood 로 잡히는 걸
// 방지. 트레이드오프: 아주 오래된 실패는 소스에 안 들어오지만, 관측 목적(현재
// 열려있는 실패의 신선도)엔 최근 창이면 충분.

import { createAdminClient } from '@/lib/supabase/admin';
import { WIDGET_HEALTH_SOURCES } from '@/lib/admin/analytics';
import { computeSignature, logError, normalizeMessage } from '@/lib/observability/log-error';

type Admin = ReturnType<typeof createAdminClient>;

// 최초 스윕에서 되돌아볼 최대 창 — 역사적 백로그 flood 방지.
const FIRST_RUN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
// 한 스윕에서 테이블당 처리할 신규 fail 행 상한(RPC 호출 폭주 방지). 최신순으로
// 이 상한만큼 조회하므로, 고빈도 실패 테이블에서도 항상 최근 실패를 본다(starve X).
const MAX_ROWS_PER_TABLE = 500;
// signature code 축에 실을 원인 토큰 상한 — 자유텍스트 error_message 의
// cardinality 폭주 가드(정규화로도 안 잡히는 초장문 방지).
const CAUSE_CODE_MAX = 80;

// 이 feature 의 job-sweep signature 별 마지막 집계 시각(워터마크) 맵.
// signature -> last_seen. 데이터 의존적으로 signature 가 정해지므로(원인·status),
// 사전에 개별 조회하지 않고 feature 단위로 한 번에 읽어 맵으로 만든다.
async function watermarksFor(admin: Admin, feature: string): Promise<Map<string, string>> {
  const { data } = await admin
    .from('error_events')
    .select('signature, last_seen')
    .eq('feature', feature)
    .eq('source', 'job-sweep');
  const map = new Map<string, string>();
  for (const r of (data ?? []) as { signature: string | null; last_seen: string | null }[]) {
    if (r.signature && r.last_seen) map.set(r.signature, r.last_seen);
  }
  return map;
}

// 한 fail 행의 (feature, status, error_message) → signature/code/message.
// 워터마크 맵 조회와 logError 가 **동일하게** 이 함수를 통과해야 정합이 유지된다.
function signatureFor(
  feature: string,
  table: string,
  status: string | null,
  errorMessage: string | null,
): { signature: string; code: string; message: string } {
  const statusPart = status ?? 'unknown';
  // 원인 토큰: logError 와 같은 normalizeMessage 로 마스킹(숫자/uuid/ts) → 과분할
  // 방지. 빈 값이면 coarse 폴백(원인 없이 status 만).
  const cause = normalizeMessage(errorMessage).slice(0, CAUSE_CODE_MAX).trim();
  const code = cause ? `job_failed:${cause}` : 'job_failed';
  // 원문 error_message 는 message 에 그대로 실어 signature(=normalize(message))가
  // 원인별로 갈리게 한다. 원문은 logError 가 컬럼 상한으로 안전하게 자른다.
  const message = errorMessage
    ? `${table} job failed (status=${statusPart}): ${errorMessage}`
    : `${table} job failed (status=${statusPart})`;
  return { signature: computeSignature({ feature, code, message }), code, message };
}

export type WidgetSweepResult = {
  table: string;
  feature: string;
  newFails: number;
  skipped?: string; // 테이블 없음(마이그 미적용) 등으로 건너뛴 사유.
};

type FailRow = {
  id: string;
  status: string | null;
  created_at: string;
  error_message: string | null;
};

// fail 행 조회 — error_message(설정된 컬럼) 를 함께 읽되, 그 컬럼이 없는 테이블은
// 컬럼 없이 재시도해 coarse 폴백. 반환 rows 는 error_message 별칭으로 통일.
async function fetchFailRows(
  admin: Admin,
  table: string,
  statusCol: string,
  fail: string[],
  cutoffIso: string,
  errorCol: string | null,
): Promise<{ rows: FailRow[] | null; error?: string }> {
  const statusSel = statusCol === 'status' ? 'status' : `status:${statusCol}`;

  const run = async (withError: boolean) => {
    const cols = ['id', statusSel, 'created_at'];
    if (withError && errorCol) {
      cols.push(errorCol === 'error_message' ? 'error_message' : `error_message:${errorCol}`);
    }
    return admin
      .from(table)
      .select(cols.join(', '))
      .in(statusCol, fail)
      .gt('created_at', cutoffIso)
      // 최신순 + 상한 — 고빈도 테이블에서 새 실패가 굶지 않게(오래된 백로그가
      // 상한을 채워 최근 행을 못 보는 asc-limit 함정 회피).
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS_PER_TABLE);
  };

  let res = errorCol ? await run(true) : await run(false);
  if (res.error && errorCol) {
    // error 컬럼이 이 테이블에 없을 수 있음(마이그 미적용/오설정) — 컬럼 없이 재시도.
    res = await run(false);
  }
  if (res.error) return { rows: null, error: res.error.message };
  const rows = (res.data ?? []) as unknown as FailRow[];
  return { rows: rows.map((r) => ({ ...r, error_message: r.error_message ?? null })) };
}

// 한 테이블의 신규 fail 을 워터마크 이후로 집계해 error_events 로 적재.
async function sweepOne(
  admin: Admin,
  src: (typeof WIDGET_HEALTH_SOURCES)[number],
): Promise<WidgetSweepResult> {
  const statusCol = src.statusColumn ?? 'status';
  const errorCol = src.errorColumn === undefined ? 'error_message' : src.errorColumn;

  // 이 feature 의 job-sweep 워터마크 스냅샷(원인·status 별 signature -> last_seen).
  const watermarks = await watermarksFor(admin, src.feature);
  // 조회 창은 항상 최근 FIRST_RUN_WINDOW. 이미 집계된 행은 아래 per-signature
  // 워터마크 비교로 in-memory skip 하므로, 창을 워터마크로 앞당길 필요가 없다
  // (최신순 + 상한이라 재조회 비용도 저렴). 최초 스윕이든 이후든 동일 창을 훑어
  // 신규 원인/status 를 놓치지 않는다.
  const cutoffIso = new Date(Date.now() - FIRST_RUN_WINDOW_MS).toISOString();

  const { rows, error } = await fetchFailRows(
    admin,
    src.table,
    statusCol,
    src.fail,
    cutoffIso,
    errorCol,
  );
  if (error || rows === null) {
    // 테이블 없음(이 env 에 마이그 미적용) 등 — 대시보드처럼 degrade.
    return { table: src.table, feature: src.feature, newFails: 0, skipped: error };
  }
  if (rows.length === 0) {
    return { table: src.table, feature: src.feature, newFails: 0 };
  }

  // 최신순으로 받았으나, 같은 signature 의 context 가 최신 샘플로 남도록 오래된 →
  // 최신 순서로 처리한다(마지막 logError 가 최신 행).
  const ascending = rows.slice().reverse();

  let newFails = 0;
  for (const r of ascending) {
    const { signature, code, message } = signatureFor(
      src.feature,
      src.table,
      r.status,
      r.error_message,
    );
    const watermark = watermarks.get(signature);
    // 워터마크 없음(=신규 원인) 또는 워터마크 이후 생성행만 신규로 집계.
    if (watermark && r.created_at <= watermark) continue;

    // logError 는 내부에서 같은 {feature, code, message} 로 signature 를 계산하므로
    // 위 watermark 조회 signature 와 반드시 일치한다(정합). 절대 throw 안 함.
    await logError({
      feature: src.feature,
      code,
      message,
      context: {
        table: src.table,
        sample_id: r.id,
        status: r.status,
        error_message: r.error_message,
        created_at: r.created_at,
      },
      severity: 'error',
      source: 'job-sweep',
    });
    newFails += 1;
  }

  return { table: src.table, feature: src.feature, newFails };
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
