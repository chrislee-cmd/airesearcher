// 톤 → 시각 토큰 매핑. tone 은 서버가 주는 정체성 토큰이라 컴포넌트가
// resourceType 으로 분기하지 않는다(§5-1). tone 은 아이콘과도 1:1 이므로
// 아이콘도 tone 에서 파생한다 — 역할 문자열이 아니라 시각 토큰끼리의 매핑이다.

import type { DuotoneIconName } from '@/components/ui/icons/duotone-icon';
import type { ShareTone } from './types';

// 34px 행 타일 배경 (pastel 파스텔 전색). BUILD-SPEC §0.2.
export const TONE_BG: Record<ShareTone, string> = {
  rose: 'bg-rose',
  sky: 'bg-sky',
  lav: 'bg-lav',
  peach: 'bg-peach',
  aqua: 'bg-aqua',
  sun: 'bg-sun',
};

// tone → 듀오톤 아이콘 (BUILD-SPEC §0.2 표: 인터뷰=document · 프로빙=questions ·
// 전사록=minutes · UT=target · 데스크=keywords · 리크루팅=guest).
export const TONE_ICON: Record<ShareTone, DuotoneIconName> = {
  rose: 'document',
  sky: 'questions',
  lav: 'minutes',
  peach: 'target',
  aqua: 'keywords',
  sun: 'guest',
};

// 발급자 아바타 바탕색 — 산출물 톤 6종과 같은 팔레트에서 이름 해시로 고정
// 배정(§5-8: avatarUrl 없음, 계약 변경 없이 동작). 이름이 같으면 항상 같은 색.
const AVATAR_TONES: ShareTone[] = ['rose', 'sky', 'lav', 'peach', 'aqua', 'sun'];

export function avatarTone(name: string): ShareTone {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

// 이니셜 — 한글 성 1자 / 라틴 이니셜 2자 (§5-8). name 이 비면 빈 문자열.
export function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '';
  // 한글(가–힣)이 첫 글자면 성 1자.
  if (/[가-힣]/.test(trimmed[0])) return trimmed[0];
  // 라틴: 최대 두 단어의 앞 글자.
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return trimmed.slice(0, 2).toUpperCase();
}
