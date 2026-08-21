// 인터뷰 탑라인 보고서 — 블록 배열 → Markdown / plain-text 직렬화.
//
// export 라우트(다운로드)가 저장된 interview_toplines.blocks 를 .md / .txt 로
// 내보내는 데 쓴다. topline-import.ts 의 parseMarkdownToToplineBlocks(md→blocks)
// 역방향을 대칭으로 구현한다 — heading/table/quote/paragraph 가 라운드트립하게.
//
// 인용 처리(사용자 결정 3, topline-docx 와 동일 정책): 블록의 citations 는
// chunk_id 문자열이고 md 본문에도 inline [chunk_id] 토큰이 섞여 있다. 사람이
// 읽는 문서이므로 raw chunk_id 를 **절대 노출하지 않는다** — inline 토큰은
// 제거하고, 블록 끝에 "근거: 문서명" 으로 출처 문서명만 표기한다(chunk_id →
// filename 은 route 가 getCitationSources 로 미리 해석해 sources 맵으로 넘긴다).
//
// 순수 함수(DB/네트워크 무관) — sources 맵만 주입받는다. 표는 GFM 파이프 표로
// 온전히 보존하고, txt 는 마크다운 기호를 제거/치환한 선형 텍스트로 변환한다.

import type { ToplineBlock } from '@/lib/interview-v2/topline';

export type CitationSource = { filename: string };

export type ToplineTextOptions = {
  projectName: string;
  // interview_toplines.generated_at (ISO). 표지 "생성일" 에 쓰인다. 없으면 오늘.
  generatedAt?: string | null;
  // chunk_id → 출처 문서. inline chunk_id 대신 사람이 읽는 "근거: 파일명" 을
  // 렌더하는 데 쓴다. 맵에 없는 id 는 조용히 생략(raw 노출 절대 없음).
  sources: Map<string, CitationSource>;
};

// inline [chunk_id] 인용 토큰 제거 — markdown 링크 [label](url) 는 보존한다.
// 이 블록의 citations 에 실제로 있는 id 만 지워서 일반 [대괄호] 산문은 남긴다.
// 토큰 앞 공백도 같이 정리하고, 구두점 앞에 남는 공백을 붙인다(topline-docx 와 동일).
function stripInlineCitations(md: string, citedIds: Set<string>): string {
  return md
    .replace(/\s*\[([^\]\n]+)\](?!\()/g, (full, tok: string) =>
      citedIds.has(tok.trim()) ? '' : full,
    )
    .replace(/[ \t]+([.,;:?!、。])/g, '$1');
}

