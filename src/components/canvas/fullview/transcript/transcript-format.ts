/* ────────────────────────────────────────────────────────────────────
   전사 풀뷰 V2 (state 04·05) 프레젠테이션 포맷 헬퍼 — fresh 신규 빌드.
   레거시 transcript-result-fullview 의 동형 헬퍼를 재구현(로직 재사용,
   프레젠테이션 커플링 없음). list/detail 두 컴포넌트가 공유.
   ──────────────────────────────────────────────────────────────────── */

import { getLanguage } from '@/lib/transcripts/languages';
import type { TranscriptJobStatus } from '@/components/transcript-job-provider';

// CD 파일행 3-상태 (state 04). done=✓/border-2 ink, processing=lav tint,
// failed=error. 잡 status + stuck 플래그 → 이 3-상태로 축약.
export type FileRowState = 'done' | 'processing' | 'failed';

export function fileRowState(
  status: TranscriptJobStatus,
  stuck: boolean,
): FileRowState {
  if (status === 'done') return 'done';
  if (status === 'error' || status === 'cancelled' || stuck) return 'failed';
  return 'processing';
}

// mime/파일명 → CD 파일행 이모지 아이콘 (🎙️ audio · 🎬 video · 📄 그 외).
export function fileIcon(mime: string | null, filename: string): string {
  const m = (mime ?? '').toLowerCase();
  if (m.startsWith('video/')) return '🎬';
  if (m.startsWith('audio/')) return '🎙️';
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (['mp4', 'mov', 'webm', 'mkv', 'avi'].includes(ext)) return '🎬';
  if (['m4a', 'mp3', 'wav', 'aac', 'ogg', 'flac'].includes(ext)) return '🎙️';
  return '📄';
}

export function minutesFromSeconds(seconds: number | null): number | null {
  if (!seconds || seconds < 0) return null;
  return Math.max(1, Math.round(seconds / 60));
}

export function formatDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(d);
}

export function languageBadge(code: string | null): string | null {
  if (!code) return null;
  const entry = getLanguage(code);
  const flag = entry?.flag ?? '🌐';
  return `${flag} ${code.toUpperCase()}`;
}

// 확장자를 벗긴 표시 이름. 익명 blob 이면 폴백 라벨은 소비처에서 결정.
export function stripExt(filename: string): string {
  return filename.replace(/\.[^./]+$/, '').trim();
}
