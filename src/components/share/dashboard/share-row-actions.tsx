'use client';

import { DuotoneIcon } from '@/components/ui/icons/duotone-icon';
import { Pressable } from '@/components/artifacts/library/pressable';
import type { ShareStatus } from './types';

// 액션 3종 — 잠금 매트릭스(§1.4). status 축만 씀(소유권 무관 — issuer.isMine 은
// 잠금에 영향 없음). 셸(deliverables-library) 버튼 클래스를 그대로 미러링(§3-2):
// primary=bg-ink, secondary=paper, 잠금=surface-disabled+그림자없음+래퍼 opacity 금지.
//
//  status   복사        초대 편집   철회
//  active   primary     secondary   danger secondary
//  expired  잠금        secondary   잠금        (초대 편집 = 기한 연장 경로)
//  revoked  잠금        잠금        잠금

const PILL = 'inline-flex items-center justify-center gap-1.5 rounded-pill';
const PRIMARY = 'border-2 border-ink bg-ink text-paper shadow-memphis-sm';
const SECONDARY = 'border-[1.5px] border-ink bg-paper text-ink shadow-memphis-sm';
const DANGER =
  'border-[1.5px] border-amore-deep bg-paper text-amore-deep shadow-memphis-sm-crimson';
const LOCKED = 'border-[1.5px] border-ink/20 bg-surface-disabled text-mute';
const COPIED =
  'border-2 border-success bg-success-bg text-success-text shadow-memphis-sm-success';

// 복사됨 체크 — 듀오톤 스트로크 문법(currentColor 로 success-text 상속, hex 없음).
function CheckGlyph() {
  return (
    <svg
      width={13}
      height={13}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}

export function ShareRowActions({
  status,
  copied,
  labels,
  onCopy,
  onInviteEdit,
  onRevoke,
}: {
  status: ShareStatus;
  copied: boolean;
  labels: { copy: string; copied: string; inviteEdit: string; revoke: string };
  onCopy: () => void;
  onInviteEdit: () => void;
  onRevoke: () => void;
}) {
  const copyLocked = status !== 'active';
  const inviteLocked = status === 'revoked'; // expired 는 살림(기한 연장 경로)
  const revokeLocked = status !== 'active';

  return (
    <div className="flex w-[212px] shrink-0 items-center justify-end gap-[7px]">
      {/* 복사 — min-width 로 "복사"↔"복사됨" 폭 차이 흡수(§1.7). */}
      <Pressable
        onPress={onCopy}
        disabled={copyLocked}
        ariaLabel={labels.copy}
        className={`${PILL} min-w-[82px] px-[13px] py-1.5 text-md font-extrabold ${
          copyLocked ? LOCKED : copied ? COPIED : PRIMARY
        }`}
      >
        {copyLocked ? (
          <DuotoneIcon name="link" size={14} stroke="var(--color-mute)" />
        ) : copied ? (
          <CheckGlyph />
        ) : (
          <DuotoneIcon name="link" size={14} mono />
        )}
        {copied && !copyLocked ? labels.copied : labels.copy}
      </Pressable>

      {/* 초대 편집 — expired 에서도 활성(기한 연장). */}
      <Pressable
        onPress={onInviteEdit}
        disabled={inviteLocked}
        ariaLabel={labels.inviteEdit}
        className={`${PILL} px-3 py-1.5 text-md font-bold ${
          inviteLocked ? LOCKED : SECONDARY
        }`}
      >
        {labels.inviteEdit}
      </Pressable>

      {/* 철회 — 테두리만 붉음. 붉은 채움은 확인 모달 확정 버튼에만. */}
      <Pressable
        onPress={onRevoke}
        disabled={revokeLocked}
        ariaLabel={labels.revoke}
        className={`${PILL} px-3 py-1.5 text-md font-extrabold ${
          revokeLocked ? 'font-bold ' + LOCKED : DANGER
        }`}
      >
        {labels.revoke}
      </Pressable>
    </div>
  );
}
