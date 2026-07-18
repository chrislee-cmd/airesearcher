// LLM 산출물 출력 언어(outputLang) 공용 결정 규칙 — i18n Phase 7.
//
// 배경: 리포트·topline·인사이트·요약 등 LLM 산출물은 과거 프롬프트에 "한국어로
// 작성" 을 하드코딩해 /en 유저에게도 한국어로 새어 나왔다. Phase 7 은 프롬프트
// 지시문(모델 추론용 scaffolding)은 그대로 두되 **출력 언어만 유저 로케일로
// 파라미터화**한다. 지시문 자체를 영어로 번역하면 모델 동작이 바뀌므로(특히
// 한국어 인터뷰 분석) 지시문은 유지가 원칙.
//
// 결정 규칙(단일 SSOT): 명시적 위젯 출력언어 선택 > 유저 로케일(#1038) > en.
//   - 위젯 명시 선택: probing/topline 처럼 출력언어 셀렉터가 있는 경로.
//   - 유저 로케일: NEXT_LOCALE 쿠키(=profiles.locale 동기) — request-locale.ts.
//   - en: 최종 폴백(routing.defaultLocale 과 일치).
//
// probing-prompts.ts / interview-v2/topline-prompt.ts 는 이 helper 이전에
// 자체 enum(PROBING_OUTPUT_LANGS / TOPLINE_OUTPUT_LANGS)을 갖고 있고 이미
// 동작하므로 그대로 둔다(회귀 방지). 신규로 파라미터화하는 경로만 이 helper 를
// 쓴다 — 라벨/코드 집합은 두 기존 enum 과 동일하게 맞춰 드리프트 0.

export const OUTPUT_LANGS = ['ko', 'en', 'ja', 'zh', 'es', 'th'] as const;
export type OutputLang = (typeof OUTPUT_LANGS)[number];

const OUTPUT_LANG_LABEL: Record<OutputLang, string> = {
  ko: '한국어', // i18n-allow-korean -- LLM 프롬프트에 박는 출력언어 라벨(유저 미노출 scaffolding)
  en: 'English',
  ja: '日本語',
  zh: '中文',
  es: 'Español',
  th: 'ไทย',
};

export function isOutputLang(v: unknown): v is OutputLang {
  return typeof v === 'string' && (OUTPUT_LANGS as readonly string[]).includes(v);
}

export function outputLangLabel(lang: OutputLang): string {
  return OUTPUT_LANG_LABEL[lang];
}

// 명시적 위젯 선택 > 유저 로케일 > en. 둘 다 미지정/미지원이면 en.
export function resolveOutputLang(
  explicit?: string | null,
  locale?: string | null,
): OutputLang {
  if (isOutputLang(explicit)) return explicit;
  if (isOutputLang(locale)) return locale;
  return 'en';
}

// 프롬프트 말미에 붙이는 출력 언어 지시(scaffolding — 한글 유지 OK, 유저 미노출).
// verbatim 인용·고유명사·파일명은 원문 언어를 보존해 인용 충실도를 지킨다.
export function outputLangDirective(lang: OutputLang): string {
  const label = outputLangLabel(lang);
  return `\n\n## 출력 언어 (필수)
- 모든 산출물 텍스트(제목·헤더·본문·요약·라벨·표 헤더·불릿)를 **${label}**(으)로 작성합니다.
- 단, 원문 인용(verbatim quote)·응답자 발화·고유명사·파일명은 **원래 언어 그대로** 둡니다(번역·의역 금지).`;
}
