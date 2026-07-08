// SEC EDGAR 공통 운영 규약 — User-Agent 헤더 + rate limit throttle. CIK 명부와
// 재무 조회가 함께 쓴다. client 번들 안전(순수 fetch 래퍼, env·LLM 의존 없음).
//
// SEC fair-use (https://www.sec.gov/os/webmaster-faq#developers):
//   1. **User-Agent 필수** — "Sample Company AdminContact@example.com" 형식의
//      식별 가능한 UA 가 없으면 SEC 가 403 으로 거부한다. 키(인증)는 없다.
//   2. **rate limit ~10 req/s** — 초과 시 IP 차단. 아래 secThrottledAll 이 동시성
//      을 묶어(≤8) 폭주를 막는다. 명부·재무 조회는 회사당 1콜이라 회사 5개 수준
//      에선 여유롭지만, warm-up 병렬 폭을 상한으로 명시해 규약을 코드로 보장한다.

// 연락 가능한 식별 UA. SEC 는 실제 연락처(이메일)를 UA 에 넣기를 요구한다.
export const SEC_USER_AGENT =
  'ai-researcher-desk/1.0 (meteor research; chris.lee@meteor-research.com)';

// SEC 요청 전용 fetch — UA 헤더를 강제로 얹고 timeout 을 건다. Accept 도 명시해
// data.sec.gov 가 JSON 을 확실히 주게 한다. helpers.safeFetch 와 달리 UA 가 필수라
// 별도 래퍼로 둔다(누락 시 전건 403 회귀 방지).
export function secFetch(url: string, timeoutMs = 10_000): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  return fetch(url, {
    headers: { 'User-Agent': SEC_USER_AGENT, Accept: 'application/json' },
    signal: ac.signal,
  }).finally(() => clearTimeout(t));
}

// rate limit(~10/s) 준수용 동시성 제한 map. warm-up 이 회사들을 병렬로 받되 한
// 번에 최대 `concurrency` 개만 in-flight 로 둬 초당 요청 폭을 안전 범위로 묶는다.
// Promise.all 의 무제한 병렬을 대체 — 회사가 많아져도 429/차단이 안 나게 한다.
export async function secThrottledAll<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency = 8,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return out;
}
