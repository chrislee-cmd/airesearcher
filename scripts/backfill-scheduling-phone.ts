// Backfill sched_candidates.phone to the canonical `10########` form (card 604).
//
// WHY this exists — phones were stored verbatim (`010-1234-5678` · ` 01012345678 `
// · `10-1234-5678` 혼재), so dedup (숫자만 비교) sees `010…`(11자리) and `10…`
// (10자리) as different people, and the participant gate collides on the shared
// tail. Canonicalizing every stored phone to one form (앞0·국가코드·구분자 제거,
// 10자리) makes dedup + gate consistent. New ingest is already canonical (the
// parser + upsert chokepoint); this one-off script fixes the existing rows.
//
// SAFE + REVERSIBLE: a canonicalizable phone is replaced with the canonical value
// and the ORIGINAL is preserved under fields.__phone_raw (only when absent — never
// clobbered, so re-runs keep the first-seen raw). Un-canonicalizable phones
// (유선/자릿수 이상/010 계열 아님 — 실측 ~39건) are LEFT UNTOUCHED and only printed
// as a report for a human to fix at the source (덮어쓰기 = 복구 불가). Empty phones
// are skipped. Idempotent — a second --commit is a no-op (already canonical).
//
// COST GATE — no LLM, no external calls; just a paginated read + targeted UPDATEs:
//   (no flag)   diagnose: count already-canonical / to-change / flagged. No writes.
//   --dry-run   print sample transforms + the full flagged report. No writes.
//   --commit    UPDATE canonicalizable rows (phone + __phone_raw). Writes.
// Scope with --limit N, --project <interview_project_id>, --batch <sched_batch_id>.
//
// RUN (from the repo/worktree root, with .env.local present):
//   node --experimental-strip-types --env-file=.env.local \
//     scripts/backfill-scheduling-phone.ts              # diagnose (no writes)
//   node --experimental-strip-types --env-file=.env.local \
//     scripts/backfill-scheduling-phone.ts --dry-run
//   node --experimental-strip-types --env-file=.env.local \
//     scripts/backfill-scheduling-phone.ts --commit

import { createClient } from '@supabase/supabase-js';
import {
  canonicalizeMobile,
  PHONE_RAW_FIELD,
  type PhoneFlagReason,
} from '../src/lib/scheduling/phone.ts';

type CandRow = {
  id: string;
  batch_id: string | null;
  name: string | null;
  phone: string | null;
  fields: Record<string, string> | null;
};

const PAGE = 1000;

