'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { ChromeButton } from '@/components/ui/chrome-button';
import { ChipInput } from '@/components/ui/chip-input';
import { IconButton } from '@/components/ui/icon-button';
import { SelectMenu } from '@/components/ui/select-menu';
import { useToast } from '@/components/toast-provider';

// 공유 + 초대 관리 모달 (#477) — 인터뷰 탑라인 / 프로빙 페르소나 전체보기에서
// 재사용하는 단일 컴포넌트. #474 backend API(POST /api/share, invite add/remove,
// revoke, GET /api/share/mine)를 소비한다.
//
// export(Notion/Google Docs) 와 구분되는 "링크로 공유" — 완전 공개가 아니라
// 초대된 이메일만 열람하는 allow-list 링크. 정책 카피로 이를 명시한다.

// resource_type — 클라이언트 안전 리터럴(shared-views.ts 는 node:crypto 를
// 끌어와 client bundle 에 못 넣으므로 여기서 별도 정의).
export type ShareResourceType = 'interview_topline' | 'probing_persona';

// 뷰어 라우트(#475, 머지됨)는 `[locale]/share/[token]` — localePrefix:'always'
// 라 locale 세그먼트가 필수다. 한 곳에 모아 둔다.
function viewerUrl(locale: string, token: string): string {
  const path = `/${locale}/share/${token}`;
  if (typeof window === 'undefined') return path;
  return `${window.location.origin}${path}`;
}

// 만료 프리셋 — backend POST /api/share 는 expires_at 미지정 시 30일 기본이며
// "만료 없음" 을 지원하지 않으므로(항상 만료 강제, 결정 2) 프리셋만 제공한다.
const EXPIRY_DAYS = [7, 30, 90] as const;
const DEFAULT_EXPIRY_DAY = 30;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normEmail = (s: string) => s.trim().toLowerCase();

type ShareRow = {
  id: string;
  token: string;
  resource_type: ShareResourceType;
  resource_id: string;
  expires_at: string | null;
  revoked_at: string | null;
  invited_emails: string[];
};

type Props = {
  open: boolean;
  onClose: () => void;
  resourceType: ShareResourceType;
  resourceId: string;
};

