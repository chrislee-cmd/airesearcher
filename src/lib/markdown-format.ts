/**
 * If the extracted text already has plausible interview/document structure
 * — markdown headers, lists, code fences, OR simply enough paragraph breaks
 * to suggest it's prose, not a single wall of text — pass it through with
 * minimal cleanup. Skipping the LLM formatter here avoids the output-token
 * cap silently truncating large interviews (the failure mode where a 113k
 * char .md became 9k char output, or a 41k char .docx became 9.7k chars).
 *
 * No file-extension gate: a .docx interview extracted by mammoth typically
 * has one paragraph per utterance, and the structural test below is a
 * stronger signal than the extension anyway.
 */
export function tryMarkdownPassthrough(
  rawText: string,
  filename: string,
): string | null {
  const hasHeader = /^#{1,6}\s+/m.test(rawText);
  const hasList = /^\s*[-*+]\s+/m.test(rawText) || /^\s*\d+\.\s+/m.test(rawText);
  // Require enough paragraph breaks that a single huge run-on isn't
  // accepted. 5+ blank-line separators ≈ at least 6 paragraphs of prose.
  const hasParagraphs = (rawText.match(/\n\s*\n/g) ?? []).length >= 5;
  const hasCode = /```/.test(rawText);
  if (!(hasHeader || hasList || hasParagraphs || hasCode)) return null;

  // Minimal cleanup: normalize line endings, collapse 3+ blank lines.
  const cleaned = rawText
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return `---\nfile: ${filename}\n---\n\n${cleaned}\n`;
}

/**
 * Try to convert a raw interview transcript into structured Markdown using
 * deterministic regex parsing. Returns null when the input does not look
 * like a labeled interview, so callers can fall back to an LLM step.
 *
 * Detected speaker labels (case-sensitive, line-leading):
 *   M | R | Q | A | I | P
 *   진행자 | 응답자 | 면접관 | 참여자 | 인터뷰어
 *   Moderator | Interviewer | Respondent | Participant | Interviewee
 *
 * Heuristic: needs at least 4 prefix matches AND ≥2 distinct speakers.
 */
export function tryRegexMarkdown(
  rawText: string,
  filename: string,
): string | null {
  const SPEAKER =
    /^(M|R|Q|A|I|P|진행자|응답자|면접관|참여자|인터뷰어|Moderator|Interviewer|Respondent|Participant|Interviewee)\s*[:：]\s*(.*)$/;

  const lines = rawText.split(/\r?\n/).map((l) => l.trim());
  const labelHits = lines.filter((l) => SPEAKER.test(l)).length;
  if (labelHits < 4) return null;

  type Block = { role: string; text: string };
  const blocks: Block[] = [];
  let cur: Block | null = null;
  for (const line of lines) {
    if (!line) continue;
    const m = SPEAKER.exec(line);
    if (m) {
      if (cur) blocks.push(cur);
      cur = { role: m[1], text: m[2] };
    } else if (cur) {
      cur.text += ' ' + line;
    }
  }
  if (cur) blocks.push(cur);
  if (new Set(blocks.map((b) => b.role)).size < 2) return null;

  const QUESTION_ROLE =
    /^(M|Q|I|진행자|면접관|인터뷰어|Moderator|Interviewer)$/;

  const cleanInline = (s: string) =>
    s
      // mammoth artifact: [[text]{.underline}](url) → [text](url)
      .replace(/\[\[(.+?)\]\{[^}]*\}\]\((.+?)\)/g, '[$1]($2)')
      // mammoth artifact: [text]{.underline} → text
      .replace(/\[(.+?)\]\{[^}]*\}/g, '$1')
      // collapse repeated whitespace
      .replace(/\s+/g, ' ')
      .trim();

  const out: string[] = [
    '---',
    `file: ${filename}`,
    '---',
    '',
  ];
  for (const b of blocks) {
    const text = cleanInline(b.text);
    if (!text) continue;
    if (QUESTION_ROLE.test(b.role)) {
      out.push('', `## Q. ${text}`, '');
    } else {
      out.push(text);
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