function parseArgs(argv: string[]) {
  const flags = {
    commit: argv.includes('--commit'),
    dryRun: argv.includes('--dry-run'),
    help: argv.includes('--help') || argv.includes('-h'),
    limit: undefined as number | undefined,
    project: undefined as string | undefined,
    batch: undefined as string | undefined,
  };
  const readValue = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const limitRaw = readValue('--limit');
  if (limitRaw) flags.limit = Number.parseInt(limitRaw, 10);
  flags.project = readValue('--project');
  flags.batch = readValue('--batch');
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

const REASON_LABEL: Record<PhoneFlagReason, string> = {
  no_digits: '숫자 없음',
  not_mobile: '휴대폰 형식 아님(유선/기타)',
  wrong_length: '자릿수 미달/초과',
};

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(
      [
        'backfill-scheduling-phone — sched_candidates.phone 정본화(10########)',
        '',
        '  (no flag)   진단만: 이미 정본 / 변경대상 / flag 건수 집계 (쓰기 없음)',
        '  --dry-run   변경 샘플 + flag 리포트 출력 (쓰기 없음)',
        '  --commit    정본화 가능 행 UPDATE (phone + __phone_raw). 쓰기 발생',
        '  --limit N   최대 N개만',
        '  --project <interview_project_id>  특정 프로젝트의 batch 만',
        '  --batch <sched_batch_id>          특정 batch 만',
      ].join('\n'),
    );
    return;
  }

  const supabase = createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } },
  );

  // Optional scoping: --project resolves to its sched_batches ids; --batch is a
  // single batch id. Absent → every candidate.
  let batchIds: string[] | null = null;
  if (flags.batch) {
    batchIds = [flags.batch];
  } else if (flags.project) {
    const { data: batches, error } = await supabase
      .from('sched_batches')
      .select('id')
      .eq('project_id', flags.project);
    if (error) throw error;
    batchIds = (batches ?? []).map((b) => b.id as string);
    if (batchIds.length === 0) {
      console.log(`\nproject=${flags.project} 에 batch 가 없습니다.\n`);
      return;
    }
  }

  // Paginated read of candidates with a non-null phone.
  const rows: CandRow[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from('sched_candidates')
      .select('id, batch_id, name, phone, fields')
      .not('phone', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (batchIds) q = q.in('batch_id', batchIds);
    const { data, error } = await q;
    if (error) throw error;
    const page = (data ?? []) as CandRow[];
    rows.push(...page);
    if (page.length < PAGE) break;
    if (flags.limit && rows.length >= flags.limit) break;
  }
  const scoped = flags.limit ? rows.slice(0, flags.limit) : rows;

  // Classify each row.
  let alreadyCanonical = 0;
  const toChange: { row: CandRow; canonical: string; raw: string }[] = [];
  const flagged: { row: CandRow; reason: PhoneFlagReason }[] = [];
  for (const row of scoped) {
    const original = (row.phone ?? '').trim();
    if (original === '') continue; // empty (defensive; filtered above)
    const { canonical, flagged: isFlagged, reason } = canonicalizeMobile(original);
    if (isFlagged || !canonical) {
      if (isFlagged && reason) flagged.push({ row, reason });
      continue;
    }
    if (canonical === original) {
      alreadyCanonical += 1;
      continue;
    }
    toChange.push({ row, canonical, raw: original });
  }

  console.log(
    `\nsched_candidates(phone 있음) 스캔 ${scoped.length}건` +
      `${batchIds ? ` · scope batch ${batchIds.length}개` : ''}` +
      `${flags.limit ? ` · limit ${flags.limit}` : ''}`,
  );
  console.log(`  이미 정본: ${alreadyCanonical}`);
  console.log(`  변경 대상(정본화 가능): ${toChange.length}`);
  console.log(`  flag(정본화 불가 · 미변경): ${flagged.length}`);

  // Always print the flag report — this is the human hand-off (덮어쓰지 않으므로
  // 사용자가 원본에서 고쳐야 한다).
  if (flagged.length > 0) {
    console.log('\n── flag 리스트(미변경, 원본에서 수정 필요) ──');
    for (const { row, reason } of flagged) {
      console.log(
        `  · ${row.name ?? '(이름없음)'} | ${row.phone} | ${REASON_LABEL[reason]} | id=${row.id}`,
      );
    }
  }

  if (flags.dryRun) {
    const sample = toChange.slice(0, 20);
    if (sample.length > 0) {
      console.log('\n── 변경 샘플(최대 20건, dry-run) ──');
      for (const { row, canonical, raw } of sample) {
        console.log(`  · ${row.name ?? '(이름없음)'} | ${raw} → ${canonical} | id=${row.id}`);
      }
      if (toChange.length > sample.length) {
        console.log(`  … 외 ${toChange.length - sample.length}건`);
      }
    }
    console.log('\n(dry-run: 미기록)\n');
    return;
  }

  if (!flags.commit) {
    console.log(
      '\nℹ️  실제 변경하려면 --dry-run (미리보기) 또는 --commit (기록) 을 붙이세요.\n',
    );
    return;
  }

  // --commit: UPDATE each canonicalizable row. Preserve the original under
  // __phone_raw only when absent (re-run never clobbers the first-seen raw).
  let ok = 0;
  let failed = 0;
  for (const { row, canonical, raw } of toChange) {
    const fields = { ...(row.fields ?? {}) };
    if (!(PHONE_RAW_FIELD in fields)) fields[PHONE_RAW_FIELD] = raw;
    const { error } = await supabase
      .from('sched_candidates')
      .update({ phone: canonical, fields })
      .eq('id', row.id);
    if (error) {
      console.log(`  ⚠️ UPDATE 실패 id=${row.id}: ${error.message}`);
      failed += 1;
      continue;
    }
    ok += 1;
  }

  console.log(
    `\n완료 — 정본화 ${ok} · 실패 ${failed} · flag(미변경) ${flagged.length}\n`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
