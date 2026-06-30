// 데스크 리서치 결과 보고서 (LLM markdown) → 토픽별 위젯 grid 를 위한
// 클라이언트 파싱. 결과 모달이 "문서 한 덩이" 대신 섹션별 Memphis 카드로
// 렌더하도록 `## 섹션` 단위로 자르고, 각 섹션을 알려진 7종 (Executive /
// Findings / RQ / Quant / Competitive / Caveats / Appendix) 으로 분류한다.
//
// 강건성 원칙 — 파싱은 절대 throw 하지 않고, 인식 가능한 섹션이 하나도 없으면
// `ok: false` 로 돌려 호출부가 raw markdown fallback 으로 회귀하게 한다
// (약식/raw-dump 보고서나 LLM 이 형식을 벗어난 경우 UI 깨짐 0).
//
// 실제 보고서 헤딩 (src/app/api/desk/route.ts synthesize prompt 기준):
//   1. # 🧭 Executive Summary            (H1)
//   2. ## 📝 Findings — …                 (### 토픽 sub-section)
//   3. ## ❓ Research Questions & Findings (### Q. sub-section)
//   4. ## 📊 Quantitative Snapshots
//   5. ## 🏢 Competitive / Market Map      (### 키워드 sub-section)
//   6. ## ⚠️ Caveats & Methodology
//   7. ## 📚 Appendix — Sources            (### T1/T2/T3 sub-section)
// Executive 만 H1 이라 `#{1,2}` 양쪽을 섹션 경계로 인정한다. 약식/raw-dump
// 보고서의 같은 아이콘 (🧭 개요, ❓, 📊, 📚) 도 같은 규칙으로 잡힌다.

export type DeskSectionKind =
  | 'executive'
  | 'findings'
  | 'rq'
  | 'quant'
  | 'competitive'
  | 'caveats'
  | 'appendix'
  | 'other';

// SectionCard 가 쓰는 accent 토큰 키. globals.css 에 실재하는 토큰만
// (info 토큰은 없어 pastel sky 로 대체). DeskAccent → 실제 클래스 매핑은
// section-card.tsx 가 소유.
export type DeskAccent =
  | 'amore'
  | 'success'
  | 'info'
  | 'warning'
  | 'peach'
  | 'mute'
  | 'mute-soft'
  | 'ink';

export type DeskEmphasis = 'large' | 'medium' | 'small';

export type DeskTopic = {
  id: string;
  title: string; // ### 헤더 텍스트 (아이콘/마크업 그대로)
  body: string; // 토픽 본문 markdown
};

export type DeskParsedSection = {
  id: string; // anchor id (e.g. 'desk-sec-findings')
  kind: DeskSectionKind;
  icon: string; // 헤더에서 추출한 선두 이모지 (없으면 kind 기본 아이콘)
  title: string; // 이모지 제거한 헤더 텍스트
  body: string; // 섹션 본문 markdown (헤딩 라인 제외)
  topics: DeskTopic[]; // ### 하위 섹션 (findings / competitive)
  emphasis: DeskEmphasis;
  accent: DeskAccent;
  collapsed: boolean; // default-collapsed (appendix)
};

export type ParsedDeskReport = {
  preamble: string; // 첫 헤딩 앞 내용 (보통 비어있음)
  sections: DeskParsedSection[];
  ok: boolean; // false → 호출부가 raw markdown 으로 fallback
};

// 헤더 선두 이모지 → kind. 아이콘이 분류의 1차 신호 (가장 안정적).
// ❓ 를 📝 보다 먼저 보는 순서는 무관 (정확 매칭) 이지만, RQ 헤더가
// "Research Questions & Findings" 라 'findings' 키워드를 품으므로 키워드
// fallback 보다 아이콘 매칭이 우선해야 RQ/Findings 가 안 섞인다.
const ICON_TO_KIND: { icon: string; kind: DeskSectionKind }[] = [
  { icon: '🧭', kind: 'executive' },
  { icon: '📝', kind: 'findings' },
  { icon: '❓', kind: 'rq' },
  { icon: '📊', kind: 'quant' },
  { icon: '🏢', kind: 'competitive' },
  { icon: '⚠️', kind: 'caveats' },
  { icon: '⚠', kind: 'caveats' },
  { icon: '📚', kind: 'appendix' },
];

// 아이콘이 없을 때의 키워드 fallback. RQ 를 findings 보다 먼저 검사 —
// "Research Questions & Findings" 가 두 키워드를 다 품어서.
const KEYWORD_RULES: { re: RegExp; kind: DeskSectionKind }[] = [
  { re: /executive\s*summary|^\s*개요/i, kind: 'executive' },
  { re: /research\s*questions?|리서치\s*질문/i, kind: 'rq' },
  { re: /findings/i, kind: 'findings' },
  { re: /quantitative|정량|snapshot/i, kind: 'quant' },
  { re: /competitive|market\s*map|경쟁|시장/i, kind: 'competitive' },
  { re: /caveats|methodology|한계|방법론/i, kind: 'caveats' },
  { re: /appendix|sources|출처/i, kind: 'appendix' },
];

const KIND_META: Record<
  DeskSectionKind,
  { icon: string; emphasis: DeskEmphasis; accent: DeskAccent; collapsed: boolean }
