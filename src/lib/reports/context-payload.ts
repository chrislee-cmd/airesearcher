import { z } from 'zod';

// Shape of the external-context blob a user supplies when running an
// Enhance pass on an existing report. Stored verbatim on
// report_versions.context_payload so the run is reproducible and the UI
// can show "this version was enhanced from {trends|logs|perspective}
// with the following inputs".

export const EnhanceMode = z.enum(['trends', 'logs', 'perspective']);
export type EnhanceMode = z.infer<typeof EnhanceMode>;

// Free-form text snippet — pasted body of a trend article, a memo, etc.
const TextInput = z.object({
  kind: z.literal('text'),
  content: z.string().min(1).max(50_000),
});

// URL pointer — the server may optionally fetch + summarize the page,
// but we keep the raw URL too.
const UrlInput = z.object({
  kind: z.literal('url'),
  url: z.string().url(),
  fetched: z
    .object({
      title: z.string().optional(),
      excerpt: z.string().max(20_000),
    })
    .optional(),
});

// File the user uploaded for this enhancement. We don't keep the binary
// long-term; only the normalized markdown excerpt that we feed to the
// model.
const FileInput = z.object({
  kind: z.literal('file'),
  filename: z.string(),
  mime: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
  normalized_md: z.string().max(80_000),
});

// Reference to an existing workspace artifact (desk research result,
// quant analysis output, etc.) — we copy its content excerpt in.
const ArtifactInput = z.object({
  kind: z.literal('artifact'),
  artifact_id: z.string(),
  feature: z.string(),
  title: z.string(),
  content_excerpt: z.string().max(80_000),
});

// Mode-specific structured form. Free-form on purpose — each mode reads
// its own keys (see enhance-prompts.ts).
const FormInput = z.object({
  kind: z.literal('form'),
  schema: EnhanceMode,
  fields: z.record(z.string(), z.unknown()),
});

export const ContextInput = z.discriminatedUnion('kind', [
  TextInput,
  UrlInput,
  FileInput,
  ArtifactInput,
  FormInput,
]);
export type ContextInput = z.infer<typeof ContextInput>;

export const ContextPayload = z.object({
  mode: EnhanceMode,
  inputs: z.array(ContextInput).min(1).max(20),
  user_note: z.string().max(2_000).optional(),
});
export type ContextPayload = z.infer<typeof ContextPayload>;

// Render the payload as a single text block that goes into the user
// message of the enhancement prompt. Kept dumb on purpose: the prompt
// (enhance-prompts.ts) does the heavy lifting of interpretation.
export function renderContextForPrompt(payload: ContextPayload): string {
  const parts: string[] = [];
  if (payload.user_note) {
    parts.push(`## 사용자 지시\n${payload.user_note}`);
  }
  payload.inputs.forEach((inp, i) => {
    const header = `## 입력 ${i + 1} — ${inp.kind}`;
    switch (inp.kind) {
      case 'text':
        parts.push(`${header}\n${inp.content}`);
        break;
      case 'url': {
        const body = inp.fetched
          ? `제목: ${inp.fetched.title ?? '(없음)'}\n발췌:\n${inp.fetched.excerpt}`
          : '(본문 가져오지 못함)';
        parts.push(`${header} (${inp.url})\n${body}`);
        break;
      }
      case 'file':
        parts.push(`${header} — ${inp.filename}\n${inp.normalized_md}`);
        break;
      case 'artifact':
        parts.push(
          `${header} — ${inp.feature} · ${inp.title}\n${inp.content_excerpt}`,
        );
        break;
      case 'form': {
        const lines = Object.entries(inp.fields)
          .map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`)
          .join('\n');
        parts.push(`${header} (${inp.schema} 폼)\n${lines}`);
        break;
      }
    }
  });
  return parts.join('\n\n');
}
