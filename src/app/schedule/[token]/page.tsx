import { headers, cookies } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { routing } from '@/i18n/routing';
import { resolveSchedToken } from '@/lib/scheduling/public';
import { ParticipantSchedule } from '@/components/scheduling/participant-schedule';
import { ParticipantScheduleNotice } from '@/components/scheduling/participant-schedule-notice';
import enMessages from '../../../../messages/en.json';

// Anon participant page for the recruiting-scheduling share link (PR4). Route
// lives at `/schedule/[token]` (outside `[locale]`) because the admin link
// generator emits `${origin}/schedule/${token}` — locale-free, anonymous. The
// participant_token IS the authorization; a dead/invalid token shows only a
// notice (no data leak).
//
// i18n: this route is outside next-intl's `[locale]` segment, so there is no
// ambient request locale or provider. We negotiate the locale per request
// (explicit NEXT_LOCALE cookie → Accept-Language → default) and inject only the
// `SchedulingParticipant` messages. Every non-en locale is deep-merged on top
// of en so a partially-translated locale never leaks a raw key (same invariant
// as src/i18n/request.ts and the `/ut-live` page).

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

// Honor the participant's own language: explicit NEXT_LOCALE cookie → first
// supported Accept-Language tag → default. (An external visitor is best served
// in their own language, unlike the signed-in app which forces en.)
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

async function loadMessages(locale: string): Promise<Messages> {
  const enNs = (enMessages as Messages).SchedulingParticipant as Messages;
  if (locale === 'en') return { SchedulingParticipant: enNs };
  const localeMod = (await import(`../../../../messages/${locale}.json`))
    .default as Messages;
  const localeNs = isPlainObject(localeMod.SchedulingParticipant)
    ? localeMod.SchedulingParticipant
    : {};
  return { SchedulingParticipant: deepMerge(enNs, localeNs) };
}

export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const locale = await negotiateLocale();
  const messages = await loadMessages(locale);

  const gate = await resolveSchedToken(token);

  const body =
    'error' in gate ? (
      <ParticipantScheduleNotice />
    ) : (
      <ParticipantSchedule
        token={token}
        candidateName={gate.candidate.name}
      />
    );

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {body}
    </NextIntlClientProvider>
  );
}
