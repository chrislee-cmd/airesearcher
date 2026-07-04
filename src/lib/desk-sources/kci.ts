// KCI (Korea Citation Index, 한국연구재단) — domestic academic journal articles.
// Free OpenAPI at https://open.kci.go.kr/ ; response is XML. We parse it with the
// shared regex helpers rather than pulling in an XML-parser dependency, matching
// how every other source in this registry handles XML (Naver etc.).

import { env } from '@/env';
import type { DeskArticle, DeskSourceDefinition } from './types';
import { inRange, pickTag, safeFetch, UA } from './helpers';

const ENDPOINT = 'https://open.kci.go.kr/po/openapi/openApiSearch.kci';
const ARTICLE_VIEW =
  'https://www.kci.go.kr/kciportal/ci/sereArticleSearch/ciSereArtiView.kci?sereArticleSearchBean.artiId=';

// Split the XML payload into its repeating record blocks. KCI wraps results in
// <outputData><record>…</record>…</outputData>; we match <record> defensively so
// a slightly different envelope tag doesn't zero out the whole parse.
function recordBlocks(xml: string): string[] {
  return xml.match(/<record\b[\s\S]*?<\/record>/gi) ?? [];
}

// KCI field names are best-effort per the spec; tolerate a couple of tag spellings
// and always fall back to undefined so a missing field never throws.
function parseRecord(block: string, keyword: string): DeskArticle | null {
  const title = pickTag(block, 'article-title') ?? pickTag(block, 'title');
  if (!title) return null;

  const articleId = pickTag(block, 'article-id') ?? pickTag(block, 'artiId');
  const url =
    pickTag(block, 'url') ?? (articleId ? `${ARTICLE_VIEW}${articleId}` : undefined);
  if (!url) return null;

  const abstract = pickTag(block, 'article-abstract') ?? pickTag(block, 'abstract');
  const year = pickTag(block, 'pub-year') ?? pickTag(block, 'pubYear');
  // First author only — enough to attribute the article in the report.
  const author = pickTag(block, 'author');

  return {
    source: 'kci',
    title,
    url,
    snippet: abstract ? abstract.slice(0, 500) : undefined,
    publishedAt: year && /^\d{4}$/.test(year.trim()) ? `${year.trim()}-01-01` : undefined,
    origin: author,
    keyword,
  };
}

export const kci: DeskSourceDefinition = {
  id: 'kci',
  category: 'academic',
  group: 'academic_kr',
  label: 'KCI (한국학술)',
  labelEn: 'KCI (Korean Academic)',
  hint: '국내 학술지 논문 (한국연구재단)',
  regionOnly: ['KR'],
  envKeys: ['KCI_API_KEY'],
  async fetch({ keyword, range, limit }) {
    const key = env.KCI_API_KEY;
    if (!key) return [];
    const params = new URLSearchParams({
      apiCode: 'articleSearch',
      key,
      title: keyword,
      displayCount: String(Math.min(100, Math.max(1, limit))),
    });
    const res = await safeFetch(`${ENDPOINT}?${params}`, {
      headers: { 'user-agent': UA, accept: 'application/xml' },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return recordBlocks(xml)
      .map((b) => parseRecord(b, keyword))
      .filter((a): a is DeskArticle => a !== null)
      .filter((a) => inRange(a.publishedAt, range))
      .slice(0, limit);
  },
};
