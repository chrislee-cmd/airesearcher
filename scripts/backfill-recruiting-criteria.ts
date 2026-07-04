// Backfill 참여자 조건(criteria) for recruiting forms published before the
// `criteria`/`summary` columns existed (migration 20260703060414).
//
// WHY this exists — the fullview "참여자 조건" panel reads
// `recruiting_forms.criteria`. Forms published before that migration (or
// before this feature shipped) have `criteria IS NULL`, so the panel renders
// empty even though 분포 works. The wizard's `editedBrief` that produced the
// survey is long gone (React state only), so there is no stored copy to
// re-persist. This one-off ops script reconstructs an *approximation* of the
// criteria by reading the published Google Form's screening questionnaire and
// asking the same LLM (Sonnet 4.6) that the wizard uses to infer the
// recruitment target 조건 back out of the questions.
//
// This is lossy by nature — the questionnaire is downstream of the original
// criteria — so it is a best-effort recovery, not a faithful restore. Review
// the --dry-run output before committing.
//
// COST GATE — the LLM is only called with an explicit flag, because each form
// costs one Sonnet 4.6 completion:
//   (no flag)   list forms needing backfill. No LLM, no writes. (diagnosis)
//   --dry-run   call the LLM per form and print derived criteria. No writes.
//   --commit    call the LLM and UPDATE recruiting_forms. Writes.
// Scope with --limit N, --form <formId>, --org <orgId>.
//
// RUN (from the repo/worktree root, with .env.local present):
//   node --experimental-strip-types --env-file=.env.local \
//     scripts/backfill-recruiting-criteria.ts            # list candidates
//   node --experimental-strip-types --env-file=.env.local \
//     scripts/backfill-recruiting-criteria.ts --dry-run --limit 3
//   node --experimental-strip-types --env-file=.env.local \
//     scripts/backfill-recruiting-criteria.ts --commit
//
// Google Forms read requires the admin-proxy token (GOOGLE_ADMIN_*): prod
// publishes land in the admin's Drive (see google-oauth-admin.ts), so the
// admin bearer can read them. Legacy per-user OAuth forms are not readable
// with this token — those are skipped with a warning, not failed.
//
// Anthropic is zero-retention by default (see lib/llm/config.ts) and we send
// no user/PII metadata, so no providerOptions are needed here.

import { createClient } from '@supabase/supabase-js';
import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { recruitingBriefSchema } from '../src/lib/recruiting-schema.ts';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FORMS_BASE = 'https://forms.googleapis.com/v1/forms';

// Mirror the wizard's extraction persona (see /api/recruiting/extract) but
// point it at a *published questionnaire* instead of RFP source material: we
// are reverse-inferring the recruitment 조건 from the screening questions.
const SYSTEM = `당신은 정성/정량 리서치 모집 전문가입니다. 아래는 이미 발행된 참여자 스크리닝 설문지(질문 목록)입니다. 이 설문이 걸러내려는 **대상자 모집 조건(criteria)** 을 역으로 추론해 구조화하세요.

- 인구통계(연령, 성별, 거주지), 직업/소득, 사용/구매 경험, 행태/태도, 보유 제품, 의사결정 권한 등을 **항목별로 잘게 쪼개서** 추출.
- 각 항목은 category, label(짧게), detail(한 문장 설명), required(필수 여부)를 채울 것.
- 설문 질문이 근거로 삼지 않는 조건은 만들지 말 것 (추측 최소화).
- summary 는 이 모집의 대상/목적을 한 문장으로.
- schedule 은 설문지만으로는 알 수 없으므로 빈 배열로 둘 것.

한국어로 작성. 결과는 JSON 스키마만.`;

type Criterion = {
  category: string;
  label: string;
  detail: string;
  required: boolean;
};

type FormRow = {
  form_id: string;
  title: string | null;
  org_id: string | null;
  created_at: string;
};

// Loose slice of the forms.googleapis.com GET response — we read question
// titles + descriptions + choice option values to give the LLM signal.
type FormChoice = { value?: string };
type FormQuestion = {
  choiceQuestion?: { options?: FormChoice[] };
};
type FormItem = {
  title?: string;
  description?: string;
  questionItem?: { question?: FormQuestion };
};
type FormGetResponse = {
  info?: { title?: string; documentTitle?: string };
  items?: FormItem[];
};

