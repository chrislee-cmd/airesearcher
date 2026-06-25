// probing 위젯 가이드 textarea 의 파일 import 유틸 (PR-6b).
//
// .md / .txt — 브라우저 native file.text().
// .docx — mammoth.extractRawText. dynamic import 로 lazy 로딩 — initial
//   bundle 에 안 들어가게 (~50KB gzip). 첫 .docx import 때만 chunk 다운로드,
//   이후 캐시.
//
// 후처리:
//   - 3+ 연속 줄바꿈 → 2개 로 압축 (워드/마크다운 export 가 흔히 만든다)
//   - GUIDE_MAX_CHARS 초과 시 잘라내고 truncated=true 반환
//
// 클라이언트 사이드 전용 — 위젯이 'use client' 안에서 호출.

import { GUIDE_MAX_CHARS } from './probing-guide-storage';

export const GUIDE_IMPORT_MAX_BYTES = 5 * 1024 * 1024; // 5MB

const TEXT_EXT_RE = /\.(md|markdown|txt)$/i;
const DOCX_EXT_RE = /\.docx$/i;
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const TEXT_MIMES = new Set([
  'text/plain',
  'text/markdown',
  'text/x-markdown',
]);

export type GuideImportErrorCode =
  | 'unsupported_type'
  | 'too_large'
  | 'parse_failed';

export class GuideImportError extends Error {
  code: GuideImportErrorCode;
  constructor(code: GuideImportErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = 'GuideImportError';
  }
}

type Kind = 'text' | 'docx' | 'unsupported';

function classify(file: File): Kind {
  if (DOCX_EXT_RE.test(file.name) || file.type === DOCX_MIME) return 'docx';
  if (
    TEXT_EXT_RE.test(file.name) ||
    TEXT_MIMES.has(file.type) ||
    file.type.startsWith('text/')
  ) {
    return 'text';
  }
  return 'unsupported';
}

function postProcess(raw: string): { text: string; truncated: boolean } {
  // 정규화: \r\n → \n, 3+ 줄바꿈 → 2 (워드 export 가 흔히 만드는 빈 줄 더미).
  const normalized = raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (normalized.length <= GUIDE_MAX_CHARS) {
    return { text: normalized, truncated: false };
  }
  return { text: normalized.slice(0, GUIDE_MAX_CHARS), truncated: true };
}

export async function importGuideFile(
  file: File,
): Promise<{ text: string; truncated: boolean }> {
  if (file.size > GUIDE_IMPORT_MAX_BYTES) {
    throw new GuideImportError('too_large');
  }
  const kind = classify(file);
  if (kind === 'unsupported') {
    throw new GuideImportError('unsupported_type');
  }
  try {
    if (kind === 'text') {
      const raw = await file.text();
      return postProcess(raw);
    }
    // docx — lazy import. mammoth 의 browser entry 가 arrayBuffer 옵션 사용.
    const mammoth = await import('mammoth');
    const arrayBuffer = await file.arrayBuffer();
    const { value } = await mammoth.extractRawText({ arrayBuffer });
    return postProcess(value);
  } catch (e) {
    if (e instanceof GuideImportError) throw e;
    throw new GuideImportError(
      'parse_failed',
      e instanceof Error ? e.message : String(e),
    );
  }
}
