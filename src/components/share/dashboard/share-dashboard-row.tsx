'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { DuotoneIcon } from '@/components/ui/icons/duotone-icon';
import type { ShareLinkItem } from './types';
import { TONE_BG, TONE_ICON, avatarTone, initials } from './tone';
import { mmdd, mmddhhmm, expiryInfo, maskEmail, type ExpiryInfo } from './format';
import { ShareStatusBadge } from './share-status-badge';
import { ShareRowActions } from './share-row-actions';
import { ShareInvitePopover } from './share-invite-popover';

// 행 = ShareLinkItem 하나. 행 문법은 deliverables-library 에서 가져온 것(§3-2):
// 34px 톤 타일 · 제목/종류 칩 · 메타 라인 · 5개 열(초대·열람·만료·상태·액션).
//
// - revoked 행만 타일 파스텔을 잃는다(§0.4). expired 는 톤 유지, 텍스트만 눕힘.
// - 발급자 아바타/이름은 **조직 전체 스코프일 때만**(showIssuer) 메타 라인에.
// - 열람 열은 §0.3(노출 확정). viewsEnabled=false 면(폴백) 열 숨김.

const AVATAR_BASE =
  'inline-flex shrink-0 items-center justify-center rounded-full text-xs font-extrabold';

export function ShareDashboardRow({
  item,
  showIssuer,
  viewsEnabled,
  nowMs,
  onCopy,
  onInviteEdit,
  onRevoke,
}: {
  item: ShareLinkItem;
  showIssuer: boolean;
  viewsEnabled: boolean;
  nowMs: number;
  onCopy: () => Promise<boolean>;
  onInviteEdit: () => void;
  onRevoke: () => void;
}) {
  const t = useTranslations('ShareDashboard');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [popoverOpen, setPopoverOpen] = useState(false);

  const revoked = item.status === 'revoked';
  const dim = item.status === 'expired' || item.status === 'revoked';

  async function handleCopy() {
    const ok = await onCopy();
    if (ok) {
      setCopyState('copied');
      // 1.6초 유지 후 기본 복귀 (§1.7). setTimeout 은 모션이 아니라 상태 타이머라
      // prefers-reduced-motion 대상 아님.
      window.setTimeout(() => setCopyState('idle'), 1600);
    } else {
      setCopyState('failed');
    }
  }

  const invited = item.invitedEmails;
  const shownChips = invited.slice(0, 2);
  const overflow = invited.length - shownChips.length;

  const exp = expiryInfo(item.expiresAt, nowMs);
  const issuerName = item.issuer.name ?? t('meta.retiredMember');

  return (
    <div className="group flex flex-col border-b border-line bg-paper hover:bg-surface-canvas">
      <div className="flex items-center gap-[11px] px-6 py-[13px]">
        {/* 산출물 톤 타일 — revoked 는 파스텔 상실. 아이콘 채움 = paper(§1.10). */}
        <div
          className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-icon border-2 ${
            revoked ? 'border-ink/28 bg-surface-disabled' : `border-ink ${TONE_BG[item.tone]}`
          } group-hover:shadow-memphis-sm-faint`}
        >
          <DuotoneIcon
            name={TONE_ICON[item.tone]}
            size={18}
            fill="var(--color-paper)"
            stroke={revoked ? 'var(--color-mute-soft)' : undefined}
          />
        </div>

        {/* 제목 + 종류 칩 + 메타 라인. */}
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={`truncate text-lg font-bold ${revoked ? 'text-mute-soft' : 'text-ink'}`}
            >
              {item.resourceTitle ?? item.resourceLabel}
            </span>
            <span
              className={`shrink-0 rounded-xs border-[1.3px] border-line-strong px-1.5 py-px font-mono-label text-xs font-bold ${
                revoked ? 'text-faint' : 'text-mute-soft'
              }`}
            >
              {item.resourceLabel}
            </span>
          </div>
          <div className="flex items-center gap-[7px] text-sm text-mute-soft">
            <span>{t('meta.issuedOn', { date: mmdd(item.createdAt) })}</span>
            {showIssuer && (
              <span
                className={`inline-flex items-center gap-[5px] ${revoked ? 'opacity-[.72]' : ''}`}
              >
                <span aria-hidden>·</span>
                <span
                  className={`${AVATAR_BASE} h-4 w-4 border-[1.3px] ${
                    revoked
                      ? 'border-ink/30 bg-surface-disabled text-mute'
                      : `border-ink text-ink ${TONE_BG[avatarTone(issuerName)]}`
                  }`}
                >
                  {initials(issuerName)}
                </span>
                <span>{issuerName}</span>
                {item.issuer.isMine && (
                  <span className="rounded-xs border border-rose bg-rose-bg px-1 font-mono-label text-xs font-extrabold text-amore-deep">
                    {t('meta.mine')}
                  </span>
                )}
              </span>
            )}
            {revoked && (
              <span className="font-bold text-mute">
                · {t('meta.revokedOn', { date: mmdd(item.revokedAt) })}
              </span>
            )}
          </div>
        </div>

        {/* 초대 열 — 마스킹 칩 최대 2 + ＋N(펼침). 0명은 안내 문구. */}
        <div className="relative flex w-[210px] shrink-0 flex-wrap items-center gap-[5px]">
          {invited.length === 0 ? (
            <span className="text-sm text-faint">{t('invited.none')}</span>
          ) : (
            <>
              {shownChips.map((email) => (
                <span
                  key={email}
                  className="rounded-xs border-[1.3px] border-line-strong bg-paper-soft px-[7px] py-0.5 font-mono-label text-xs-soft text-ink"
                >
                  {maskEmail(email)}
                </span>
              ))}
              {overflow > 0 && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={() => setPopoverOpen((v) => !v)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setPopoverOpen((v) => !v);
                    }
                  }}
                  className="cursor-pointer font-mono-label text-xs-soft font-bold text-mute"
                >
                  ＋{overflow}
                </span>
              )}
              {popoverOpen && (
                <ShareInvitePopover
                  emails={invited}
                  headerLabel={t('popover.inviteCount', { count: invited.length })}
                  editLabel={t('popover.inviteEdit')}
                  onEdit={() => {
                    setPopoverOpen(false);
                    onInviteEdit();
                  }}
                  onClose={() => setPopoverOpen(false)}
                />
              )}
            </>
          )}
        </div>

        {/* 열람 열 — 미집계(null) vs 0회 구분(§0.3). */}
        {viewsEnabled && (
          <div className="flex w-[126px] shrink-0 flex-col gap-0.5">
            {item.viewCount == null ? (
              <span className="font-mono-label text-md text-faint">—</span>
            ) : (
              <>
                <span
                  className={`font-mono-label text-md font-extrabold ${dim ? 'text-mute' : 'text-ink'}`}
                >
                  {t('views.count', { count: item.viewCount })}
                </span>
                {item.lastViewedAt && (
                  <span className="font-mono-label text-xs text-faint">
                    {mmddhhmm(item.lastViewedAt)}
                  </span>
                )}
              </>
            )}
          </div>
        )}

        {/* 만료 열 — 7일 이내는 경고 칩으로 승격. */}
        <div className="flex w-[150px] shrink-0 flex-col gap-0.5">
          <ExpiryCell exp={exp} t={t} />
        </div>

        {/* 상태 열. */}
        <div className="w-[108px] shrink-0">
          <ShareStatusBadge status={item.status} label={t(`statusBadge.${item.status}`)} />
        </div>

        {/* 액션 열 (w-212 내장). */}
        <ShareRowActions
          status={item.status}
          copied={copyState === 'copied'}
          labels={{
            copy: t('actions.copy'),
            copied: t('actions.copied'),
            inviteEdit: t('actions.inviteEdit'),
            revoke: t('actions.revoke'),
          }}
          onCopy={() => void handleCopy()}
          onInviteEdit={onInviteEdit}
          onRevoke={onRevoke}
        />
      </div>

      {/* 복사 실패 카드 — 토스트 대신 행 아래에서 주소 직접 선택(§1.7). */}
      {copyState === 'failed' && (
        <div className="mx-6 mb-3 flex max-w-[430px] flex-col gap-2 rounded-panel border-2 border-ink bg-error-bg px-3.5 py-3">
          <span className="text-md font-extrabold text-error-text">
            {t('actions.copyFailedTitle')}
          </span>
          <span className="truncate rounded-icon border-[1.5px] border-error-line bg-paper px-3 py-2 font-mono-label text-sm text-mute">
            {item.url}
          </span>
        </div>
      )}
    </div>
  );
}

function ExpiryCell({
  exp,
  t,
}: {
  exp: ExpiryInfo;
  t: ReturnType<typeof useTranslations>;
}) {
  if (exp.kind === 'none') {
    return <span className="font-mono-label text-sm text-mute">{t('expiry.none')}</span>;
  }
  if (exp.kind === 'soon') {
    return (
      <>
        <span className="font-mono-label text-sm font-extrabold text-amber-text">
          {exp.date}
        </span>
        <span className="inline-flex w-fit items-center gap-1 rounded-xs border-[1.3px] border-amber-line bg-warning-bg px-1.5 py-px font-mono-label text-xs font-extrabold text-amber-text">
          {t('expiry.daysLeft', { days: exp.days })}
        </span>
      </>
    );
  }
  return (
    <>
      <span className="font-mono-label text-sm text-mute">{exp.date}</span>
      <span className="font-mono-label text-xs text-faint">
        {exp.kind === 'past'
          ? t('expiry.daysAgo', { days: exp.days })
          : t('expiry.daysLeft', { days: exp.days })}
      </span>
    </>
  );
}
