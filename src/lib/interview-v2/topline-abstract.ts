import type { ToplineBlock } from './types';

// 탑라인 보고서 blocks → 위젯 카드용 "abstract"(핵심 요약) 파생. 마이그 무변경
// (blocks JSONB). 신버전 보고서는 reduce 가 emit 한 전용 executive_summary
// 블록(summary + key_points)을 우선 쓰고, 그 블록이 없는 구버전 보고서는 "핵심
// 요약" 리드 섹션(첫 heading→다음 heading 전) 전체 — 리드 문단(summary) + 그 섹션의
// insight bullet(keyPoints) — 을 파생하는 #471 fallback 을 쓴다. 어느 경로든 제목 +
// 리드 문단 + 핵심 포인트 shape 로 수렴해 카드가 리치하게 그려진다
// (pr-interview-topline-executive-summary-field 결정 2·3 + #471 결정 1). client-safe —
// 서버 import 없음, DOM 접근 없음.

export type ToplineAbstract = {
  // 보고서 제목(첫 heading) — 없으면 프로젝트명으로 대체.
  title: string;
  // 핵심 요약(plain text). executive_summary 블록의 summary 우선, 없으면 "핵심
  // 요약" 리드 섹션의 문단(들)에서 파생(#471 fallback).
  summary: string;
  // 핵심 포인트 3~5(plain text). executive_summary 블록의 key_points, 또는 파생
  // fallback 에서 리드 섹션의 insight bullet. 리드에 문단 없이 insight 만 있으면
  // insight 가 summary 로 승격되고 keyPoints 는 빈 배열(중복 방지).
  keyPoints: string[];
  // 요약 출처 — 'executive_summary'(reduce 전용 블록) vs 'derived'(#471 파생
  // fallback). 카드가 "핵심 요약" 라벨 칩을 신버전에서만 띄우는 데 쓴다.
  source: 'executive_summary' | 'derived';
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

// 첫 heading(=섹션 제목) 다음부터 그 다음 heading 전까지의 블록 = "핵심 요약"
// 리드 섹션. depth-rework(#425/#808) 보고서는 리드에 "핵심 요약" heading + 문단 +
// insight bullet 을 싣는다. heading 이 아예 없으면 전체 blocks 를 리드로 본다
// (#471 결정 1 — 첫 문단만이 아니라 다음 heading 전까지 완전 파생). subheading 은
// 섹션 내부로 보고 경계로 치지 않는다(리드 섹션을 통째로 잡기 위함).
function leadSectionBlocks(blocks: ToplineBlock[]): ToplineBlock[] {
  const firstHeading = blocks.findIndex(
    (b) => b.type === 'heading' && b.md?.trim(),
  );
  if (firstHeading === -1) return blocks;
  const rest = blocks.slice(firstHeading + 1);
  const nextHeading = rest.findIndex(
    (b) => b.type === 'heading' && b.md?.trim(),
  );
  return nextHeading === -1 ? rest : rest.slice(0, nextHeading);
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

  // 우선: reduce 가 emit 한 전용 executive_summary 블록(리치 요약 + 핵심 포인트).
  // 신버전 보고서는 이걸 카드·fullview 공용 리드로 쓴다
  // (pr-interview-topline-executive-summary-field 결정 2).
  const exec = blocks.find(
    (b) => b.type === 'executive_summary' && b.summary?.trim(),
  );
  if (exec) {
    const summary = clampSentences(toPlainText(exec.summary ?? ''), 6, 360);
    if (summary) {
      const keyPoints = (exec.key_points ?? [])
        .map((p) => toPlainText(p))
        .filter(Boolean)
        .slice(0, 5);
      return { title, summary, keyPoints, source: 'executive_summary' };
    }
  }

  // Fallback(#471 파생 — 구버전 보고서 호환): 전용 executive_summary 블록이 없는
  // 보고서는 "핵심 요약" 리드 섹션(첫 heading→다음 heading 전) 전체를 파생한다.
  // 리드 문단(들) → summary, 그 섹션의 insight bullet → keyPoints 로 나눠 카드를
  // 리치하게 채운다(#471 결정 1 — 첫 문단만이 아니라 섹션 완전 파생, 리드 문단 +
  // 핵심 bullet). 리드 섹션에 소스가 없으면(첫 heading 이 표·인용만 거느린 경우)
  // 전체 blocks 로 넓혀 재시도 → 구버전(#449) 파생 회귀 방지.
  const lead = leadSectionBlocks(blocks);
  const pickText = (list: ToplineBlock[]) =>
    list.map((b) => toPlainText(b.md ?? '')).filter(Boolean);

  const paragraphsInLead = lead.filter(
    (b) => b.type === 'paragraph' && b.md?.trim(),
  );
  const insightsInLead = lead.filter(
    (b) => b.type === 'insight' && b.md?.trim(),
  );

  // summary = 리드 문단(없으면 리드 insight → 그마저 없으면 전체 blocks 문단/insight
  // 로 폴백). 문단이 summary 를 채웠을 때만 insight 를 keyPoints 로 분리한다 —
  // 문단이 없어 insight 가 summary 로 승격되면 keyPoints 는 비워 중복 노출을 막는다.
  let summarySource = pickText(
    paragraphsInLead.length ? paragraphsInLead : insightsInLead,
  );
  let keyPointsSource = paragraphsInLead.length ? pickText(insightsInLead) : [];

  if (summarySource.length === 0) {
    // 리드 섹션이 텍스트를 못 낸 구버전 보고서 — 전체 blocks 로 넓혀 파생(#449 동작).
    const allInsights = blocks.filter((b) => b.type === 'insight' && b.md?.trim());
    const allParagraphs = blocks.filter(
      (b) => b.type === 'paragraph' && b.md?.trim(),
    );
    summarySource = pickText(allParagraphs.length ? allParagraphs : allInsights);
    keyPointsSource = allParagraphs.length ? pickText(allInsights) : [];
  }

  // 리드 섹션 전체를 담되 카드 레이아웃 보호(사용자 결정 2 — 길이 상한, 초과는
  // "전체 보기"). 첫 문단만(240자) 보다 여유를 줘 리드 섹션을 리치하게(5문장/320자).
  const summary = clampSentences(summarySource.join(' '), 5, 320);
  if (!summary) return null;

  const keyPoints = keyPointsSource.slice(0, 5);

  return { title, summary, keyPoints, source: 'derived' };
}
