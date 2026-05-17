import { createClient } from '@/lib/supabase/server';
import type { FeatureKey } from '@/lib/features';

// Server-side workspace data model. The list endpoint returns this shape;
// content() is a separate lazy fetch keyed by (dbFeature, dbId).
//
// `featureKey` is the workspace/sidebar label key (e.g. 'quotes' for a
// transcript markdown) — this matches what the old WorkspaceBridge wrote.
// `dbFeature` + `dbId` identify the source DB row for content fetch and
// project assignment.

export type DbFeature =
  | 'transcript'
  | 'desk'
  | 'interview'
  | 'report'
  | 'scheduler'
  | 'recruiting'
  | 'generation';

export type WorkspaceArtifactListItem = {
  id: string;
  featureKey: FeatureKey;
  title: string;
  createdAt: string;
  dbFeature: DbFeature;
  dbId: string;
  projectId: string | null;
  folderId: string | null;
};

export type ProjectFilter =
  | { kind: 'project'; projectId: string }
  | { kind: 'unfiled' }
  | { kind: 'all' }
  // Folder filter narrows to a specific folder under a project. `null`
  // means "project root" (artifacts in the project but no folder).
  | { kind: 'folder'; projectId: string; folderId: string | null };

export type FolderRow = {
  id: string;
  project_id: string;
  parent_folder_id: string | null;
  name: string;
  created_at: string;
  updated_at: string;
};

// Supabase's PostgrestFilterBuilder generic depth blows up TS instantiation
// when threaded through a typed helper, so we type the param loosely. The
// callers re-narrow via the destructured `.data` they actually consume.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyProjectFilter(q: any, filter: ProjectFilter): any {
  if (filter.kind === 'project') return q.eq('project_id', filter.projectId);
  if (filter.kind === 'unfiled') return q.is('project_id', null);
  if (filter.kind === 'folder') {
    const scoped = q.eq('project_id', filter.projectId);
    return filter.folderId === null
      ? scoped.is('folder_id', null)
      : scoped.eq('folder_id', filter.folderId);
  }
  return q;
}

// Maps a DB feature row → workspace artifact list item. Keeps title logic
// close to the existing dashboard renderer so the workspace panel and the
// /projects/[id] page stay consistent.
function transcriptToItem(r: {
  id: string;
  filename: string | null;
  project_id: string | null;
  folder_id: string | null;
  updated_at: string | null;
  created_at: string;
}): WorkspaceArtifactListItem {
  const base = (r.filename ?? 'transcript').replace(/\.[^./\\]+$/, '');
  return {
    id: `tx_${r.id}`,
    featureKey: 'quotes',
    title: `${base}.md`,
    createdAt: r.updated_at ?? r.created_at,
    dbFeature: 'transcript',
    dbId: r.id,
    projectId: r.project_id,
    folderId: r.folder_id,
  };
}

function deskToItem(r: {
  id: string;
  keywords: string[] | null;
  project_id: string | null;
  folder_id: string | null;
  updated_at: string | null;
  created_at: string;
}): WorkspaceArtifactListItem {
  const kw = (r.keywords ?? [])[0] ?? 'desk';
  const stamp = (r.updated_at ?? r.created_at).slice(0, 10);
  return {
    id: `desk_${r.id}`,
    featureKey: 'desk',
    title: `desk-${kw}-${stamp}.md`,
    createdAt: r.updated_at ?? r.created_at,
    dbFeature: 'desk',
    dbId: r.id,
    projectId: r.project_id,
    folderId: r.folder_id,
  };
}

function interviewToItem(r: {
  id: string;
  inputs: { filename?: string }[] | null;
  project_id: string | null;
  folder_id: string | null;
  updated_at: string | null;
  created_at: string;
}): WorkspaceArtifactListItem {
  const stamp = (r.updated_at ?? r.created_at).slice(0, 10);
  return {
    id: `iv_${r.id}`,
    featureKey: 'interviews',
    title: `interviews-${stamp}.md`,
    createdAt: r.updated_at ?? r.created_at,
    dbFeature: 'interview',
    dbId: r.id,
    projectId: r.project_id,
    folderId: r.folder_id,
  };
}

function reportToItem(r: {
  id: string;
  inputs: { filename?: string }[] | null;
  project_id: string | null;
  folder_id: string | null;
  updated_at: string | null;
  created_at: string;
}): WorkspaceArtifactListItem {
  const inputs = r.inputs ?? [];
  const first = inputs[0]?.filename ?? 'report';
  return {
    id: `rp_${r.id}`,
    featureKey: 'reports',
    title: `${first}-report.html`,
    createdAt: r.updated_at ?? r.created_at,
    dbFeature: 'report',
    dbId: r.id,
    projectId: r.project_id,
    folderId: r.folder_id,
  };
}

