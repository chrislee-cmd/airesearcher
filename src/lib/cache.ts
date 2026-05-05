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
    .select('value, hits')
    .eq('key', key)
    .maybeSingle();
  if (!data) return null;
  // Fire-and-forget hit counter — the previous version wrote `undefined`,
  // which the JS client dropped silently, so the column never advanced.
  void admin
    .from('cache_entries')
    .update({
      hits: ((data.hits as number | null) ?? 0) + 1,
      last_hit_at: new Date().toISOString(),
    })
    .eq('key', key)
    .then(() => {});
  return data.value as T;
}

/**
 * Look up many keys at once. Returns a map keyed by `key` containing only the
 * hits — callers compute the misses by diffing. Used for batch operations
 * (e.g. embeddings) where hitting `cache_entries` once per item is wasteful.
 */
export async function getCacheMany<T>(
  keys: string[],
): Promise<Map<string, T>> {
  const out = new Map<string, T>();
  if (keys.length === 0) return out;
  const admin = createAdminClient();
  const { data } = await admin
    .from('cache_entries')
    .select('key, value')
    .in('key', keys);
  for (const row of data ?? []) {
    out.set(row.key as string, row.value as T);
  }
  return out;
}

/** Batch upsert. Best-effort — failures are swallowed. */
export async function setCacheMany<T>(
  entries: { key: string; value: T }[],
): Promise<void> {
  if (entries.length === 0) return;
  const admin = createAdminClient();
  await admin
    .from('cache_entries')
    .upsert(
      entries.map(({ key, value }) => ({ key, value: value as unknown as object })),
      { onConflict: 'key' },
    );
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
