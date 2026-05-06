import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveOrg } from '@/lib/org';

export const maxDuration = 30;

const Body = z.object({
  // Cross-browser-stable signals collected client-side. The server combines
  // them with the public IP (which the browser can't see) to produce the
  // final hash, so a client can't preimage-attack the policy.
  screen: z.string().max(40),     // e.g. "1920x1080@2"
  tz: z.string().max(80),         // IANA, e.g. "Asia/Seoul"
  os: z.string().max(40),         // platform string, e.g. "macOS"
  cores: z.number().int().min(0).max(256),
  colorDepth: z.number().int().min(0).max(96),
});

function publicIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  const real = req.headers.get('x-real-ip');
  return real ?? null;
}

function ip24(ip: string | null): string | null {
  if (!ip) return null;
  // IPv4: take the /24 prefix. IPv6: take the /48 prefix as a rough analogue.
  if (ip.includes('.')) {
    const parts = ip.split('.');
    if (parts.length !== 4) return null;
    return parts.slice(0, 3).join('.');
  }
  if (ip.includes(':')) {
    const parts = ip.split(':');
    return parts.slice(0, 3).join(':');
  }
  return null;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const org = await getActiveOrg();
  if (!org) return NextResponse.json({ error: 'no_organization' }, { status: 403 });

  const parsed = Body.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const sig = parsed.data;
  const ip = publicIp(request);
  const prefix = ip24(ip);

  // Hash blends client signals + IP so the resulting fingerprint can't be
  // forged from the client alone. Truncated to 16 hex chars (64 bits) — more
  // than enough for collision-avoidance at our scale, way too short to brute
  // force.
  const hash = createHash('sha256')
    .update(
      [ip ?? '', sig.screen, sig.tz, sig.os, sig.cores, sig.colorDepth].join('|'),
    )
    .digest('hex')
    .slice(0, 16);

  // Skip if this org's fingerprint is already recorded — the policy already
  // ran on its first POST and we don't want to thrash trial_ends_at on
  // every page load.
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from('trial_fingerprints')
    .select('first_org_id')
    .eq('hash', hash)
    .maybeSingle();
  if (existing?.first_org_id === org.org_id) {
    const { data: orgRow } = await admin
      .from('organizations')
      .select('trial_ends_at, is_unlimited')
      .eq('id', org.org_id)
      .single();
    return NextResponse.json({
      trialEndsAt: orgRow?.trial_ends_at ?? null,
      isUnlimited: Boolean(orgRow?.is_unlimited),
      applied: false,
    });
  }

  const { data, error } = await admin.rpc('apply_trial_policy', {
    p_org_id: org.org_id,
    p_hash: hash,
    p_ip: ip,
    p_ip_24: prefix,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ trialEndsAt: data ?? null, applied: true });
}
