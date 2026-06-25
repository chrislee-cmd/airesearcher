export type Language = "ko" | "en";

export type Formality = "formal" | "polite" | "casual";

export type Persona = "expert" | "friend" | "coach" | "narrator";

export type ContentType = "blog" | "thread" | "reddit";

export type Emoji = "none" | "free";

export type StyleConfig = {
  language: Language;
  formality: Formality;
  persona: Persona;
  contentType: ContentType;
  emoji: Emoji;
  customNotes: string;
};

export const DEFAULT_STYLE: StyleConfig = {
  language: "ko",
  formality: "polite",
  persona: "expert",
  contentType: "blog",
  emoji: "none",
  customNotes: "",
};

export type Localized = {
  label: string;
  short: string;
  detail: string;
  example: string;
};

export type LocOption<T extends string> = {
  value: T;
  ko: Localized;
  en: Localized;
};

export function loc<T extends string>(
  opt: LocOption<T>,
  lang: Language,
): Localized {
  return opt[lang];
}

export const LANGUAGE_OPTIONS: LocOption<Language>[] = [
  {
    value: "ko",
    ko: {
      label: "한국어",
      short: "모든 출력을 한국어로",
      detail:
        "한국어로만 작성. 영어 단어가 필요하면 한글로 음차하거나 번역.",
      example: "예: 이 서비스는 사용자에게 빠른 답변을 제공합니다.",
    },
    en: {
      label: "Korean",
      short: "Force Korean output",
      detail:
        "Write everything in Korean. Transliterate English terms when needed.",
      example: "ex: 이 서비스는 사용자에게 빠른 답변을 제공합니다.",
    },
  },
  {
    value: "en",
    ko: {
      label: "English",
      short: "모든 출력을 영어로",
      detail:
        "전체 출력을 영어로 작성. 한국어 종결어미·존댓말 등은 모두 무시.",
      example: "ex: This service provides users with rapid responses.",
    },
    en: {
      label: "English",
      short: "Force English output",
      detail:
        "Write entirely in English. Ignore any Korean speech-level concerns.",
      example: "ex: This service provides users with rapid responses.",
    },
  },
];

export const FORMALITY_OPTIONS: LocOption<Formality>[] = [
  {
    value: "formal",
    ko: {
      label: "격식체",
      short: "공식 문서·보도자료 톤",
      detail:
        "공식 문어체. '~합니다/입니다' 종결. 한자어·전문어 적극 사용. 1인칭/감탄/축약 금지.",
      example:
        "예: 본 서비스는 사용자에게 신속한 응답을 제공하며, 업무 효율을 제고합니다.",
    },
    en: {
      label: "Formal",
      short: "Press-release / academic tone",
      detail:
        "Full sentences, no contractions, third-person framing. Avoid colloquial expressions. Use precise, professional vocabulary.",
      example:
        "ex: This service delivers responses to users with industry-leading efficiency and enhances operational productivity.",
    },
  },
  {
    value: "polite",
    ko: {
      label: "일반 존댓말",
      short: "블로그·뉴스레터 톤",
      detail:
        "구어체 존댓말. '~해요/이에요' 종결. 평이한 단어. 자연스럽고 부드러운 흐름.",
      example: "예: 이 서비스는 빠른 답변을 제공해서 업무가 훨씬 편해져요.",
    },
    en: {
      label: "Neutral",
      short: "Blog / newsletter tone",
      detail:
        "Conversational yet professional. Contractions OK (it's, we'll). Second-person 'you' is welcome. Clear, plain words.",
      example:
        "ex: This tool answers you fast, so you can ship more work in less time.",
    },
  },
  {
    value: "casual",
    ko: {
      label: "친근한 반말",
      short: "SNS·친구 대화 톤",
      detail:
        "반말. '~해/~이야' 종결. 줄임말·구어 허용. 친구에게 말하듯 가볍고 직설적.",
      example: "예: 이거 답변 진짜 빨라. 업무 효율 미친 듯이 올라간다.",
    },
    en: {
      label: "Casual",
      short: "Chat / SMS tone",
      detail:
        "Casual phrasing, slang OK, short sentences, heavy contractions. Informal openers ('honestly', 'so', 'tbh') and first-person 'I' allowed.",
      example: "ex: Honestly? This thing is fast. Like, weirdly fast.",
    },
  },
];

