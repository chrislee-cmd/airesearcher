'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import {
  ShareInviteModal,
  type ShareResourceType,
} from '@/components/share/share-invite-modal';
import type { ShareLinkItem, ShareScope, ShareStatus, ShareTone } from './types';
import { ShareDashboardRow } from './share-dashboard-row';
import { ShareStatusSegment, type StatusFilter } from './share-status-segment';
import { ShareIssuerFilter, type IssuerOption } from './share-issuer-filter';
import {
  ShareDashboardEmpty,
  ShareDashboardFilteredEmpty,
  ShareDashboardSkeleton,
} from './share-dashboard-states';
import { RevokeShareModal } from './revoke-share-modal';

// 컨테이너 배선(로직 재사용) — /api/share/mine(snake_case) 소비 → camelCase
// ShareLinkItem 어댑터 → dumb 프레젠테이션 조립. scope 는 부모(LibrarySurface)가
// 헤더 토글로 소유하고, 여기서는 canViewOrgScope 를 onMeta 로 되돌린다(토글
// 렌더 여부는 부모가 결정). 철회 = POST /api/share/[id]/revoke, 초대 편집 =
// 기존 ShareInviteModal.

const VALID_TONES: ShareTone[] = ['rose', 'sky', 'lav', 'peach', 'aqua', 'sun'];

type WireIssuer = { name: string | null; isMine: boolean };
type WireShare = {
  id: string;
  token: string;
  url: string;
  resource_type: string;
  resource_id: string;
  resource_title: string | null;
  resource_label: string;
  tone: string;
  status: ShareStatus;
  invited_emails: string[];
  view_count: number | null;
  last_viewed_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  issuer: WireIssuer;
};

function adapt(w: WireShare): ShareLinkItem {
  return {
    id: w.id,
    token: w.token,
    url: w.url,
    resourceType: w.resource_type,
    resourceId: w.resource_id,
    resourceTitle: w.resource_title,
    resourceLabel: w.resource_label,
    tone: (VALID_TONES.includes(w.tone as ShareTone) ? w.tone : 'lav') as ShareTone,
    status: w.status,
    invitedEmails: w.invited_emails ?? [],
    // API 가 view_count ?? 0 로 coalesce 하므로 현재는 항상 number("—" 미집계
    // 분기는 방어적). 계약 변경 없이 프레젠테이션은 null 도 지원한다(§0.3).
    viewCount: w.view_count,
    lastViewedAt: w.last_viewed_at,
    expiresAt: w.expires_at,
    revokedAt: w.revoked_at,
    createdAt: w.created_at,
    issuer: { name: w.issuer?.name ?? null, isMine: Boolean(w.issuer?.isMine) },
  };
}

