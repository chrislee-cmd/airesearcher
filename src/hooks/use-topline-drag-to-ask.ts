'use client';

import { useCallback, useState } from 'react';
import { parseSearchStream } from '@/lib/interview-v2/parse-stream';

// 인터뷰 탑라인 drag-to-ask — ask 스트리밍 + pending 삽입 + 유지/버리기 상태.
//
// ask(): 선택 구절 + 질문을 POST /topline/ask 로 보내 답변을 스트리밍하고,
// anchor 블록 아래에 pending 삽입으로 렌더할 상태를 만든다(옅은 배경/점선은
// 렌더 쪽 책임). keep(): PATCH /topline/blocks 로 inserted_qa 를 서버 병합한
// 뒤 refetch 로 확정된 blocks 를 다시 읽는다. discard(): 클라 상태에서 제거
// (서버 미저장이라 롤백으로 충분 — 사용자 결정 2).

export type PendingQa = {
  // 클라 전용 id(서버 blocks id 와 무관).
  id: string;
  anchorBlockId: string;
  selectedExcerpt: string;
  question: string;
  answerMd: string;
  // 답변이 인용한 chunk_id(뱃지 하이라이트 + keep 시 서버 재검증 시드).
  citations: string[];
  phase: 'streaming' | 'done' | 'error';
  errorMsg?: string;
  // keep PATCH in-flight.
  saving?: boolean;
};

function newId(): string {
  // 브라우저 crypto — 앱 런타임에서 안전(워크플로우 스크립트 제한과 무관).
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `pqa_${crypto.randomUUID()}`;
  }
  return `pqa_${Date.now()}`;
}

export function useToplineDragToAsk(opts: {
  projectId: string;
  // 서버 병합 후 확정 blocks 를 다시 읽기 위한 콜백(hook 의 refetch).
  onMerged: () => Promise<void> | void;
}) {
  const { projectId, onMerged } = opts;
  const [pending, setPending] = useState<PendingQa[]>([]);

  const patch = useCallback(
    (id: string, next: Partial<PendingQa>) => {
      setPending((list) =>
        list.map((p) => (p.id === id ? { ...p, ...next } : p)),
      );
    },
    [],
  );

  const remove = useCallback((id: string) => {
    setPending((list) => list.filter((p) => p.id !== id));
  }, []);

  const ask = useCallback(
    async (anchorBlockId: string, selectedText: string, question: string) => {
      const id = newId();
      setPending((list) => [
        ...list,
        {
          id,
          anchorBlockId,
          selectedExcerpt: selectedText,
          question,
          answerMd: '',
          citations: [],
          phase: 'streaming',
        },
      ]);

      try {
        const res = await fetch('/api/interviews/v2/topline/ask', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            project_id: projectId,
            anchor_block_id: anchorBlockId,
            selected_text: selectedText,
            question,
          }),
        });

        if (!res.ok || !res.body) {
          const raw = await res.text().catch(() => '');
          let detail = '';
          try {
            detail = (JSON.parse(raw) as { error?: string }).error ?? '';
          } catch {
            // non-JSON error body
          }
          patch(id, { phase: 'error', errorMsg: detail || `HTTP ${res.status}` });
          return;
        }

        const contentType = res.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
          // no_answer / short-circuit — 완결 객체(스트림 아님).
          const body = (await res.json().catch(() => ({}))) as {
            answer_md?: string;
          };
          patch(id, {
            answerMd: body.answer_md ?? '',
            citations: [],
            phase: 'done',
          });
          return;
        }

        for await (const chunk of parseSearchStream(res.body)) {
          patch(id, {
            answerMd: chunk.answer_md,
            citations: chunk.citations.map((c) => String(c.chunk_id)),
          });
        }
        patch(id, { phase: 'done' });
      } catch (e) {
        patch(id, {
          phase: 'error',
          errorMsg: e instanceof Error ? e.message : 'network_error',
        });
      }
    },
    [projectId, patch],
  );

  const keep = useCallback(
    async (id: string) => {
      let target: PendingQa | undefined;
      setPending((list) => {
        target = list.find((p) => p.id === id);
        return list.map((p) => (p.id === id ? { ...p, saving: true } : p));
      });
      if (!target) return;

      try {
        const res = await fetch('/api/interviews/v2/topline/blocks', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            project_id: projectId,
            anchor_block_id: target.anchorBlockId,
            question: target.question,
            selected_excerpt: target.selectedExcerpt,
            answer_md: target.answerMd,
            citations: target.citations,
          }),
        });
        if (!res.ok) {
          const raw = await res.text().catch(() => '');
          let detail = '';
          try {
            detail = (JSON.parse(raw) as { error?: string }).error ?? '';
          } catch {
            // non-JSON
          }
          patch(id, {
            saving: false,
            phase: 'error',
            errorMsg: detail || `HTTP ${res.status}`,
          });
          return;
        }
        // 서버 병합 성공 — pending 제거 후 확정 blocks 재조회(realtime 도
        // 반영하지만 refetch 로 결정적으로 맞춘다).
        remove(id);
        await onMerged();
      } catch (e) {
        patch(id, {
          saving: false,
          phase: 'error',
          errorMsg: e instanceof Error ? e.message : 'network_error',
        });
      }
    },
    [projectId, patch, remove, onMerged],
  );

  const discard = useCallback((id: string) => remove(id), [remove]);

  return { pending, ask, keep, discard };
}
