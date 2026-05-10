import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Skip the Supabase session refresh on internals + API routes.
  // API handlers each call supabase.auth.getUser() themselves and don't
  // need the proxy to mutate cookies — paying for it on every poll
  // (transcripts/jobs, desk/jobs, credits/status, etc.) added a
  // measurable RTT to navigation. /auth/callback stays in the matcher
  // so OAuth redirects still get cookies set.
  matcher: [
    '/((?!api/|_next/static|_next/image|_next/data|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
