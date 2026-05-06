'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useTranscriptJobs } from './transcript-job-provider';
import { useDeskJobs } from './desk-job-provider';
import { useInterviewJob } from './interview-job-provider';
import { useWorkspace } from './workspace-provider';

// Watches background job providers and auto-registers any newly-done
// artifact into the workspace panel. Runs at the layout level so every
// page gets coverage without each generator wiring itself.
//
// Coverage:
//   - Transcripts (tx_<jobId>)  — Deepgram markdown
//   - Desk research (desk_<jobId>) — final report markdown
//   - Interviews (iv_<sessionHash>) — consolidated insights summary
//   - Reports register themselves directly from report-generator.tsx
export function WorkspaceBridge() {
  const transcripts = useTranscriptJobs();
  const desk = useDeskJobs();
  const interview = useInterviewJob();
  const workspace = useWorkspace();

  // Single seen-set covers every prefix. Seeded from existing artifacts so a
  // page refresh that re-hydrates done jobs doesn't double-add.
  const seenRef = useRef<Set<string>>(new Set());
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    for (const a of workspace.artifacts) {
      if (
        a.id.startsWith('tx_') ||
        a.id.startsWith('desk_') ||
        a.id.startsWith('iv_')
      ) {
        seenRef.current.add(a.id);
      }
    }
  }, [workspace.artifacts]);

  // ── Transcripts ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function registerNew(jobId: string, filename: string) {
      try {
        const res = await fetch(`/api/transcripts/jobs/${jobId}`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const json = await res.json();
        const md: string = json.markdown ?? '';
        if (!md.trim() || cancelled) return;
        const base = (filename || 'transcript').replace(/\.[^./\\]+$/, '');
        workspace.addArtifact({
          id: `tx_${jobId}`,
          featureKey: 'quotes',
          title: `${base}.md`,
          content: md,
        });
      } catch {
        // ignore — next status update retries
      }
    }
    for (const j of transcripts.jobs) {
      if (j.status !== 'done') continue;
      const id = `tx_${j.id}`;
      if (seenRef.current.has(id)) continue;
      seenRef.current.add(id);
      void registerNew(j.id, j.filename);
    }
    return () => {
      cancelled = true;
    };
  }, [transcripts.jobs, workspace]);

  // ── Desk research ───────────────────────────────────────────────────────
  // The job's `output` field is the final markdown report. Title from the
  // first keyword + date stamp so the workspace card is recognisable.
  useEffect(() => {
    for (const j of desk.jobs) {
      if (j.status !== 'done' || !j.output) continue;
      const id = `desk_${j.id}`;
      if (seenRef.current.has(id)) continue;
      seenRef.current.add(id);
      const stamp = new Date().toISOString().slice(0, 10);
      const kw = j.keywords[0] ?? 'desk';
      workspace.addArtifact({
        id,
        featureKey: 'desk',
        title: `desk-${kw}-${stamp}.md`,
        content: j.output,
      });
    }
  }, [desk.jobs, workspace]);

  // ── Interviews ──────────────────────────────────────────────────────────
  // Interview state is single-context (one analysis at a time). Trigger:
  // vertical synthesis finished AND consolidated insights exist. The
  // workspace artifact is a markdown digest so it can be dropped into reports
  // / generators that accept text.
  const interviewArtifact = useMemo(() => {
    if (!interview.verticalDone) return null;
    const a = interview.analysis;
    if (!a || !a.consolidated || a.consolidated.length === 0) return null;
    // Stable id: hash of the file order so re-running with the same files
    // overwrites instead of accumulating.
    const fingerprint = interview.filenameOrder.join('|');
    const hash = fingerprint
      ? Buffer.from(fingerprint).toString('base64').slice(0, 16)
      : 'session';
    const md = [
      `# 인터뷰 분석 — 핵심 인사이트`,
      '',
      ...a.consolidated.flatMap((c) => [
        `## ${c.topic}`,
        '',
        c.summary,
        '',
        ...(c.representativeVocs && c.representativeVocs.length > 0
          ? [
              '**대표 VOC**',
              ...c.representativeVocs.map((v) => `- "${v.voc}" — ${v.filename}`),
              '',
            ]
          : []),
      ]),
    ].join('\n');
    return { id: `iv_${hash}`, md };
  }, [interview.verticalDone, interview.analysis, interview.filenameOrder]);

  useEffect(() => {
    if (!interviewArtifact) return;
    if (seenRef.current.has(interviewArtifact.id)) return;
    seenRef.current.add(interviewArtifact.id);
    const stamp = new Date().toISOString().slice(0, 10);
    workspace.addArtifact({
      id: interviewArtifact.id,
      featureKey: 'interviews',
      title: `interviews-${stamp}.md`,
      content: interviewArtifact.md,
    });
  }, [interviewArtifact, workspace]);

  return null;
}
