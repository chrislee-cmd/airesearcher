import type { DeskArticle, DeskSourceDefinition, DeskSourceErrorReason } from './types';
import { classifyHttpStatus, decodeEntities, inRange, safeFetch, UA } from './helpers';

// aTFIS(식품산업통계정보, atfis.or.kr) 의 「시장분석」 게시판(FB0027) — 한국농수산
// 식품유통공사(aT)가 매년 발간하는 **가공식품 세분시장 시장보고서** 목록. 라면·
// 음료·커피·간편식 등 소비재 식품의 시장 규모(TAM)는 KOSIS 정형 통계에 거의
// 없고 이 세분시장 보고서가 사실상 1차 출처다 (2026-07-06 market mode TAM 전멸
// 진단의 근본 원인). registry category 를 `stats` 로 두어 market prompt 의
// "📊 산업 통계 — TAM 근거" bucket 에 자동 편입시킨다.
//
// 설계 결정(스크랩 정찰로 확정):
//   1. searchWord 무력 — 이 게시판의 검색 파라미터는 결과를 필터하지 않고 항상
//      최신 목록을 돌려준다. 그래서 서버 검색에 기대지 않고 목록을 통째로 받아
//      **클라이언트에서 키워드로 관련 세분시장만 게이트**한다.
//   2. 숫자는 본문 PDF 첨부에만 있고 HTML 목록/상세엔 없다 — 이 소스는 "권위
//      있는 세분시장 보고서 링크 + 세분시장 식별"을 제공하고, 실제 TAM 수치는
//      뉴스 추출(F2)·업계 추정치(F3)가 채운다. 정책상 없는 숫자는 만들지 않는다.
//   3. 세분시장 명칭이 소비재 통칭과 다를 수 있어(라면↔면류) 통칭→세분시장
//      동의어 브릿지를 둔다. 최근 연도엔 「라면」 단독 보고서도 있어 직접 매칭이
//      1순위, 동의어는 fallback.
//   4. 목록은 자주 안 바뀌므로 프로세스 메모리에 TTL 캐시 — 한 job 안에서
//      키워드별로 여러 번 호출돼도 실제 네트워크는 1회(task cap 보호).

const BOARD_LIST = 'https://www.atfis.or.kr/home/board/FB0027.do';
// 최근 3페이지면 최신~과거 3~4년치 세분시장(≈36건)이 들어와 라면·음료 등 주요
// 소비재는 직접/동의어 매칭으로 모두 잡힌다. 더 파면 task cap 부담만 커진다.
const LIST_PAGES = [1, 2, 3];
const LIST_TTL_MS = 6 * 60 * 60 * 1000; // 6h — 목록은 연 단위로만 갱신됨

type AtfisRow = {
  bpoId: string;
  title: string;
  sector: string; // 제목 첫 토큰 = 세분시장 명칭 ("면류", "커피" …)
  year?: string; // 제목의 20xx 연도 (정렬·range 필터용)
};

// 소비재 통칭 → aTFIS 세분시장 명칭 브릿지. 값은 목록 제목의 첫 토큰과 정확히
// 일치해야 한다. 직접 매칭(제목에 키워드 포함)이 안 될 때만 쓰이는 fallback.
const SECTOR_SYNONYMS: { sector: string; terms: string[] }[] = [
  { sector: '면류', terms: ['라면', '국수', '냉면', '우동', '파스타', '스파게티', '당면', '쌀국수'] },
  { sector: '음료류', terms: ['음료', '탄산', '생수', '주스', '이온음료', '에너지드링크', '스포츠음료'] },
  { sector: '스낵류', terms: ['과자', '스낵', '감자칩', '비스킷', '크래커'] },
  { sector: '초콜릿류', terms: ['초콜릿', '초코'] },
  { sector: '유제품', terms: ['우유', '치즈', '요거트', '요구르트', '발효유', '버터'] },
  { sector: '소스류', terms: ['소스', '케첩', '드레싱', '마요네즈', '양념'] },
  { sector: '당류', terms: ['설탕', '시럽', '올리고당', '물엿'] },
  { sector: '식육가공품', terms: ['햄', '소시지', '베이컨', '육가공'] },
  { sector: '간편식', terms: ['간편식', '가정간편식', 'hmr', '도시락', '즉석식품'] },
  { sector: '냉동식품', terms: ['냉동식품', '냉동'] },
  { sector: '커피', terms: ['커피', '원두'] },
  { sector: '다류', terms: ['차', '녹차', '홍차', '티백'] },
  { sector: '식용유', terms: ['식용유', '기름', '올리브유'] },
  { sector: '건강기능식품', terms: ['건강기능식품', '건기식', '영양제'] },
];

