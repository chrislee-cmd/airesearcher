import { cache } from 'react';
import { createClient } from './server';

// React cache() dedupes within a single RSC request lifecycle, so a
// layout + page combo that both need the user only pays one
// supabase.auth.getUser() round-trip. The proxy (src/proxy.ts) still
// runs its own getUser() to refresh cookies — that's a separate request
// and not deduplicable from here.
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
});
