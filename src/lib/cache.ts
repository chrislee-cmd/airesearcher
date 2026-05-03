import { createHash } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';

export function hashBytes(buf: ArrayBuffer | Buffer | Uint8Array): string {
  const bytes =
    buf instanceof ArrayBuffer
      ? Buffer.from(buf)
      : buf instanceof Uint8Array
      ? Buffer.from(buf)
      : buf;
  return createHash('sha256').update(bytes).digest('hex');
}

export function hashString(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

export async function getCache<T>(key: string): Promise<T | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('cache_entries')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (!data) return null;
  // Best-effort hit counter (don't await failures).
  void admin
    .from('cache_entries')
    .update({ hits: undefined as unknown as number, last_hit_at: new Date().toISOString() })
    .eq('key', key)
    .then(() => {});
  return data.value as T;
}

export async function setCache<T>(key: string, value: T): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from('cache_entries')
    .upsert({ key, value: value as unknown as object }, { onConflict: 'key' });
}

/** Wrap an expensive function with a content-addressed cache. */
export async function withCache<T>(
  key: string,
  compute: () => Promise<T>,
): Promise<{ value: T; hit: boolean }> {
  const cached = await getCache<T>(key);
  if (cached !== null) return { value: cached, hit: true };
  const value = await compute();
  await setCache(key, value);
  return { value, hit: false };
}
