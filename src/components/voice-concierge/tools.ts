'use client';

// Voice Concierge — client-side tool factory.
//
// The Agents SDK's `tool()` pattern (verified against
// @openai/agents-realtime@0.11.6 — see node_modules/.../tool.d.ts):
//   - The factory returns an array of FunctionTool objects.
//   - Each tool's execute() return value is automatically formatted as
//     a function_call_output and fed back to the model on the next turn.
//     There's no manual conversation.item.create needed.
//   - Tools are passed to `new RealtimeAgent({ ..., tools: [...] })` and
//     also flow into the session config when the SDK calls
//     transport.updateSessionConfig on connect / agent change.
//
// All tool descriptions are KO-leaning because (a) the persona is KO-default
// and (b) gpt-realtime-2 handles mixed-language tool descriptions cleanly
// per the Realtime docs. Keep them tight: 1 sentence + 1 example. The model
// picks tools by description quality, so this is load-bearing copy.

import { tool } from '@openai/agents/realtime';
import { z } from 'zod';
import { FEATURES, type FeatureKey } from '@/lib/features';
import {
  ESCALATION_TOPICS,
  FEATURE_KEY_LIST,
  NAVIGABLE_HREFS,
  PURCHASE_ROUTE,
  SUPPORT_EMAIL,
} from '@/lib/voice/tools';

// Minimal shape we need from next/navigation's useRouter() return —
// kept narrow so we don't import the AppRouterInstance type (which is
// internal-ish in Next 16 and would couple this file to the framework
// version).
export type VoiceRouter = {
  push: (href: string) => void;
};

/** Toast pusher signature — matches useToast().push from ToastProvider. */
export type VoiceToastPush = (
  message: string,
  opts?: { tone?: 'info' | 'amore' | 'warn'; ttlMs?: number },
) => void;

/** Per-tool-call analytics hook. Sends a fire-and-forget POST to bump
 *  voice_sessions.tool_calls. Best-effort; failures don't surface. */
type BumpToolCallCounter = () => void;

export type BuildVoiceToolsDeps = {
  router: VoiceRouter;
  toast: VoiceToastPush;
  /** Localized tool-status copy. Sourced from messages/{ko,en}.json
   *  Concierge.tool_* keys so we don't ship english toasts into a KO UI. */
  copy: {
    navigating: string;
    openingPurchase: string;
    escalating: string;
    highlightFallback: string;
  };
  /** voice_sessions.id of the active session — needed by the tool-call
   *  counter. Null when called before the session connects (the model
   *  shouldn't be invoking tools then, but we gate defensively). */
  getSessionId: () => string | null;
};

/**
 * Build the 7 voice concierge tools bound to a router + toast + session.
 * Called once per RealtimeSession lifecycle from use-realtime-session.ts.
 */
