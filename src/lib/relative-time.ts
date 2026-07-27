import type { useTranslations } from 'next-intl';

// 상대 시각 포맷터("방금"/"N분 전"/"N시간 전"). listener-panel.tsx /
// interpreter-fullview.tsx 에 사본으로 존재하던 relativeJoined 순수 로직을
// 공용화한 것 — 리크루팅 로스터의 "링크 접속" 컬럼(joined_at)이 첫 소비자.
// `t` 는 justNow / minutesAgo({count}) / hoursAgo({count}) 키를 가진 네임스페이스여야 한다.
export function relativeJoined(
  joinedAt: string,
  now: number,
  t: ReturnType<typeof useTranslations>,
): string {
  const ts = Date.parse(joinedAt);
  if (Number.isNaN(ts)) return '';
  const sec = Math.max(0, Math.round((now - ts) / 1000));
  if (sec < 60) return t('justNow');
  const min = Math.floor(sec / 60);
  if (min < 60) return t('minutesAgo', { count: min });
  const hr = Math.floor(min / 60);
  return t('hoursAgo', { count: hr });
}
