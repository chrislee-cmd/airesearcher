// Voice Concierge — server helper for the `getMyProjects` tool.
//
// Returns the same project list the dashboard shows, sorted by latest
// activity so "지난주에 시작한 그거" resolves to the right thing first.
// We reuse getDashboardCards() (which already aggregates last activity
// across report/interview/transcript/desk/scheduler jobs + generations)
// rather than re-querying the projects table directly — guarantees the
// model sees the same ordering the user does on /dashboard.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg, getOrgFlags } from '@/lib/org';
import { getDashboardCards } from '@/lib/dashboard';
import { PREVIEW_FEATURES } from '@/lib/features';

export const runtime = 'nodejs';

const Body = z.object({
  limit: z.number().int().positive().max(10).optional().default(5),
});

export async function POST(request: Request) {
  // ── Auth ────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  if (PREVIEW_FEATURES.has('voice_concierge')) {
    const flags = await getOrgFlags(org.org_id);
    if (!flags.isUnlimited) {
      return NextResponse.json({ error: 'preview_only' }, { status: 403 });
    }
  }

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const limit = Math.min(parsed.data.limit ?? 5, 10);

  // ── Read via the existing dashboard aggregator ──────────────────────
  // getDashboardCards returns a card per project (plus an "unfiled"
  // bucket with projectId=null which we drop — the model only cares
  // about named projects). Already sorted by lastActivityAt desc.
  const { cards } = await getDashboardCards(org.org_id);

  const projects = cards
    .filter((c) => c.projectId !== null && c.name !== null)
    .slice(0, limit)
    .map((c) => {
      // Pick the single feature with the most artifacts as the
      // "lastFeature" hint. Cheap heuristic — gives the model
      // something to recall ("the desk research one"); the user can
      // always correct.
      const counts = c.counts;
      let topFeature: string | undefined;
      let topCount = 0;
      for (const [k, v] of Object.entries(counts) as [string, number][]) {
        if (v > topCount) {
          topCount = v;
          topFeature = k;
        }
      }
      return {
        id: c.projectId as string,
        name: c.name as string,
        // ISO string for the model — easier to phrase than a numeric ms.
        updatedAt: c.lastActivityAt
          ? new Date(c.lastActivityAt).toISOString()
          : null,
        lastFeature: topFeature,
      };
    });

  return NextResponse.json({ projects });
}
