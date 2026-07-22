/* ────────────────────────────────────────────────────────────────────
   DuotoneIcon — Research-Canvas 듀오톤 아이콘 세트 (CD 핸드오프, R7 토큰화).

   SSOT: Widgets Canvas 1c 프로토. 이모지 전면 대체용 · 총 25종.
   스타일: viewBox 0 0 24 24 · stroke 2 · round cap+join.

   듀오톤 = ink 스트로크 + **위젯 톤 채움**. 채움은 정적 hex 가 아니라
   `var(--widget-tone)` — widget-shell 이 카드 컨테이너에 노출하는 "해상된
   헤더 톤"(유저 headerColor ?? accent 파스텔) 을 읽는다. 그래서 🎨 로
   헤더색을 바꾸면 헤더밴드·아이콘·팔레트글리프가 **한 소스로 동시 리틴트**된다.

   토큰화(하드코딩 hex 0):
   - stroke = `var(--color-ink)` (mono 모드는 `var(--color-paper)` = 흰).
   - fill 기본 = `var(--widget-tone, var(--widget-header-bg-rose))`.
     (var 미정의 컨텍스트 = 중립 rose 파스텔 폴백 — 모두 토큰.)
   - mono = 어두운 배경(CTA/공유 버튼)용 단색: 흰 스트로크 + 채움 없음.

   접근성: 순수 장식 → aria-hidden. 의미는 인접 라벨 텍스트가 전달.
   ──────────────────────────────────────────────────────────────────── */

import type { ReactNode } from 'react';

const INK = 'var(--color-ink)';

// var(--widget-tone) 미정의 컨텍스트용 중립 폴백 (rose 파스텔 토큰).
export const DEFAULT_TONE_FILL = 'var(--widget-tone, var(--widget-header-bg-rose))';

export type DuotoneIconName =
  | 'diamond' | 'offline' | 'online' | 'observe' | 'mic' | 'minutes'
  | 'host' | 'guest' | 'language' | 'project' | 'questions' | 'keywords'
  | 'target' | 'document' | 'upload' | 'interpret' | 'speakers' | 'typos'
  | 'polish' | 'link' | 'waiting' | 'start' | 'stop' | 'audio' | 'fullview'
  | 'search' | 'trend' | 'market';

