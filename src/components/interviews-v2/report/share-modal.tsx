'use client';

/* ────────────────────────────────────────────────────────────────────
   InterviewShareModal — 보고서 공유 모달 (fresh · BUILD-SPEC §1.4 · S4c .dc.html
   비주얼 SSOT). border 3 ink · rounded-modal(18) · shadow-iv-modal-share(6px6px0
   ink/30) · 헤더 rose + border-b 2 ink.

   링크 필드 + 복사 · 게이트 토글 · 초대 이메일(ChipField). "지금까지 연 사람 N명"
   행은 미렌더(DECISIONS #4 — shared_views 에 열람 카운트 컬럼 없음).

   공유 API(POST /api/share · /api/share/mine · /invite · /revoke)를 그대로 소비한다
   (계약 무변경). 공유 로직은 shared <ShareInviteModal> 과 같은 엔드포인트를 쓰되,
   그 6-consumer 컴포넌트의 외형을 rose 로 바꾸면 probing 등 5개 표면이 회귀하므로
   재-스킨하지 않고 인터뷰 전용 프레젠테이션을 새로 짓는다(보수적 — PR 본문 명시).

   토글 = 공유 링크 활성(ON=발급/create · OFF=폐기/revoke). 백엔드에 공개/비공개
   모드가 없어(항상 이메일 allow-list) 이것이 존재하는 유일한 on/off 상태다
   (보수적 해석 — PR 본문 명시). <Modal bare> 로 메커니즘만 빌린다.
   ──────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/modal';
import { ChipField } from '@/components/ui/chip-field';
import { DuotoneIcon } from '@/components/ui/icons/duotone-icon';
import { useToast } from '@/components/toast-provider';

// 인터뷰 탑라인 뷰어 라우트 — 구 뷰어(/share/[token], localePrefix always).
function viewerUrl(locale: string, token: string): string {
  const path = `/${locale}/share/${token}`;
  if (typeof window === 'undefined') return path;
  return `${window.location.origin}${path}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normEmail = (s: string) => s.trim().toLowerCase();
const DEFAULT_EXPIRY_DAYS = 30;

type ShareRow = {
  id: string;
  token: string;
  invited_emails: string[];
};

export function InterviewShareModal({
  open,
  onClose,
  resourceId,
}: {
  open: boolean;
  onClose: () => void;
  // interview_toplines.id — 미저장이면 null(모달 진입 차단은 호출측 담당).
  resourceId: string;
}) {
  const t = useTranslations('InterviewsV2');
  const locale = useLocale();
  const toast = useToast();

  const [share, setShare] = useState<ShareRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // 열릴 때마다 내 공유 목록에서 이 리소스의 활성 링크를 찾는다.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 열 때마다 게이트 리셋(외부 소스 = open)
    setLoading(true);
    setShare(null);
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/share/mine', { cache: 'no-store' });
        const json = (await res.json().catch(() => null)) as
          | { shares?: Array<ShareRow & { resource_type: string; resource_id: string; revoked_at: string | null }> }
          | null;
        if (cancelled || !aliveRef.current) return;
        const active = (json?.shares ?? []).find(
          (s) =>
            s.resource_type === 'interview_topline' &&
            s.resource_id === resourceId &&
            !s.revoked_at,
        );
        setShare(active ? { id: active.id, token: active.token, invited_emails: active.invited_emails } : null);
      } catch {
        // 조회 실패 — 비활성(OFF)으로 fallback.
      } finally {
        if (!cancelled && aliveRef.current) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, resourceId]);

  // 토글 ON — 링크 발급.
  const enable = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          resource_type: 'interview_topline',
          resource_id: resourceId,
          invited_emails: [],
          expires_at: new Date(
            Date.now() + DEFAULT_EXPIRY_DAYS * 24 * 3600 * 1000,
          ).toISOString(),
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | { id?: string; token?: string; error?: string }
        | null;
      if (!res.ok || !json?.id || !json.token) {
        toast.push(`${t('shareCreateError')}${json?.error ? ` (${json.error})` : ''}`, {
          tone: 'warn',
        });
        return;
      }
      setShare({ id: json.id, token: json.token, invited_emails: [] });
      toast.push(t('shareCreateSuccess'), { tone: 'amore' });
    } catch {
      toast.push(t('shareCreateError'), { tone: 'warn' });
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  }, [busy, resourceId, toast, t]);

  // 토글 OFF — 링크 폐기.
  const disable = useCallback(async () => {
    if (!share || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/share/${share.id}/revoke`, { method: 'POST' });
      if (!res.ok) throw new Error('revoke_failed');
      if (aliveRef.current) setShare(null);
      toast.push(t('shareRevoked'), { tone: 'amore' });
    } catch {
      toast.push(t('shareRevokeError'), { tone: 'warn' });
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  }, [share, busy, toast, t]);

  const copyLink = useCallback(async () => {
    if (!share) return;
    try {
      await navigator.clipboard.writeText(viewerUrl(locale, share.token));
      toast.push(t('shareCopied'), { tone: 'amore' });
    } catch {
      toast.push(t('shareCopyError'), { tone: 'warn' });
    }
  }, [share, locale, toast, t]);

  // 초대 이메일 add/remove — 서버 즉시 반영(낙관 + 롤백).
  const addInvite = useCallback(
    async (email: string) => {
      if (!share) return;
      const prev = share.invited_emails;
      setShare({ ...share, invited_emails: [...prev, email] });
      try {
        const res = await fetch(`/api/share/${share.id}/invite`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ emails: [email] }),
        });
        if (!res.ok) throw new Error('add_failed');
      } catch {
        if (aliveRef.current) setShare((s) => (s ? { ...s, invited_emails: prev } : s));
        toast.push(t('shareInviteError'), { tone: 'warn' });
      }
    },
    [share, toast, t],
  );
  const removeInvite = useCallback(
    async (email: string) => {
      if (!share) return;
      const prev = share.invited_emails;
      setShare({ ...share, invited_emails: prev.filter((e) => e !== email) });
      try {
        const res = await fetch(`/api/share/${share.id}/invite`, {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        if (!res.ok) throw new Error('remove_failed');
      } catch {
        if (aliveRef.current) setShare((s) => (s ? { ...s, invited_emails: prev } : s));
        toast.push(t('shareInviteError'), { tone: 'warn' });
      }
    },
    [share, toast, t],
  );

  // ChipField onChange(next) → add/remove 단건 + 형식 검증.
  const onEmailsChange = (next: string[]) => {
    const emails = share?.invited_emails ?? [];
    if (next.length > emails.length) {
      const value = normEmail(next[next.length - 1]);
      if (!value) return;
      if (!EMAIL_RE.test(value)) {
        toast.push(t('shareInvalidEmail'), { tone: 'warn' });
        return;
      }
      if (emails.some((e) => normEmail(e) === value)) return;
      void addInvite(value);
    } else if (next.length < emails.length) {
      const removed = emails.find((e) => !next.includes(e));
      if (removed) void removeInvite(removed);
    }
  };

  const active = !!share;

  return (
    <Modal open={open} onClose={onClose} size="sm" bare labelledBy="iv-share-title">
      <div className="overflow-hidden rounded-modal border-[3px] border-ink bg-paper shadow-iv-modal-share">
        {/* 헤더 — rose. */}
        <div className="flex items-center gap-2.5 border-b-2 border-ink bg-widget-header-rose px-[18px] py-3">
          <DuotoneIcon name="link" size={18} />
          <div
            id="iv-share-title"
            className="text-xl font-extrabold text-ink"
            style={{ fontFamily: 'var(--font-outfit), var(--font-sans)' }}
          >
            {t('shareTitle')}
          </div>
          {/* eslint-disable-next-line react/forbid-elements -- 모달 닫기 ✕ 는 28px 스퀘어 chrome(rounded-nav·memphis-sm); IconButton 고정 배경과 불일치 */}
          <button
            type="button"
            onClick={onClose}
            aria-label={t('shareClose')}
            className="ml-auto flex h-[28px] w-[28px] items-center justify-center rounded-nav border-[1.5px] border-ink bg-paper text-sm font-bold text-ink shadow-memphis-sm"
          >
            ✕
          </button>
        </div>

        {/* 본문. */}
        <div className="flex flex-col gap-3.5 p-[18px]">
          {loading ? (
            <div className="py-6 text-center font-mono-label text-sm text-mute-soft">
              {t('shareLoading')}
            </div>
          ) : (
            <>
              {/* 링크 필드 + 복사 — 활성일 때만. */}
              {active && (
                <div className="flex items-center gap-2.5">
                  <div className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap rounded-control border-[1.5px] border-ink bg-paper-soft px-3 py-2.5 font-mono-label text-xs text-mute">
                    {viewerUrl(locale, share!.token)}
                  </div>
                  {/* eslint-disable-next-line react/forbid-elements -- 복사는 solid ink rounded-control chrome(memphis-sm-faint); Button primary radius 와 불일치 */}
                  <button
                    type="button"
                    onClick={() => void copyLink()}
                    className="inline-flex shrink-0 items-center rounded-control bg-ink px-4 py-2.5 text-md font-extrabold text-paper shadow-memphis-sm-faint"
                  >
                    {t('shareCopy')}
                  </button>
                </div>
              )}

              {/* 게이트 토글 카드. */}
              <div className="flex flex-col gap-2.5 rounded-card border-[1.5px] border-ink/[0.14] bg-paper-soft px-3.5 py-3">
                <div className="flex items-center gap-2.5">
                  {/* eslint-disable-next-line react/forbid-elements -- CD §1.4 토글 스위치는 34×20 전용 chrome(track success·knob·border 2 ink); primitive 부재(Checkbox 와 형태 상이) */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={active}
                    disabled={busy}
                    onClick={() => (active ? void disable() : void enable())}
                    aria-label={t('shareGateLabel')}
                    className={`relative h-5 w-[34px] shrink-0 rounded-pill border-2 border-ink transition-colors disabled:opacity-50 ${
                      active ? 'bg-success' : 'bg-paper'
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`absolute top-[1px] h-[14px] w-[14px] rounded-full border border-ink bg-paper transition-[left] motion-reduce:transition-none ${
                        active ? 'left-[15px]' : 'left-[1px]'
                      }`}
                    />
                  </button>
                  <span className="text-md font-extrabold text-ink">
                    {t('shareGateLabel')}
                  </span>
                </div>
                <div className="text-xs leading-[1.6] text-mute">
                  {t('shareGateDesc')}
                </div>
              </div>

              {/* 초대 이메일 — 활성일 때만. */}
              {active && (
                <div className="flex flex-col gap-1.5">
                  <span className="font-mono-label text-xs font-bold uppercase tracking-[0.14em] text-mute-soft">
                    {t('shareInvitesLabel')}
                  </span>
                  <ChipField
                    values={share!.invited_emails}
                    onChange={onEmailsChange}
                    commitOnComma
                    inputType="email"
                    disabled={busy}
                    placeholderEmpty={t('shareInvitesPlaceholder')}
                    chipRemoveLabel={(email) => t('shareRemoveInvite', { email })}
                    inputClassName="min-w-[140px]"
                  />
                  <span className="text-xs leading-[1.55] text-mute-soft">
                    {t('shareInvitesHint')}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