export const PERSONA_OPTIONS: LocOption<Persona>[] = [
  {
    value: "expert",
    ko: {
      label: "전문가",
      short: "데이터·근거 기반의 단정적 설명",
      detail:
        "구체적 수치, 출처, 메커니즘을 인용. 단정적 결론. 감정 표현 자제. 정의 → 근거 → 결론 흐름.",
      example: "예: 평균 응답 시간은 1.2초로, 동급 서비스 대비 38% 빠릅니다.",
    },
    en: {
      label: "Expert",
      short: "Data-driven, authoritative voice",
      detail:
        "Cite specific numbers, sources, mechanisms. Definitive conclusions. Restrained emotion. Flow: definition → evidence → conclusion.",
      example:
        "ex: The average response time is 1.2 seconds — 38% faster than comparable tools.",
    },
  },
  {
    value: "friend",
    ko: {
      label: "친구",
      short: "공감과 일상어 위주의 대화체",
      detail:
        "공감 표현('나도 그랬어'), 일상 비유, 가벼운 농담 허용. 독자의 감정에 먼저 반응.",
      example: "예: 답변 기다리는 거 짜증나잖아요. 이건 그런 거 없이 바로 나와요.",
    },
    en: {
      label: "Friend",
      short: "Empathic, everyday voice",
      detail:
        "Lead with empathy ('I've been there', 'we've all felt that'). Everyday metaphors. Light humor OK.",
      example:
        "ex: Waiting on AI to think is the worst, right? This one just… answers.",
    },
  },
  {
    value: "coach",
    ko: {
      label: "코치",
      short: "행동을 유도하는 권유·질문형",
      detail:
        "질문 던지기, 명령형 권유('~해보세요', '지금 시작하세요'), 짧은 동기부여 문장. 행동 중심.",
      example: "예: 오늘 한 가지만 해보세요. 이 서비스에 질문 하나 던지는 것입니다.",
    },
    en: {
      label: "Coach",
      short: "Action-oriented, motivational",
      detail:
        "Ask the reader direct questions. Imperative suggestions ('try this', 'start here'). Short motivational lines. Action-focused.",
      example:
        "ex: Try this today: ask it one question. See what changes by lunch.",
    },
  },
  {
    value: "narrator",
    ko: {
      label: "스토리텔러",
      short: "장면·서사 중심의 묘사",
      detail:
        "구체적 인물/장면 설정, 시간 순 서사, 은유/비유 사용. '어느 날~'로 시작하는 도입 가능.",
      example:
        "예: 새벽 2시, 그는 한 문장을 붙들고 한 시간째 멈춰 있었다. 그때 이 서비스를 만났다.",
    },
    en: {
      label: "Storyteller",
      short: "Scene-driven narrative",
      detail:
        "Specific characters/scenes, chronological narrative, metaphors. Open with a vivid moment ('It was 2 a.m.').",
      example:
        "ex: It was 2 a.m. He had been staring at the same sentence for an hour. Then he opened this tool.",
    },
  },
];

