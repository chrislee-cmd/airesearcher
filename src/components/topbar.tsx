import { getTranslations } from 'next-intl/server';
import Image from 'next/image';
import { Link } from '@/i18n/navigation';
import { TopbarTabs } from './topbar-tabs';
import { TopbarAccount } from './topbar-account';
import { SignInButton } from './sign-in-button';
import { BackgroundJobPill } from './background-job-pill';
import { QaFeedbackCluster } from './qa/qa-feedback-cluster';
// 뷰 모드 토글 (캔버스 ⇄ 리스트) — 2026-07-27 사용자 요청으로 숨김. 복원 시 아래 import 주석 해제.
// import { ViewModeToggle } from './view-mode-toggle';
import { CollabShareButton } from './scheduling/collab-share';
import { getActiveOrg, getCurrentUserOrgs } from '@/lib/org';
import { getCollabShareData } from '@/lib/collab-share-data';

// PR-D7: 사이드바 → 헤더 탭 구조 전환. 노랑 banner + 검정 3px 하단 border
// + Outfit display logo. 좌측 로고 / 중앙 탭 row / 우측 user menu.
export async function Topbar({
  credits,
  userEmail,
  isAuthed,
  isSuperAdmin = false,
}: {
  credits: number | null;
  userEmail: string | null;
  isAuthed: boolean;
  isSuperAdmin?: boolean;
}) {
  const tBrand = await getTranslations('Brand');
  const tTabs = await getTranslations('Topbar.tabs');

  // Org members (invitees) get a scheduling entry in the account menu even
  // without super-admin, so they can find the shared workspace after accepting.
  const activeOrg = isAuthed ? await getActiveOrg() : null;
  const isOrgMember = !!activeOrg;

  // Full membership list + resolved active org feed the profile-menu org
  // switcher. Both are React-cache()d, so this adds no extra query when the
  // caller already resolved the active org above.
  const orgs = isAuthed ? await getCurrentUserOrgs() : [];

  // Global collaborator-share entry point (pr-canvas-collab-share-entry) — the
  // same invite modal as the recruiting-scheduling view, surfaced next to the
  // account menu (Google-Docs share position) so it's reachable from the main
  // canvas and every other (app) page. Returns null (button hidden) unless the
  // account is an org owner/admin — same gate as members/invite.
  const collab = isAuthed ? await getCollabShareData() : null;

  const tabs = [
    { key: 'canvas', href: '/canvas', label: tTabs('canvas') },
    // Projects·Members 탭 숨김 (2026-08-07 사용자 요청 — 당장 미사용).
    // 라우트(/projects·/members)·초대·collab 로직은 전부 보존 — 탭 진입점만
    // 감춰 딥링크·기존 링크는 그대로 동작. 초대는 우측 CollabShareButton 로도
    // 도달 가능. 복원하려면 아래 두 줄의 주석을 해제하면 된다.
    // { key: 'projects', href: '/projects', label: tTabs('projects') },
    // 통합 산출물 라이브러리 — 6기능 횡단 산출물 리스트(CD Surface A).
    { key: 'library', href: '/library', label: tTabs('library') },
    // { key: 'members', href: '/members', label: tTabs('members') },
  ];

  return (
    <header
      data-coachmark-id="topbar"
      className="flex h-14 shrink-0 items-center justify-between gap-6 px-8"
      style={{
        background: 'var(--sidebar-bg-strong)',
        borderBottom: 'var(--sidebar-border-width) solid var(--sidebar-border)',
      }}
    >
      <div className="flex shrink-0 items-center gap-4">
        <Link href="/" aria-label={tBrand('name')} className="flex shrink-0 items-center">
          {/* Primary horizontal lockup — dark wordmark reads cleanly on the
              yellow (--sidebar-bg-strong) banner; on-color card variants would
              float a badge inside the bar. `unoptimized` skips the image
              optimizer (SVG, no dangerouslyAllowSVG config) — the vector is
              served as-is. The asset's viewBox carries generous transparent
              padding (glyph is ~44% of the 1539×272 box), so we render at 40px
              inside the h-14 (56px) bar to keep the visible mark legible; width
              follows the viewBox ratio so it never distorts. */}
          <Image
            src="/branding/logos/01_PRIMARY_LOGO_HORIZONTAL.svg"
            alt={tBrand('name')}
            width={226}
            height={40}
            priority
            unoptimized
            style={{ height: 40, width: 'auto' }}
          />
        </Link>
        <BackgroundJobPill />
      </div>

      {isAuthed && <TopbarTabs tabs={tabs} />}

      <div className="flex shrink-0 items-center gap-3">
        {isAuthed ? (
          <>
            {/* 뷰 모드 토글 (캔버스 ⇄ 리스트) — 2026-07-27 사용자 요청으로 숨김.
                기능·컴포넌트는 보존(ViewModeToggle / ViewModeProvider / getViewMode).
                다시 제공하려면 위 import 와 아래 한 줄의 주석을 해제하면 된다. */}
            {/* <ViewModeToggle /> */}
            {/* QA feedback cluster (voice mic + text note + "피드백 남기기"
                label) — shown to every signed-in account. */}
            <QaFeedbackCluster />
            {collab ? (
              <CollabShareButton orgId={collab.orgId} members={collab.members} />
            ) : null}
            <TopbarAccount
              email={userEmail}
              credits={credits}
              isSuperAdmin={isSuperAdmin}
              isOrgMember={isOrgMember}
              orgs={orgs}
              activeOrgId={activeOrg?.org_id ?? null}
            />
          </>
        ) : (
          <SignInButton />
        )}
      </div>
    </header>
  );
}
