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
    // Memphis observer frame is self-contained (CD `.dc.html`): a centered
    // ~600px column on the dotted canvas ground, filling the viewport height.
    // The dotted radial ground mirrors the CD comp background.
    // `min-h-0`: as a flex child of the `h-full` body column, main must be
    // allowed to shrink below its content — otherwise flex's default
    // `min-height:auto` lets accumulating captions/screen grow main past the
    // viewport (heights creep up over a session). Clamped here, the viewer's
    // inner `overflow-y-auto` panels absorb the overflow at a fixed frame size.
    <main className="flex min-h-0 flex-1 justify-center bg-surface-canvas px-4 py-6 [background-image:radial-gradient(var(--color-line-empty)_1.1px,transparent_1.1px)] [background-size:22px_22px]">
      <TranslateViewer
        token={token}
        sessionId={meta.id}
        sourceLang={meta.source_lang}
        targetLang={meta.target_lang}
        initialStatus={meta.status}
        startedAt={meta.started_at}
        recordEnabled={meta.record_enabled}
      />
    </main>
  );
}
