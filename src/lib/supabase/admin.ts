import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client for server-only contexts (webhooks, jobs)
 * that run without a user session and must bypass RLS to update rows.
 * Never import this from client components.
 */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
