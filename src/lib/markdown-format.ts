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
