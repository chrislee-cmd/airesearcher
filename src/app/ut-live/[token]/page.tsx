import { headers, cookies } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { routing } from '@/i18n/routing';
import { resolveUtToken } from '@/lib/ut/public';
import { ParticipantCapture } from '@/components/ut/participant-capture';
import { ParticipantNotice } from '@/components/ut/participant-notice';
import enMessages from '../../../../messages/en.json';

// Remote AI-UT participant (624) public page — no install, no login. The
// participant_token IS the authorization. Route lives at `/ut-live/[token]`
// (outside `[locale]`) because 623's link generator emits
// `${baseUrl()}/ut-live/${token}` — locale-free, anonymous. See the `/live`
// interpretation viewer for the sibling pattern.
//
// We resolve the token server-side once so the page can decide task-briefing
// vs. notice, then hand off to a client component that owns the consent gate +
// screen share + LiveKit publish. A dead link (invalid / missing) or an
// already-finished session shows only a notice — no data leak.
//
// i18n: this route is outside next-intl's `[locale]` segment, so there is no
// ambient request locale or provider. We negotiate the locale per request
// (explicit NEXT_LOCALE cookie → Accept-Language → en default) and inject the
// `UtParticipant` messages through our own NextIntlClientProvider. Every
// non-en locale is deep-merged on top of en so a partially-translated locale
// never leaks a raw key (same invariant as src/i18n/request.ts).

type Messages = Record<string, unknown>;

function isPlainObject(value: unknown): value is Messages {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMerge(base: Messages, override: Messages): Messages {
  const out: Messages = { ...base };
  for (const key of Object.keys(override)) {
    const b = base[key];
    const o = override[key];
    out[key] = isPlainObject(b) && isPlainObject(o) ? deepMerge(b, o) : o;
  }
  return out;
}

// Negotiate the participant's locale. Unlike the main app (which forces en
// unless an explicit cookie is set), a participant is an external visitor and
// a privacy-consent screen is best shown in their own language — so we honor
// Accept-Language here. Order: explicit NEXT_LOCALE cookie → first supported
// Accept-Language tag → en default.
async function negotiateLocale(): Promise<string> {
  const supported = routing.locales as readonly string[];
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get('NEXT_LOCALE')?.value;
  if (cookieLocale && supported.includes(cookieLocale)) return cookieLocale;

  const accept = (await headers()).get('accept-language') ?? '';
  for (const part of accept.split(',')) {
    const primary = part.split(';')[0]?.trim().toLowerCase().split('-')[0] ?? '';
    if (supported.includes(primary)) return primary;
  }
  return routing.defaultLocale;
}

// Load only the `UtParticipant` namespace, en-base merged, so the anon page
// ships a tiny message payload rather than the whole catalog.
async function loadUtMessages(locale: string): Promise<Messages> {
  const enNs = (enMessages as Messages).UtParticipant as Messages;
  if (locale === 'en') return { UtParticipant: enNs };
  const localeMod = (await import(`../../../../messages/${locale}.json`))
    .default as Messages;
  const localeNs = isPlainObject(localeMod.UtParticipant)
    ? localeMod.UtParticipant
    : {};
  return { UtParticipant: deepMerge(enNs, localeNs) };
}

export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const locale = await negotiateLocale();
  const messages = await loadUtMessages(locale);

  const gate = await resolveUtToken(token);

  let body: React.ReactNode;
  if ('error' in gate) {
    body = <ParticipantNotice variant="invalid" />;
  } else if (gate.session.status === 'done' || gate.session.status === 'error') {
    // A session the researcher already ended won't accept a new participant
    // stream (publisher-token 410) — show a notice instead of the capture UI.
    body = <ParticipantNotice variant="ended" />;
  } else {
    body = (
      <ParticipantCapture
        token={token}
        taskGoal={gate.session.task_goal}
        targetUrl={gate.session.target_url}
      />
    );
  }

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {body}
    </NextIntlClientProvider>
  );
}
