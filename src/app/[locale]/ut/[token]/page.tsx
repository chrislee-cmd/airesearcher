import { setRequestLocale, getTranslations } from 'next-intl/server';
import { resolveUtToken } from '@/lib/ut/public';
import { ParticipantCapture } from '@/components/ut/participant-capture';

// 원격 AI UT 참가자(624) 공개 페이지 — 무설치·무로그인, participant_token 이 인가.
//
// 토큰을 서버에서 1회 resolve 해 과제(task_goal)·대상 사이트를 안내로 넘긴다.
// 죽은 링크(무효/미존재)나 이미 끝난 세션(done/error)은 데이터 노출 없이 안내만.
// 살아있는 세션이면 클라 컴포넌트가 동의 게이트 + 화면공유 + LiveKit 발행을 소유.

async function Notice({
  locale,
  variant,
}: {
  locale: string;
  variant: 'invalid' | 'ended';
}) {
  const t = await getTranslations({ locale, namespace: 'UtParticipant' });
  return (
    <main className="mx-auto flex w-full max-w-[640px] flex-1 flex-col px-4 pb-16 pt-10">
      <div className="rounded-md border border-line bg-paper p-6">
        <h1 className="text-xl font-semibold tracking-[-0.01em] text-ink-2">
          {t(`notice.${variant}.heading`)}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-mute">
          {t(`notice.${variant}.body`)}
        </p>
      </div>
    </main>
  );
}

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);

  const gate = await resolveUtToken(token);
  if ('error' in gate) {
    return <Notice locale={locale} variant="invalid" />;
  }
  const { session } = gate;

  // 리서처가 이미 종료한 세션은 새 참가자 스트림을 받지 않는다(publisher-token
  // 410 과 정합). 캡처 UI 대신 안내만.
  if (session.status === 'done' || session.status === 'error') {
    return <Notice locale={locale} variant="ended" />;
  }

  return (
    <ParticipantCapture
      token={token}
      taskGoal={session.task_goal}
      targetUrl={session.target_url}
    />
  );
}
