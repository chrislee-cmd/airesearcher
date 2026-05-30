import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { TranslateViewer } from '@/components/translate-viewer';

// Public live-interpretation viewer. The host generates a share link in
// the console (POST /api/translate/sessions/:id/share) and any anon
// visitor with the URL can land here without auth.
//
// We resolve the token server-side once so the page can render the
// correct lang pair / status, then hand off to a client component that
// owns the LiveKit + Supabase broadcast subscription.

type Meta = {
  id: string;
  source_lang: string;
  target_lang: string;
  status: 'idle' | 'live' | 'ended';
  livekit_room: string;
  record_enabled: boolean;
  started_at: string | null;
  expires_at: string | null;
};

async function loadMeta(token: string): Promise<Meta | null> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('get_translate_session_by_token', {
    p_token: token,
  });
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return row ? (row as Meta) : null;
}

export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!token || token.length < 16 || token.length > 32) notFound();
  const meta = await loadMeta(token);
  if (!meta) notFound();

  return (
    <main className="mx-auto w-full max-w-[1120px] flex-1 px-4 pb-12 pt-8">
      <TranslateViewer
        token={token}
        sessionId={meta.id}
        sourceLang={meta.source_lang}
        targetLang={meta.target_lang}
        initialStatus={meta.status}
        recordEnabled={meta.record_enabled}
      />
    </main>
  );
}
