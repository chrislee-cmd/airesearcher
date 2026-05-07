import { createClient } from '@/lib/supabase/server';

// What each project card shows. The dashboard page composes one card
// per project plus a single "unfiled" card for rows with project_id IS
// NULL (legacy artifacts before project tagging existed).

export type ProjectCardCounts = {
  reports: number;
  interviews: number;
  transcripts: number;
  desk: number;
  quotes: number;        // generations table
  recruiting: number;    // recruiting_forms (org-tagged only)
  scheduler: number;     // scheduler_sessions
};

export type ProjectCard = {
  // null project_id == "unfiled" bucket
  projectId: string | null;
  name: string | null;
  counts: ProjectCardCounts;
  // running = jobs whose status is not 'done' / not 'error'
  runningCount: number;
  // ms since epoch of the latest updated_at across all artifacts in
  // this project. null when the project has nothing yet.
  lastActivityAt: number | null;
};

const ZERO_COUNTS: ProjectCardCounts = {
  reports: 0,
  interviews: 0,
  transcripts: 0,
  desk: 0,
  quotes: 0,
  recruiting: 0,
  scheduler: 0,
};

// Fetches the data needed to render the project-centric dashboard.
// All queries are scoped to the active org via RLS — we just pull
// project_id + status + updated_at from each artifact table and bucket
// in JS. With realistic data sizes (hundreds of rows, not millions)
// this is faster than seven GROUP BY round trips.
export async function getDashboardCards(orgId: string): Promise<{
  cards: ProjectCard[];
}> {
  const supabase = await createClient();

  // Project list (active org). RLS guarantees we only see our own.
  const projectsP = supabase
    .from('projects')
    .select('id, name, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });

  // Per-table fetches: id+project_id+status+updated_at is enough to
  // count + detect "running" + last activity. We don't pull payloads.
  const reportsP = supabase
    .from('report_jobs')
    .select('project_id, status, updated_at')
    .eq('org_id', orgId);
  const interviewsP = supabase
    .from('interview_jobs')
    .select('project_id, status, updated_at')
    .eq('org_id', orgId);
  const transcriptsP = supabase
    .from('transcript_jobs')
    .select('project_id, status, updated_at')
    .eq('org_id', orgId);
  const deskP = supabase
    .from('desk_jobs')
    .select('project_id, status, updated_at')
    .eq('org_id', orgId);
  const quotesP = supabase
    .from('generations')
    .select('project_id, created_at')
    .eq('org_id', orgId);
  const recruitingP = supabase
    .from('recruiting_forms')
    .select('project_id, created_at')
    .eq('org_id', orgId);
  const schedulerP = supabase
    .from('scheduler_sessions')
    .select('project_id, updated_at')
    .eq('org_id', orgId);

  const [
    { data: projects },
    { data: reports },
    { data: interviews },
    { data: transcripts },
    { data: desk },
    { data: quotes },
    { data: recruiting },
    { data: scheduler },
  ] = await Promise.all([
    projectsP,
    reportsP,
    interviewsP,
    transcriptsP,
    deskP,
    quotesP,
    recruitingP,
    schedulerP,
  ]);

  // Bucket key: project_id string, or '' for unfiled. We use '' so
  // the Map key stays a string (cleaner than null in TS).
  function key(pid: string | null | undefined): string {
    return pid ?? '';
  }

  const buckets = new Map<string, ProjectCard>();
  function ensure(pid: string, name: string | null = null): ProjectCard {
    let b = buckets.get(pid);
    if (b) return b;
    b = {
      projectId: pid === '' ? null : pid,
      name,
      counts: { ...ZERO_COUNTS },
      runningCount: 0,
      lastActivityAt: null,
    };
    buckets.set(pid, b);
    return b;
  }

  // Seed with project rows so empty projects still show up as cards.
  for (const p of projects ?? []) {
    ensure(p.id, p.name);
  }

  function note(
    bucket: ProjectCard,
    status: string | null,
    updatedAt: string | null,
  ) {
    if (status && status !== 'done' && status !== 'error') {
      bucket.runningCount += 1;
    }
    if (updatedAt) {
      const t = Date.parse(updatedAt);
      if (!isNaN(t) && (bucket.lastActivityAt === null || t > bucket.lastActivityAt)) {
        bucket.lastActivityAt = t;
      }
    }
  }

  for (const r of reports ?? []) {
    const b = ensure(key(r.project_id));
    b.counts.reports += 1;
    note(b, r.status as string, r.updated_at as string | null);
  }
  for (const r of interviews ?? []) {
    const b = ensure(key(r.project_id));
    b.counts.interviews += 1;
    note(b, r.status as string, r.updated_at as string | null);
  }
  for (const r of transcripts ?? []) {
    const b = ensure(key(r.project_id));
    b.counts.transcripts += 1;
    note(b, r.status as string, r.updated_at as string | null);
  }
  for (const r of desk ?? []) {
    const b = ensure(key(r.project_id));
    b.counts.desk += 1;
    note(b, r.status as string, r.updated_at as string | null);
  }
  for (const r of quotes ?? []) {
    const b = ensure(key(r.project_id));
    b.counts.quotes += 1;
    note(b, null, r.created_at as string | null);
  }
  for (const r of recruiting ?? []) {
    const b = ensure(key(r.project_id));
    b.counts.recruiting += 1;
    note(b, null, r.created_at as string | null);
  }
  for (const r of scheduler ?? []) {
    const b = ensure(key(r.project_id));
    b.counts.scheduler += 1;
    note(b, null, r.updated_at as string | null);
  }

  // Order: real projects first by lastActivityAt desc (NULL last), then
  // the unfiled bucket. Empty projects still appear, sorted by created_at.
  const real = Array.from(buckets.values())
    .filter((b) => b.projectId !== null)
    .sort((a, b) => {
      if (a.lastActivityAt && b.lastActivityAt) {
        return b.lastActivityAt - a.lastActivityAt;
      }
      if (a.lastActivityAt) return -1;
      if (b.lastActivityAt) return 1;
      return 0;
    });
  const unfiled = buckets.get('') ?? null;

  return { cards: unfiled ? [...real, unfiled] : real };
}
