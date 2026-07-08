// 새 마이그가 prod 에 적용되기 전까진 transcript_jobs 에 일부 컬럼이 없습니다.
// PR preview deployment 가 prod DB 를 그대로 보는 환경에선 이 컬럼을 포함한
// select 가 PostgREST 42703 ("column does not exist") 로 통째 실패해서 preview /
// download / list / workspace 4-way 가 모두 404 / 500 으로 깨집니다 (PR #505).
//
// 이 헬퍼는 아래 OPTIONAL_COLUMNS 를 baseColumns 뒤에 붙여 select 하고, 특정
// 컬럼 부재 에러가 나면 그 컬럼만 빼고 다시 시도합니다(다른 optional 컬럼은
// 유지). 마이그 적용 후엔 첫 query 가 성공 → 추가 호출 0. 미적용 컬럼이 섞여
// 있어도 있는 것만 살려서 graceful degrade.
//
// 등록된 optional 컬럼:
//   - inferred_speakers (20260629011051, Q&A 문맥 diarization, PR #505)
//   - meeting_summary   (20260708160620, 회의록 모드 요약 + Todo)

type QueryResult<T> = {
  data: T | null;
  error: { code?: string; message?: string } | null;
};

const OPTIONAL_COLUMNS = ['inferred_speakers', 'meeting_summary'] as const;
const COLUMN_MISSING_CODE = '42703';

function missingOptionalColumn(message: string): string | null {
  for (const col of OPTIONAL_COLUMNS) {
    if (message.includes(col)) return col;
  }
  return null;
}

/**
 * baseColumns + 등록된 optional 컬럼으로 select. optional 컬럼이 prod 에 없어
 * 42703 이 나면 그 컬럼만 제거하고 재시도(다른 optional 컬럼은 유지). 남은
 * optional 컬럼이 없을 때까지 반복하므로, 일부만 적용된 중간 상태도 커버.
 */
export async function selectWithInferredFallback<T>(
  runQuery: (columns: string) => Promise<QueryResult<T>>,
  baseColumns: string,
): Promise<QueryResult<T>> {
  let optional = [...OPTIONAL_COLUMNS] as string[];
  for (;;) {
    const columns = optional.length
      ? `${baseColumns}, ${optional.join(', ')}`
      : baseColumns;
    const res = await runQuery(columns);
    if (!res.error) return res;
    const code = res.error.code ?? '';
    const message = res.error.message ?? '';
    if (code === COLUMN_MISSING_CODE || /column .* does not exist/i.test(message)) {
      const missing = missingOptionalColumn(message);
      if (missing && optional.includes(missing)) {
        console.warn(
          `[transcripts] ${missing} column not found — retrying select without it. ` +
            'Apply migration with `supabase db push --linked --yes`. ' +
            `(detail: ${message.slice(0, 200)})`,
        );
        optional = optional.filter((c) => c !== missing);
        continue;
      }
      // 42703 이지만 optional 로 특정 안 됨 → 마지막 시도로 base 만.
      if (optional.length) {
        optional = [];
        continue;
      }
    }
    return res;
  }
}

type UpdateError = { code?: string; message?: string } | null;

/**
 * 동일 fallback 을 write path 에 적용. webhook / poll 의 post-pass UPDATE 가
 * patch 에 optional 컬럼(inferred_speakers / meeting_summary)을 포함할 때,
 * 컬럼 부재(마이그 미적용)면 그 키만 빼고 retry. 그래야 clean_markdown /
 * speaker_roles 등 다른 패스 결과가 같은 UPDATE 안에서 살아남음.
 */
export async function updateWithInferredFallback(
  runUpdate: (patch: Record<string, unknown>) => Promise<{ error: UpdateError }>,
  patch: Record<string, unknown>,
): Promise<{ error: UpdateError }> {
  let current = patch;
  for (;;) {
    const res = await runUpdate(current);
    if (!res.error) return res;
    const code = res.error.code ?? '';
    const message = res.error.message ?? '';
    if (code === COLUMN_MISSING_CODE || /column .* does not exist/i.test(message)) {
      const missing = missingOptionalColumn(message);
      if (missing && missing in current) {
        console.warn(
          `[transcripts] ${missing} column not found on update — retrying without it. ` +
            'Apply migration with `supabase db push --linked --yes`. ' +
            `(detail: ${message.slice(0, 200)})`,
        );
        const { [missing]: _drop, ...rest } = current;
        void _drop;
        current = rest;
        continue;
      }
    }
    return res;
  }
}
