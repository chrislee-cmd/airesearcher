// LiveKit access token helpers for the simultaneous interpreter.
//
// Host tokens can publish + subscribe (they push both the original mic
// track and the OpenAI-translated TTS track into the room).
//
// Viewer tokens are subscribe-only — issued to anon users hitting the
// public share link.

import { AccessToken } from 'livekit-server-sdk';
import { env } from '@/env';

const DEFAULT_TTL_SECONDS = 4 * 3600;

function requireEnv(): { apiKey: string; apiSecret: string; url: string } {
  const apiKey = env.LIVEKIT_API_KEY;
  const apiSecret = env.LIVEKIT_API_SECRET;
  const url = env.LIVEKIT_URL;
  if (!apiKey || !apiSecret || !url) {
    throw new Error('missing_livekit_config');
  }
  return { apiKey, apiSecret, url };
}

export function livekitUrl(): string {
  return requireEnv().url;
}

export async function buildHostToken(opts: {
  roomName: string;
  identity: string;
  ttlSeconds?: number;
}): Promise<string> {
  const { apiKey, apiSecret } = requireEnv();
  const at = new AccessToken(apiKey, apiSecret, {
    identity: opts.identity,
    ttl: opts.ttlSeconds ?? DEFAULT_TTL_SECONDS,
  });
  at.addGrant({
    room: opts.roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
  return at.toJwt();
}

export async function buildViewerToken(opts: {
  roomName: string;
  identity: string;
  ttlSeconds?: number;
}): Promise<string> {
  const { apiKey, apiSecret } = requireEnv();
  const at = new AccessToken(apiKey, apiSecret, {
    identity: opts.identity,
    ttl: opts.ttlSeconds ?? DEFAULT_TTL_SECONDS,
  });
  at.addGrant({
    room: opts.roomName,
    roomJoin: true,
    canPublish: false,
    canSubscribe: true,
    canPublishData: false,
  });
  return at.toJwt();
}
