// Spike (card 584) — 인용 실존 검증(스펙 §방법 3 환각 인용 게이트).
// desk-websearch-eval 덤프 JSON 을 받아, Claude 레인이 회수한 소스 URL 을 실제로
// HTTP 요청해 ① 살아있는지(2xx/3xx) ② 페이지 제목이 존재하는지 확인한다. 결과를
// 보고서 §인용검증 표에 기록한다(≥5 필수).
//
// 실행: node scripts/spikes/desk-websearch-verify-citations.mjs <dump.json> [--n 8]

import { readFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const nIdx = args.indexOf('--n');
const N = nIdx >= 0 ? parseInt(args[nIdx + 1], 10) : 8;
if (!file) { console.error('사용법: node desk-websearch-verify-citations.mjs <dump.json> [--n 8]'); process.exit(1); }

const dump = JSON.parse(await readFile(file, 'utf8'));
// 키워드별 상위 소스를 골고루 뽑아 국내/글로벌 섞이게(첫 소스 우선).
const picks = [];
for (const run of dump.runs ?? []) {
  const src = run.claude?.sources ?? [];
  if (src[0]) picks.push({ keyword: run.keyword, ...src[0] });
  if (src[1]) picks.push({ keyword: run.keyword, ...src[1] });
}
const targets = picks.slice(0, N);

function titleOf(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, ' ').trim().slice(0, 80) : '(제목 없음)';
}

console.log(`인용 실존 검증 — ${targets.length}개 URL (dump: ${file})\n`);
let ok = 0;
for (const t of targets) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    const res = await fetch(t.url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (spike-citation-verify)' },
    });
    clearTimeout(timer);
    let title = '';
    if (res.ok) {
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('text/html')) title = titleOf(await res.text());
      else title = `(${ct.split(';')[0] || 'non-html'})`;
    }
    const live = res.status >= 200 && res.status < 400;
    if (live) ok++;
    console.log(`[${live ? 'OK ' : 'XX '}] ${res.status} ${t.korean ? 'KR' : '  '} ${t.tier}  ${t.url}`);
    console.log(`       제목: ${title || '—'}  | 키워드: ${t.keyword}`);
  } catch (e) {
    console.log(`[ERR] --- ${t.korean ? 'KR' : '  '} ${t.tier}  ${t.url}`);
    console.log(`       ${String(e.name || e).slice(0, 60)}  | 키워드: ${t.keyword}`);
  }
}
console.log(`\n실존(2xx/3xx): ${ok}/${targets.length}`);
