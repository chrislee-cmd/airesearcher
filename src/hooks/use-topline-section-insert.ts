'use client';

import { useCallback, useState } from 'react';

// 인터뷰 탑라인 섹션 삽입 — 섹션 사이 gap 의 +버튼 → 명령 프롬프트로 새 섹션을
// 생성하고 그 자리에 영속한다.
//
// insert(): 자연어 지시를 POST /topline/section 으로 보내 섹션 md 를 생성한 뒤,
// PATCH /topline/blocks (action:'insert_section') 로 anchor(gap 위 블록, null=
// 최상단) 뒤에 inserted_section 을 병합한다. drag-to-ask 와 달리 keep/discard 가
// 없다 — "제출 → 로딩 → 삽입" 이라 생성 성공 시 곧바로 영속하고 refetch 로 확정
// 블록을 읽는다. 실패 시 pending(로딩) 제거 + onError 로 안내(롤백).

export type PendingSection = {
  // 클라 전용 id.
  id: string;
  // 삽입 지점 바로 위 블록 id(null = 최상단 gap). 로딩 카드를 그 gap 에 렌더.
  anchorBlockId: string | null;
  prompt: string;
  phase: 'generating';
};

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `psec_${crypto.randomUUID()}`;
  }
  return `psec_${Date.now()}`;
}

export function useToplineSectionInsert(opts: {
  projectId: string;
  // 서버 삽입 후 확정 blocks 를 다시 읽기 위한 콜백(hook 의 refetch).
  onInserted: () => Promise<void> | void;
  // 생성/저장 실패 시 사용자 안내(toast). code 는 서버 error 또는 네트워크.
  onError: (code: string) => void;
}) {
  const { projectId, onInserted, onError } = opts;
  const [pending, setPending] = useState<PendingSection[]>([]);

  const remove = useCallback((id: string) => {
    setPending((list) => list.filter((p) => p.id !== id));
  }, []);

  const insert = useCallback(
    async (anchorBlockId: string | null, prompt: string) => {
      const trimmed = prompt.trim();
      if (!trimmed) return;
      const id = newId();
      setPending((list) => [
        ...list,
        { id, anchorBlockId, prompt: trimmed, phase: 'generating' },
      ]);

      try {
        // 1) 생성 — 코퍼스 근거로 섹션 md + citation 을 만든다(비스트리밍 JSON).
        const genRes = await fetch('/api/interviews/v2/topline/section', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ project_id: projectId, prompt: trimmed }),
        });
        const genJson = (await genRes.json().catch(() => null)) as
          | { answer_md?: string; citation_ids?: string[]; no_answer?: boolean; error?: string }
          | null;
        if (!genRes.ok || !genJson) {
          remove(id);
          onError(genJson?.error || `HTTP ${genRes.status}`);
          return;
        }
        if (genJson.no_answer || !genJson.answer_md?.trim()) {
          remove(id);
          onError('no_answer');
          return;
        }

        // 2) 영속 — 생성된 섹션을 anchor 뒤(null=최상단)에 삽입 병합한다.
        const patchRes = await fetch('/api/interviews/v2/topline/blocks', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'insert_section',
            project_id: projectId,
            anchor_block_id: anchorBlockId,
            prompt: trimmed,
            generated_md: genJson.answer_md,
            citations: genJson.citation_ids ?? [],
          }),
        });
        if (!patchRes.ok) {
          const raw = await patchRes.text().catch(() => '');
          let detail = '';
          try {
            detail = (JSON.parse(raw) as { error?: string }).error ?? '';
          } catch {
            // non-JSON error body
          }
          remove(id);
          onError(detail || `HTTP ${patchRes.status}`);
          return;
        }

        // 성공 — 로딩 제거 후 확정 blocks 재조회(realtime 도 반영하지만 refetch
        // 로 결정적으로 맞춘다). 새 inserted_section 이 렌더된다.
        remove(id);
        await onInserted();
      } catch (e) {
        remove(id);
        onError(e instanceof Error ? e.message : 'network_error');
      }
    },
    [projectId, remove, onInserted, onError],
  );

  return { pending, insert };
}