// 블록 citations → 중복 없는 출처 문서명(첫 등장 순서). 맵에 없거나 빈 파일명은
// 건너뛴다(topline-docx citedFilenames 와 동일).
function citedFilenames(
  citations: string[] | undefined,
  sources: Map<string, CitationSource>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of citations ?? []) {
    const src = sources.get(String(id));
    const name = src?.filename?.trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

// GFM 표 셀 이스케이프 — 파이프는 `\|` 로, 개행은 공백으로(한 행 유지).
function escapeCell(s: string): string {
  return s.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
}

// 마크다운 인라인 기호 제거(txt 선형화) — 링크는 라벨만 남기고 강조/코드 마커
// 제거. 헤딩/불릿 접두는 호출측(라인 단위)에서 이미 처리한다.
function stripInlineMd(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // 이미지 → alt
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // 링크 → 라벨
    .replace(/\*\*([^*]+)\*\*/g, '$1') // 볼드
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2') // 이탤릭(단일 *)
    .replace(/`([^`]+)`/g, '$1'); // 인라인 코드
}

// ISO(또는 null) → YYYY-MM-DD. 파싱 실패/미지정 시 오늘 날짜(topline-docx formatDate).
function formatDate(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  const valid = !Number.isNaN(d.getTime()) ? d : new Date();
  const y = valid.getFullYear();
  const m = String(valid.getMonth() + 1).padStart(2, '0');
  const day = String(valid.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── Markdown ────────────────────────────────────────────────────────────────

function sourceLineMd(
  citations: string[] | undefined,
  sources: Map<string, CitationSource>,
): string | null {
  const names = citedFilenames(citations, sources);
  if (names.length === 0) return null;
  return `_근거: ${names.join(', ')}_`;
}

// 블록 → markdown 문자열(블록 하나가 하나의 문단 단위). raw chunk_id 노출 없음.
function blockToMarkdown(
  block: ToplineBlock,
  sources: Map<string, CitationSource>,
): string {
  const citations = 'citations' in block ? block.citations : undefined;
  const citedIds = new Set((citations ?? []).map((c) => String(c).trim()));
  const strip = (s: string) => stripInlineCitations(s, citedIds);
  const src = sourceLineMd(citations, sources);
  const withSrc = (body: string) => (src ? `${body}\n\n${src}` : body);

  if (block.type === 'executive_summary') {
    const parts: string[] = [];
    if (block.summary?.trim()) parts.push(strip(block.summary).trim());
    const points = (block.key_points ?? [])
      .filter((p) => p.trim())
      .map((p) => `- ${strip(p).trim()}`);
    if (points.length) parts.push(points.join('\n'));
    return withSrc(parts.join('\n\n'));
  }

  if (block.type === 'heading') {
    return `# ${(block.md ?? '').trim()}`;
  }

  if (block.type === 'subheading') {
    return `## ${(block.md ?? '').trim()}`;
  }

  if (block.type === 'quote') {
    const lines = strip(block.md ?? '')
      .trim()
      .split('\n')
      .map((l) => `> ${l}`.trimEnd());
    if (block.attribution) {
      lines.push('>', `> — ${block.attribution}`);
    }
    return withSrc(lines.join('\n'));
  }

  if (block.type === 'table' && block.table) {
    const parts: string[] = [];
    if (block.md?.trim()) parts.push(`**${block.md.trim()}**`);
    const headers = block.table.headers.map((h) => escapeCell(strip(h)));
    const sep = headers.map(() => '---');
    const lines = [
      `| ${headers.join(' | ')} |`,
      `| ${sep.join(' | ')} |`,
      ...block.table.rows.map(
        (row) =>
          `| ${headers.map((_, c) => escapeCell(strip(row[c] ?? ''))).join(' | ')} |`,
      ),
    ];
    parts.push(lines.join('\n'));
    return withSrc(parts.join('\n\n'));
  }

  if (block.type === 'chart' || block.type === 'pie') {
    const parts: string[] = [];
    if (block.title?.trim()) parts.push(`**${block.title.trim()}**`);
    if (block.description?.trim()) parts.push(block.description.trim());
    const data = block.data ?? [];
    const total = data.reduce((s, d) => s + (d.value > 0 ? d.value : 0), 0);
    const items = data.map((d) => {
      if (block.type === 'pie' && total > 0) {
        const pct = Math.round((d.value / total) * 100);
        return `- ${d.label}: ${d.value} (${pct}%)`;
      }
      return `- ${d.label}: ${d.value}`;
    });
    if (items.length) parts.push(items.join('\n'));
    return withSrc(parts.join('\n\n'));
  }

  if (block.type === 'inserted_qa') {
    const parts: string[] = [];
    if (block.question?.trim()) parts.push(`**Q. ${block.question.trim()}**`);
    if (block.selected_excerpt?.trim())
      parts.push(`> "${block.selected_excerpt.trim()}"`);
    if (block.md?.trim()) parts.push(strip(block.md).trim());
    return withSrc(parts.join('\n\n'));
  }

  if (block.type === 'inserted_section') {
    const parts: string[] = ['**✚ 삽입 섹션**'];
    if (block.prompt?.trim()) parts.push(`_지시: "${block.prompt.trim()}"_`);
    if (block.md?.trim()) parts.push(strip(block.md).trim());
    return withSrc(parts.join('\n\n'));
  }

  // paragraph · insight (기본) — md 원문 보존(불릿/번호 등은 이미 markdown).
  return withSrc(strip(block.md ?? '').trim());
}

/**
 * 탑라인 블록 배열 → Markdown 문자열. 표지(제목 + 생성일) 뒤에 블록들을 GFM 으로
 * 직렬화한다. 인용은 "근거: 문서명" 으로 변환하고 raw chunk_id 는 노출하지 않는다.
 */
export function toplineBlocksToMarkdown(
  blocks: ToplineBlock[],
  opts: ToplineTextOptions,
): string {
  const { projectName, generatedAt, sources } = opts;
  const title = projectName?.trim() || '탑라인 보고서';
  const head = `# ${title}\n\n_생성일 ${formatDate(generatedAt)}_`;
  const body = blocks
    .map((b) => blockToMarkdown(b, sources))
    .filter((s) => s.trim().length > 0);
  return [head, ...body].join('\n\n') + '\n';
}

// ── Plain text ───────────────────────────────────────────────────────────────

// md 프로즈(불릿/번호/문단) → plain 라인들. inline md 기호 제거.
function proseToPlain(md: string): string[] {
  const out: string[] = [];
  for (const raw of md.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) {
      out.push('');
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      out.push(`• ${stripInlineMd(bullet[1])}`);
      continue;
    }
    const num = line.match(/^\s*(\d+)\.\s+(.*)$/);
    if (num) {
      out.push(`${num[1]}. ${stripInlineMd(num[2])}`);
      continue;
    }
    out.push(stripInlineMd(line));
  }
  // 선행/후행 빈 줄 정리.
  while (out.length && out[0] === '') out.shift();
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

