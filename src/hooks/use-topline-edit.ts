'use client';

import { useCallback, useState } from 'react';

// 인터뷰 탑라인 인라인 편집 — 선택 블록의 md 를 직접 수정/저장.
//
// save(): 낙관적으로 블록 md 를 즉시 반영(applyBlockMd)한 뒤 PATCH
// /topline/blocks (action:'edit_block') 로 서버에 영속한다. 성공 시 onSaved
// (hook refetch)로 확정 blocks 를 다시 읽고, 실패 시 원문 md 로 되돌려 롤백한다
// (drag-to-ask keep 과 동일한 낙관 원칙 — 사용자 결정 2). 스타일 편집 X, 내용만
// (사용자 결정 1·3) — 서버가 블록 타입/구조를 유지하고 md 만 교체한다.

export type EditSaveResult = { ok: true } | { ok: false; error: string };

export function useToplineEdit(opts: {
  projectId: string;
  // 낙관적 블록 md 교체(성공 전 즉시 반영 / 실패 시 원문 복원).
  applyBlockMd: (blockId: string, md: string) => void;
  // 서버 저장 성공 후 확정 blocks 재조회(hook refetch).
  onSaved: () => Promise<void> | void;
}) {
  const { projectId, applyBlockMd, onSaved } = opts;
  // 현재 저장 in-flight 인 블록 id (버튼 비활성/스피너용).
  const [savingId, setSavingId] = useState<string | null>(null);

  const save = useCallback(
    async (
      blockId: string,
      prevMd: string,
      nextMd: string,
    ): Promise<EditSaveResult> => {
      const trimmed = nextMd.trim();
      // 빈 저장 또는 변경 없음 — 서버 왕복 없이 종료(호출측이 편집 닫음).
      if (!trimmed || trimmed === prevMd.trim()) {
        return { ok: true };
      }

      setSavingId(blockId);
      // 낙관적 반영 — 서버 확정 전 즉시 화면 갱신.
      applyBlockMd(blockId, trimmed);

      try {
        const res = await fetch('/api/interviews/v2/topline/blocks', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'edit_block',
            project_id: projectId,
            block_id: blockId,
            md: trimmed,
          }),
        });
        if (!res.ok) {
          // 롤백 — 원문 md 로 되돌린다.
          applyBlockMd(blockId, prevMd);
          const rawBody = await res.text().catch(() => '');
          let detail = '';
          try {
            detail = (JSON.parse(rawBody) as { error?: string }).error ?? '';
          } catch {
            // non-JSON error body
          }
          setSavingId(null);
          return { ok: false, error: detail || `HTTP ${res.status}` };
        }
        // 서버 병합 성공 — 확정 blocks 재조회(realtime 도 반영하지만 refetch 로
        // 결정적으로 맞춘다).
        await onSaved();
        setSavingId(null);
        return { ok: true };
      } catch (e) {
        applyBlockMd(blockId, prevMd);
        setSavingId(null);
        return {
          ok: false,
          error: e instanceof Error ? e.message : 'network_error',
        };
      }
    },
    [projectId, applyBlockMd, onSaved],
  );

  return { savingId, save };
}
