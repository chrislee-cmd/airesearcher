'use client';

import { useEffect, useRef } from 'react';
import { useTranscriptJobs } from './transcript-job-provider';
import { useWorkspace } from './workspace-provider';

// Watches background job providers and auto-registers any newly-done
// artifact into the workspace panel. Runs at the layout level so every
// page gets coverage without each generator wiring itself.
export function WorkspaceBridge() {
  const { jobs } = useTranscriptJobs();
  const workspace = useWorkspace();

  // Track which job IDs we have already registered so re-mounts and
  // realtime echoes don't double-add the same artifact. Also seeded
  // from existing artifact IDs on mount so a refresh doesn't re-add
  // jobs that were already captured in a previous session.
  const seenRef = useRef<Set<string>>(new Set());
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    for (const a of workspace.artifacts) {
      // Artifact IDs for transcript-derived items use this prefix.
      if (a.id.startsWith('tx_')) seenRef.current.add(a.id);
    }
  }, [workspace.artifacts]);

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
        workspace.addArtifact({
          id: `tx_${jobId}`,
          featureKey: 'quotes',
          title: filename || 'Transcript',
          content: md,
        });
      } catch {
        // ignore — next status update will retry via this same effect
      }
    }
    for (const j of jobs) {
      if (j.status !== 'done') continue;
      if (seenRef.current.has(`tx_${j.id}`)) continue;
      seenRef.current.add(`tx_${j.id}`);
      void registerNew(j.id, j.filename);
    }
    return () => {
      cancelled = true;
    };
  }, [jobs, workspace]);

  return null;
}
