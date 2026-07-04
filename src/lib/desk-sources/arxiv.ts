import { XMLParser } from 'fast-xml-parser';
import type { DeskSourceDefinition } from './types';
import { inRange, safeFetch, UA } from './helpers';

// arXiv Atom API (free, no key). Region-agnostic — arXiv is English-only
// preprints, so the `region` param is ignored and the source stays in the
// `global` group (never hidden off-KR). The response is Atom XML, parsed with
// fast-xml-parser rather than the regex helpers other sources use, because
// entries carry nested authors / multiple links that regex handles poorly.
type ArxivLink = { '@_href'?: string; '@_rel'?: string; '@_type'?: string };
type ArxivAuthor = { name?: string };
type ArxivEntry = {
  title?: string;
  summary?: string;
  published?: string;
  link?: ArxivLink | ArxivLink[];
  author?: ArxivAuthor | ArxivAuthor[];
};

// Atom fields arrive as either a single node or an array depending on cardinality.
function toArray<T>(v: T | T[] | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

// Atom text nodes are usually strings, but pad with newlines/indentation.
function clean(s: unknown, max: number): string | undefined {
  if (typeof s !== 'string') return undefined;
  const t = s.replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : undefined;
}

export const arxiv: DeskSourceDefinition = {
  id: 'arxiv',
  category: 'academic',
  group: 'global',
  label: 'arXiv',
  labelEn: 'arXiv',
  hint: 'CS/AI·물리·수학 preprint (영문, 키 불필요)',
  async fetch({ keyword, range, limit }) {
    const max = Math.min(100, Math.max(1, limit));
    const url =
      `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(keyword)}` +
      `&max_results=${max}&sortBy=relevance`;
    const res = await safeFetch(url, { headers: { 'user-agent': UA } }, 15_000);
    if (!res.ok) return [];
    const xml = await res.text();
    const parser = new XMLParser({ ignoreAttributes: false });
    let entries: ArxivEntry[];
    try {
      entries = toArray(parser.parse(xml)?.feed?.entry as ArxivEntry | ArxivEntry[] | undefined);
    } catch {
      return [];
    }
    return entries
      .map((e) => {
        // Prefer the human-readable abstract page (rel=alternate, text/html).
        const links = toArray(e.link);
        const url =
          links.find((l) => l['@_type'] === 'text/html')?.['@_href'] ??
          links.find((l) => l['@_rel'] === 'alternate')?.['@_href'] ??
          links[0]?.['@_href'] ??
          '';
        const authors = toArray(e.author)
          .map((a) => a.name)
          .filter((n): n is string => !!n)
          .join(', ');
        return {
          source: 'arxiv' as const,
          title: clean(e.title, 300) ?? '',
          url,
          snippet: clean(e.summary, 500),
          publishedAt: typeof e.published === 'string' ? e.published.slice(0, 10) : undefined,
          origin: authors || 'arXiv',
          keyword,
        };
      })
      .filter((a) => a.title && a.url)
      .filter((a) => inRange(a.publishedAt, range))
      .slice(0, limit);
  },
};
