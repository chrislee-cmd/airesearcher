import { setRequestLocale, getTranslations } from 'next-intl/server';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { isShareExpired } from '@/lib/share/shared-views';
import { loadSharedResource } from '@/lib/share/loaders';
import {
  verifyViewerCookie,
  viewerCookieName,
} from '@/lib/share/viewer-cookie';
import { ShareShell, type ShareTone } from '@/components/share/share-shell';
import { ShareGateForm } from '@/components/share/share-gate-form';
import { TranscriptShareBody } from '@/components/share/bodies/transcript-share-body';
import { DeskShareBody } from '@/components/share/bodies/desk-share-body';
import { UtShareBody } from '@/components/share/bodies/ut-share-body';
import type {
  SharedTranscript,
  SharedDeskReport,
  SharedUtInsight,
} from '@/lib/share/loaders';

// 통합 산출물 공개 공유 뷰어(Surface B, /share/d/[token]) — CD share-shell 셸 +
// 전사록·데스크·UT 본문 slot. 서버 컴포넌트.
//
// 오케스트레이션(기존 /share/[token] 과 동형, 셸만 fresh):
//   1) 이메일 무관 토큰 상태 — 무효/폐기/만료면 dead-end(데이터 0).
//   2) 뷰어 이메일 확보: OTP 쿠키 → 로그인 세션 이메일.
//   3) loadSharedResource(게이트 재확인 + read-only 본문) 통과 시 valid 셸.
//      아니면 gated(셸 안 인라인 OTP 폼) 또는 dead-end.
//
// D1: not_found = deleted 동일(토큰 존재 여부 확인 안 함). 이 라우트는 산출물
// 통합 3타입(transcript/desk_report/ut_insight)만 그린다 — 기존 2타입은 구
// /share/[token] 라우트 소유. 그 외 타입은 not_found 로(데이터 0).

// 기능 정체성 = tone(셸은 feature-blind). transcript=lav · desk=aqua · ut=peach.
const TONE: Record<string, ShareTone> = {
  transcript: 'lav',
  desk_report: 'aqua',
  ut_insight: 'peach',
};

function stripExt(name: string): string {
  return name.replace(/\.[^./\\]+$/, '');
}

// 토큰 echo(B3c mono) — 앞/뒤 일부만 노출(전체 토큰 노출 안 함).
function tokenEcho(token: string): string {
  const head = token.slice(0, 4);
  const tail = token.slice(-3);
  return `/share/${head}…${tail}`;
}

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('Share.shell');

  const admin = createAdminClient();

  // 1) 죽은 링크는 이메일 게이트 없이 바로 dead-end(데이터 0). D1 — not_found 와
  //    deleted 를 구별하지 않는다.
  const { data: share } = await admin
    .from('shared_views')
    .select('resource_type, expires_at, revoked_at')
    .eq('token', token)
    .maybeSingle();
  if (!share) {
    return (
      <ShareShell
        state="not_found"
        locale={locale}
        title=""
        tone="lav"
        sharedAt=""
        expiresAt={null}
        tokenEcho={tokenEcho(token)}
      />
    );
  }
  if (share.revoked_at) {
    return (
      <ShareShell
        state="revoked"
        locale={locale}
        title=""
        tone="lav"
        sharedAt=""
        expiresAt={null}
      />
    );
  }
  if (isShareExpired(share.expires_at as string | null)) {
    return (
      <ShareShell
        state="expired"
        locale={locale}
        title=""
        tone="lav"
        sharedAt=""
        expiresAt={(share.expires_at as string | null) ?? null}
      />
    );
  }

  const tone = TONE[share.resource_type as string] ?? 'lav';

  // 2) 뷰어 이메일: OTP 인증 쿠키(우선) → 로그인 세션 이메일.
  const cookieStore = await cookies();
  const cookieEmail = verifyViewerCookie(
    token,
    cookieStore.get(viewerCookieName(token))?.value,
  );

  let sessionEmail: string | null = null;
  if (!cookieEmail) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    sessionEmail = user?.email ?? null;
  }
  const candidateEmail = cookieEmail ?? sessionEmail;

  // 3) 게이트 통과 시에만 본문 read-only 로드 + valid 렌더.
  if (candidateEmail) {
    const loaded = await loadSharedResource(admin, token, candidateEmail);
    if (loaded.ok) {
      const body = renderBody(loaded.resourceType, loaded.resource);
      if (!body) {
        // 이 라우트가 그리지 않는 타입(기존 2타입 등) → 데이터 0 안내.
        return (
          <ShareShell
            state="not_found"
            locale={locale}
            title=""
            tone={tone}
            sharedAt=""
            expiresAt={null}
            tokenEcho={tokenEcho(token)}
          />
        );
      }
      return (
        <ShareShell
          state="valid"
          locale={locale}
          title={body.title || t('untitled')}
          tone={tone}
          sharedAt={loaded.sharedAt}
          expiresAt={loaded.expiresAt}
        >
          {body.node}
        </ShareShell>
      );
    }
    // 죽은 링크는 위에서 걸렀지만 레이스 대비 — reason 별 상태.
    if (loaded.reason === 'not_found') {
      return (
        <ShareShell
          state="not_found"
          locale={locale}
          title=""
          tone={tone}
          sharedAt=""
          expiresAt={null}
          tokenEcho={tokenEcho(token)}
        />
      );
    }
    if (loaded.reason === 'revoked') {
      return (
        <ShareShell state="revoked" locale={locale} title="" tone={tone} sharedAt="" expiresAt={null} />
      );
    }
    if (loaded.reason === 'expired') {
      return (
        <ShareShell state="expired" locale={locale} title="" tone={tone} sharedAt="" expiresAt={null} />
      );
    }
    // not_invited → 게이트(로그인 세션 이메일이 미초대였음을 알림).
    return (
      <ShareShell state="gated" locale={locale} title="" tone={tone} sharedAt="" expiresAt={null}>
        <ShareGateForm token={token} prefillEmail={sessionEmail ?? undefined} notInvited />
      </ShareShell>
    );
  }

  // 이메일 미확보(비로그인 외부인) → 게이트.
  return (
    <ShareShell state="gated" locale={locale} title="" tone={tone} sharedAt="" expiresAt={null}>
      <ShareGateForm token={token} />
    </ShareShell>
  );
}

// resource_type → { 본문 노드, 셸 title }. 이 라우트가 그리는 3타입만.
function renderBody(
  resourceType: string,
  resource: unknown,
): { node: React.ReactNode; title: string } | null {
  if (resourceType === 'transcript') {
    const r = resource as SharedTranscript;
    return {
      node: <TranscriptShareBody data={r} />,
      title: r.meta.filename ? stripExt(r.meta.filename) : '',
    };
  }
  if (resourceType === 'desk_report') {
    const r = resource as SharedDeskReport;
    return {
      node: <DeskShareBody data={r} />,
      title: r.keywords.length > 0 ? r.keywords.join(', ') : '',
    };
  }
  if (resourceType === 'ut_insight') {
    const r = resource as SharedUtInsight;
    return {
      node: <UtShareBody data={r} />,
      title: r.targetUrl ?? '',
    };
  }
  return null;
}