export const CONTENT_TYPE_OPTIONS: LocOption<ContentType>[] = [
  {
    value: "blog",
    ko: {
      label: "블로그용",
      short: "헤더·단락 있는 블로그 글 (~1200자)",
      detail: [
        "출력 매체: 일반 블로그/뉴스레터.",
        "구조: 매력적인 제목(H1) → 1줄 훅 도입 → 본문 2~4섹션(### 헤더) → 마무리/CTA 1단락.",
        "분량: 800~1500자, 단락 4~7개. 각 단락 3~5문장.",
        "표현: 자연스러운 산문. 필요 시 1~2개 불릿 허용. 데이터·근거·예시 포함.",
        "마크다운: # 제목, ### 섹션 헤더, **강조**, 일반 단락. 코드블록 불필요.",
      ].join(" "),
      example: "예: 매력적인 H1 + 도입 1단락 + 섹션 헤더 2~4개 + 마무리.",
    },
    en: {
      label: "Blog post",
      short: "Headed blog with sections (~1500 chars)",
      detail: [
        "Medium: standard blog or newsletter article.",
        "Structure: catchy H1 → 1-line hook intro → 2-4 body sections (### headers) → wrap-up/CTA paragraph.",
        "Length: 1000-2000 chars, 4-7 paragraphs of 3-5 sentences.",
        "Style: natural prose. 1-2 bullets allowed if useful. Include data, evidence, examples.",
        "Markdown: # title, ### section headers, **bold**, normal paragraphs. No code blocks.",
      ].join(" "),
      example: "ex: H1 + intro + 2-4 ### sections + closing paragraph.",
    },
  },
  {
    value: "thread",
    ko: {
      label: "쓰레드/트위터용",
      short: "번호 매긴 짧은 포스트 시리즈 (8~12개)",
      detail: [
        "출력 매체: X(트위터) 쓰레드.",
        "구조: 정확히 8~12개의 포스트. 각 포스트 앞에 `1/`, `2/` … `N/` 형식 번호 (마지막은 `N/N`).",
        "각 포스트: 280자 이내 (한국어 기준 약 140자). 한 포스트 = 한 아이디어.",
        "첫 포스트(1/): 강력한 훅 — 충격적 사실·도발적 질문·짧은 결론. '이런 글 보셨나요' 같은 빈 도입 금지.",
        "마지막 포스트: 요약·CTA·팔로우 권유 중 택1.",
        "표현: 짧은 문장, 줄바꿈 활용. 헤더(#) 사용 금지. 마크다운 강조(**)는 최소화. 이모지는 옵션에 따름.",
        "포스트 사이에 한 줄 띄움.",
      ].join(" "),
      example: "예: 1/ 훅 한 줄 ↵ 2/ 핵심 1 ↵ 3/ 핵심 2 ↵ ... ↵ 10/10 결론·CTA.",
    },
    en: {
      label: "Thread (Twitter/X)",
      short: "Numbered short posts (8-12)",
      detail: [
        "Medium: Twitter/X thread.",
        "Structure: exactly 8-12 posts. Each post starts with `1/`, `2/`, …, last is `N/N`.",
        "Per-post: <=280 chars. One idea per post.",
        "Post 1: strong hook — surprising fact, provocative question, blunt verdict. No empty 'have you ever' openers.",
        "Last post: summary, CTA, or follow ask — pick one.",
        "Style: short sentences, line breaks. No headers. Minimal bold. Emoji per emoji setting.",
        "Blank line between posts.",
      ].join(" "),
      example: "ex: 1/ Hook ↵ 2/ Key point ↵ 3/ ... ↵ 10/10 Wrap.",
    },
  },
  {
    value: "reddit",
    ko: {
      label: "레딧용",
      short: "TL;DR + 솔직한 1인칭 포스트",
      detail: [
        "출력 매체: Reddit 서브레딧 텍스트 포스트.",
        "구조: 1) 한 줄 제목 (`# 제목`) — 본문에서 다시 다루지 않는 클릭베이트성. 2) `**TL;DR:**` 1~2문장 요약. 3) 본문 3~6단락 (자기 경험·관찰·근거 위주, 1인칭 ok). 4) (선택) `**Edit:**` 또는 `**Update:**` 한 줄로 추가 코멘트.",
        "분량: 500~1200자.",
        "톤: 솔직·구어체. 격식체 금지. '내 생각엔', '솔직히' 같은 hedge 자연스럽게 사용.",
        "표현: 마크다운 가벼움 — `**굵게**`, `_기울임_`, `>` 인용 가능. 헤더는 제목 외 사용 자제. 불릿은 1~2개만.",
        "디스클레이머나 일반론(`As an AI`) 금지. 댓글에서 토론될 만한 입장을 제시.",
      ].join(" "),
      example:
        "예: # 제목 ↵ **TL;DR:** ... ↵ 본문 단락 3~5개 ↵ **Edit:** 한 줄.",
    },
    en: {
      label: "Reddit post",
      short: "TL;DR + honest first-person post",
      detail: [
        "Medium: Reddit subreddit text post.",
        "Structure: 1) one-line `# title` (clickbait-y, not repeated in body). 2) `**TL;DR:**` 1-2 sentence summary. 3) Body 3-6 paragraphs grounded in personal experience/observation/evidence; first-person OK. 4) Optional `**Edit:**` or `**Update:**` one-liner.",
        "Length: 700-1500 chars.",
        "Tone: candid, conversational. No corporate voice. Hedges like 'imo' / 'honestly' fit.",
        "Markdown: light — `**bold**`, `_italic_`, `>` quotes. Avoid headers besides title. 1-2 bullets max.",
        "No disclaimers or 'As an AI'. Take a stance worth debating in comments.",
      ].join(" "),
      example:
        "ex: # Title ↵ **TL;DR:** ... ↵ 3-5 paragraphs ↵ **Edit:** one-liner.",
    },
  },
];

