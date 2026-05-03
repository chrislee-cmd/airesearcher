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

function jaccard(aChars: Set<string>, bChars: Set<string>): number {
  if (aChars.size === 0 && bChars.size === 0) return 0;
  let inter = 0;
  for (const c of aChars) if (bChars.has(c)) inter += 1;
  const union = aChars.size + bChars.size - inter;
  return union === 0 ? 0 : inter / union;
}

type FlatItem = {
  fileIdx: number;
  itemIdx: number;
  question: string;
  voc: string;
  norm: Set<string>;
};

function clusterItems(items: FlatItem[], threshold = 0.5): FlatItem[][] {
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
      // Avoid mapping two items from the same file to one cluster — the
      // matrix only has one cell per file per question. The first item
      // wins; later same-file items split into a new cluster of their own.
      if (cluster.some((m) => m.fileIdx === cand.fileIdx)) continue;
      if (jaccard(seed.norm, cand.norm) >= threshold) {
        cluster.push(cand);
        used.add(j);
      }
    }
    clusters.push(cluster);
  }
  return clusters;
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

  // Flatten every item across all files
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
        norm: new Set(normalizeQuestion(q)),
      });
    });
  });

  const clusters = clusterItems(flat, 0.5);

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
