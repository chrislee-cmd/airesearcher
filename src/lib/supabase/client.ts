import { createBrowserClient } from '@supabase/ssr';
import { env } from '@/env';

// `@supabase/ssr` ships its own browser singleton in `createBrowserClient`,
// but the cache lives at module scope inside the library. If the bundler
// loads two copies of `@supabase/ssr` (separate server/client chunks,
// pnpm hoisting quirks), each copy has its own cache and we end up with
// multiple browser clients all listening on the same
// `lock:sb-<ref>-auth-token` Web Lock. The lock then isn't released within
// 5s, GoTrue logs "Forcefully acquiring the lock to recover", the in-flight
// token refresh fails to persist, and every subsequent API request lands
// without `sb-...-auth-token` cookies — 401 across the app.
//
// Wrapping the factory in our OWN module-scoped singleton guarantees a
// single client instance per browser regardless of the library's caching.
function buildClient() {
  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

let cached: ReturnType<typeof buildClient> | null = null;

export function createClient() {
  if (!cached) cached = buildClient();
  return cached;
}