export function ShareDashboardContainer({
  scope,
  onMeta,
  onOpenArtifacts,
}: {
  scope: ShareScope;
  // canViewOrgScope 를 부모로 되돌림(헤더 스코프 토글 렌더 여부 결정).
  onMeta: (canViewOrgScope: boolean) => void;
  // 빈 상태(4a) CTA — 산출물 탭으로 전환.
  onOpenArtifacts: () => void;
}) {
  const t = useTranslations('ShareDashboard');
  const locale = useLocale();

  const [items, setItems] = useState<ShareLinkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [nowMs] = useState(() => Date.now());

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [q, setQ] = useState('');
  const [issuerSel, setIssuerSel] = useState<string | null>(null);

  const [revokeItem, setRevokeItem] = useState<ShareLinkItem | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [inviteItem, setInviteItem] = useState<ShareLinkItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/share/mine?locale=${locale}`, { cache: 'no-store' });
      const json = (await res.json().catch(() => null)) as
        | { shares?: WireShare[]; canViewOrgScope?: boolean }
        | null;
      if (!res.ok || !json) {
        setError(true);
        return;
      }
      setItems((json.shares ?? []).map(adapt));
      onMeta(Boolean(json.canViewOrgScope));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [locale, onMeta]);

  useEffect(() => {
    // 마운트/refetch 시 목록 로드. load() 가 setLoading(true) 를 동기 호출하지만
    // 이건 외부 시스템(API) 동기화용 fetch 라 의도된 패턴(share-invite-modal 선례).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount/refetch
    void load();
  }, [load]);

  // 스코프 축(§0.5) — org 스코프에서만 발급자 필터/아바타가 산다.
  const orgScopeView = scope === 'org';

  // 스코프 베이스(스코프만) — 4a(빈 상태) vs 4c(필터 빈 결과) 판정용.
  const scopeBase = useMemo(
    () => (orgScopeView ? items : items.filter((i) => i.issuer.isMine)),
    [items, orgScopeView],
  );

  // 발급자 facet(org 전용) — distinct 이름(내 것 우선).
  const issuers = useMemo<IssuerOption[]>(() => {
    if (!orgScopeView) return [];
    const seen = new Map<string, IssuerOption>();
    for (const it of scopeBase) {
      const name = it.issuer.name;
      if (!name || seen.has(name)) continue;
      seen.set(name, { name, isMine: it.issuer.isMine });
    }
    return [...seen.values()].sort((a, b) => Number(b.isMine) - Number(a.isMine));
  }, [scopeBase, orgScopeView]);

  // 검색 + 발급자 필터(상태는 별도) → 세그먼트 카운트의 모집단.
  const facetPool = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return scopeBase.filter((it) => {
      // 발급자 필터는 org 스코프에서만 유효(내 링크 스코프에선 UI 미렌더 →
      // 잔여 선택값 무시).
      if (orgScopeView && issuerSel && it.issuer.name !== issuerSel) return false;
      if (!needle) return true;
      const hay = [
        it.resourceTitle ?? '',
        it.resourceLabel,
        ...it.invitedEmails,
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [scopeBase, q, issuerSel, orgScopeView]);

  const counts = useMemo(
    () => ({
      alive: facetPool.filter((i) => i.status === 'active').length,
      expired: facetPool.filter((i) => i.status === 'expired').length,
      revoked: facetPool.filter((i) => i.status === 'revoked').length,
      all: facetPool.length,
    }),
    [facetPool],
  );

  const displayed = useMemo(
    () =>
      statusFilter === 'all'
        ? facetPool
        : facetPool.filter((i) => i.status === statusFilter),
    [facetPool, statusFilter],
  );

  const onCopy = useCallback(
    (item: ShareLinkItem) => async () => {
      try {
        await navigator.clipboard.writeText(item.url);
        return true;
      } catch {
        return false;
      }
    },
    [],
  );

  const confirmRevoke = useCallback(async () => {
    if (!revokeItem || revokeBusy) return;
    setRevokeBusy(true);
    try {
      const res = await fetch(`/api/share/${revokeItem.id}/revoke`, { method: 'POST' });
      if (!res.ok) throw new Error('revoke_failed');
      setRevokeItem(null);
      await load();
    } catch {
      // 실패 시 모달 유지(사용자가 재시도). 별도 토스트 없음 — 이 표면은 행/모달
      // 안에서 피드백한다.
    } finally {
      setRevokeBusy(false);
    }
  }, [revokeItem, revokeBusy, load]);

  const hasIssuerFilter = orgScopeView && issuers.length > 0;

  // ── 목록 본문 ──────────────────────────────────────────────────────────
  let body: React.ReactNode;
  if (loading) {
    body = <ShareDashboardSkeleton />;
  } else if (error) {
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
        <p className="text-md text-mute">{t('error.body')}</p>
        <span
          role="button"
          tabIndex={0}
          onClick={() => void load()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              void load();
            }
          }}
          className="inline-flex cursor-pointer items-center rounded-pill border-[1.5px] border-ink bg-paper px-4 py-2 text-md font-bold text-ink shadow-memphis-sm-faint"
        >
          {t('error.retry')}
        </span>
      </div>
    );
  } else if (scopeBase.length === 0) {
    body = (
      <ShareDashboardEmpty
        variant={orgScopeView ? 'org' : 'default'}
        onOpenArtifacts={onOpenArtifacts}
      />
    );
  } else if (displayed.length === 0) {
    body = (
      <ShareDashboardFilteredEmpty
        total={scopeBase.length}
        onClear={() => {
          setStatusFilter('all');
          setQ('');
          setIssuerSel(null);
        }}
      />
    );
  } else {
    body = displayed.map((item) => (
      <ShareDashboardRow
        key={item.id}
        item={item}
        showIssuer={orgScopeView}
        viewsEnabled
        nowMs={nowMs}
        onCopy={onCopy(item)}
        onInviteEdit={() => setInviteItem(item)}
        onRevoke={() => setRevokeItem(item)}
      />
    ));
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {/* 툴바 — 섹션 제목 + 카운트 + 상태 세그먼트 + 발급자 필터(org) + 검색 + 정렬. */}
      <div className="flex shrink-0 items-center gap-3 border-b-2 border-ink bg-paper px-6 py-[13px]">
        <div className="flex shrink-0 items-baseline gap-2.5">
          <span className="text-3xl font-extrabold tracking-tight text-ink" style={OUTFIT}>
            {t('section.title')}
          </span>
          <span className="font-mono-label text-md font-bold text-mute-soft">
            {loading ? '' : scopeBase.length}
          </span>
        </div>

        <ShareStatusSegment
          value={statusFilter}
          counts={counts}
          loading={loading}
          onChange={setStatusFilter}
          labels={{
            active: t('status.alive'),
            expired: t('status.expired'),
            revoked: t('status.revoked'),
            all: t('status.all'),
          }}
        />

        {hasIssuerFilter && (
          <ShareIssuerFilter
            issuers={issuers}
            selected={issuerSel}
            onSelect={setIssuerSel}
            allLabel={t('issuerFilter.all')}
            meLabel={t('meta.mine')}
          />
        )}

        <div
          className={`flex flex-1 items-center gap-2.5 rounded-field border-[1.5px] border-ink bg-paper px-4 py-2 ${
            hasIssuerFilter ? 'max-w-[280px]' : 'max-w-[320px]'
          }`}
        >
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={hasIssuerFilter ? t('searchPlaceholderShort') : t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
            className="!rounded-none !border-0 !bg-transparent !px-0 !py-0 !text-md focus-visible:!border-transparent"
          />
        </div>

        <div className="flex-1" />

        {/* 정렬 — v1 은 최신 발급순 단일(표시 전용). */}
        <span className="inline-flex shrink-0 items-stretch overflow-hidden rounded-control border-[1.5px] border-ink bg-paper shadow-memphis-sm">
          <span className="flex items-center px-[13px] py-2 text-md font-bold text-ink">
            {t('sort.recent')}
          </span>
          <span className="w-[1.5px] bg-ink" />
          <span className="flex items-center px-[11px] text-xs text-ink" aria-hidden>
            ▼
          </span>
        </span>
      </div>

      {/* 열 헤더. */}
      {!loading && !error && scopeBase.length > 0 && displayed.length > 0 && (
        <div className="flex shrink-0 items-center gap-[11px] border-b border-line bg-paper px-6 py-2.5">
          <span className="flex-1 font-mono-label text-xs font-bold uppercase tracking-[0.08em] text-mute-soft">
            {t('col.deliverable')}
          </span>
          <span className="w-[210px] font-mono-label text-xs font-bold uppercase tracking-[0.08em] text-mute-soft">
            {t('col.invited')}
          </span>
          <span className="w-[126px] font-mono-label text-xs font-bold uppercase tracking-[0.08em] text-mute-soft">
            {t('col.views')}
          </span>
          <span className="w-[150px] font-mono-label text-xs font-bold uppercase tracking-[0.08em] text-mute-soft">
            {t('col.expiry')}
          </span>
          <span className="w-[108px] font-mono-label text-xs font-bold uppercase tracking-[0.08em] text-mute-soft">
            {t('col.status')}
          </span>
          <span className="w-[212px] text-right font-mono-label text-xs font-bold uppercase tracking-[0.08em] text-mute-soft">
            {t('col.actions')}
          </span>
        </div>
      )}

      {/* 목록. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{body}</div>

      {/* 푸터. */}
      <div className="shrink-0 border-t border-line bg-paper-soft px-6 py-2.5 font-mono-label text-sm text-mute-soft">
        {loading
          ? ''
          : t('footer.summary', { shown: displayed.length, total: scopeBase.length })}
      </div>

      {/* 철회 확인 모달. */}
      {revokeItem && (
        <RevokeShareModal
          item={revokeItem}
          busy={revokeBusy}
          onCancel={() => {
            if (!revokeBusy) setRevokeItem(null);
          }}
          onConfirm={() => void confirmRevoke()}
        />
      )}

      {/* 초대 편집 — 기존 ShareInviteModal 재사용(재디자인 금지). 닫힐 때 refetch. */}
      {inviteItem && (
        <ShareInviteModal
          open
          onClose={() => {
            setInviteItem(null);
            void load();
          }}
          resourceType={inviteItem.resourceType as ShareResourceType}
          resourceId={inviteItem.resourceId}
        />
      )}
    </div>
  );
}

const OUTFIT = { fontFamily: 'var(--font-outfit), var(--font-sans)' } as const;
