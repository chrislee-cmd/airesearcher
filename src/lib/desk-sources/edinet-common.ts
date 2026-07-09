// EDINET (일본 전자공시 api.edinet-fss.go.jp v2) 공통 운영 규약 — subscription key
// 주입 + fetch 래퍼. 코드 명부·문서 인덱스·재무 조회가 함께 쓴다. client 번들
// 안전(순수 fetch 래퍼, env·LLM 의존 없음 — 키는 호출부가 주입).
//
// ⚠️ EDINET API v2 는 발급받은 **Subscription-Key** 를 query 파라미터로 요구한다.
// 키가 URL query 에 들어가므로 — **URL 전체를 로그에 남기면 키가 노출된다**. 이
// 모듈·호출부는 절대 URL 을 로그하지 않고 docID/date 만 남긴다(키 마스킹 규약).

export const EDINET_API_BASE = 'https://api.edinet-fss.go.jp/api/v2';

// EDINET code list(제출자↔EDINET코드↔증권코드 매핑) 다운로드 — API v2 와 별개의
// 공개 정적 파일(키 불필요). ZIP 안에 EdinetcodeDlInfo.csv (Shift-JIS).
export const EDINET_CODELIST_URL =
  'https://disclosure2dl.edinet-fss.go.jp/searchdocument/codelist/Edinetcode.zip';

// subscription key 를 query 에 얹은 URL 을 만든다. **이 함수의 결과(키 포함 URL)를
// 로그하지 말 것** — 호출부는 docID/date 만 로그한다.
export function withKey(url: string, key: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return key ? `${url}${sep}Subscription-Key=${encodeURIComponent(key)}` : url;
}

// timeout 을 건 fetch. JSON(문서 목록) · binary(코드리스트/문서 ZIP) 모두 쓴다.
export function edinetFetch(url: string, timeoutMs = 10_000): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  return fetch(url, { signal: ac.signal }).finally(() => clearTimeout(t));
}

// rate limit 보호용 동시성 제한 map (SEC secThrottledAll 미러). 문서 목록 스윕이
// 날짜들을 병렬로 받되 한 번에 최대 `concurrency` 개만 in-flight 로 둔다.
export async function edinetThrottledAll<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency = 4,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return out;
}

export function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error && (err.name === 'AbortError' || /abort/i.test(err.message))
  );
}
