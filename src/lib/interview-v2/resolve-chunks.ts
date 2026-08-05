// Interview V2 evidence-chunk resolve — citation id → popover payload.
//
// The redesigned interview-results view renders inline [chunk_id] citations
// as chips; clicking one opens a popover that needs the chunk's excerpt, its
// source file name, and a human-readable position. This helper is the read
// side of that popover (DECISIONS #1): given a set of citation ids already
// scoped to one project, it fetches the underlying interview_chunks + their
// documents and shapes each into a compact popover record.
//
// Access logic mirrors the existing V2 retrieval helpers (pgvector-query /
// parent-expand): the caller does authorization (getActiveOrg → org_id +
// project ownership), and this helper trusts org_id as the isolation boundary
// while additionally narrowing to the requested project. Chunks whose id is
// unknown, org-foreign, or in another project are silently dropped — the
// caller returns the surviving set and the frontend falls back to a bare chip
// for anything missing (spec: 미존재/타 프로젝트 id 는 조용히 제외).

// Popover excerpt cap — a preview, never the full chunk (spec: ≤300자,
// 앞부분+말줄임). interview_chunks.content is lossless and can be multi-KB.
export const EXCERPT_MAX_CHARS = 300;

export type ResolvedChunk = {
  chunk_id: string;
  excerpt: string;
  file_name: string;
  // Human-readable location within the source file. We surface the chunk's
  // paragraph ordinal (순번) — the only stable position field the chunker
  // stamps for every chunk (metadata.paragraph_index); char offsets and
  // timestamps aren't universally present. null when the chunk predates that
  // metadata. No invented field (spec: 필드 발명 금지, 애매하면 순번).
  position: number | null;
};

// Loosely typed DB boundary — structurally matching Supabase's recursively
// generic PostgrestFilterBuilder triggers TS2589 (excessively deep). Same
// localized `any` escape hatch parent-expand.ts uses; rows are re-validated at
// runtime below.
type AdminClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase builder type is too deep to structurally match (TS2589); the `any` is localized to this DB boundary and rows are re-validated at runtime.
  from: (table: string) => any;
};

function truncateExcerpt(content: string): string {
  const text = (content ?? '').trim();
  if (text.length <= EXCERPT_MAX_CHARS) return text;
  // Slice the leading window and mark the elision. slice(0, MAX-1) keeps the
  // rendered string (excerpt + '…') at ≤ EXCERPT_MAX_CHARS characters.
  return text.slice(0, EXCERPT_MAX_CHARS - 1).trimEnd() + '…';
}

/**
 * Resolve citation chunk ids to popover records, scoped to one project.
 *
 * @param admin      Admin (service-role) client — org_id + project_id below are
 *                   the isolation boundary; authorization happens at the route.
 * @param orgId      Requester's active org.
 * @param projectId  Project the citations belong to (already ownership-checked).
 * @param chunkIds   Raw citation ids from the client (stringified bigints).
 *
 * Returns one record per resolvable chunk, in no guaranteed order. Ids that are
 * non-numeric, unknown, org-foreign, or belong to a document outside projectId
 * are omitted (not an error). Fail-closed: on a DB error it throws and the
 * route surfaces a 500 rather than leaking a partial/unscoped set.
 */
export async function resolveChunks(
  admin: AdminClient,
  orgId: string,
  projectId: string,
  chunkIds: string[],
): Promise<ResolvedChunk[]> {
  // interview_chunks.id is a bigserial — coerce and drop anything that isn't a
  // clean integer id (a malformed id can never match, so silently skip it).
  const numericIds = Array.from(
    new Set(
      chunkIds
        .map((raw) => String(raw).trim())
        .filter((s) => /^\d+$/.test(s)),
    ),
  ).map((s) => Number(s));
  if (numericIds.length === 0) return [];

  // Fetch the requested chunks scoped to the org. document_id lets us enforce
  // the project boundary in the second step; metadata carries the position.
  const chunkRes = await admin
    .from('interview_chunks')
    .select('id, content, document_id, metadata')
    .eq('org_id', orgId)
    .in('id', numericIds);
  if (chunkRes.error) {
    throw new Error(`resolveChunks chunks: ${String(chunkRes.error)}`);
  }
  const chunkRows = (Array.isArray(chunkRes.data) ? chunkRes.data : []) as Array<{
    id: number | string;
    content: string;
    document_id: string;
    metadata: { paragraph_index?: number | null } | null;
  }>;
  if (chunkRows.length === 0) return [];

  // Resolve document_id → (filename, project_id) via a second scoped query
  // rather than a PostgREST embed. interview_chunks.document_id has a direct FK
  // to interview_documents, so an embed would work — but the 2-step keeps us
  // clear of the transitive-embed silent-empty trap (PROJECT.md §7.10) and lets
  // the project filter live in plain code.
  const docIds = Array.from(new Set(chunkRows.map((r) => r.document_id)));
  const docRes = await admin
    .from('interview_documents')
    .select('id, filename, project_id')
    .eq('org_id', orgId)
    .in('id', docIds);
  if (docRes.error) {
    throw new Error(`resolveChunks documents: ${String(docRes.error)}`);
  }
  const docRows = (Array.isArray(docRes.data) ? docRes.data : []) as Array<{
    id: string;
    filename: string | null;
    project_id: string | null;
  }>;

  // Keep only documents that live in the requested project — this is what drops
  // citation ids pointing at another project's chunks.
  const filenameByDoc = new Map<string, string>();
  for (const d of docRows) {
    if (d.project_id !== projectId) continue;
    filenameByDoc.set(d.id, typeof d.filename === 'string' ? d.filename : '');
  }

  const out: ResolvedChunk[] = [];
  for (const c of chunkRows) {
    const fileName = filenameByDoc.get(c.document_id);
    if (fileName === undefined) continue; // unknown doc or other project
    const paragraphIndex = c.metadata?.paragraph_index;
    out.push({
      chunk_id: String(c.id),
      excerpt: truncateExcerpt(c.content),
      file_name: fileName,
      position: typeof paragraphIndex === 'number' ? paragraphIndex : null,
    });
  }
  return out;
}
