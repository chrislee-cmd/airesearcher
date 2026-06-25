// probing 위젯 가이드 textarea 의 영속화. localStorage 한 키.
// 사용자 별·디바이스 별 — 프로젝트 단위 영속화는 별 PR 후보 (PR-7).
// 백엔드 max (suggest route.ts 의 z.string().max(20_000)) 와 동일한 cap.

const STORAGE_KEY = 'probing-guide-v1';
export const GUIDE_MAX_CHARS = 20_000;

export function getStoredGuide(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveGuide(value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // quota / private mode — silently ignore. 다음 키 입력에서 재시도.
  }
}
