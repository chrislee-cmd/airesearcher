// One-off cleanup — remove the leftover inbox duplicate of a scheduling
// candidate, keeping the real (group) row (card 607, E3).
//
// WHY this exists — before card 604 (phone canonicalize) + 605 (cross-batch
// dedup block), the same person could land TWICE under one project: once in the
// inbox pool (is_inbox=true) and again inside an assignment group
// (is_inbox=false). Forensics (2026-07-27) measured every duplicate pair as
// across-batch (inbox + group), NEVER group-only:
//
//   group row (is_inbox=false)  — slots·messages·confirmed 보유 → 진짜.
//   inbox leftover (is_inbox=true) — slots 0·messages 0·pending → 껍데기.
//
// 604 canonicalized the stored phones and 605 stopped NEW leakage, so the pairs
// now group cleanly by (project_id, canonical phone). This one-off deletes the
// attachment-free inbox leftover and keeps the group row. The FKs on
// sched_slots.candidate_id / sched_messages.candidate_id are ON DELETE CASCADE,
// so deleting a truly-empty inbox row loses nothing.
//
// SAFE + REVERSIBLE-ish:
//   * NEVER deletes a group (is_inbox=false) row — deletion targets are inbox
//     leftovers only.
//   * RUNTIME GUARD — re-counts slots + messages for each target the moment
//     before deletion. If either is non-zero (data changed since forensics),
//     the row is SKIPPED and reported, never deleted.
//   * TIMESTAMP INHERITANCE — a target's joined_at / last_seen_at is copied to
//     the survivor when the survivor lacks it (링크접속 상태 보존): joined_at =
//     earliest across targets, last_seen_at = latest. Survivor's own value is
//     never clobbered.
//   * EDGE (0 in practice) — if a pair has NO group row (inbox rows only), keep
//     the row with slots/messages, else the newest; delete the rest.
//
// COST GATE — no LLM, no external calls; a paginated read + count queries +
// targeted UPDATEs/DELETEs:
//   (no flag)   diagnose: count duplicate pairs / deletion targets / would-skip
//               (target with attachments). No writes.
//   --dry-run   full deletion list (project · name · phone · inbox cand_id ·
//               survivor cand_id) + timestamp inheritance plan. No writes.
//   --commit    inherit timestamps → DELETE inbox leftovers (with the runtime
//               guard re-check right before each delete). Writes.
// Scope with --limit N (cap on duplicate pairs) or --project <sched_project_id>.
//
// RUN (from the repo/worktree root, with .env.local present):
//   node --experimental-strip-types --env-file=.env.local \
//     scripts/cleanup-scheduling-duplicates.ts              # diagnose (no writes)
//   node --experimental-strip-types --env-file=.env.local \
//     scripts/cleanup-scheduling-duplicates.ts --dry-run
//   node --experimental-strip-types --env-file=.env.local \
//     scripts/cleanup-scheduling-duplicates.ts --commit

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { canonicalizeMobile } from '../src/lib/scheduling/phone.ts';

type CandRow = {
  id: string;
  batch_id: string;
  name: string | null;
  phone: string | null;
  joined_at: string | null;
  last_seen_at: string | null;
  created_at: string;
};

type BatchRow = {
  id: string;
  project_id: string | null;
  is_inbox: boolean | null;
};

const PAGE = 1000;
const IN_CHUNK = 200; // .in() list size cap (URL length safety)

function parseArgs(argv: string[]) {
  const flags = {
    commit: argv.includes('--commit'),
    dryRun: argv.includes('--dry-run'),
    help: argv.includes('--help') || argv.includes('-h'),
    limit: undefined as number | undefined,
    project: undefined as string | undefined,
  };
  const readValue = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const limitRaw = readValue('--limit');
  if (limitRaw) flags.limit = Number.parseInt(limitRaw, 10);
  flags.project = readValue('--project');
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

/** Tally how many rows in `table` reference each of `ids` via candidate_id. */
async function countByCandidate(
  supabase: SupabaseClient,
  table: 'sched_slots' | 'sched_messages',
  ids: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, 0);
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    const { data, error } = await supabase
      .from(table)
      .select('candidate_id')
      .in('candidate_id', chunk);
    if (error) throw error;
    for (const r of (data ?? []) as { candidate_id: string | null }[]) {
      if (r.candidate_id && counts.has(r.candidate_id)) {
        counts.set(r.candidate_id, (counts.get(r.candidate_id) ?? 0) + 1);
      }
    }
  }
  return counts;
}

