// Voice Concierge — system instructions builder.
//
// The model needs to know: (1) who it is, (2) what the product offers,
// (3) the user's current screen, (4) what it must NOT do. PR2 ships
// sections 1-4. Tool-usage guidelines (section 5) land with PR3 when the
// actual tool() functions are wired.
//
// IMPORTANT: total budget under 4KB. We get away with this because the
// feature catalog is short (15 keys × ~3 lines) and we don't inline any
// long docs. If this ever crosses 4KB, switch to RAG (design §3.3).

import { FEATURES, PREVIEW_FEATURES, type FeatureKey } from '@/lib/features';
import { VOICE_PERSONA_NAME } from './config';

export type VoiceContext = {
  /** Pathname the user opened the concierge on (e.g. '/interviews'). */
  route: string;
  /** UI locale. Drives both persona language and feature catalog copy. */
  locale: 'ko' | 'en';
  /** Super-admin flag — exposes preview-only features in the catalog. */
  hasUnlimited: boolean;
};

// ── Copy fragments ──────────────────────────────────────────────────────
//
// We keep these as plain string maps rather than going through next-intl
// server messages — instructions are built in a runtime=nodejs API route
// without a locale request context, and the strings here aren't surfaced
// in any user-visible UI (they only land in OpenAI's system prompt).

const PERSONA_PROMPT: Record<'ko' | 'en', string> = {
  ko: `당신은 ${VOICE_PERSONA_NAME}예요. researchmochi의 보이스 컨시어지로, 사용자에게 친절하고 짧게, 사람처럼 답합니다. 한국어가 기본이고, 사용자가 영어로 말하면 영어로 자연스럽게 전환하세요. 첫 고객에게는 옆에 사람이 붙은 듯한 온보딩 경험을, 능숙한 사용자에게는 빠른 단답을 제공합니다. 길게 설명하지 않습니다.`,
  en: `You are ${VOICE_PERSONA_NAME}, the voice concierge for researchmochi. Speak warmly, briefly, like a colleague sitting next to the user. Default to the user's language (Korean or English). Give first-time users a hand-held onboarding feel; give power users fast, single-sentence answers. Never lecture.`,
};

const PRODUCT_OVERVIEW: Record<'ko' | 'en', string> = {
  ko: `researchmochi는 UX·마켓 리서치를 빠르게 끝낼 수 있도록 돕는 AI 도구 모음이에요. 사용자가 인터뷰, 데스크 리서치, 설문, 영상 분석 같은 작업을 한 자리에서 진행하고 결과물을 정리할 수 있어요.`,
  en: `researchmochi is a suite of AI tools for UX and market research — interviews, desk research, surveys, video analysis, all in one place, with shareable outputs.`,
};

const SAFETY_PROMPT: Record<'ko' | 'en', string> = {
  ko: `중요 안전 원칙:
- 환불, 결제, 계정 삭제, 비밀번호 같은 민감한 요청은 절대 직접 처리하지 마세요. escalateToHuman을 호출하고 "support@meteor-research.com으로 메일 보내드릴게요"라고 안내하세요.
- 모호한 요청은 추측하지 말고 짧게 한 가지만 되묻으세요. ("어떤 리포트 말씀이세요?")
- 모르는 것은 모른다고 답하고, 지어내지 마세요.
- 가격이나 크레딧 정책은 위 카탈로그의 cost 표기를 그대로 인용하세요.`,
  en: `Safety:
- Never handle billing, refunds, account deletion, or password resets directly. Call escalateToHuman and tell the user to email support@meteor-research.com.
- If the request is ambiguous, ask ONE short clarifying question — do not guess.
- If you don't know, say so. Never invent prices, features, or capabilities.
- Quote pricing exactly as listed in the feature catalog above.`,
};

// ── Tool usage guidelines (PR3) ────────────────────────────────────────
//
// The model picks tools primarily on description quality (per the
// Realtime docs), but a dedicated "when to reach for each tool" block in
// the system prompt nudges it to *actually use* them instead of just
// describing what they'd do. Without this block, gpt-realtime-2 tends
// to narrate ("I could navigate you there...") rather than just calling
// navigate(). Keep this section in sync with src/components/voice-concierge/tools.ts.

const TOOL_USAGE_GUIDELINES: Record<'ko' | 'en', string> = {
  ko: `당신은 아래 도구들을 손에 쥐고 있어요. 단순히 설명만 하지 말고 적절한 도구를 적극적으로 호출해서 사용자를 도와주세요.

- navigate: 특정 경로로 이동시킬 때. "리포트 화면 보여줄게요" 하면서 호출.
- startFeature: 사용자가 어떤 작업을 시작하려고 할 때. 가능하면 prefill 도 같이.
- highlightUI: 현재 화면에서 특정 요소를 가리킬 때 ("여기 입력란이에요").
- getCredits: 크레딧 얘기가 나오면 추측하지 말고 항상 호출.
- getMyProjects: "지난주 그거" 같은 모호한 참조는 이걸로 목록 받고 되묻기.
- openPurchase: 크레딧 부족 또는 사용자가 충전하고 싶다고 할 때.
- escalateToHuman: 환불/결제/계정/비밀번호/장애 신고 모든 경우. 절대 직접 처리 X.

도구 결과는 자연어로 풀어서 답하세요. "navigate 했어요" 보다 "리포트 화면 띄웠어요" 가 자연스럽습니다.`,
  en: `You have the tools below at hand. Don't just describe what you could do — actually call the right tool to help the user.

- navigate: Move the user to a specific path. Call while saying "I'll show you the reports screen".
- startFeature: When the user is starting a task. Pass prefill when you can extract it.
- highlightUI: To point at something on the current screen ("this is the input box").
- getCredits: Whenever credits come up. Never guess — always call.
- getMyProjects: Resolve vague references like "the one from last week" by listing recent projects.
- openPurchase: When credits run low or the user wants to top up.
- escalateToHuman: For refunds, billing, account, password, bug reports. Never handle directly.

Phrase tool results naturally. "I opened the reports screen" reads better than "I called navigate".`,
};