function schedulerToItem(r: {
  id: string;
  name: string | null;
  attendees: unknown[] | null;
  project_id: string | null;
  folder_id: string | null;
  updated_at: string | null;
  created_at: string;
}): WorkspaceArtifactListItem {
  const name = (r.name && r.name.trim()) || `Scheduler (${(r.attendees ?? []).length})`;
  return {
    id: `sc_${r.id}`,
    featureKey: 'scheduler',
    title: name,
    createdAt: r.updated_at ?? r.created_at,
    dbFeature: 'scheduler',
    dbId: r.id,
    projectId: r.project_id,
    folderId: r.folder_id,
  };
}

function recruitingToItem(r: {
  id: string;
  title: string | null;
  project_id: string | null;
  folder_id: string | null;
  created_at: string;
}): WorkspaceArtifactListItem {
  return {
    id: `rc_${r.id}`,
    featureKey: 'recruiting',
    title: r.title ?? 'Recruiting form',
    createdAt: r.created_at,
    dbFeature: 'recruiting',
    dbId: r.id,
    projectId: r.project_id,
    folderId: r.folder_id,
  };
}

function generationToItem(r: {
  id: string;
  feature: string;
  project_id: string | null;
  folder_id: string | null;
  created_at: string;
}): WorkspaceArtifactListItem {
  // generations.feature can be any FeatureKey; we trust the row.
  return {
    id: `gn_${r.id}`,
    featureKey: r.feature as FeatureKey,
    title: r.feature,
    createdAt: r.created_at,
    dbFeature: 'generation',
    dbId: r.id,
    projectId: r.project_id,
    folderId: r.folder_id,
  };
}

export async function listWorkspaceArtifacts(
  orgId: string,
  filter: ProjectFilter,
): Promise<WorkspaceArtifactListItem[]> {
  const supabase = await createClient();

  const transcriptQ = applyProjectFilter(
    supabase
      .from('transcript_jobs')
      .select('id, project_id, folder_id, filename, status, updated_at, created_at')
      .eq('org_id', orgId)
      .eq('status', 'done'),
    filter,
  );
  const deskQ = applyProjectFilter(
    supabase
      .from('desk_jobs')
      .select('id, project_id, folder_id, keywords, status, updated_at, created_at')
      .eq('org_id', orgId)
      .eq('status', 'done'),
    filter,
  );
  const interviewQ = applyProjectFilter(
    supabase
      .from('interview_jobs')
      .select('id, project_id, folder_id, inputs, status, updated_at, created_at')
      .eq('org_id', orgId)
      .eq('status', 'done'),
    filter,
  );
  const reportQ = applyProjectFilter(
    supabase
      .from('report_jobs')
      .select('id, project_id, folder_id, inputs, status, updated_at, created_at')
      .eq('org_id', orgId)
      .eq('status', 'done'),
    filter,
  );
  const schedulerQ = applyProjectFilter(
    supabase
      .from('scheduler_sessions')
      .select('id, project_id, folder_id, name, attendees, updated_at, created_at')
      .eq('org_id', orgId),
    filter,
  );
  const recruitingQ = applyProjectFilter(
    supabase
      .from('recruiting_forms')
      .select('id, project_id, folder_id, title, created_at')
      .eq('org_id', orgId),
    filter,
  );
  // generations has no org_id; if filter is 'all' we skip (no way to scope).
  // Otherwise filter by project_id (project itself is org-scoped, so transitively safe).
  const generationsQ =
    filter.kind === 'all'
      ? null
      : applyProjectFilter(
          supabase
            .from('generations')
            .select('id, project_id, folder_id, feature, created_at'),
          filter,
        );

  const [tx, desk, iv, rp, sc, rc, gn] = await Promise.all([
    transcriptQ,
    deskQ,
    interviewQ,
    reportQ,
    schedulerQ,
    recruitingQ,
    generationsQ ?? Promise.resolve({ data: [] as Array<{ id: string; project_id: string | null; folder_id: string | null; feature: string; created_at: string }> }),
  ]);

  const out: WorkspaceArtifactListItem[] = [];
  for (const r of tx.data ?? []) out.push(transcriptToItem(r));
  for (const r of desk.data ?? []) out.push(deskToItem(r));
  for (const r of iv.data ?? []) out.push(interviewToItem(r));
  for (const r of rp.data ?? []) out.push(reportToItem(r));
  for (const r of sc.data ?? []) out.push(schedulerToItem(r));
  for (const r of rc.data ?? []) out.push(recruitingToItem(r));
  for (const r of gn.data ?? []) out.push(generationToItem(r));

  out.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return out;
}

// ── Content extraction ────────────────────────────────────────────────────

// Mirrors the consolidated-insight markdown that WorkspaceBridge used to
// build client-side. Source: src/components/workspace-bridge.tsx (before
// removal). Keeping the format identical preserves muscle memory for
// users who copy/send the digest into other features.
type ConsolidatedVoc = { voc: string; filename: string };
type ConsolidatedOutlier = { description: string; filenames: string[] };
type Consolidated = {
  topic: string;
  mainstream?: string;
  mainstreamVocs: ConsolidatedVoc[];
  outliers: ConsolidatedOutlier[];
  outlierVocs: ConsolidatedVoc[];
};

