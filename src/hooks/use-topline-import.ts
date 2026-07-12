'use client';

import { useCallback, useState } from 'react';

// 인터뷰 탑라인 — 편집전용 모드(외부 보고서 업로드) 클라 오케스트레이션.
//
// import(file): 사용자가 고른 보고서 파일을 POST /topline/import 로 보낸다. 서버가
// md→blocks 파싱 + status='done'/source='uploaded' 저장을 하고, 성공 시
// onImported()(refetch)로 저장된 보고서를 편집 모드로 연다. 생성(Opus) 경로와 달리
// realtime 진행률이 없다 — 단발 저장이라 로딩→완료만.
//
// 포맷별 전송(#595):
//   - Markdown/평문(.md/.markdown/.txt) → 클라에서 file.text() 로 읽어 JSON 전송.
//     이미 Markdown 이라 서버 변환 불필요(구조 손실 0, 왕복 최소).
//   - DOCX/PDF/HTML → 바이너리/마크업이라 클라 text() 로는 못 읽는다. 파일을
//     multipart 로 그대로 보내고 서버(report-convert)가 구조 보존 Markdown 정규화.
//
// use-topline-section-insert 의 pending/롤백 패턴을 따르되, 단일 파일 단발이라
// importing 불리언 하나로 충분. 실패는 onError(code)로 toast 안내.

// 클라에서 텍스트로 읽어 JSON 전송할 수 있는(=이미 Markdown/평문) 파일인지.
// 그 외(DOCX/PDF/HTML)는 서버 변환 경로(multipart)로 보낸다.
const TEXT_UPLOAD_RE = /\.(md|markdown|txt)$/i;
function isTextUpload(file: File): boolean {
  return (
    file.type === 'text/markdown' ||
    file.type === 'text/plain' ||
    TEXT_UPLOAD_RE.test(file.name)
  );
}

export function useToplineImport(opts: {
  projectId: string;
  // 서버 저장 후 저장된 blocks 를 다시 읽어 편집 모드로 전환하는 콜백(refetch).
  onImported: () => Promise<void> | void;
  // 읽기/파싱/저장 실패 시 사용자 안내(toast). code 는 서버 error 또는 네트워크.
  onError: (code: string) => void;
}) {
  const { projectId, onImported, onError } = opts;
  const [importing, setImporting] = useState(false);

  const importFile = useCallback(
    async (file: File) => {
      if (importing) return;
      setImporting(true);
      try {
        let res: Response;
        if (isTextUpload(file)) {
          // Markdown/평문 — 클라에서 읽어 JSON 전송(서버 변환 불필요).
          const markdown = await file.text();
          if (!markdown.trim()) {
            onError('empty_report');
            return;
          }
          res = await fetch('/api/interviews/v2/topline/import', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              project_id: projectId,
              markdown,
              filename: file.name,
            }),
          });
        } else {
          // DOCX/PDF/HTML — 파일을 multipart 로 보내 서버가 Markdown 정규화.
          const form = new FormData();
          form.append('project_id', projectId);
          form.append('file', file);
          res = await fetch('/api/interviews/v2/topline/import', {
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
          return;
        }
        // 성공 — 저장된 보고서를 다시 읽어 편집 모드로 연다.
        await onImported();
      } catch (e) {
        onError(e instanceof Error ? e.message : 'network_error');
      } finally {
        setImporting(false);
      }
    },
    [importing, projectId, onImported, onError],
  );

  return { importing, importFile };
}