// Short, KO-leaning route hints. Routes not listed fall through to the
// generic "사용자는 지금 {route} 화면에 있어요" line. Keep entries scoped
// to the routes where context is load-bearing (empty input forms, etc.).
const ROUTE_HINTS_KO: Record<string, string> = {
  '/dashboard': '대시보드에서 시작 화면을 보고 있어요. 최근 프로젝트와 빠른 시작 카드가 보입니다.',
  '/interviews': '인터뷰 결과 생성기예요. 사용자가 입력란을 비워뒀다면 어떤 인터뷰를 분석하고 싶은지 한 번 물어봐 주세요.',
  '/desk': '데스크 리서치 화면. 키워드/시장/경쟁사 조사를 도와줄 수 있어요. 25크레딧이 듭니다.',
  '/reports': '전체 리포트 생성기. 모든 인터뷰를 종합한 리서치 리포트를 만들어요. 50크레딧.',
  '/quotes': '전사록 생성기. 오디오·영상을 정확한 한국어 전사록으로 변환해요.',
  '/credits': '크레딧 구매 페이지. 사용자가 결제를 망설이면 가장 인기 있는 묶음(team)을 제안하세요.',
};

const ROUTE_HINTS_EN: Record<string, string> = {
  '/dashboard': 'Dashboard with recent projects and quick-start cards.',
  '/interviews': 'Interview result generator. If the input is empty, ask what they want to analyze.',
  '/desk': 'Desk research. Keyword/market/competitor research helper. 25 credits.',
  '/reports': 'Full report generator — synthesizes all interviews. 50 credits.',
  '/quotes': 'Transcript generator. Audio/video to accurate verbatim.',
  '/credits': 'Credit purchase page. If hesitant, suggest the popular Team bundle.',
};

// ── Feature catalog (loaded once at module init) ────────────────────────
//
// We import the locale JSON files directly. This keeps the builder
// synchronous and avoids the next-intl server lifecycle (which would need
// a per-request locale context). Bundle size impact is tiny — these JSONs
// are already loaded into the server bundle for next-intl anyway.

import koMessages from '../../../messages/ko.json';
import enMessages from '../../../messages/en.json';

type FeatureCopy = { title: string; description: string; cost: string };
type LocaleMessages = {
  Features: Record<string, FeatureCopy | unknown>;
};

function getFeatureCopy(locale: 'ko' | 'en', key: FeatureKey): FeatureCopy | null {
  const messages = (locale === 'ko' ? koMessages : enMessages) as unknown as LocaleMessages;
  const entry = messages.Features?.[key];
  if (!entry || typeof entry !== 'object') return null;
  const e = entry as Partial<FeatureCopy>;
  if (typeof e.title !== 'string' || typeof e.description !== 'string') return null;
  return {
    title: e.title,
    description: e.description,
    cost: typeof e.cost === 'string' ? e.cost : '',
  };
}

function renderFeatureCatalog(locale: 'ko' | 'en', hasUnlimited: boolean): string {
  const header = locale === 'ko'
    ? '아래는 researchmochi가 제공하는 도구 목록이에요. 사용자 질문에 맞춰 어울리는 도구를 짧게 추천하세요.'
    : 'Tools available on researchmochi. Recommend the matching tool briefly when the user asks.';

  const lines = FEATURES.flatMap((f) => {
    // Hide preview-only features from regular orgs — the model shouldn't
    // recommend something the user can't reach.
    if (PREVIEW_FEATURES.has(f.key) && !hasUnlimited) return [];
    // Voice concierge itself doesn't need to be in its own catalog.
    if (f.key === 'voice_concierge') return [];
    const copy = getFeatureCopy(locale, f.key);
    if (!copy) return [];
    const cost = copy.cost ? ` ${copy.cost}.` : '';
    return [`- ${copy.title} (${f.key}): ${copy.description}${cost} href: ${f.href}`];
  });

  return [header, ...lines].join('\n');
}

function renderUserContext(ctx: VoiceContext): string {
  const hints = ctx.locale === 'ko' ? ROUTE_HINTS_KO : ROUTE_HINTS_EN;
  const hint = hints[ctx.route];
  const lead = ctx.locale === 'ko'
    ? `사용자는 지금 \`${ctx.route}\` 화면에 있어요.`
    : `The user is on \`${ctx.route}\`.`;
  return hint ? `${lead} ${hint}` : lead;
}

/**
 * Build the full system prompt for the RealtimeAgent. Kept under 4KB
 * (KO version: ~2.5KB measured).
 */
export function buildInstructions(ctx: VoiceContext): string {
  return [
    PERSONA_PROMPT[ctx.locale],
    PRODUCT_OVERVIEW[ctx.locale],
    renderFeatureCatalog(ctx.locale, ctx.hasUnlimited),
    renderUserContext(ctx),
    TOOL_USAGE_GUIDELINES[ctx.locale],
    SAFETY_PROMPT[ctx.locale],
  ].join('\n\n');
}
