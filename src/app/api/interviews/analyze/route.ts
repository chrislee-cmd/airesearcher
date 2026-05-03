import { NextResponse } from 'next/server';
import { z } from 'zod';
import { generateObject } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { spendCredits } from '@/lib/credits';

export const maxDuration = 300;

const Body = z.object({
  extractions: z
    .array(
      z.object({
        filename: z.string().min(1),
        items: z.array(
          z.object({
            question: z.string(),
            voc: z.string(),
          }),
        ),
      }),
    )
    .min(1)
    .max(20),
});

// === Deterministic question clustering ===
// We build the matrix entirely on the server: flatten every (file, item)
// into a list, group by question similarity, and emit one row per cluster.
// This guarantees every file's questions surface in the output (no LLM
// laziness can drop a respondent column), and never returns empty rows.

function normalizeQuestion(s: string): string {
  return s
    .toLowerCase()
    // strip punctuation / spaces / quotes / particles that don't change meaning
    .replace(/[\s.,?!()'"‘’“”~`*\-_:;…]/g, '');
}

// Character bigrams over the normalized string. Bigrams are more
// discriminating than single-char Jaccard while still tolerating Korean
// particle/ending variations like 하시나요/하세요/하나요 — exactly the
// pattern that was making one file's column come out empty.
function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  if (s.length === 0) return out;
  if (s.length === 1) {
    out.add(s);
    return out;
  }
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

type FlatItem = {
  fileIdx: number;
  itemIdx: number;
  question: string;
  voc: string;
  bg: Set<string>;
};

// Pass 1: greedy seed-and-grow at the strict threshold.
// Pass 2: every single-member cluster tries again against larger clusters
// at a relaxed threshold, scored by *average* similarity across all
// members. This rescues a file whose phrasing matches the cluster as a
// whole but didn't match the seed item — the exact failure mode behind
// the empty respondent column.
function clusterItems(
  items: FlatItem[],
  strict = 0.45,
  relaxed = 0.28,
): FlatItem[][] {
  const used = new Set<number>();
  const clusters: FlatItem[][] = [];

  for (let i = 0; i < items.length; i++) {
    if (used.has(i)) continue;
    const seed = items[i];
    const cluster: FlatItem[] = [seed];
    used.add(i);
    for (let j = i + 1; j < items.length; j++) {
      if (used.has(j)) continue;
      const cand = items[j];
      if (cluster.some((m) => m.fileIdx === cand.fileIdx)) continue;
      if (jaccard(seed.bg, cand.bg) >= strict) {
        cluster.push(cand);
        used.add(j);
      }
    }
    clusters.push(cluster);
  }

  for (let ci = 0; ci < clusters.length; ci++) {
    const cluster = clusters[ci];
    if (cluster.length !== 1) continue;
    const orphan = cluster[0];
    let bestIdx = -1;
    let bestScore = relaxed;
    for (let cj = 0; cj < clusters.length; cj++) {
      if (cj === ci) continue;
      const target = clusters[cj];
      if (target.length < 2) continue;
      if (target.some((m) => m.fileIdx === orphan.fileIdx)) continue;
      let total = 0;
      for (const m of target) total += jaccard(orphan.bg, m.bg);
      const avg = total / target.length;
      if (avg > bestScore) {
        bestScore = avg;
        bestIdx = cj;
      }
    }
    if (bestIdx >= 0) {
      clusters[bestIdx].push(orphan);
      clusters[ci] = [];
    }
  }

  return clusters.filter((c) => c.length > 0);
}

function pickCanonical(cluster: FlatItem[]): string {
  // Longest question text in the cluster — usually the most informative phrasing.
  return cluster.reduce((a, b) =>
    a.question.length >= b.question.length ? a : b,
  ).question;
}

// === Pass 3: LLM semantic consolidation ===
// After deterministic clustering some rows still represent the *same*
// question phrased differently across files (e.g. "왜 신경 쓰게 되셨나요?"
// vs "특별히 신경 쓰게 된 계기는?"). Bigrams can't see that semantic link;
// Sonnet can. We send only the canonical questions (no VOC bodies) and ask
// for index-grouping. On any failure we fall back to the deterministic
// result — the user never gets fewer rows than what's already correct.
const consolidationSchema = z.object({
  groups: z.array(z.array(z.number().int())),
});

async function llmConsolidate(
  questions: string[],
  apiKey: string,
): Promise<number[][] | null> {
  if (questions.length < 2) return null;
  const anthropic = createAnthropic({ apiKey });
  const numbered = questions.map((q, i) => `[${i}] ${q}`).join('\n');
  const SYSTEM = `당신은 인터뷰 질문 정규화 도우미입니다.

입력으로 인덱스가 붙은 한국어 질문 리스트가 주어집니다. 의미가 사실상 같은 질문(어휘·표현·어미는 달라도 본질이 같은 것)끼리 묶어서 인덱스 배열의 배열로 반환하세요.

# 규칙
- 모든 인덱스가 정확히 한 번씩 등장해야 합니다 (누락·중복 금지).
- 묶을 게 없으면 단일 원소 배열로 둡니다 (예: [3] 혼자).
- 의미가 미묘하게 다르면 묶지 마세요. 확실히 같은 것만 묶습니다.
- 출력은 정의된 JSON 스키마(groups)만, 그 외 텍스트 금지.`;

  try {
    const result = await generateObject({
      model: anthropic('claude-sonnet-4-6'),
      schema: consolidationSchema,
      system: SYSTEM,
      prompt: `질문 목록 (총 ${questions.length}개):\n\n${numbered}`,
      temperature: 0,
    });
    return result.object.groups;
  } catch (e) {
    console.warn('[analyze] llmConsolidate failed:', e);
    return null;
  }
}

function applyConsolidation(
  clusters: FlatItem[][],
  groups: number[][],
): FlatItem[][] {
  // Validate groups: every cluster index must appear exactly once. If not,
  // bail out — fall back to deterministic result.
  const seen = new Set<number>();
  for (const g of groups) {
    for (const idx of g) {
      if (idx < 0 || idx >= clusters.length || seen.has(idx)) {
        console.warn(
          '[analyze] consolidation invalid (bad index or duplicate):',
          { idx, groups },
        );
        return clusters;
      }
      seen.add(idx);
    }
  }
  if (seen.size !== clusters.length) {
    console.warn(
      '[analyze] consolidation invalid (missing indices):',
      { seen: seen.size, expected: clusters.length },
    );
    return clusters;
  }

  // Merge clusters per group, but if two clusters share a fileIdx, keep
  // the first occurrence and split the rest into their own group — one
  // cell per file per question is invariant.
  const merged: FlatItem[][] = [];
  for (const g of groups) {
    const primary: FlatItem[] = [];
    const overflow: FlatItem[][] = [];
    const fileSeen = new Set<number>();
    for (const idx of g) {
      for (const item of clusters[idx]) {
        if (fileSeen.has(item.fileIdx)) {
          // Same file already represented in primary — start its own group.
          overflow.push([item]);
        } else {
          primary.push(item);
          fileSeen.add(item.fileIdx);
        }
      }
    }
    if (primary.length > 0) merged.push(primary);
    for (const o of overflow) merged.push(o);
  }
  return merged;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { extractions } = parsed.data;

  const { data: orgRow } = await supabase
    .from('organizations')
    .select('credit_balance')
    .eq('id', org.org_id)
    .single();
  if (!orgRow || (orgRow.credit_balance ?? 0) < 3) {
    return NextResponse.json({ error: 'insufficient' }, { status: 402 });
  }

  const filenames = extractions.map((e) => e.filename);

  // Diagnostic: per-file item counts in Vercel logs so empty columns can
  // be traced back to "extract returned 0 items" vs. "clustering dropped them".
  console.log(
    '[analyze] extractions:',
    extractions.map((e, i) => ({
      idx: i,
      filename: e.filename,
      itemCount: e.items.length,
      sample: e.items.slice(0, 2).map((it) => ({
        q: it.question.slice(0, 40),
        vocLen: it.voc.length,
      })),
    })),
  );

  const flat: FlatItem[] = [];
  extractions.forEach((ext, fileIdx) => {
    ext.items.forEach((it, itemIdx) => {
      const q = (it.question ?? '').trim();
      if (!q) return;
      flat.push({
        fileIdx,
        itemIdx,
        question: q,
        voc: it.voc ?? '',
        bg: bigrams(normalizeQuestion(q)),
      });
    });
  });

  let clusters = clusterItems(flat, 0.45, 0.28);
  const beforeConsolidation = clusters.length;

  // Pass 3 — LLM semantic consolidation. Skip silently on missing key or
  // any failure (deterministic clusters are still valid).
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey && clusters.length >= 2) {
    const canonicals = clusters.map(pickCanonical);
    const groups = await llmConsolidate(canonicals, apiKey);
    if (groups) clusters = applyConsolidation(clusters, groups);
  }
  console.log('[analyze] consolidation:', {
    before: beforeConsolidation,
    after: clusters.length,
    saved: beforeConsolidation - clusters.length,
  });

  // Sort clusters so the user sees the most-overlapping rows first, then
  // by interview flow position averaged across all members. The previous
  // sort keyed on `cluster[0]` (= the seed) which always came from the
  // earliest-listed file — pushing every cluster that *only* contained
  // the last file's items to the bottom of the matrix and creating the
  // illusion that the last column was empty.
  function avgItemIdx(c: FlatItem[]): number {
    let sum = 0;
    for (const m of c) sum += m.itemIdx;
    return sum / c.length;
  }
  clusters.sort((a, b) => {
    if (a.length !== b.length) return b.length - a.length; // most files first
    return avgItemIdx(a) - avgItemIdx(b);                  // earlier in interview first
  });

  const matrix = {
    questions: clusters.map(pickCanonical),
    rows: clusters.map((cluster) => {
      const canonical = pickCanonical(cluster);
      return {
        question: canonical,
        cells: filenames.map((filename, fi) => {
          const member = cluster.find((m) => m.fileIdx === fi);
          return {
            filename,
            voc: member?.voc ?? '',
          };
        }),
      };
    }),
  };

  const filledByFile = filenames.map((_, fi) =>
    matrix.rows.reduce((acc, r) => acc + (r.cells[fi].voc ? 1 : 0), 0),
  );
  console.log('[analyze] matrix:', {
    rows: matrix.rows.length,
    filledByFile,
    filenames,
  });

  const { data: gen, error: insertErr } = await supabase
    .from('generations')
    .insert({
      org_id: org.org_id,
      user_id: user.id,
      feature: 'interviews',
      input: filenames.join(', '),
      output: JSON.stringify(matrix),
      credits_spent: 3,
    })
    .select('id')
    .single();
  if (insertErr || !gen) {
    return NextResponse.json({ error: insertErr?.message ?? 'db_error' }, { status: 500 });
  }
  const spend = await spendCredits(org.org_id, 'interviews', gen.id);
  if (!spend.ok) {
    await supabase.from('generations').delete().eq('id', gen.id);
    return NextResponse.json({ error: spend.reason }, { status: 402 });
  }

  return NextResponse.json(matrix);
}