function parseArgs(argv: string[]) {
  const flags = {
    commit: argv.includes('--commit'),
    dryRun: argv.includes('--dry-run'),
    help: argv.includes('--help') || argv.includes('-h'),
    limit: undefined as number | undefined,
    form: undefined as string | undefined,
    org: undefined as string | undefined,
  };
  const readValue = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const limitRaw = readValue('--limit');
  if (limitRaw) flags.limit = Number.parseInt(limitRaw, 10);
  flags.form = readValue('--form');
  flags.org = readValue('--org');
  return flags;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing env ${name}. Run with --env-file=.env.local (or export it).`,
    );
  }
  return v;
}

// Inline admin-token mint — mirrors lib/google-oauth-admin.getAdminAccessToken
// but self-contained so this script runs under `node --experimental-strip-types`
// without pulling the Next.js server module graph (@sentry/nextjs, @/env).
async function getAdminAccessToken(): Promise<string> {
  const body = new URLSearchParams({
    client_id: requireEnv('GOOGLE_CLIENT_ID'),
    client_secret: requireEnv('GOOGLE_CLIENT_SECRET'),
    refresh_token: requireEnv('GOOGLE_ADMIN_REFRESH_TOKEN'),
    grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new Error(`admin_token_refresh_failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

async function fetchForm(
  accessToken: string,
  formId: string,
): Promise<FormGetResponse> {
  const res = await fetch(`${FORMS_BASE}/${formId}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`forms_get_failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as FormGetResponse;
}

// Flatten a form's questions into a compact prompt the LLM can reason over.
function questionnaireText(form: FormGetResponse): string {
  const lines: string[] = [];
  const title = form.info?.title || form.info?.documentTitle;
  if (title) lines.push(`설문 제목: ${title}`);
  let n = 0;
  for (const item of form.items ?? []) {
    if (!item.questionItem?.question) continue; // skip page breaks / text blocks
    n += 1;
    const parts: string[] = [`Q${n}. ${item.title ?? '(무제)'}`];
    if (item.description) parts.push(`  설명: ${item.description}`);
    const opts = item.questionItem.question.choiceQuestion?.options
      ?.map((o) => o.value)
      .filter((v): v is string => Boolean(v));
    if (opts && opts.length > 0) parts.push(`  선택지: ${opts.join(' / ')}`);
    lines.push(parts.join('\n'));
  }
  return lines.join('\n');
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(
      [
        'backfill-recruiting-criteria — 옛 리크루팅 폼의 참여자 조건 재추출',
        '',
        '  (no flag)   backfill 대상 폼 나열 (LLM 미호출, 쓰기 없음)',
        '  --dry-run   폼별 LLM 재추출 후 출력 (쓰기 없음, LLM 비용 발생)',
        '  --commit    LLM 재추출 + recruiting_forms UPDATE (LLM 비용 발생)',
        '  --limit N   최대 N개만',
        '  --form <id> 특정 form_id 하나만',
        '  --org <id>  특정 org_id 만',
      ].join('\n'),
    );
    return;
  }

  const supabase = createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } },
  );

  // Candidate set: forms with no stored criteria yet. If the `criteria`
  // column itself doesn't exist (migration not applied → 원인 1), this select
  // fails with 42703 — surface that clearly instead of a cryptic error.
  let query = supabase
    .from('recruiting_forms')
    .select('form_id, title, org_id, created_at')
    .is('criteria', null)
    .order('created_at', { ascending: false });
  if (flags.form) query = query.eq('form_id', flags.form);
  if (flags.org) query = query.eq('org_id', flags.org);
  if (flags.limit) query = query.limit(flags.limit);

  const { data, error } = await query;
  if (error) {
    if (error.code === '42703') {
      console.error(
        '\n❌ recruiting_forms.criteria 컬럼이 없습니다 — 마이그레이션(20260703060414) 이 prod 에 적용되지 않았습니다 (원인 1).\n   먼저 `supabase db push --linked` 로 마이그를 적용한 뒤 다시 실행하세요.\n',
      );
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const rows = (data ?? []) as FormRow[];
  console.log(`\nbackfill 대상 (criteria 미저장): ${rows.length}개`);
  for (const r of rows) {
    console.log(`  - ${r.form_id}  ${r.title ?? '(무제)'}  · org=${r.org_id ?? '—'} · ${r.created_at}`);
  }

  if (rows.length === 0) return;
  if (!flags.dryRun && !flags.commit) {
    console.log(
      '\nℹ️  LLM 재추출을 하려면 --dry-run (미기록) 또는 --commit (기록) 을 붙이세요. (LLM 비용 발생)\n',
    );
    return;
  }

  const anthropic = createAnthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY') });
  const accessToken = await getAdminAccessToken();

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  for (const r of rows) {
    process.stdout.write(`\n▶ ${r.form_id} (${r.title ?? '무제'}) … `);
    let form: FormGetResponse;
    try {
      form = await fetchForm(accessToken, r.form_id);
    } catch (e) {
      // Legacy per-user forms aren't in the admin Drive → 403/404. Skip, don't fail.
      console.log(`skip (Forms read 실패: ${e instanceof Error ? e.message : e})`);
      skipped += 1;
      continue;
    }

    const text = questionnaireText(form);
    if (!text.trim()) {
      console.log('skip (질문 없음)');
      skipped += 1;
      continue;
    }

    let brief: { summary: string; criteria: Criterion[] };
    try {
      const { object } = await generateObject({
        model: anthropic('claude-sonnet-4-6'),
        schema: recruitingBriefSchema,
        system: SYSTEM,
        prompt: `다음 스크리닝 설문지에서 모집 조건을 역추론하세요.\n\n${text}`,
        temperature: 0.1,
      });
      brief = { summary: object.summary, criteria: object.criteria };
    } catch (e) {
      console.log(`fail (LLM: ${e instanceof Error ? e.message : e})`);
      failed += 1;
      continue;
    }

    console.log(`criteria ${brief.criteria.length}개 추출`);
    for (const c of brief.criteria) {
      console.log(`    · [${c.category}] ${c.label}${c.required ? ' (필수)' : ''} — ${c.detail}`);
    }
    console.log(`    summary: ${brief.summary}`);

    if (flags.commit) {
      const { error: upErr } = await supabase
        .from('recruiting_forms')
        .update({ criteria: brief.criteria, summary: brief.summary })
        .eq('form_id', r.form_id);
      if (upErr) {
        console.log(`    ⚠️ UPDATE 실패: ${upErr.message}`);
        failed += 1;
        continue;
      }
      console.log('    ✅ 저장됨');
    }
    ok += 1;
  }

  console.log(
    `\n완료 — 성공 ${ok} · 건너뜀 ${skipped} · 실패 ${failed}${flags.commit ? '' : ' (dry-run: 미기록)'}\n`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
