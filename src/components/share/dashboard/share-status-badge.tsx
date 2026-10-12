import type { ShareStatus } from './types';

// 공유 상태 배지 — 라이브러리 4-상태 문법에서 3칸만 사용(§1.3).
// **error 틴트 없음.** 철회는 고장이 아니라 사람이 의도한 일 — 붉은색은 철회
// 버튼과 확인 모달에만. 목록에 붉은 배지가 뜨면 잘못된 화면처럼 읽힌다.
//
// Soft Identity (리브랜드 2단계) 핵심규칙 4 — **배지에 테두리가 없다.**
// 틴트 면(--*-bg) + 진한 글자(--*-fg) + 6px 점. 만료와 철회는 **둘 다 회색
// 면**이고 점 모양으로만 구분한다:
// - active  : --ok-bg 면 · --ok-fg 글자 · 채운 --ok-dot 점
// - expired : --fill 면 · --mute 글자 · **속 빈 점**(흰 면 + 1.5px --faint 링)
// - revoked : --fill 면 · --mute 글자 · **채운 점**(--ink)

type Tone = {
  dot: string;
  ring: boolean; // 속 빈 도트(만료)
  tint: string;
  text: string;
};

const TONE: Record<ShareStatus, Tone> = {
  active: {
    dot: 'bg-soft-ok-dot',
    ring: false,
    tint: 'bg-soft-ok-bg',
    text: 'text-soft-ok-fg',
  },
  expired: {
    dot: 'bg-soft-surface',
    ring: true,
    tint: 'bg-soft-fill',
    text: 'text-soft-mute',
  },
  revoked: {
    dot: 'bg-ink',
    ring: false,
    tint: 'bg-soft-fill',
    text: 'text-soft-mute',
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
      className={`inline-flex items-center gap-1.5 rounded-pill ${t.tint} px-2.5 py-[3px] text-sm font-bold ${t.text}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${t.dot} ${
          t.ring ? 'border-[1.5px] border-soft-faint' : ''
        }`}
      />
      {label}
    </span>
  );
}
