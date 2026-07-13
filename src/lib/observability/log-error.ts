// 중앙 에러 관측 Phase 1 — logError() 헬퍼 (docs/error-observability.md).
//
// 제품 어디서든 catch 안에서 한 줄로 호출하는 인제스트 진입점. signature 를
// 계산해 record_error_event RPC 로 원자적 upsert 한다. 같은 원인의 재발은
// 신규 행이 아니라 count++/last_seen 갱신으로 collapse (occurrence flood 방지).
//
// ── 절대 규칙: throw 금지 (best-effort) ──
// 관측이 기능을 깨면 안 된다. RPC 실패·env 누락·직렬화 오류 등 어떤 이유로도
// 이 함수는 예외를 밖으로 던지지 않는다. 실패 시 console.error 로만 폴백하고
// 조용히 반환한다. 호출측은 await 해도 되고 fire-and-forget 해도 된다.
//
// ── signature 정규화 (품질 핵심) ──
// signature = sha256(feature + '|' + code + '|' + normalizeMessage(message)).
// 정규화가 message 안의 가변 토큰(숫자·UUID·타임스탬프·따옴표 리터럴)을
// 마스킹하므로, "job 3f2a… failed at 12:04:11" 같은 메시지들이 한 시그니처로
// 뭉친다. 과분할(메모 flood)과 과병합(원인 뭉개짐) 사이의 균형점 —
// 마스킹 규칙을 바꾸면 dedup 경계가 바뀌므로 신중히.

import { createAdminClient } from '@/lib/supabase/admin';
import { hashString } from '@/lib/cache';

export type ErrorFeature =
  | 'interview'
  | 'billing'
  | 'desk'
  | 'transcript'
  | 'insights'
  | 'translate'
  | 'db'
  | string; // widgetHealth 키 확장을 열어둠 — 새 위젯이 자유 문자열로 적재.

export type ErrorSeverity = 'error' | 'warn';
export type ErrorSource = 'app' | 'db-poll' | 'job-sweep';

export type LogErrorInput = {
  feature: ErrorFeature;
  // 세분 코드 — signature 의 핵심 축. 같은 feature 안에서 원인을 가른다.
  // 예: 'chunk_insert_failed' | 'checkout_503' | 'statement_timeout'.
  code?: string | null;
  // 원문 메시지. 정규화 전 원문 1건이 message 컬럼에 보관되고, 정규화본은
  // signature 에만 쓰인다.
  message?: string | null;
  // 샘플 컨텍스트(id/route/org 등). PII 최소화 — 표본 1건이면 충분.
  context?: Record<string, unknown> | null;
  severity?: ErrorSeverity;
  source?: ErrorSource;
};

// 가변 토큰 마스킹. 순서 주의 — UUID/타임스탬프를 숫자 마스킹보다 먼저 처리해야
// 부분 매칭으로 쪼개지지 않는다.
export function normalizeMessage(raw: string | null | undefined): string {
  if (!raw) return '';
  let s = String(raw);
  // 1) UUID (8-4-4-4-12 hex) → <uuid>
  s = s.replace(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    '<uuid>',
  );
  // 2) ISO 8601 타임스탬프 → <ts>
  s = s.replace(
    /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g,
    '<ts>',
  );
  // 3) 시:분:초 단독 → <time>
  s = s.replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, '<time>');
  // 4) 긴 16진 토큰(해시/포인터, 8자리+) → <hex>
  s = s.replace(/\b0x[0-9a-f]+\b/gi, '<hex>');
  s = s.replace(/\b[0-9a-f]{8,}\b/gi, '<hex>');
  // 5) 나머지 숫자 열 → <n>
  s = s.replace(/\b\d+\b/g, '<n>');
  // 6) 따옴표 안 리터럴(가변 식별자) → '<v>' / "<v>"
  s = s.replace(/'[^']*'/g, "'<v>'");
  s = s.replace(/"[^"]*"/g, '"<v>"');
  // 7) 공백 정규화 + 길이 상한(시그니처 안정성).
  s = s.replace(/\s+/g, ' ').trim().slice(0, 300);
  return s;
}

// signature = sha256(feature|code|normalized(message)). code 가 없으면 빈 축.
export function computeSignature(input: {
  feature: string;
  code?: string | null;
  message?: string | null;
}): string {
  const parts = [
    input.feature ?? '',
    input.code ?? '',
    normalizeMessage(input.message),
  ];
  return hashString(parts.join('|'));
}

// 인제스트 진입점. 절대 throw 하지 않는다.
export async function logError(input: LogErrorInput): Promise<void> {
  try {
    const signature = computeSignature(input);
    const admin = createAdminClient();
    const { error } = await admin.rpc('record_error_event', {
      p_signature: signature,
      p_feature: input.feature,
      p_code: input.code ?? null,
      // 원문은 컬럼 상한(text)에 안전하게 자름 — 폭주 로그가 저장을 부풀리지 않게.
      p_message: input.message ? String(input.message).slice(0, 2000) : null,
      p_context: (input.context ?? null) as unknown as object | null,
      p_severity: input.severity ?? 'error',
      p_source: input.source ?? 'app',
    });
    if (error) {
      // RPC 미배포(마이그 적용 전) 또는 권한/스키마 문제 — 기능은 안 깬다.
      console.error('[logError] record_error_event failed', input.feature, input.code, error.message);
    }
  } catch (e) {
    // createAdminClient env 누락·직렬화 오류 등 — 조용히 폴백.
    console.error('[logError] unexpected', input.feature, input.code, e instanceof Error ? e.message : e);
  }
}
