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
import { WorkspacePanel } from '@/components/workspace-panel';
import { GenerationJobProvider } from '@/components/generation-job-provider';
import { ActiveProjectProvider } from '@/components/active-project-provider';
import { VideoJobProvider } from '@/components/video-job-provider';
import { PaywallProvider } from '@/components/paywall-provider';
import { ToastProvider } from '@/components/toast-provider';
import { TrialInitializer } from '@/components/trial-initializer';

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

  const org = user ? await getActiveOrg() : null;
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
    <PaywallProvider>
     <ToastProvider>
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
             <main className="flex-1 overflow-auto p-6">{children}</main>
             <WorkspacePanel />
           </div>
         </div>

         <TrialInitializer enabled={!!user} />
         </WorkspaceProvider>
         </ActiveProjectProvider>
        </GenerationJobProvider>
       </DeskJobProvider>
      </TranscriptJobProvider>
     </InterviewJobProvider>
     </VideoJobProvider>
     </ToastProvider>
    </PaywallProvider>
  );
}
