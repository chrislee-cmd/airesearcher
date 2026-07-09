import { redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { Outfit } from 'next/font/google';
import { getCurrentUser } from '@/lib/supabase/user';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';
import { getActiveOrg } from '@/lib/org';
import { getOrgCredits } from '@/lib/credits';
import { listProjects } from '@/lib/projects';
import { Topbar } from '@/components/topbar';
import { InterviewJobProvider } from '@/components/interview-job-provider';
import { TranscriptJobProvider } from '@/components/transcript-job-provider';
import { DeskJobProvider } from '@/components/desk-job-provider';
import { WorkspaceProvider } from '@/components/workspace-provider';
import { GenerationJobProvider } from '@/components/generation-job-provider';
import { CreditDeductionProvider } from '@/components/credit-deduction-provider';
import { ActiveProjectProvider } from '@/components/active-project-provider';
import { VideoJobProvider } from '@/components/video-job-provider';
import { PaywallProvider } from '@/components/paywall-provider';
import { ToastProvider } from '@/components/toast-provider';
import { TrialInitializer } from '@/components/trial-initializer';
import { AuthStateListener } from '@/components/auth-state-listener';
import { SessionExpiredModal } from '@/components/auth/session-expired-modal';
import { ConcurrencyGateProvider } from '@/components/concurrency-gate-provider';

// Outfit display 폰트 — PR-D5 (shell pop) 에서 사이드바 로고 / 그룹
// 헤딩 / topbar 로고가 사용. canvas/layout.tsx 도 같은 변수명을 정의
// 하므로 canvas 라우트는 자체 layout 가 덮어쓰고 다른 라우트는 이
// 정의가 살아남는다.
const outfit = Outfit({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-outfit',
  display: 'swap',
});

export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const user = await getCurrentUser();

  // Layer 1 (SSR gate): every route in the (app) group requires auth. On a
  // fresh load / RSC render with no session — including the "ghost session"
  // case where the client still shows the app after a sign-out — send the
  // user to /login instead of rendering a dead app shell. Public routes
  // (landing, pricing, privacy, ...) live outside this group and are
  // unaffected. The client-side <AuthStateListener /> below covers live
  // session loss without a reload; the proxy adds a third pre-render gate.
  if (!user) {
    redirect(`/${locale}/login`);
  }

  const org = await getActiveOrg();
  // Once we have org, the follow-up reads are independent — fan them out
  // so the slowest one bounds total latency, not their sum. (Each is
  // also cache()d so duplicate reads from page.tsx in the same request
  // hit memory instead of Supabase.)
  const [credits, projects] = org
    ? await Promise.all([
        getOrgCredits(org.org_id),
        listProjects(org.org_id),
      ])
    : [null, [] as Awaited<ReturnType<typeof listProjects>>];

  return (
    // 동시접속 정원 게이트 (#505) — 앱 셸 전체를 감싸 cap 초과 시 대기실만
    // 렌더하고 앱 마운트를 보류. 정원 여유/에러 시 fail-open 으로 투명 통과.
    <ConcurrencyGateProvider>
    <PaywallProvider>
     <ToastProvider>
     <CreditDeductionProvider>
     <VideoJobProvider>
     <InterviewJobProvider>
      <TranscriptJobProvider>
       <DeskJobProvider>
        <GenerationJobProvider>
         <ActiveProjectProvider projects={projects.map((p) => ({ id: p.id, name: p.name }))}>
         <WorkspaceProvider>
         <div className={`${outfit.variable} flex flex-1 flex-col overflow-hidden`}>
           <Topbar
             userEmail={user?.email ?? null}
             credits={credits}
             isAuthed={!!user}
             isSuperAdmin={isSuperAdminEmail(user?.email)}
           />
           <div className="flex flex-1 overflow-hidden">
             {/* /canvas 와 loading fallback 모두 노랑 bg + 점 grid 가 topbar
                 바로 아래 edge-to-edge 로 깔려야 pop 톤이 유지된다. main 의 p-6
                 이 cream 패딩 잔재로 보이는 걸 막기 위해 has-[[data-canvas]] /
                 has-[[data-loading]] 일 때만 0 으로. 다른 라우트는 p-6 그대로. */}
             <main className="flex-1 overflow-auto p-6 has-[[data-canvas]]:p-0 has-[[data-loading]]:p-0">{children}</main>
           </div>
         </div>

         <TrialInitializer enabled={!!user} />
         {/* Layer 2 (live gate): redirect to /login the moment the session
             ends without a reload — sign-out here or in another tab. */}
         <AuthStateListener />
         {/* Silent server-side session expiry surfaces only as 401s (no
             auth event) — this modal catches the first one and forces a
             re-login. Complements AuthStateListener above. */}
         <SessionExpiredModal />
         </WorkspaceProvider>
         </ActiveProjectProvider>
        </GenerationJobProvider>
       </DeskJobProvider>
      </TranscriptJobProvider>
     </InterviewJobProvider>
     </VideoJobProvider>
     </CreditDeductionProvider>
     </ToastProvider>
    </PaywallProvider>
    </ConcurrencyGateProvider>
  );
}
