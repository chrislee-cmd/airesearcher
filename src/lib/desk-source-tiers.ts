// Domain whitelist for source tier classification. Used by the crawl pipeline
// to tag each collected article with a `tier` so downstream weighting (PR-2's
// synthesis pass) can prefer wire/research-house sources over user-generated
// commentary.
//
// Buckets:
//   T1 — wire services, top-tier press, major research houses, government stats.
//        Treat as primary evidence.
//   T2 — tech / trade press and respected analyst blogs. Reliable secondary
//        coverage.
//   T3 — community / blog / social. Useful for sentiment + emerging signals
//        but never as standalone evidence.
//   unknown — domain not in any list; defaults to T3 for downstream weighting.
//
// Matching is suffix-based on the hostname (after stripping `www.`) so
// `seoul.bloomberg.co.kr` still maps to T1 via `bloomberg.co`. Keep entries
// without protocol or path.
//
// This list is hand-curated. PR-2 may layer an LLM check on top of it for
// publishers not enumerated here; for now the rule-based path is the entire
// classifier.

export type SourceTier = 'T1' | 'T2' | 'T3' | 'unknown';

export const T1_DOMAINS: ReadonlySet<string> = new Set([
  // Global wires / pink-paper press
  'bloomberg.com',
  'bloomberg.co.jp',
  'reuters.com',
  'jp.reuters.com',
  'ft.com',
  'wsj.com',
  'nytimes.com',
  'washingtonpost.com',
  'economist.com',
  'apnews.com',
  'bbc.com',
  'bbc.co.uk',
  'cnbc.com',
  'forbes.com',
  'fortune.com',
  'theguardian.com',
  'nikkei.com',
  'asia.nikkei.com',
  // Major research / consulting
  'mckinsey.com',
  'bain.com',
  'bcg.com',
  'gartner.com',
  'forrester.com',
  'idc.com',
  'deloitte.com',
  'pwc.com',
  'ey.com',
  'kpmg.com',
  'accenture.com',
  'statista.com',
  'oecd.org',
  'imf.org',
  'worldbank.org',
  'who.int',
  // Korea — major dailies, broadcasters, gov stats
  'hankyung.com',
  'mk.co.kr',
  'chosun.com',
  'joongang.co.kr',
  'donga.com',
  'hani.co.kr',
  'khan.co.kr',
  'mt.co.kr',
  'edaily.co.kr',
  'yna.co.kr',
  'newsis.com',
  'fnnews.com',
  'sedaily.com',
  'biz.chosun.com',
  'kmib.co.kr',
  'munhwa.com',
  'segye.com',
  'kbs.co.kr',
  'mbc.co.kr',
  'sbs.co.kr',
  'ytn.co.kr',
  'jtbc.co.kr',
  'imnews.imbc.com',
  'kostat.go.kr',
  'kosis.kr',
  'mofa.go.kr',
  'moef.go.kr',
  'mois.go.kr',
  'me.go.kr',
  'msit.go.kr',
  'mss.go.kr',
  'krx.co.kr',
  'fss.or.kr',
  'kdi.re.kr',
  'kotra.or.kr',
  'kiet.re.kr',
  // Japan — major dailies, broadcasters
  'asahi.com',
  'yomiuri.co.jp',
  'mainichi.jp',
  'sankei.com',
  'nhk.or.jp',
  'japantimes.co.jp',
  // US / global business + research adjacencies
  'hbr.org',
  'sloanreview.mit.edu',
  'morningstar.com',
  'spglobal.com',
  'pewresearch.org',
  'nielsen.com',
  'kantar.com',
  'ipsos.com',
]);

