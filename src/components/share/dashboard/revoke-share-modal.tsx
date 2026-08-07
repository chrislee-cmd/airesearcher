'use client';

import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/modal';
import { DuotoneIcon } from '@/components/ui/icons/duotone-icon';
import { Pressable } from '@/components/artifacts/library/pressable';
import type { ShareLinkItem } from './types';
import { TONE_BG, TONE_ICON, avatarTone, initials } from './tone';
import { mmdd, maskEmail } from './format';

const OUTFIT = { fontFamily: 'var(--font-outfit), var(--font-sans)' } as const;

// 철회 확인 모달(§1.6 · C3a) — 비가역이므로 확인 단계 필수. 영향 범위를 숫자로
// 말하고(초대 N명 + 이메일 칩), 재발급 시 주소가 바뀐다는 사실을 명시한다.
// 확정 버튼 라벨 = "링크 끄기"(§3-4). 붉은 채움은 이 버튼 하나에만.
//
// 남의 링크(issuer.isMine === false)면 맨 위에 소유자 경고 밴드 한 줄 추가
// (§1.11 · C5 5c). DECISIONS §5-7: 알림 시스템 부재 → "알림이 갑니다" 절 삭제,
// 소유자 이름만. 나머지 구조는 C3a 와 동일 — 밴드 하나만 조건부.
//
// 초대 0명(주소 공유형)이면 영향 범위 박스를 렌더하지 않고 본문 문구가 달라진다
// (C5 5c: "주소를 아는 사람이면 누구나 … N회 열렸습니다").

export function RevokeShareModal({
  item,
  busy,
  onCancel,
  onConfirm,
}: {
  item: ShareLinkItem;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations('ShareDashboard');
  const hasInvites = item.invitedEmails.length > 0;
  const notMine = !item.issuer.isMine;
  const issuerName = item.issuer.name ?? t('meta.retiredMember');

  const targetMeta = t('revokeModal.targetMeta', {
    date: mmdd(item.createdAt),
    invites: hasInvites
      ? t('revokeModal.inviteCount', { count: item.invitedEmails.length })
      : t('revokeModal.noInvite'),
    views: item.viewCount ?? 0,
  });

  return (
    <Modal open onClose={onCancel} bare size="md" labelledBy="revoke-share-title">
      <div className="overflow-hidden rounded-modal border-[3px] border-ink bg-paper shadow-iv-modal-regen">
        {/* 헤더 (error-bg). */}
        <div className="flex items-center gap-[11px] border-b-2 border-ink bg-error-bg px-5 py-3.5">
          <span id="revoke-share-title" className="text-2xl font-extrabold text-ink" style={OUTFIT}>
            {t('revokeModal.title')}
          </span>
          <Pressable
            onPress={onCancel}
            ariaLabel={t('revokeModal.close')}
            className="ml-auto flex h-[30px] w-[30px] items-center justify-center rounded-icon border-[1.5px] border-ink bg-paper text-lg font-bold text-ink shadow-memphis-sm"
          >
            ✕
          </Pressable>
        </div>

        {/* 본문. */}
        <div className="flex flex-col gap-[15px] p-5">
          {/* 소유자 경고 밴드 — 남의 링크만(§1.11). */}
          {notMine && (
            <div className="flex items-center gap-2.5 rounded-panel border-2 border-ink bg-warning-bg px-[15px] py-3">
              <span
                className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-[1.4px] border-ink text-sm font-extrabold text-ink ${TONE_BG[avatarTone(issuerName)]}`}
              >
                {initials(issuerName)}
              </span>
              <span className="text-md leading-relaxed text-amber-text">
                {t.rich('revokeModal.ownerBand', {
                  name: issuerName,
                  b: (chunks) => <b className="font-extrabold">{chunks}</b>,
                })}
              </span>
            </div>
          )}

          {/* 대상 카드 — 산출물 톤 유지. */}
          <div className="flex items-center gap-[11px] rounded-panel border-[1.5px] border-line-strong bg-surface-canvas px-[15px] py-[13px]">
            <div
              className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-nav border-2 border-ink ${TONE_BG[item.tone]}`}
            >
              <DuotoneIcon name={TONE_ICON[item.tone]} size={16} fill="var(--color-paper)" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-lg font-bold text-ink">
                {item.resourceTitle ?? item.resourceLabel}
              </div>
              <div className="mt-0.5 font-mono-label text-xs-soft text-mute-soft">{targetMeta}</div>
            </div>
          </div>

          {/* 본문 문구 — 초대형 vs 주소공유형. */}
          <p className="text-lg leading-loose text-ink-2">
            {hasInvites
              ? t.rich('revokeModal.bodyInvited', {
                  count: item.invitedEmails.length,
                  b: (chunks) => <b className="font-extrabold text-ink">{chunks}</b>,
                })
              : t.rich('revokeModal.bodyPublic', {
                  views: item.viewCount ?? 0,
                  b: (chunks) => <b className="font-extrabold text-ink">{chunks}</b>,
                })}
          </p>

          {/* 영향 범위 박스 — 초대가 있을 때만. 이메일은 마스킹. */}
          {hasInvites && (
            <div className="flex flex-col gap-[7px] rounded-panel border-2 border-ink bg-error-bg px-[15px] py-[13px]">
              <span className="text-md font-extrabold text-error-text">
                {t('revokeModal.impactTitle')}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {item.invitedEmails.map((email) => (
                  <span
                    key={email}
                    className="rounded-xs border-[1.3px] border-error-line bg-paper px-2 py-0.5 font-mono-label text-sm text-ink"
                  >
                    {maskEmail(email)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 푸터. */}
        <div className="flex items-center gap-2.5 border-t-2 border-ink bg-paper-soft px-5 py-3.5">
          <span className="font-mono-label text-sm text-mute-soft">
            {t('revokeModal.footerNote')}
          </span>
          <div className="ml-auto flex gap-[9px]">
            <Pressable
              onPress={onCancel}
              disabled={busy}
              ariaLabel={t('revokeModal.cancel')}
              className="inline-flex cursor-pointer items-center rounded-pill border-[1.5px] border-ink/20 px-[18px] py-2.5 text-lg font-bold text-mute"
            >
              {t('revokeModal.cancel')}
            </Pressable>
            <Pressable
              onPress={onConfirm}
              disabled={busy}
              ariaLabel={t('revokeModal.confirm')}
              className="inline-flex cursor-pointer items-center gap-2 rounded-pill border-2 border-amore-deep bg-amore-deep px-5 py-2.5 text-lg font-extrabold text-paper shadow-memphis-sm-crimson"
            >
              {busy ? t('revokeModal.confirming') : t('revokeModal.confirm')}
            </Pressable>
          </div>
        </div>
      </div>
    </Modal>
  );
}
