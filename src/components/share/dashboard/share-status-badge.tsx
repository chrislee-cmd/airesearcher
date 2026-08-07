import type { ShareStatus } from './types';

// 공유 상태 배지 — 라이브러리 4-상태 문법에서 3칸만 사용(§1.3).
// **error 틴트 없음.** 철회는 고장이 아니라 사람이 의도한 일 — 붉은색은 철회
// 버튼과 확인 모달에만. 목록에 붉은 배지가 뜨면 잘못된 화면처럼 읽힌다.
//
// - active  : success 도트(채움) · success 틴트
// - expired : 속 빈 도트(paper + mute-soft 링) · paper-soft 틴트
// - revoked : ink 도트(채움) · surface-disabled 틴트

type Tone = {
  dot: string;
  ring: boolean; // 속 빈 도트(만료)
  tint: string;
  border: string;
  text: string;
};

const TONE: Record<ShareStatus, Tone> = {
  active: {
    dot: 'bg-success',
    ring: false,
    tint: 'bg-success-bg',
    border: 'border-success-line',
    text: 'text-success-text',
  },
  expired: {
    dot: 'bg-paper',
    ring: true,
    tint: 'bg-paper-soft',
    border: 'border-line-strong',
    text: 'text-mute',
  },
  revoked: {
    dot: 'bg-ink',
    ring: false,
    tint: 'bg-surface-disabled',
    border: 'border-ink/24',
    text: 'text-mute',
  },
};

export function ShareStatusBadge({
  status,
  label,
}: {
  status: ShareStatus;
  label: string;
}) {
  const t = TONE[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill border-[1.3px] ${t.tint} ${t.border} px-2.5 py-[3px] text-sm font-bold ${t.text}`}
    >
      <span
        className={`h-[7px] w-[7px] rounded-full ${t.dot} ${
          t.ring ? 'border-[1.6px] border-mute-soft' : ''
        }`}
      />
      {label}
    </span>
  );
}