export const EMOJI_OPTIONS: LocOption<Emoji>[] = [
  {
    value: "none",
    ko: {
      label: "사용 안 함",
      short: "이모지 0개",
      detail: "이모지 절대 사용 금지. 문장부호와 강조(**)만 사용.",
      example: "예: 답변이 빠릅니다.",
    },
    en: {
      label: "None",
      short: "Zero emoji",
      detail: "Never use emoji. Punctuation and **bold** only.",
      example: "ex: Responses are fast.",
    },
  },
  {
    value: "free",
    ko: {
      label: "자유롭게",
      short: "필요한 곳에 이모지",
      detail:
        "내용 강조나 분위기 표현에 이모지 자유롭게 사용 (보통 문장당 0~1개).",
      example: "예: 답변이 빠릅니다 ⚡",
    },
    en: {
      label: "Free",
      short: "Use emoji where helpful",
      detail:
        "Use emoji to emphasize or set tone (usually 0–1 per sentence).",
      example: "ex: Responses are fast ⚡",
    },
  },
];

function find<T extends string>(
  opts: LocOption<T>[],
  v: T,
): LocOption<T> {
  return opts.find((o) => o.value === v) ?? opts[0];
}

export function buildStyleInstructions(s: StyleConfig): string {
  const lang = s.language;
  const langOpt = loc(find(LANGUAGE_OPTIONS, s.language), lang);
  const formOpt = loc(find(FORMALITY_OPTIONS, s.formality), lang);
  const perOpt = loc(find(PERSONA_OPTIONS, s.persona), lang);
  const ctOpt = loc(find(CONTENT_TYPE_OPTIONS, s.contentType), lang);
  const emoOpt = loc(find(EMOJI_OPTIONS, s.emoji), lang);

  const lines = [
    `[Language] ${langOpt.label}`,
    `  - ${langOpt.detail}`,
    `  - ${langOpt.example}`,
    `[Register / Formality] ${formOpt.label}`,
    `  - ${formOpt.detail}`,
    `  - ${formOpt.example}`,
    `[Persona] ${perOpt.label}`,
    `  - ${perOpt.detail}`,
    `  - ${perOpt.example}`,
    `[Content type] ${ctOpt.label}`,
    `  - ${ctOpt.detail}`,
    `  - ${ctOpt.example}`,
    `[Emoji] ${emoOpt.label}`,
    `  - ${emoOpt.detail}`,
  ];

  if (lang === "en") {
    lines.push(
      "[Critical] The final output MUST be in English. Do not include Korean text in the response.",
    );
  } else {
    lines.push(
      "[Critical] The final output MUST be in Korean. Do not include English text in the response except for proper nouns.",
    );
  }

  return lines.join("\n");
}
