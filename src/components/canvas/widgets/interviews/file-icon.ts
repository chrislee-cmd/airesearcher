import type { DuotoneIconName } from '@/components/ui/icons/duotone-icon';

// 파일 타입 → 듀오톤 아이콘 (BUILD-SPEC §1.5): 오디오/영상 = mic · 표 데이터
// (csv/xlsx) = dataset(신규 3종) · 그 외 텍스트 문서 = document. mime 우선,
// 없으면 확장자로 폴백.
export function fileIconName(
  mime: string | null,
  filename: string,
): DuotoneIconName {
  const m = (mime ?? '').toLowerCase();
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (
    m.startsWith('audio') ||
    m.startsWith('video') ||
    ['m4a', 'mp3', 'wav', 'aac', 'ogg', 'mp4', 'mov', 'webm'].includes(ext)
  ) {
    return 'mic';
  }
  if (
    m.includes('csv') ||
    m.includes('spreadsheet') ||
    m.includes('excel') ||
    ['csv', 'xlsx', 'xls', 'tsv'].includes(ext)
  ) {
    return 'dataset';
  }
  return 'document';
}