/** Fresh count (head-only) for a single candidate — the delete-time guard. */
async function liveCount(
  supabase: SupabaseClient,
  table: 'sched_slots' | 'sched_messages',
  candidateId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('candidate_id', candidateId);
  if (error) throw error;
  return count ?? 0;
}

type Target = {
  row: CandRow;
  projectId: string;
  canonicalPhone: string;
  slots: number;
  messages: number;
};

type Plan = {
  projectId: string;
  canonicalPhone: string;
  survivor: CandRow;
  survivorIsGroup: boolean;
  targets: Target[]; // inbox leftovers to delete (attachment-free by design)
  blocked: Target[]; // would-be targets skipped: slots/messages > 0
  inheritJoinedAt: string | null; // to stamp onto survivor (only if it lacks it)
  inheritLastSeenAt: string | null;
};

/** joined_at = earliest (first join); last_seen_at = latest (most recent seen). */
function pickEarliest(values: (string | null)[]): string | null {
  const present = values.filter((v): v is string => !!v).sort();
  return present[0] ?? null;
}
function pickLatest(values: (string | null)[]): string | null {
  const present = values.filter((v): v is string => !!v).sort();
  return present[present.length - 1] ?? null;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(
      [
        'cleanup-scheduling-duplicates — 인박스 잔여 중복 삭제, 그룹 행 보존 (card 607)',
        '',
        '  (no flag)   진단만: 중복쌍 / 삭제 대상 / 가드로 skip 될 대상 집계 (쓰기 없음)',
        '  --dry-run   삭제 대상 전체 목록 + timestamp 승계 계획 출력 (쓰기 없음)',
        '  --commit    timestamp 승계 → 인박스 잔여 DELETE (삭제 직전 슬롯/메시지 0 재확인)',
        '  --limit N   중복쌍 최대 N개만',
        '  --project <sched_project_id>  특정 프로젝트만',
      ].join('\n'),
    );
    return;
  }

  const supabase = createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } },
  );

  // 1) All batches → (project_id, is_inbox) lookup. Optional --project scoping.
  const { data: batchData, error: batchErr } = await supabase
    .from('sched_batches')
    .select('id, project_id, is_inbox');
  if (batchErr) throw batchErr;
  const batches = (batchData ?? []) as BatchRow[];
  const batchById = new Map(batches.map((b) => [b.id, b]));

  // 2) Paginated candidates. We group by (batch.project_id, canonical phone),
  //    so rows without a project_id or without a canonicalizable phone can't
  //    participate in a project+phone pair and are skipped (counted for the
  //    report).
  const rows: CandRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('sched_candidates')
      .select('id, batch_id, name, phone, joined_at, last_seen_at, created_at')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const page = (data ?? []) as CandRow[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  // 3) Build (project_id, canonical phone) groups.
  const groups = new Map<string, CandRow[]>();
  let skippedNoProject = 0;
  let skippedNoPhone = 0;
  for (const row of rows) {
    const batch = batchById.get(row.batch_id);
    const projectId = batch?.project_id ?? null;
    if (!projectId) {
      skippedNoProject += 1;
      continue;
    }
    if (flags.project && projectId !== flags.project) continue;
    const { canonical } = canonicalizeMobile(row.phone);
    if (!canonical) {
      skippedNoPhone += 1;
      continue;
    }
    const key = `${projectId}||${canonical}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  // 4) Keep only duplicate groups (count > 1), capped by --limit.
  let dupGroups = [...groups.entries()].filter(([, list]) => list.length > 1);
  if (flags.limit) dupGroups = dupGroups.slice(0, flags.limit);

  // Pre-fetch slot/message counts for every candidate in a duplicate group so
  // we can (a) pick survivors and (b) know which targets carry attachments.
  const dupCandIds = dupGroups.flatMap(([, list]) => list.map((c) => c.id));
  const slotCounts = await countByCandidate(supabase, 'sched_slots', dupCandIds);
  const msgCounts = await countByCandidate(supabase, 'sched_messages', dupCandIds);
  const attach = (id: string) =>
    (slotCounts.get(id) ?? 0) + (msgCounts.get(id) ?? 0);

  // 5) Build a plan per duplicate group.
  const plans: Plan[] = [];
  for (const [key, list] of dupGroups) {
    const [projectId, canonicalPhone] = key.split('||');
    const groupRows = list.filter(
      (c) => batchById.get(c.batch_id)?.is_inbox === false,
    );
    const inboxRows = list.filter(
      (c) => batchById.get(c.batch_id)?.is_inbox === true,
    );

    let survivor: CandRow;
    let survivorIsGroup: boolean;
    let deletable: CandRow[];

    if (groupRows.length >= 1) {
      // Keep a group row (제약: 그룹 행 절대 삭제 금지). If several group rows
      // (defensive — 0 in practice), keep the one with the most attachments,
      // tie-broken by newest; delete ONLY inbox rows either way.
      survivor = [...groupRows].sort((a, b) => {
        const d = attach(b.id) - attach(a.id);
        if (d !== 0) return d;
        return b.created_at.localeCompare(a.created_at);
      })[0];
      survivorIsGroup = true;
      deletable = inboxRows;
    } else {
      // EDGE (0 in practice): inbox-only pair. Keep the row with attachments,
      // else the newest; delete the rest.
      const ranked = [...inboxRows].sort((a, b) => {
        const d = attach(b.id) - attach(a.id);
        if (d !== 0) return d;
        return b.created_at.localeCompare(a.created_at);
      });
      survivor = ranked[0];
      survivorIsGroup = false;
      deletable = ranked.slice(1);
    }

    const targets: Target[] = [];
    const blocked: Target[] = [];
    for (const row of deletable) {
      const t: Target = {
        row,
        projectId,
        canonicalPhone,
        slots: slotCounts.get(row.id) ?? 0,
        messages: msgCounts.get(row.id) ?? 0,
      };
      // Guard (pre-check from the batch counts): a leftover must be empty.
      if (t.slots > 0 || t.messages > 0) blocked.push(t);
      else targets.push(t);
    }

    // Inheritance is sourced from the rows actually being deleted.
    const inheritJoinedAt = survivor.joined_at
      ? null
      : pickEarliest(targets.map((t) => t.row.joined_at));
    const inheritLastSeenAt = survivor.last_seen_at
      ? null
      : pickLatest(targets.map((t) => t.row.last_seen_at));

    plans.push({
      projectId,
      canonicalPhone,
      survivor,
      survivorIsGroup,
      targets,
      blocked,
      inheritJoinedAt,
      inheritLastSeenAt,
    });
  }

  const totalTargets = plans.reduce((n, p) => n + p.targets.length, 0);
  const totalBlocked = plans.reduce((n, p) => n + p.blocked.length, 0);
  const totalInherit = plans.filter(
    (p) => p.inheritJoinedAt || p.inheritLastSeenAt,
  ).length;
  const inboxOnlyPairs = plans.filter((p) => !p.survivorIsGroup).length;

  console.log(
    `\nsched_candidates 스캔 ${rows.length}건` +
      `${flags.project ? ` · scope project ${flags.project}` : ''}` +
      `${flags.limit ? ` · limit ${flags.limit}쌍` : ''}`,
  );
  console.log(`  중복쌍(프로젝트+정본전화 count>1): ${plans.length}`);
  console.log(`  삭제 대상(인박스 잔여, 슬롯·메시지 0): ${totalTargets}`);
  console.log(`  가드 skip(슬롯/메시지 보유 → 미삭제): ${totalBlocked}`);
  console.log(`  timestamp 승계 필요 쌍: ${totalInherit}`);
  console.log(`  (참고) 그룹 행 없는 인박스-only 쌍: ${inboxOnlyPairs}`);
  console.log(
    `  (스킵) project 없음 ${skippedNoProject} · 정본전화 없음 ${skippedNoPhone}`,
  );

  // Always surface the guard-blocked rows — they need a human look.
  if (totalBlocked > 0) {
    console.log('\n── 가드 skip(슬롯/메시지 보유, 삭제 안 함) ──');
    for (const p of plans) {
      for (const b of p.blocked) {
        console.log(
          `  · ${b.row.name ?? '(이름없음)'} | ${b.canonicalPhone} | ` +
            `slots=${b.slots} msgs=${b.messages} | cand=${b.row.id} | proj=${b.projectId}`,
        );
      }
    }
  }

  if (flags.dryRun) {
    console.log('\n── 삭제 대상 전체(dry-run) ──');
    for (const p of plans) {
      if (p.targets.length === 0) continue;
      const inh =
        p.inheritJoinedAt || p.inheritLastSeenAt
          ? ` | 승계→survivor: ${
              p.inheritJoinedAt ? `joined_at=${p.inheritJoinedAt}` : ''
            }${
              p.inheritLastSeenAt ? ` last_seen_at=${p.inheritLastSeenAt}` : ''
            }`
          : '';
      const survTag = p.survivorIsGroup ? 'group' : 'inbox-only';
      for (const t of p.targets) {
        console.log(
          `  · ${t.row.name ?? '(이름없음)'} | ${p.canonicalPhone} | proj=${p.projectId}\n` +
            `      삭제 inbox cand=${t.row.id}  →  survivor(${survTag}) cand=${p.survivor.id}${inh}`,
        );
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

  // 6) --commit: per plan, inherit timestamps onto the survivor, then DELETE
  //    each target — RE-CHECKING slots/messages live right before each delete
  //    (data may have changed since the batch count above).
  let deleted = 0;
  let guardSkipped = 0;
  let inherited = 0;
  let failed = 0;

  for (const p of plans) {
    if (p.targets.length === 0) continue;

    // Timestamp inheritance first, so a survivor keeps the leftover's join
    // state even if we crash between the update and the deletes.
    const patch: { joined_at?: string; last_seen_at?: string } = {};
    if (p.inheritJoinedAt) patch.joined_at = p.inheritJoinedAt;
    if (p.inheritLastSeenAt) patch.last_seen_at = p.inheritLastSeenAt;
    if (patch.joined_at || patch.last_seen_at) {
      const { error } = await supabase
        .from('sched_candidates')
        .update(patch)
        .eq('id', p.survivor.id);
      if (error) {
        console.log(
          `  ⚠️ 승계 UPDATE 실패 survivor=${p.survivor.id}: ${error.message} — 이 쌍 삭제 보류`,
        );
        failed += 1;
        continue; // don't delete leftovers if we couldn't preserve their state
      }
      inherited += 1;
    }

    for (const t of p.targets) {
      // RUNTIME GUARD (delete-time, fresh): re-count. Non-zero → skip.
      const [liveSlots, liveMsgs] = await Promise.all([
        liveCount(supabase, 'sched_slots', t.row.id),
        liveCount(supabase, 'sched_messages', t.row.id),
      ]);
      if (liveSlots > 0 || liveMsgs > 0) {
        console.log(
          `  ⏭️  가드 skip(삭제직전 재확인) ${t.row.name ?? '(이름없음)'} ` +
            `cand=${t.row.id} slots=${liveSlots} msgs=${liveMsgs}`,
        );
        guardSkipped += 1;
        continue;
      }
      const { error } = await supabase
        .from('sched_candidates')
        .delete()
        .eq('id', t.row.id);
      if (error) {
        console.log(`  ⚠️ DELETE 실패 cand=${t.row.id}: ${error.message}`);
        failed += 1;
        continue;
      }
      deleted += 1;
    }
  }

  console.log(
    `\n완료 — 삭제 ${deleted} · timestamp 승계 ${inherited} · ` +
      `가드 skip ${guardSkipped} · 실패 ${failed}\n`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