export function ShareInviteModal({
  open,
  onClose,
  resourceType,
  resourceId,
}: Props) {
  const t = useTranslations('Share');
  const locale = useLocale();
  const toast = useToast();

  // 활성(미폐기) 공유 row — 없으면 생성 모드.
  const [share, setShare] = useState<ShareRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // 생성 모드 로컬 상태 — 링크 생성 전 초대 이메일/만료를 모아 둔다.
  const [draftEmails, setDraftEmails] = useState<string[]>([]);
  const [expiryDay, setExpiryDay] = useState<number>(DEFAULT_EXPIRY_DAY);

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // 모달 열릴 때마다 내 공유 목록에서 이 리소스의 활성 링크를 찾는다.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset gate on each open
    setLoading(true);
    setShare(null);
    setDraftEmails([]);
    setExpiryDay(DEFAULT_EXPIRY_DAY);
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/share/mine', { cache: 'no-store' });
        const json = (await res.json().catch(() => null)) as
          | { shares?: ShareRow[] }
          | null;
        if (cancelled || !aliveRef.current) return;
        const active = (json?.shares ?? []).find(
          (s) =>
            s.resource_type === resourceType &&
            s.resource_id === resourceId &&
            !s.revoked_at,
        );
        setShare(active ?? null);
      } catch {
        // 조회 실패 — 생성 모드로 fallback (사용자가 링크를 새로 만들 수 있게).
      } finally {
        if (!cancelled && aliveRef.current) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, resourceType, resourceId]);

  const createLink = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          resource_type: resourceType,
          resource_id: resourceId,
          invited_emails: draftEmails,
          expires_at: new Date(
            Date.now() + expiryDay * 24 * 3600 * 1000,
          ).toISOString(),
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | { id?: string; token?: string; expires_at?: string | null; error?: string }
        | null;
      if (!res.ok || !json?.id || !json.token) {
        toast.push(`${t('createError')}${json?.error ? ` (${json.error})` : ''}`, {
          tone: 'warn',
        });
        return;
      }
      setShare({
        id: json.id,
        token: json.token,
        resource_type: resourceType,
        resource_id: resourceId,
        expires_at: json.expires_at ?? null,
        revoked_at: null,
        invited_emails: [...draftEmails],
      });
      toast.push(t('createSuccess'), { tone: 'amore' });
    } catch {
      toast.push(t('createError'), { tone: 'warn' });
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  }, [busy, resourceType, resourceId, draftEmails, expiryDay, toast, t]);

  const copyLink = useCallback(async () => {
    if (!share) return;
    const url = viewerUrl(locale, share.token);
    try {
      await navigator.clipboard.writeText(url);
      toast.push(t('copied'), { tone: 'amore' });
    } catch {
      toast.push(t('copyError'), { tone: 'warn' });
    }
  }, [share, locale, toast, t]);

  // 관리 모드 — 서버에 즉시 반영(낙관 + 롤백).
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
        if (aliveRef.current) {
          setShare((s) =>
            s ? { ...s, invited_emails: prev } : s,
          );
        }
        toast.push(t('inviteError'), { tone: 'warn' });
      }
    },
    [share, toast, t],
  );

  const removeInvite = useCallback(
    async (email: string) => {
      if (!share) return;
      const prev = share.invited_emails;
      setShare({
        ...share,
        invited_emails: prev.filter((e) => e !== email),
      });
      try {
        const res = await fetch(`/api/share/${share.id}/invite`, {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        if (!res.ok) throw new Error('remove_failed');
      } catch {
        if (aliveRef.current) {
          setShare((s) => (s ? { ...s, invited_emails: prev } : s));
        }
        toast.push(t('inviteError'), { tone: 'warn' });
      }
    },
    [share, toast, t],
  );

  const revokeLink = useCallback(async () => {
    if (!share || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/share/${share.id}/revoke`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('revoke_failed');
      // 폐기 후 생성 모드로 되돌린다(새 링크를 만들 수 있게).
      if (aliveRef.current) {
        setShare(null);
        setDraftEmails([]);
        setExpiryDay(DEFAULT_EXPIRY_DAY);
      }
      toast.push(t('revoked'), { tone: 'amore' });
    } catch {
      toast.push(t('revokeError'), { tone: 'warn' });
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  }, [share, busy, toast, t]);

  if (!open) return null;

  const expiryOptions = EXPIRY_DAYS.map((d) => ({
    value: String(d),
    label: t('expiryDays', { days: d }),
  }));

  return (
    <Modal open={open} onClose={onClose} size="sm" labelledBy="share-invite-title">
      <div className="flex flex-col gap-4 p-6">
        <div>
          <h2
            id="share-invite-title"
            className="text-lg font-semibold tracking-[-0.01em] text-ink-2"
          >
            {t('title')}
          </h2>
          {/* 정책 고지 — 공개 아님, 초대된 이메일만 · 언제든 폐기 가능. */}
          <p className="mt-1 text-sm text-mute">{t('notice')}</p>
        </div>

        {loading ? (
          <p className="py-6 text-center text-sm text-mute-soft">
            {t('loading')}
          </p>
        ) : share ? (
          // ── 관리 모드 — 링크 존재 ──
          <>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-mute-soft">
                {t('linkLabel')}
              </span>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-xs border border-line-soft bg-paper px-3 py-2 text-sm text-ink">
                  {viewerUrl(locale, share.token)}
                </code>
                <ChromeButton size="sm" onClick={() => void copyLink()}>
                  {t('copy')}
                </ChromeButton>
              </div>
              {share.expires_at ? (
                <span className="text-xs text-mute-soft">
                  {t('expiresOn', {
                    date: new Date(share.expires_at).toLocaleDateString(),
                  })}
                </span>
              ) : null}
            </div>

            <EmailChips
              emails={share.invited_emails}
              onAdd={(e) => void addInvite(e)}
              onRemove={(e) => void removeInvite(e)}
              disabled={busy}
            />
          </>
        ) : (
          // ── 생성 모드 — 링크 없음 ──
          <>
            <EmailChips
              emails={draftEmails}
              onAdd={(e) =>
                setDraftEmails((prev) =>
                  prev.some((x) => x === e) ? prev : [...prev, e],
                )
              }
              onRemove={(e) =>
                setDraftEmails((prev) => prev.filter((x) => x !== e))
              }
              disabled={busy}
            />
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-mute-soft">
                {t('expiryLabel')}
              </span>
              <div className="w-[160px]">
                <SelectMenu
                  value={String(expiryDay)}
                  onChange={(v) => setExpiryDay(Number(v))}
                  options={expiryOptions}
                  aria-label={t('expiryLabel')}
                />
              </div>
            </div>
          </>
        )}
      </div>

      {!loading ? (
        <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-line-soft px-6 py-3">
          {share ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void revokeLink()}
              disabled={busy}
              title={t('revokeHint')}
            >
              {t('revoke')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t('done')}
            </Button>
            {!share ? (
              <Button
                variant="primary"
                size="sm"
                onClick={() => void createLink()}
                loading={busy}
                loadingLabel={t('creating')}
              >
                {t('create')}
              </Button>
            ) : null}
          </div>
        </footer>
      ) : null}
    </Modal>
  );
}

// 이메일 chip 편집기 — project-tag-editor.tsx 의 chip 컨테이너 규격 재사용
// (border-2 border-ink frame + focus-within:border-amore + amore pill chip +
// ChipInput extender). 이메일 형식 선제 검증 + 대소문자 무시 중복 제거.
function EmailChips({
  emails,
  onAdd,
  onRemove,
  disabled,
}: {
  emails: string[];
  onAdd: (email: string) => void;
  onRemove: (email: string) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('Share');
  const toast = useToast();
  const [draft, setDraft] = useState('');

  const commit = (raw: string) => {
    const value = normEmail(raw);
    setDraft('');
    if (!value) return;
    if (!EMAIL_RE.test(value)) {
      toast.push(t('invalidEmail'), { tone: 'warn' });
      return;
    }
    if (emails.some((e) => normEmail(e) === value)) return;
    onAdd(value);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit(draft);
    } else if (e.key === 'Backspace' && !draft && emails.length) {
      onRemove(emails[emails.length - 1]);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-mute-soft">
        {t('invitesLabel')}
      </span>
      <div className="flex flex-wrap items-center gap-1.5 rounded-xs border-2 border-ink bg-paper px-2.5 py-1.5 focus-within:border-amore">
        {emails.map((email) => (
          <span
            key={email}
            className="inline-flex items-center gap-1 rounded-pill border border-amore bg-paper px-2.5 py-0.5 text-xs text-amore"
          >
            {email}
            <IconButton
              variant="ghost-brand"
              size="compact"
              onClick={() => onRemove(email)}
              disabled={disabled}
              aria-label={t('removeInvite', { email })}
            >
              <span aria-hidden>×</span>
            </IconButton>
          </span>
        ))}
        <ChipInput
          type="email"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (draft.trim()) commit(draft);
          }}
          disabled={disabled}
          placeholder={emails.length === 0 ? t('invitesPlaceholder') : ''}
          className="min-w-[140px] flex-1 text-xs"
        />
      </div>
      <span className="text-xs text-mute-soft">{t('invitesHint')}</span>
    </div>
  );
}
