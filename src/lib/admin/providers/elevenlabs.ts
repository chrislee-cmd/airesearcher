import type { ProviderUsage } from '../types';

// ElevenLabs subscription endpoint returns the character quota used vs
// available, plus the next reset timestamp. There's no $ cost API on
// the regular key — pricing is plan-based — so we surface the remaining
// character quota as `balanceLabel`.
//
// Docs: https://elevenlabs.io/docs/api-reference/user/get-subscription
const SUBSCRIPTION_URL = 'https://api.elevenlabs.io/v1/user/subscription';

export async function getElevenLabsUsage(): Promise<ProviderUsage> {
  const present = !!process.env.ELEVENLABS_API_KEY;
  const envKeys = [{ key: 'ELEVENLABS_API_KEY', present }];
  const dashboardUrl = 'https://elevenlabs.io/app/usage';

  if (!present) {
    return {
      id: 'elevenlabs',
      name: 'ElevenLabs',
      status: 'unconfigured',
      dashboardUrl,
      envKeys,
    };
  }

  try {
    const res = await fetch(SUBSCRIPTION_URL, {
      headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY! },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as {
      tier?: string;
      character_count?: number;
      character_limit?: number;
      next_character_count_reset_unix?: number;
    };
    const used = json.character_count ?? 0;
    const limit = json.character_limit ?? 0;
    const remaining = Math.max(0, limit - used);
    return {
      id: 'elevenlabs',
      name: 'ElevenLabs',
      status: 'ok',
      periodLabel: json.next_character_count_reset_unix
        ? `리셋 예정: ${new Date(json.next_character_count_reset_unix * 1000)
            .toISOString()
            .slice(0, 10)}`
        : '현재 결제 주기',
      metrics: [
        { label: '플랜', value: json.tier ?? '—' },
        { label: '사용 문자', value: used.toLocaleString('ko-KR') },
        { label: '한도', value: limit.toLocaleString('ko-KR') },
      ],
      balanceLabel: `${remaining.toLocaleString('ko-KR')}자 남음`,
      dashboardUrl,
      envKeys,
    };
  } catch (e) {
    return {
      id: 'elevenlabs',
      name: 'ElevenLabs',
      status: 'error',
      error: e instanceof Error ? e.message : String(e),
      dashboardUrl,
      envKeys,
    };
  }
}