> = {
  executive: { icon: '🧭', emphasis: 'large', accent: 'amore', collapsed: false },
  findings: { icon: '📝', emphasis: 'large', accent: 'success', collapsed: false },
  rq: { icon: '❓', emphasis: 'medium', accent: 'info', collapsed: false },
  quant: { icon: '📊', emphasis: 'medium', accent: 'warning', collapsed: false },
  competitive: { icon: '🏢', emphasis: 'medium', accent: 'peach', collapsed: false },
  caveats: { icon: '⚠️', emphasis: 'small', accent: 'mute', collapsed: false },
  // Appendix — Sources 는 reference 성격이라 default collapsed 로 본문 초점 유지
  // (pr-desk-result-appendix-sources-collapsed-default 를 이 view 로 흡수).
  appendix: { icon: '📚', emphasis: 'small', accent: 'mute-soft', collapsed: true },
  other: { icon: '📄', emphasis: 'medium', accent: 'ink', collapsed: false },
};

// 유니코드 선두 이모지를 한 개만 떼어낸다 (variation selector 포함).
// 매우 보수적 — 실패해도 빈 문자열을 돌려 title 을 그대로 둔다.
function splitLeadingEmoji(raw: string): { icon: string; rest: string } {
  const m = /^\s*([\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}]️?)\s*(.*)$/u.exec(
    raw,
  );
  if (m) return { icon: m[1].replace(/️/g, '') || m[1], rest: m[2].trim() };
  return { icon: '', rest: raw.trim() };
}

function classify(title: string): DeskSectionKind {
  for (const { icon, kind } of ICON_TO_KIND) {
    if (title.includes(icon)) return kind;
  }
  for (const { re, kind } of KEYWORD_RULES) {
    if (re.test(title)) return kind;
  }
  return 'other';
}

// 섹션 본문을 `### ` 기준 토픽으로 분할. ### 앞의 lead 문단은 첫 토픽이
// 아니라 섹션 body 에 남겨 SectionCard 가 인트로로 렌더하게 한다.
function splitTopics(body: string): { lead: string; topics: DeskTopic[] } {
  const lines = body.split('\n');
  const lead: string[] = [];
  const topics: DeskTopic[] = [];
  let cur: { title: string; body: string[] } | null = null;
  let idx = 0;
  const flush = () => {
    if (cur) {
      topics.push({
        id: `topic-${idx++}`,
        title: cur.title,
        body: cur.body.join('\n').trim(),
      });
      cur = null;
    }
  };
  for (const line of lines) {
    const m = /^###\s+(.+?)\s*$/.exec(line);
    if (m) {
      flush();
      cur = { title: m[1].trim(), body: [] };
    } else if (cur) {
      cur.body.push(line);
    } else {
      lead.push(line);
    }
  }
  flush();
  return { lead: lead.join('\n').trim(), topics };
}

let anchorSeq = 0;
function makeAnchor(kind: DeskSectionKind): string {
  return kind === 'other' ? `desk-sec-other-${anchorSeq++}` : `desk-sec-${kind}`;
}

export function parseDeskReport(markdown: string): ParsedDeskReport {
  anchorSeq = 0;
  const source = (markdown ?? '').trim();
  if (!source) return { preamble: '', sections: [], ok: false };

  const lines = source.split('\n');
  const preamble: string[] = [];
  type Raw = { heading: string; title: string; body: string[] };
  const raws: Raw[] = [];
  let cur: Raw | null = null;
  let inFence = false;

  for (const line of lines) {
    // code fence 안의 `#` 는 헤딩이 아니다.
    if (/^\s*```/.test(line)) inFence = !inFence;
    const m = !inFence ? /^(#{1,2})\s+(.+?)\s*$/.exec(line) : null;
    if (m) {
      if (cur) raws.push(cur);
      else if (preamble.length === 0 && raws.length === 0) {
        // 첫 헤딩 — 그 앞 누적은 preamble 로 보존됨 (위 else 분기에서).
      }
      cur = { heading: line, title: m[2].trim(), body: [] };
    } else if (cur) {
      cur.body.push(line);
    } else {
      preamble.push(line);
    }
  }
  if (cur) raws.push(cur);

  // 분류 후 doc-title 류 'other' 헤딩이 맨 앞에 단독으로 오면 (본문 없음)
  // preamble 로 흡수 — "데스크 리서치 보고서" 같은 제목이 빈 카드가 되지 않게.
  const sections: DeskParsedSection[] = [];
  const leadingPreamble = [preamble.join('\n')];

  raws.forEach((raw, i) => {
    const kind = classify(raw.title);
    const bodyStr = raw.body.join('\n').trim();
    if (i === 0 && kind === 'other' && bodyStr.length < 4) {
      // 제목만 있는 H1 → preamble 로.
      leadingPreamble.push(raw.heading);
      return;
    }
    const { icon, rest } = splitLeadingEmoji(raw.title);
    const meta = KIND_META[kind];
    const withTopics =
      kind === 'findings' || kind === 'competitive'
        ? splitTopics(bodyStr)
        : { lead: bodyStr, topics: [] as DeskTopic[] };
    sections.push({
      id: makeAnchor(kind),
      kind,
      icon: icon || meta.icon,
      title: rest || raw.title,
      body: withTopics.lead,
      topics: withTopics.topics,
      emphasis: meta.emphasis,
      accent: meta.accent,
      collapsed: meta.collapsed,
    });
  });

  const ok = sections.length > 0;
  return {
    preamble: leadingPreamble.join('\n').trim(),
    sections,
    ok,
  };
}
