import { setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/org';
import { getOrgCredits } from '@/lib/credits';
import { Sidebar } from '@/components/sidebar';
import { Topbar } from '@/components/topbar';

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
  const credits = org ? await getOrgCredits(org.org_id) : null;

  return (
    <div className="flex flex-1">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <Topbar
          credits={credits}
          userEmail={user?.email ?? null}
          isAuthed={!!user}
        />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
