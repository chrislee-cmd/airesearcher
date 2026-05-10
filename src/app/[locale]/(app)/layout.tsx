import { setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { isSuperAdminEmail } from '@/lib/admin/superadmin';
import { getActiveOrg, getOrgFlags } from '@/lib/org';
import { getOrgCredits } from '@/lib/credits';
import { listProjects } from '@/lib/projects';
import { Sidebar } from '@/components/sidebar';
import { InterviewJobProvider } from '@/components/interview-job-provider';
import { TranscriptJobProvider } from '@/components/transcript-job-provider';
import { DeskJobProvider } from '@/components/desk-job-provider';
import { WorkspaceProvider } from '@/components/workspace-provider';
import { WorkspacePanel } from '@/components/workspace-panel';
import { WorkspaceBridge } from '@/components/workspace-bridge';
import { GenerationJobProvider } from '@/components/generation-job-provider';
import { ActiveProjectProvider } from '@/components/active-project-provider';
import { PaywallProvider } from '@/components/paywall-provider';
import { ToastProvider } from '@/components/toast-provider';
import { TrialInitializer } from '@/components/trial-initializer';

export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const org = user ? await getActiveOrg() : null;
  // Once we have org, the three follow-up reads are independent — fan
  // them out so the slowest one bounds total latency, not their sum.
  // (Each is also cache()d so duplicate reads from page.tsx in the same
  // request hit memory instead of Supabase.)
  const [credits, projects, flags] = org
    ? await Promise.all([
        getOrgCredits(org.org_id),
        listProjects(org.org_id),
        getOrgFlags(org.org_id),
      ])
    : [null, [] as Awaited<ReturnType<typeof listProjects>>, { isUnlimited: false }];

  return (
    <PaywallProvider>
     <ToastProvider>
     <InterviewJobProvider>
      <TranscriptJobProvider>
       <DeskJobProvider>
        <GenerationJobProvider>
         <ActiveProjectProvider projects={projects.map((p) => ({ id: p.id, name: p.name }))}>
         <WorkspaceProvider>
         <div className="flex flex-1">
           <Sidebar
             projects={projects.map((p) => ({ id: p.id, name: p.name }))}
             email={user?.email ?? null}
             credits={credits}
             isAuthed={!!user}
             showPreviewFeatures={flags.isUnlimited}
             isSuperAdmin={isSuperAdminEmail(user?.email)}
           />
           <main className="flex-1 overflow-auto p-6">{children}</main>
         </div>
         <WorkspaceBridge />
         <WorkspacePanel />
         <TrialInitializer enabled={!!user} />
         </WorkspaceProvider>
         </ActiveProjectProvider>
        </GenerationJobProvider>
       </DeskJobProvider>
      </TranscriptJobProvider>
     </InterviewJobProvider>
     </ToastProvider>
    </PaywallProvider>
  );
}