export function buildVoiceTools(deps: BuildVoiceToolsDeps) {
  const { router, toast, copy, getSessionId } = deps;

  // Fire-and-forget analytics counter. Skipped silently if no session id.
  const bumpToolCall: BumpToolCallCounter = () => {
    const sid = getSessionId();
    if (!sid) return;
    void fetch(`/api/voice/sessions/${sid}/tool-call`, { method: 'POST' }).catch(
      () => {
        /* best-effort */
      },
    );
  };

  // ── 1. navigate ────────────────────────────────────────────────────
  const navigateTool = tool({
    name: 'navigate',
    description:
      '사용자를 사이트 내 특정 경로로 이동시킬 때 호출합니다. 예: 사용자가 "리포트 보고 싶다"고 하면 href="/reports"로 호출하세요. 결제·충전·구매·payment 관련 요청은 이 도구가 아니라 openPurchase를 사용하세요.',
    parameters: z.object({
      href: z.enum(NAVIGABLE_HREFS as [string, ...string[]]),
    }),
    execute: async ({ href }) => {
      router.push(href);
      toast(copy.navigating, { tone: 'info' });
      bumpToolCall();
      return { ok: true, navigated_to: href };
    },
  });

  // ── 2. startFeature ────────────────────────────────────────────────
  // PR3.1: previously had `prefill: z.record(z.string(), z.unknown())` —
  // but the Realtime API rejects tool schemas whose parameters use
  // `additionalProperties` (strict mode requires every property to be
  // enumerated). The whole session.connect() was failing silently as a
  // result. Until we have a feature page that actually reads the
  // prefill payload, the parameter is dropped to a flat `key` enum.
  const startFeatureTool = tool({
    name: 'startFeature',
    description:
      '특정 피처 생성기 화면을 엽니다. 예: 사용자가 "인터뷰 분석 시작해줘"라고 하면 key="interviews"로 호출하세요.',
    parameters: z.object({
      key: z.enum(FEATURE_KEY_LIST),
    }),
    execute: async ({ key }) => {
      const feat = FEATURES.find((f) => f.key === (key as FeatureKey));
      if (!feat) {
        return { ok: false, error: 'unknown_feature' };
      }
      router.push(feat.href);
      toast(copy.navigating, { tone: 'info' });
      bumpToolCall();
      return { ok: true, key };
    },
  });

  // ── 3. highlightUI ─────────────────────────────────────────────────
  const highlightUITool = tool({
    name: 'highlightUI',
    description:
      '현재 화면의 특정 요소를 사용자에게 가리키고 싶을 때 호출합니다. 예: "여기 입력란이에요"처럼 안내할 때 targetId="keyword-input"으로 호출하세요.',
    parameters: z.object({
      targetId: z.string().min(1).max(128),
      message: z.string().max(256).optional(),
    }),
    execute: async ({ targetId, message }) => {
      // PR3 fires both a CustomEvent (for future coachmark overlay to
      // listen for) and a toast (so the user sees feedback today even
      // without a listener). The overlay component is out-of-scope for
      // PR3 — see voice-concierge-design.md §F8 / §5.
      if (typeof window !== 'undefined') {
        try {
          window.dispatchEvent(
            new CustomEvent('voice:highlight', {
              detail: { targetId, message },
            }),
          );
        } catch {
          /* old browsers without CustomEvent — fine */
        }
      }
      toast(message ?? copy.highlightFallback, { tone: 'amore' });
      bumpToolCall();
      return { ok: true };
    },
  });

  // ── 4. getCredits ──────────────────────────────────────────────────
  const getCreditsTool = tool({
    name: 'getCredits',
    description:
      '사용자의 남은 크레딧과 플랜을 확인할 때 호출합니다. 크레딧 수치는 추측하지 말고 반드시 이 도구로 확인하세요.',
    parameters: z.object({}),
    execute: async () => {
      try {
        const res = await fetch('/api/voice/tools/get-credits', {
          method: 'POST',
        });
        if (!res.ok) {
          return { ok: false, error: 'fetch_failed' };
        }
        const body = (await res.json()) as {
          credits: number;
          plan: string | null;
        };
        bumpToolCall();
        return {
          credits_remaining: body.credits,
          plan: body.plan ?? 'unknown',
        };
      } catch {
        return { ok: false, error: 'network_error' };
      }
    },
  });

  // ── 5. getMyProjects ───────────────────────────────────────────────
  const getMyProjectsTool = tool({
    name: 'getMyProjects',
    description:
      '"지난주에 시작한 그거" 같은 모호한 프로젝트 참조를 해석하기 위해 최근 프로젝트 목록을 가져옵니다. 기본 5개, 최대 10개.',
    parameters: z.object({
      limit: z.number().int().positive().max(10).optional(),
    }),
    execute: async ({ limit }) => {
      try {
        const res = await fetch('/api/voice/tools/get-projects', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ limit: limit ?? 5 }),
        });
        if (!res.ok) {
          return { ok: false, error: 'fetch_failed' };
        }
        const body = (await res.json()) as {
          projects: Array<{
            id: string;
            name: string;
            updatedAt: string | null;
            lastFeature?: string;
          }>;
        };
        bumpToolCall();
        return body;
      } catch {
        return { ok: false, error: 'network_error' };
      }
    },
  });

  // ── 6. openPurchase ────────────────────────────────────────────────
  const openPurchaseTool = tool({
    name: 'openPurchase',
    description:
      '크레딧 충전·결제·구매 페이지를 엽니다. 사용자가 "결제", "충전", "구매", "결제 페이지", "사고 싶어", "payment", "buy credits" 등 어떤 표현을 쓰든 이 도구를 호출하세요. 크레딧이 부족할 때도 자동으로 이 도구를 호출하세요. bundleId를 함께 보내면 미리 선택된 상태로 유도합니다. (절대 navigate("/billing") 호출 X — 그 경로는 존재하지 않습니다.)',
    parameters: z.object({
      bundleId: z.enum(['starter', 'team', 'studio', 'enterprise']).optional(),
    }),
    execute: async ({ bundleId }) => {
      // Forward-compat: append ?bundle= so a future /credits update can
      // pre-select the bundle. The current page ignores the query string
      // — that's fine, the model already announced the bundle verbally.
      const href = bundleId
        ? `${PURCHASE_ROUTE}?bundle=${bundleId}`
        : PURCHASE_ROUTE;
      router.push(href);
      toast(copy.openingPurchase, { tone: 'amore' });
      bumpToolCall();
      return { ok: true, route_opened: href };
    },
  });

  // ── 7. escalateToHuman ─────────────────────────────────────────────
  const escalateToHumanTool = tool({
    name: 'escalateToHuman',
    description:
      '환불·결제·계정·비밀번호·장애 신고 등 직접 처리할 수 없는 사안을 사람 담당팀에게 넘길 때 호출합니다. mailto로 메일 앱을 띄웁니다.',
    parameters: z.object({
      topic: z.enum(ESCALATION_TOPICS),
      detail: z.string().max(512).optional(),
    }),
    execute: async ({ topic, detail }) => {
      const subject = encodeURIComponent(`[Voice Concierge] ${topic}`);
      const body = encodeURIComponent(detail ?? '');
      const href = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
      // mailto: navigation: prefer window.location.href so we don't
      // collide with next/navigation's same-origin URL parsing.
      if (typeof window !== 'undefined') {
        try {
          window.location.href = href;
        } catch {
          /* sandboxed environments — silent */
        }
      }
      toast(copy.escalating, { tone: 'amore' });
      bumpToolCall();
      return { ok: true, channel: 'email' };
    },
  });

  return [
    navigateTool,
    startFeatureTool,
    highlightUITool,
    getCreditsTool,
    getMyProjectsTool,
    openPurchaseTool,
    escalateToHumanTool,
  ];
}

export type VoiceTools = ReturnType<typeof buildVoiceTools>;
