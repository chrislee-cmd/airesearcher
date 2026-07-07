import type { ToplineBlock } from './types';

// 탑라인 보고서 blocks → 위젯 카드용 "abstract"(핵심 요약) 파생. 백엔드 무변경:
// 전용 abstract 필드를 만들지 않고 이미 저장된 blocks(heading/insight/paragraph
// …)에서 제목 + 2~4문장 요약을 순수 함수로 뽑는다 (사용자 결정 2). client-safe —
// 서버 import 없음, DOM 접근 없음.

export type ToplineAbstract = {
  // 보고서 제목(첫 heading) — 없으면 프로젝트명으로 대체.
  title: string;
  // 핵심 요약 2~4문장(plain text). insight 블록 우선, 없으면 첫 문단들.
  summary: string;
};

// markdown/인용 토큰을 제거해 순수 텍스트로 — 카드 abstract 는 서식 없이 짧게
// 노출한다(React 가 이스케이프하므로 특수문자 안전). topline-view 의
// stripCiteTokens 와 같은 취지지만, 여기선 cited set 이 없어 링크 밖 짧은
// `[token]` 을 인용으로 보고 통째로 제거한다(preview 스코프라 보수적으로 충분).
function toPlainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ') // fenced code
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → 텍스트만
    .replace(/\[[^\]\n]{1,40}\](?!\()/g, '') // 남은 [cite] 토큰
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // heading 마커
    .replace(/^\s{0,3}>\s?/gm, '') // blockquote 마커
    .replace(/^\s{0,3}(?:[-*+]|\d+\.)\s+/gm, '') // list 마커
    .replace(/(\*\*|__|~~|\*|_)/g, '') // emphasis 마커
    .replace(/\s+/g, ' ')
    .trim();
}

// 첫 N문장(또는 maxChars)까지만. 한/영 종결부호(. ! ? 。 …) 기준 분리, 종결부호가
// 없는 텍스트는 maxChars 로 잘라 말줄임. 긴 요약 방어(사용자 결정 — 카드 공간 제한).
function clampSentences(
  text: string,
  maxSentences: number,
  maxChars: number,
): string {
  if (!text) return '';
  const parts = text.match(/[^.!?。…]+[.!?。…]+|\S[^.!?。…]*$/g) ?? [text];
  let out = '';
  let n = 0;
  for (const p of parts) {
    if (n >= maxSentences) break;
    const next = `${out}${p}`.trim();
    if (out && next.length > maxChars) break;
    out = `${next} `;
    n += 1;
    if (out.length >= maxChars) break;
  }
  out = out.trim();
  if (out.length > maxChars) out = `${out.slice(0, maxChars).trim()}…`;
  return out;
}

// blocks 에서 abstract 파생. 요약 소스가 하나도 없으면 null → 호출부는 파일 리스트
// 로 폴백(빈 blocks / quote·table 만 있는 보고서 방어).
export function deriveToplineAbstract(
  blocks: ToplineBlock[] | null | undefined,
  fallbackTitle: string,
): ToplineAbstract | null {
  if (!blocks || blocks.length === 0) return null;

  const headingMd =
    blocks.find((b) => b.type === 'heading' && b.md?.trim())?.md ??
    blocks.find((b) => b.type === 'subheading' && b.md?.trim())?.md ??
    '';
  const title = toPlainText(headingMd) || fallbackTitle;

  // 요약 소스: insight(교차분석 대조) 우선, 없으면 첫 문단들.
  const insights = blocks.filter((b) => b.type === 'insight' && b.md?.trim());
  const paragraphs = blocks.filter(
    (b) => b.type === 'paragraph' && b.md?.trim(),
  );
  const source = (insights.length ? insights : paragraphs)
    .map((b) => toPlainText(b.md ?? ''))
    .filter(Boolean)
    .join(' ');

  const summary = clampSentences(source, 4, 240);
  if (!summary) return null;

  return { title, summary };
}