function assembleInterviewMarkdown(consolidated: Consolidated[]): string {
  const lines: string[] = [`# 인터뷰 분석 — 핵심 인사이트`, ''];
  for (const c of consolidated) {
    lines.push(`## ${c.topic}`, '');
    if (c.mainstream && c.mainstream.trim()) {
      lines.push('**대표 경향성**', '', c.mainstream, '');
    }
    if ((c.mainstreamVocs ?? []).length > 0) {
      lines.push(
        '**대표 VOC**',
        ...c.mainstreamVocs.map((v) => `- "${v.voc}" — ${v.filename}`),
        '',
      );
    }
    if ((c.outliers ?? []).length > 0) {
      lines.push(
        '**소수 케이스**',
        ...c.outliers.map((o) => {
          const tag = o.filenames.length > 0 ? ` (${o.filenames.join(', ')})` : '';
          return `- ${o.description}${tag}`;
        }),
        '',
      );
    }
    if ((c.outlierVocs ?? []).length > 0) {
      lines.push(
        '**소수 케이스 VOC**',
        ...c.outlierVocs.map((v) => `- "${v.voc}" — ${v.filename}`),
        '',
      );
    }
  }
  return lines.join('\n');
}

export type ArtifactContent = {
  content: string;
  // 'reports' is HTML; everything else is markdown/text. The workspace
  // panel uses this hint to pick download formats (matches the old
  // formatsFor() logic).
  kind: 'html' | 'markdown' | 'text';
};

export async function getArtifactContent(
  orgId: string,
  dbFeature: DbFeature,
  dbId: string,
): Promise<ArtifactContent | null> {
  const supabase = await createClient();

  if (dbFeature === 'transcript') {
    const { data } = await supabase
      .from('transcript_jobs')
      .select('markdown')
      .eq('org_id', orgId)
      .eq('id', dbId)
      .maybeSingle();
    if (!data?.markdown) return null;
    return { content: data.markdown as string, kind: 'markdown' };
  }

  if (dbFeature === 'desk') {
    const { data } = await supabase
      .from('desk_jobs')
      .select('output')
      .eq('org_id', orgId)
      .eq('id', dbId)
      .maybeSingle();
    if (!data?.output) return null;
    return { content: data.output as string, kind: 'markdown' };
  }

  if (dbFeature === 'interview') {
    const { data } = await supabase
      .from('interview_jobs')
      .select('consolidated')
      .eq('org_id', orgId)
      .eq('id', dbId)
      .maybeSingle();
    const consolidated = (data?.consolidated as Consolidated[] | null) ?? null;
    if (!consolidated || consolidated.length === 0) return null;
    return { content: assembleInterviewMarkdown(consolidated), kind: 'markdown' };
  }

  if (dbFeature === 'report') {
    const { data } = await supabase
      .from('report_jobs')
      .select('html, markdown')
      .eq('org_id', orgId)
      .eq('id', dbId)
      .maybeSingle();
    if (data?.html) return { content: data.html as string, kind: 'html' };
    if (data?.markdown) return { content: data.markdown as string, kind: 'markdown' };
    return null;
  }

  if (dbFeature === 'generation') {
    const { data } = await supabase
      .from('generations')
      .select('output')
      .eq('id', dbId)
      .maybeSingle();
    if (!data?.output) return null;
    return { content: data.output as string, kind: 'text' };
  }

  // scheduler / recruiting: no meaningful content payload — return a stub
  // summary so the workspace can still view/copy/send something.
  if (dbFeature === 'scheduler') {
    const { data } = await supabase
      .from('scheduler_sessions')
      .select('name, attendees, selected_slots')
      .eq('org_id', orgId)
      .eq('id', dbId)
      .maybeSingle();
    if (!data) return null;
    const name = (data.name as string | null) ?? 'Scheduler session';
    const attendees = (data.attendees as unknown[] | null) ?? [];
    const slots = (data.selected_slots as unknown[] | null) ?? [];
    const md = `# ${name}\n\n- 참석자: ${attendees.length}명\n- 선택된 슬롯: ${slots.length}개`;
    return { content: md, kind: 'markdown' };
  }

  if (dbFeature === 'recruiting') {
    const { data } = await supabase
      .from('recruiting_forms')
      .select('title, responder_uri, edit_uri')
      .eq('org_id', orgId)
      .eq('id', dbId)
      .maybeSingle();
    if (!data) return null;
    const title = (data.title as string | null) ?? 'Recruiting form';
    const responder = (data.responder_uri as string | null) ?? '';
    const md = `# ${title}\n\n${responder ? `응답 링크: ${responder}` : ''}`;
    return { content: md, kind: 'markdown' };
  }

  return null;
}

// Returns every folder under a project, flat. Caller builds the tree from
// parent_folder_id (workspace panel keeps the rendered tree state).
export async function listFolders(orgId: string, projectId: string): Promise<FolderRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('folders')
    .select('id, project_id, parent_folder_id, name, created_at, updated_at')
    .eq('org_id', orgId)
    .eq('project_id', projectId)
    .order('name', { ascending: true });
  return (data ?? []) as FolderRow[];
}

