'use client';

import { useCallback, useState } from 'react';

// 인터뷰 탑라인 — 프로젝트 "분석 가이드라인" 업로드/교체/삭제 클라 오케스트레이션.
//
// 예전 use-topline-import 는 완성 보고서를 blocks 로 파싱해 편집 모드로 열던
// **생성 우회** 훅이었다. 이 훅은 대신 업로드 파일을 **생성이 따라야 할 가이드
// 문서**로 저장한다(POST /topline/guideline) — 저장 후 onChanged()(refetch)로
// 카드 배지/stale 을 갱신한다. 결과물을 편집 모드로 열지 않는다(가이드는 표시만).
//
// 포맷별 전송(use-topline-import 미러):
//   - Markdown/평문(.md/.markdown/.txt) → 클라에서 file.text() 로 읽어 JSON 전송.
//   - DOCX/PDF/HTML → multipart 로 그대로 보내 서버(report-convert)가 정규화.

const TEXT_UPLOAD_RE = /\.(md|markdown|txt)$/i;
function isTextUpload(file: File): boolean {
  return (
    file.type === 'text/markdown' ||
    file.type === 'text/plain' ||
    TEXT_UPLOAD_RE.test(file.name)
  );
}

export function useToplineGuideline(opts: {
  projectId: string;
  // 가이드 저장/삭제 성공 후 GET 재조회(배지·stale 갱신).
  onChanged: () => Promise<void> | void;
  // 읽기/변환/저장 실패 시 사용자 안내(toast). code 는 서버 error 또는 네트워크.
  onError: (code: string) => void;
}) {
  const { projectId, onChanged, onError } = opts;
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const uploadFile = useCallback(
    async (file: File): Promise<boolean> => {
      if (uploading) return false;
      setUploading(true);
      try {
        let res: Response;
        if (isTextUpload(file)) {
          const markdown = await file.text();
          if (!markdown.trim()) {
            onError('empty_report');
            return false;
          }
          res = await fetch('/api/interviews/v2/topline/guideline', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              project_id: projectId,
              markdown,
              filename: file.name,
            }),
          });
        } else {
          const form = new FormData();
          form.append('project_id', projectId);
          form.append('file', file);
          res = await fetch('/api/interviews/v2/topline/guideline', {
            method: 'POST',
            body: form,
          });
        }
        if (!res.ok) {
          const raw = await res.text().catch(() => '');
          let detail = '';
          try {
            detail = (JSON.parse(raw) as { error?: string }).error ?? '';
          } catch {
            // non-JSON error body
          }
          onError(detail || `HTTP ${res.status}`);
          return false;
        }
        await onChanged();
        return true;
      } catch (e) {
        onError(e instanceof Error ? e.message : 'network_error');
        return false;
      } finally {
        setUploading(false);
      }
    },
    [uploading, projectId, onChanged, onError],
  );

  const deleteGuideline = useCallback(async (): Promise<boolean> => {
    if (deleting) return false;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/interviews/v2/topline/guideline?project_id=${encodeURIComponent(projectId)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const raw = await res.text().catch(() => '');
        let detail = '';
        try {
          detail = (JSON.parse(raw) as { error?: string }).error ?? '';
        } catch {
          // non-JSON error body
        }
        onError(detail || `HTTP ${res.status}`);
        return false;
      }
      await onChanged();
      return true;
    } catch (e) {
      onError(e instanceof Error ? e.message : 'network_error');
      return false;
    } finally {
      setDeleting(false);
    }
  }, [deleting, projectId, onChanged, onError]);

  return { uploading, deleting, uploadFile, deleteGuideline };
}
