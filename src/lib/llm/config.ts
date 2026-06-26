// Zero-retention provider options for LLM calls (PR-SEC10).
//
// Why this exists: GDPR Art. 28 + SOC 2 confidentiality require that
// transcript / interview / desk research text sent to OpenAI and Anthropic
// is **not retained by the provider**. Each provider has a different
// mechanism:
//
//   OpenAI — `store: false` per request tells the API not to log the
//   request/response (default is 30 day abuse-monitoring retention). This is
//   org-policy enforceable too (ZDR / Zero Data Retention dashboard toggle),
//   but per-call `store: false` is the in-code guarantee that survives org
//   resets and is auditable in the source.
//
//   Anthropic — the Messages API is zero-retention by default; there is no
//   per-call flag. We avoid sending `metadata.user_id` (or any PII) so the
//   only thing Anthropic could log is timing + token counts.
//
// Both DPAs (docs/legal/) cover EU SCC + DPF. See
// docs/security-audit-data-flow.md §6.
//
// Use:
//
//   import { ZERO_RETENTION } from '@/lib/llm/config';
//
//   await generateText({
//     model,
//     prompt,
//     providerOptions: ZERO_RETENTION,
//   });

import { env } from '@/env';

export const LLM_ZERO_RETENTION_ENABLED = env.LLM_ZERO_RETENTION !== 'false';

// AI SDK `providerOptions` shape. Anthropic has no per-call ZDR flag, so the
// Anthropic key is intentionally absent — the provider is ZDR by default.
export const ZERO_RETENTION: { openai: { store: boolean } } = {
  openai: { store: !LLM_ZERO_RETENTION_ENABLED ? true : false },
};

// For routes calling the raw `openai` SDK (audio transcription, ephemeral
// realtime tokens). Returns options that should be merged into the call body
// where the SDK supports `store`. Audio + Realtime endpoints don't accept
// `store` — those rely on org-level ZDR.
export function openaiChatRequestExtras(): { store: false } | Record<string, never> {
  return LLM_ZERO_RETENTION_ENABLED ? { store: false } : {};
}
