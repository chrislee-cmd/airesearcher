'use client';

import { createClient } from '@/lib/supabase/client';
import { useState } from 'react';

export function GoogleSignInButton({ label }: { label: string }) {
  const [loading, setLoading] = useState(false);

  async function signIn() {
    setLoading(true);
    const supabase = createClient();
    const origin =
      process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin;
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(
          window.location.pathname.replace(/\/login$/, '/dashboard'),
        )}`,
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    });
  }

  return (
    <button
      onClick={signIn}
      disabled={loading}
      className="flex w-full items-center justify-center gap-3 rounded-lg border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium text-neutral-800 shadow-sm transition hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700"
    >
      <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden>
        <path fill="#EA4335" d="M12 11.4v3.3h4.7c-.2 1.2-1.5 3.5-4.7 3.5-2.8 0-5.1-2.3-5.1-5.2s2.3-5.2 5.1-5.2c1.6 0 2.7.7 3.3 1.3l2.3-2.2C16.1 5.5 14.3 4.6 12 4.6 7.9 4.6 4.6 7.9 4.6 12s3.3 7.4 7.4 7.4c4.3 0 7.1-3 7.1-7.2 0-.5 0-.8-.1-1.2H12z" />
      </svg>
      {loading ? '...' : label}
    </button>
  );
}
