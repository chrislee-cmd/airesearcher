// 웹 검색 — 탑라인 drag-to-ask 의 "웹 검색" 모드 backing.
//
// Tavily(https://tavily.com) 검색 API 한 방향 래퍼. LLM 근거용으로 각 결과의
// title/url/content(추출 스니펫)를 돌려준다. 인터뷰 코퍼스(pgvector) 대신 이
// 결과를 근거로 주입해 Sonnet 이 답을 만든다.
//
// 격리/키: TAVILY_API_KEY 는 optional env — 없으면 라우트가 web 모드를
// web_search_unavailable 로 거부한다(호출부 책임). 이 모듈은 키를 인자로 받아
// 순수 fetch 만 한다(테스트/재사용 용이).

export type WebResult = {
  title: string;
  url: string;
  // Tavily 가 추출한 페이지 스니펫(근거 본문).
  content: string;
  // 0~1 관련도(Tavily). 정렬/로깅용.
  score: number;
};

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';

/**
 * Tavily 웹 검색. 실패(네트워크/비-2xx/파싱)는 던지지 않고 [] 로 degrade —
 * 호출부는 결과 0 을 "근거 없음"으로 동일하게 처리한다. maxResults 기본 6.
 */
export async function searchWeb(
  query: string,
  opts: { apiKey: string; maxResults?: number; signal?: AbortSignal },
): Promise<WebResult[]> {
  const { apiKey, maxResults = 6, signal } = opts;
  const q = query.trim().slice(0, 400);
  if (!q) return [];

  let res: Response;
  try {
    res = await fetch(TAVILY_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query: q,
        // advanced 는 추출 품질↑ 대신 지연↑ — 짧은 추가질문엔 basic 로 충분.
        search_depth: 'basic',
        max_results: Math.min(Math.max(maxResults, 1), 10),
        include_answer: false,
      }),
      signal,
    });
  } catch (e) {
    console.error('[web-search/tavily] fetch failed', e);
    return [];
  }

  if (!res.ok) {
    console.error('[web-search/tavily] non-2xx', res.status);
    return [];
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return [];
  }

  const raw = (json as { results?: unknown })?.results;
  if (!Array.isArray(raw)) return [];

  const out: WebResult[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const url = typeof r.url === 'string' ? r.url : '';
    if (!url) continue;
    out.push({
      title: typeof r.title === 'string' && r.title.trim() ? r.title : url,
      url,
      content: typeof r.content === 'string' ? r.content.slice(0, 2_000) : '',
      score: typeof r.score === 'number' ? r.score : 0,
    });
  }
  return out;
}

/**
 * 웹 결과를 system prompt 주입용 근거 블록으로 포맷. 각 결과에 [n] 번호를 매겨
 * 모델이 답변에서 [제목](url) inline 링크로 인용하도록 유도한다(chunk_id 인용
 * 시스템과 무관 — 웹 모드는 링크 인용).
 */
export function formatWebEvidence(results: WebResult[]): string {
  return results
    .map(
      (r, i) =>
        `### [${i + 1}] ${r.title}\nURL: ${r.url}\n${r.content || '(발췌 없음)'}`,
    )
    .join('\n\n');
}
