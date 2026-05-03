import { NextResponse } from 'next/server';
import { z } from 'zod';
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

  const clusters = clusterItems(flat, 0.45, 0.28);

  // Sort clusters by the file/item order of their first member so the
  // matrix follows interview flow as much as possible.
  clusters.sort((a, b) => {
    if (a[0].fileIdx !== b[0].fileIdx) return a[0].fileIdx - b[0].fileIdx;
    return a[0].itemIdx - b[0].itemIdx;
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