// 표 → 컬럼 정렬 plain 텍스트. 셀 문자열 최대폭에 맞춰 공백 패딩(2칸 간격) +
// 헤더 밑 구분선. CJK 는 폭이 어긋날 수 있으나 "읽을 수 있는 텍스트" 기준 충분.
function tableToPlain(
  headers: string[],
  rows: string[][],
  strip: (s: string) => string,
): string[] {
  const h = headers.map((c) => stripInlineMd(strip(c)).replace(/\r?\n/g, ' ').trim());
  const body = rows.map((row) =>
    h.map((_, c) => stripInlineMd(strip(row[c] ?? '')).replace(/\r?\n/g, ' ').trim()),
  );
  const widths = h.map((cell, c) =>
    Math.max(cell.length, ...body.map((r) => r[c].length), 0),
  );
  const pad = (cell: string, c: number) => cell + ' '.repeat(widths[c] - cell.length);
  const line = (cells: string[]) => cells.map((cell, c) => pad(cell, c)).join('  ').trimEnd();
  const out = [line(h), widths.map((w) => '-'.repeat(w)).join('  ').trimEnd()];
  for (const r of body) out.push(line(r));
  return out;
}

// 블록 → plain 텍스트 문자열(블록 하나 = 한 문단). 헤딩은 밑줄, 표는 정렬.
function blockToPlainText(
  block: ToplineBlock,
  sources: Map<string, CitationSource>,
): string {
  const citations = 'citations' in block ? block.citations : undefined;
  const citedIds = new Set((citations ?? []).map((c) => String(c).trim()));
  const strip = (s: string) => stripInlineCitations(s, citedIds);
  const names = citedFilenames(citations, sources);
  const srcLine = names.length ? `근거: ${names.join(', ')}` : null;
  const withSrc = (lines: string[]) =>
    (srcLine ? [...lines, '', srcLine] : lines).join('\n');

  if (block.type === 'executive_summary') {
    const lines: string[] = [];
    if (block.summary?.trim()) lines.push(...proseToPlain(strip(block.summary)));
    for (const p of block.key_points ?? []) {
      if (p.trim()) lines.push(`• ${stripInlineMd(strip(p)).trim()}`);
    }
    return withSrc(lines);
  }

  if (block.type === 'heading') {
    const text = stripInlineMd((block.md ?? '').trim());
    return `${text}\n${'='.repeat(Math.max(text.length, 1))}`;
  }

  if (block.type === 'subheading') {
    const text = stripInlineMd((block.md ?? '').trim());
    return `${text}\n${'-'.repeat(Math.max(text.length, 1))}`;
  }

  if (block.type === 'quote') {
    const lines = proseToPlain(strip(block.md ?? ''));
    if (block.attribution) lines.push(`— ${block.attribution}`);
    return withSrc(lines);
  }

  if (block.type === 'table' && block.table) {
    const lines: string[] = [];
    if (block.md?.trim()) lines.push(stripInlineMd(block.md.trim()));
    lines.push(...tableToPlain(block.table.headers, block.table.rows, strip));
    return withSrc(lines);
  }

  if (block.type === 'chart' || block.type === 'pie') {
    const lines: string[] = [];
    if (block.title?.trim()) lines.push(stripInlineMd(block.title.trim()));
    if (block.description?.trim()) lines.push(stripInlineMd(block.description.trim()));
    const data = block.data ?? [];
    const total = data.reduce((s, d) => s + (d.value > 0 ? d.value : 0), 0);
    for (const d of data) {
      if (block.type === 'pie' && total > 0) {
        const pct = Math.round((d.value / total) * 100);
        lines.push(`• ${d.label}: ${d.value} (${pct}%)`);
      } else {
        lines.push(`• ${d.label}: ${d.value}`);
      }
    }
    return withSrc(lines);
  }

  if (block.type === 'inserted_qa') {
    const lines: string[] = [];
    if (block.question?.trim()) lines.push(`Q. ${stripInlineMd(block.question.trim())}`);
    if (block.selected_excerpt?.trim())
      lines.push(`"${block.selected_excerpt.trim()}"`);
    if (block.md?.trim()) lines.push(...proseToPlain(strip(block.md)));
    return withSrc(lines);
  }

  if (block.type === 'inserted_section') {
    const lines: string[] = ['✚ 삽입 섹션'];
    if (block.prompt?.trim()) lines.push(`지시: "${block.prompt.trim()}"`);
    if (block.md?.trim()) lines.push(...proseToPlain(strip(block.md)));
    return withSrc(lines);
  }

  // paragraph · insight (기본).
  return withSrc(proseToPlain(strip(block.md ?? '')));
}

/**
 * 탑라인 블록 배열 → plain text. Markdown 기호(#·*·|·>)를 제거/치환한 선형
 * 텍스트: 헤딩은 밑줄, 불릿은 •, 표는 컬럼 정렬. 인용은 "근거: 문서명".
 */
export function toplineBlocksToPlainText(
  blocks: ToplineBlock[],
  opts: ToplineTextOptions,
): string {
  const { projectName, generatedAt, sources } = opts;
  const title = projectName?.trim() || '탑라인 보고서';
  const head = `${title}\n${'='.repeat(Math.max(title.length, 1))}\n생성일 ${formatDate(generatedAt)}`;
  const body = blocks
    .map((b) => blockToPlainText(b, sources))
    .filter((s) => s.trim().length > 0);
  return [head, ...body].join('\n\n') + '\n';
}
