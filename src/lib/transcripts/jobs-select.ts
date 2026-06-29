// 새 마이그 (20260629011051_add_inferred_speakers_column) 가 prod 에 적용되기
// 전까진 transcript_jobs 에 inferred_speakers 컬럼이 없습니다. PR preview
// deployment 가 prod DB 를 그대로 보는 환경에선 이 컬럼을 포함한 select 가
// PostgREST 42703 ("column does not exist") 로 통째 실패해서 preview /
// download / list / workspace 4-way 가 모두 404 / 500 으로 깨집니다 (PR #505).
//
// 이 헬퍼는 첫 시도에 inferred_speakers 포함해서 select 하고, "column does
// not exist" 시 컬럼을 빼고 한 번 더 select. 마이그 적용 후엔 첫 query 가
// 성공 → 추가 호출 0. 적용 전엔 두 번 호출 + warning 1줄. graceful degrade.

type QueryResult<T> = {
  data: T | null;
  error: { code?: string; message?: string } | null;
};

const INFERRED_TAIL = ', inferred_speakers';
const COLUMN_MISSING_CODE = '42703';
const COLUMN_MISSING_RE = /inferred_speakers/;

export async function selectWithInferredFallback<T>(
  runQuery: (columns: string) => Promise<QueryResult<T>>,
  baseColumns: string,
): Promise<QueryResult<T>> {
  const full = await runQuery(baseColumns + INFERRED_TAIL);
  if (!full.error) return full;
  const code = full.error.code ?? '';
  const message = full.error.message ?? '';
  if (code === COLUMN_MISSING_CODE || COLUMN_MISSING_RE.test(message)) {
    console.warn(
      '[transcripts] inferred_speakers column not found — falling back to base select. ' +
        'Apply migration with `supabase db push --linked --yes`. ' +
        `(detail: ${message.slice(0, 200)})`,
    );
    return await runQuery(baseColumns);
  }
  return full;
}

type UpdateError = { code?: string; message?: string } | null;

/**
 * 동일 fallback 을 write path 에 적용. webhook / poll 의 post-pass UPDATE 가
 * patch 에 inferred_speakers 를 포함할 때, 컬럼 부재 (마이그 미적용) 면
 * patch 에서 그 키만 빼고 retry. 그래야 clean_markdown / speaker_roles 등
 * 다른 패스 결과가 같은 UPDATE 안에서 살아남음.
 */
export async function updateWithInferredFallback(
  runUpdate: (patch: Record<string, unknown>) => Promise<{ error: UpdateError }>,
  patch: Record<string, unknown>,
): Promise<{ error: UpdateError }> {
  const first = await runUpdate(patch);
  if (!first.error) return first;
  const code = first.error.code ?? '';
  const message = first.error.message ?? '';
  if (
    'inferred_speakers' in patch &&
    (code === COLUMN_MISSING_CODE || COLUMN_MISSING_RE.test(message))
  ) {
    console.warn(
      '[transcripts] inferred_speakers column not found on update — retrying without. ' +
        'Apply migration with `supabase db push --linked --yes`. ' +
        `(detail: ${message.slice(0, 200)})`,
    );
    const { inferred_speakers: _drop, ...rest } = patch;
    void _drop;
    return await runUpdate(rest);
  }
  return first;
}