// f = 듀오톤 채움색. paths(name) 에서 fill 지정된 요소만 채워지고 나머지는
// 순수 스트로크. mono 모드는 호출부에서 f='none' 을 넘긴다.
function paths(name: DuotoneIconName, f: string): ReactNode[] {
  switch (name) {
    case 'diamond': return [<path key={0} d="M6 4h12l3 5-9 11L3 9z" fill={f} />, <path key={1} d="M3 9h18M9 4L6 9l6 11 6-11-3-5" />];
    case 'offline': return [<circle key={0} cx={8} cy={9} r={2.6} fill={f} />, <circle key={1} cx={16} cy={9} r={2.6} fill={f} />, <path key={2} d="M3.5 19v-.8A3.7 3.7 0 0 1 7.2 14.5h1.6" />, <path key={3} d="M20.5 19v-.8a3.7 3.7 0 0 0-3.7-3.7h-1.6" />];
    case 'online': return [<rect key={0} x={3} y={4} width={18} height={12} rx={1.6} fill={f} />, <path key={1} d="M8 20h8M12 16v4" />];
    case 'observe': return [<path key={0} d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" fill={f} />, <circle key={1} cx={12} cy={12} r={2.6} />];
    case 'mic': return [<rect key={0} x={9} y={3} width={6} height={11} rx={3} fill={f} />, <path key={1} d="M6 11a6 6 0 0 0 12 0" />, <path key={2} d="M12 17v4M8.5 21h7" />];
    case 'minutes': return [<rect key={0} x={5} y={3} width={14} height={18} rx={1.6} fill={f} />, <path key={1} d="M8 8h8M8 12h8M8 16h5" />];
    case 'host': return [<circle key={0} cx={9} cy={7} r={3} fill={f} />, <path key={1} d="M3.5 20v-1a5.5 5.5 0 0 1 5.5-5.5" />, <rect key={2} x={14} y={12} width={6.5} height={9} rx={1.2} fill={f} />];
    case 'guest': return [<circle key={0} cx={11} cy={7} r={3} fill={f} />, <path key={1} d="M5 21v-2a6 6 0 0 1 12 0v2" />, <path key={2} d="M18 8.5l3-3" />];
    case 'language': return [<circle key={0} cx={12} cy={12} r={8} fill={f} />, <path key={1} d="M4 12h16" />, <path key={2} d="M12 4c2.5 2.2 2.5 13.8 0 16M12 4c-2.5 2.2-2.5 13.8 0 16" />];
    case 'project': return [<path key={0} d="M3 7a1 1 0 0 1 1-1h4l2 2h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" fill={f} />];
    case 'questions': return [<path key={0} d="M4 5h16v11H9l-4 4z" fill={f} />, <path key={1} d="M10 8.5a2 2 0 1 1 2.6 1.9c-.5.2-.7.6-.7 1.1v.3" />, <circle key={2} cx={12} cy={14} r={0.6} fill={INK} stroke="none" />];
    case 'keywords': return [<path key={0} d="M4 4h7l9 9-7 7-9-9z" fill={f} />, <circle key={1} cx={8.5} cy={8.5} r={1.4} />];
    case 'target': return [<circle key={0} cx={12} cy={12} r={8} fill={f} />, <circle key={1} cx={12} cy={12} r={4} />, <circle key={2} cx={12} cy={12} r={0.7} fill={INK} stroke="none" />];
    case 'document': return [<path key={0} d="M6 3h8l4 4v14H6z" fill={f} />, <path key={1} d="M14 3v4h4" />, <path key={2} d="M9 13h6M9 17h5" />];
    case 'upload': return [<path key={0} d="M12 15V4" />, <path key={1} d="M8 8l4-4 4 4" />, <path key={2} d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />];
    case 'interpret': return [<path key={0} d="M4 13v-1a8 8 0 0 1 16 0v1" />, <rect key={1} x={3} y={13} width={4} height={7} rx={1.6} fill={f} />, <rect key={2} x={17} y={13} width={4} height={7} rx={1.6} fill={f} />];
    case 'speakers': return [<path key={0} d="M3 6h10v6H7l-3 3v-3H3z" fill={f} />, <path key={1} d="M11 11v3h6l3 3v-3h1v-6h-2" />];
    case 'typos': return [<path key={0} d="M4 20h4L19 9l-4-4L4 16z" fill={f} />, <path key={1} d="M13.5 6.5l4 4" />];
    case 'polish': return [<path key={0} d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6z" fill={f} />, <path key={1} d="M18 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" />];
    case 'link': return [<path key={0} d="M9.5 14.5l5-5" />, <path key={1} d="M11 6.5l1-1a3.8 3.8 0 0 1 5.4 5.4l-1 1" />, <path key={2} d="M13 17.5l-1 1a3.8 3.8 0 0 1-5.4-5.4l1-1" />];
    case 'waiting': return [<circle key={0} cx={12} cy={12} r={8} fill={f} />, <path key={1} d="M12 8v4l3 2" />];
    case 'start': return [<polygon key={0} points="7 4 20 12 7 20 7 4" fill={f} />];
    case 'stop': return [<rect key={0} x={6} y={6} width={12} height={12} rx={2.5} fill={f} />];
    case 'audio': return [<path key={0} d="M4 9v6h4l5 4V5L8 9z" fill={f} />, <path key={1} d="M16.5 9.5a4 4 0 0 1 0 5" />];
    case 'fullview': return [<path key={0} d="M9 4H4v5" />, <path key={1} d="M4 4l6 6" />, <path key={2} d="M15 20h5v-5" />, <path key={3} d="M20 20l-6-6" />];
    case 'trend': return [<path key={0} d="M4 16l5-5 4 3 7-8" />, <path key={1} d="M15 6h5v5" />];
    case 'market': return [<rect key={0} x={4} y={11} width={4} height={8} rx={1} fill={f} />, <rect key={1} x={10} y={7} width={4} height={12} rx={1} fill={f} />, <rect key={2} x={16} y={4} width={4} height={15} rx={1} fill={f} />];
    case 'search': return [<circle key={0} cx={11} cy={11} r={6} fill={f} />, <path key={1} d="M20 20l-4-4" />];
    default: return [];
  }
}

export function DuotoneIcon({
  name,
  size = 20,
  fill = DEFAULT_TONE_FILL,
  mono = false,
  className,
}: {
  name: DuotoneIconName;
  size?: number;
  // 듀오톤 채움색. 기본 = var(--widget-tone) (헤더 매칭). 명시 오버라이드 가능.
  fill?: string;
  // 어두운 배경(CTA/공유 버튼)용 단색 — 흰 스트로크 + 채움 없음.
  mono?: boolean;
  className?: string;
}) {
  const stroke = mono ? 'var(--color-paper)' : INK;
  const f = mono ? 'none' : fill;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: 'block', flexShrink: 0 }}
    >
      {paths(name, f)}
    </svg>
  );
}

export default DuotoneIcon;