export const T2_DOMAINS: ReadonlySet<string> = new Set([
  // Global tech / trade press
  'techcrunch.com',
  'theverge.com',
  'wired.com',
  'arstechnica.com',
  'engadget.com',
  'zdnet.com',
  'zdnet.co.kr',
  'venturebeat.com',
  'theinformation.com',
  'protocol.com',
  'sifted.eu',
  'restofworld.org',
  'rest-of-world.com',
  'businessinsider.com',
  'axios.com',
  'semafor.com',
  'cnet.com',
  'mashable.com',
  'gizmodo.com',
  'fastcompany.com',
  // Entertainment / ad / industry trades
  'variety.com',
  'hollywoodreporter.com',
  'deadline.com',
  'adage.com',
  'adweek.com',
  'campaignlive.co.uk',
  'campaignlive.com',
  'marketingweek.com',
  'thedrum.com',
  // Korea — tech / IT / industry press
  'it.chosun.com',
  'etnews.com',
  'inews24.com',
  'ddaily.co.kr',
  'bloter.net',
  'venturesquare.net',
  'platum.kr',
  'thebell.co.kr',
  'businesspost.co.kr',
  'newspim.com',
  'kbench.com',
  'dailian.co.kr',
  // Japan tech / business
  'itmedia.co.jp',
  'techable.jp',
  'bridge.tokyo',
  'thebridge.jp',
  // Analyst blogs / vertical research
  'crunchbase.com',
  'pitchbook.com',
  'cbinsights.com',
  'a16z.com',
  'stratechery.com',
  'benedictevans.com',
  'sequoiacap.com',
  'firstround.com',
  'ycombinator.com',
]);

// T3 / unknown is "everything else". Community + UGC patterns we still call
// out so future maintainers can tell "we considered this and chose T3" from
// "we forgot to list this." This set is also useful for any future filter
// that wants to *exclude* UGC explicitly.
export const T3_HINT_DOMAINS: ReadonlySet<string> = new Set([
  'reddit.com',
  'old.reddit.com',
  'news.ycombinator.com',
  'medium.com',
  'substack.com',
  'youtube.com',
  'youtu.be',
  'twitter.com',
  'x.com',
  'facebook.com',
  'instagram.com',
  'tiktok.com',
  'linkedin.com',
  'quora.com',
  'naver.com',
  'cafe.naver.com',
  'blog.naver.com',
  'm.blog.naver.com',
  'tistory.com',
  'brunch.co.kr',
  'velog.io',
  'daum.net',
  'cafe.daum.net',
  'blog.daum.net',
  'dcinside.com',
  'fmkorea.com',
  'clien.net',
  'theqoo.net',
  'ruliweb.com',
  'inven.co.kr',
  'pgr21.com',
  'ppomppu.co.kr',
  '82cook.com',
  'mlbpark.donga.com',
  'note.com',
  'ameblo.jp',
  'hatena.ne.jp',
  'hatenablog.com',
  '2ch.sc',
  '5ch.net',
]);

function normaliseHost(input: string): string | null {
  let host: string;
  try {
    const u = new URL(input);
    host = u.hostname.toLowerCase();
  } catch {
    // Some sources hand us bare hostnames or url-looking strings without a
    // scheme. Try once more with a synthetic https:// prefix before giving up.
    try {
      const u = new URL(`https://${input}`);
      host = u.hostname.toLowerCase();
    } catch {
      return null;
    }
  }
  if (!host) return null;
  if (host.startsWith('www.')) host = host.slice(4);
  return host;
}

function matchSuffix(host: string, list: ReadonlySet<string>): boolean {
  if (list.has(host)) return true;
  // Suffix match — `seoul.bloomberg.co.kr` should still hit `bloomberg.co.kr`
  // if we ever add that, and `biz.chosun.com` falls back to `chosun.com`.
  for (const entry of list) {
    if (host.endsWith(`.${entry}`)) return true;
  }
  return false;
}

export function classifyTier(url: string | undefined | null): SourceTier {
  if (!url) return 'unknown';
  const host = normaliseHost(url);
  if (!host) return 'unknown';
  if (matchSuffix(host, T1_DOMAINS)) return 'T1';
  if (matchSuffix(host, T2_DOMAINS)) return 'T2';
  if (matchSuffix(host, T3_HINT_DOMAINS)) return 'T3';
  return 'unknown';
}