// 한 세분시장 보고서 행이 이 키워드와 관련 있는가.
function relevant(keyword: string, row: AtfisRow): boolean {
  const k = keyword.trim().toLowerCase();
  if (!k) return false;
  const title = row.title.toLowerCase();
  const sector = row.sector.toLowerCase();
  if (title.includes(k)) return true; // 직접 매칭 ("라면 2022 …", "커피 시장")
  if (k.includes(sector) || sector.includes(k)) return true; // 세분시장 명칭 부분일치
  return SECTOR_SYNONYMS.some(
    (g) => g.sector.toLowerCase() === sector && g.terms.some((t) => k.includes(t)),
  );
}

let listCache: { at: number; rows: AtfisRow[] } | null = null;

// 게시판 목록 HTML 에서 read 링크(act=read&bpoId=…)만 골라 제목·세분시장·연도로
// 파싱한다. 페이지마다 실패는 [] 로 흡수(다른 페이지 생존).
function parseListPage(html: string): AtfisRow[] {
  const rows: AtfisRow[] = [];
  const seen = new Set<string>();
  const anchor = /<a[^>]+href="([^"]*act=read[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchor.exec(html))) {
    const href = decodeEntities(m[1]);
    const bpoId = href.match(/bpoId=(\d+)/)?.[1];
    if (!bpoId || seen.has(bpoId)) continue;
    const title = decodeEntities(m[2].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (!title) continue;
    seen.add(bpoId);
    const sector = title.split(/\s+/)[0] ?? '';
    const year = title.match(/(20\d{2})/)?.[1];
    rows.push({ bpoId, title, sector, year });
  }
  return rows;
}

async function loadList(): Promise<
  { rows: AtfisRow[] } | { error: DeskSourceErrorReason }
> {
  if (listCache && Date.now() - listCache.at < LIST_TTL_MS) {
    return { rows: listCache.rows };
  }
  const results = await Promise.all(
    LIST_PAGES.map(async (p) => {
      try {
        const res = await safeFetch(
          `${BOARD_LIST}?pageIndex=${p}`,
          { headers: { 'user-agent': UA } },
          12_000,
        );
        if (!res.ok) return { rows: [] as AtfisRow[], status: res.status };
        return { rows: parseListPage(await res.text()), status: 200 };
      } catch {
        return { rows: [] as AtfisRow[], status: 0 };
      }
    }),
  );
  const merged: AtfisRow[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    for (const row of r.rows) {
      if (seen.has(row.bpoId)) continue;
      seen.add(row.bpoId);
      merged.push(row);
    }
  }
  // 한 행도 못 받았고 첫 페이지가 non-200 이면 fetch 실패로 분류(무음 0건 방지).
  if (merged.length === 0) {
    const firstBad = results.find((r) => r.status && r.status !== 200);
    if (firstBad) return { error: classifyHttpStatus(firstBad.status) ?? 'fetch_failed' };
    return { rows: [] };
  }
  // 최신 연도가 먼저 오도록 정렬 — 같은 세분시장이 여러 해 잡히면 최신을 우선.
  merged.sort((a, b) => (b.year ?? '').localeCompare(a.year ?? ''));
  listCache = { at: Date.now(), rows: merged };
  return { rows: merged };
}

export const atfis: DeskSourceDefinition = {
  id: 'atfis',
  category: 'stats',
  group: 'atfis',
  label: 'aTFIS 식품산업통계',
  labelEn: 'aTFIS (Food Industry Statistics)',
  hint: '가공식품 세분시장 시장규모 보고서 (라면·음료·커피 등, 키 불필요)',
  regionOnly: ['KR'],
  // No envKeys — the FB0027 board list is public.
  async fetch({ keyword, range, limit }) {
    const list = await loadList();
    if ('error' in list) return { articles: [], error: list.error };
    const kept = list.rows
      .filter((row) => relevant(keyword, row))
      .map(
        (row) =>
          ({
            source: 'atfis' as const,
            title: row.title,
            url: `${BOARD_LIST}?act=read&bpoId=${row.bpoId}&bcaId=0`,
            snippet:
              'aTFIS 가공식품 세분시장 현황 보고서 — 시장 규모·성장률은 첨부 보고서(PDF) 본문에 수록.',
            publishedAt: row.year ? `${row.year}-01-01` : undefined,
            origin: 'aTFIS 식품산업통계정보 (aT)',
            keyword,
          }) satisfies DeskArticle,
      )
      .filter((a) => inRange(a.publishedAt, range))
      .slice(0, limit);
    console.info(
      `[desk-debug] atfis — keyword=${keyword} catalog=${list.rows.length} kept=${kept.length}`,
    );
    return kept;
  },
};
