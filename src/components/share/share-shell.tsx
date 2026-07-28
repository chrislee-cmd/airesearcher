import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';

// 공개 공유 뷰 셸 — CD Surface B(share-shell.dc.html, 4프레임·7상태) fresh build.
//
// THE ONE RULE: 셸은 자기가 어느 기능을 감싸는지 모른다. `if (feature === …)` 는
// 버그다. 정체성은 오직 `tone`(파스텔 토큰) + `title` 로만 도착한다. B1(전사록)과
// B2(데스크)는 본문만 다르고 chrome DOM 은 byte-identical — 그게 feature-blind 증명.
//
// 사용자 확정 델타(DECISIONS, BUILD-SPEC 보다 우선):
//   D1 not_found = deleted — 같은 B3c 한 화면(토큰 존재 여부 확인 안 함).
//   D2 공유자 실명 미표시 — sharedBy prop 없음. attribution = 공유일만(만료는 notice strip).
//   D3 푸터 CTA 제거 — "Made with Research" 브랜딩만.
//
// 서버 컴포넌트(getTranslations). 상호작용이 필요한 상태(gated)는 route 가
// children 으로 client 폼(ShareGateForm)을 주입 — 셸은 chrome 만 그린다.

export type ShareTone = 'sky' | 'mint' | 'lav' | 'peach' | 'sun' | 'aqua';
export type ShareState =
  | 'valid'
  | 'loading'
  | 'expired'
  | 'revoked'
  | 'not_found'
  | 'gated';

// tone → @theme bg 유틸(globals.css 2.0 --color-{tone}). 셸은 문자열만 받고
// 클래스로 매핑 — 기능명이 셸에 새지 않는다.
const TONE_BG: Record<ShareTone, string> = {
  sky: 'bg-sky',
  mint: 'bg-mint',
  lav: 'bg-lav',
  peach: 'bg-peach',
  sun: 'bg-sun',
  aqua: 'bg-aqua',
};

export type ShareShellProps = {
  state: ShareState;
  locale: string;
  /** deliverable title — verbatim, 절대 truncate 안 함(§1 title wraps). */
  title: string;
  tone: ShareTone;
  /** 공유 시점(ISO). D2 — 공유자 실명 없이 날짜만. */
  sharedAt: string;
  /** 만료(ISO) 또는 null(만료 없음). notice strip 에 표시. */
  expiresAt: string | null;
  /** not_found(B3c) 의 mono 토큰 echo(예: /share/9fQ2…a71). */
  tokenEcho?: string;
  /** 본문 slot: valid=본문 뷰어 · gated=게이트 폼. 셸엔 불투명. */
  children?: ReactNode;
};

function fmtDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(d);
}

// ── brand mark + read-only 배지(masthead 상단행) ────────────────────────
function BrandRow({
  badge,
  badgeTone,
}: {
  badge: string;
  badgeTone: 'ink' | 'mute';
}) {
  return (
    <div className="flex items-center gap-[11px]">
      <div className="inline-flex shrink-0 items-center gap-[7px]">
        <span className="flex h-6 w-6 items-center justify-center rounded-xs border-2 border-ink bg-paper font-display text-xs font-extrabold text-ink shadow-memphis-xs">
          R
        </span>
        <span className="font-display text-xs font-extrabold tracking-[-0.2px] text-ink">
          Research Canvas
        </span>
      </div>
      <div className="flex-1" />
      <div
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-pill border-[1.5px] bg-paper px-[11px] py-1 font-mono-label text-xs font-bold ${
          badgeTone === 'ink'
            ? 'border-ink text-ink shadow-memphis-sm'
            : 'border-line text-mute-soft'
        }`}
      >
        {badge}
      </div>
    </div>
  );
}

// ── footer(D3 — 브랜딩만, CTA 없음) ─────────────────────────────────────
async function Footer() {
  const t = await getTranslations('Share.shell');
  return (
    <div className="flex shrink-0 items-center gap-2.5 border-t-2 border-ink bg-paper-soft px-[22px] py-[11px]">
      <span className="text-xs text-mute-soft">
        {t.rich('madeWith', {
          brand: (chunks) => (
            <b className="font-bold text-ink">{chunks}</b>
          ),
        })}
      </span>
    </div>
  );
}

// ── outer 프레임 wrapper(공개 페이지: 중앙 정렬 단일 컬럼) ────────────────
function Frame({
  size,
  children,
}: {
  size: 'wide' | 'compact';
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-canvas p-4 sm:p-10">
      <div
        className={`flex w-full flex-col overflow-hidden rounded-panel-lg border-[3px] border-ink bg-surface-canvas shadow-frame ${
          size === 'wide'
            ? 'h-[min(780px,90vh)] max-w-[760px]'
            : 'max-w-[568px]'
        }`}
      >
        {children}
      </div>
    </main>
  );
}

export async function ShareShell(props: ShareShellProps) {
  const { state } = props;
  if (state === 'valid') return <ValidShell {...props} />;
  if (state === 'loading') return <LoadingShell {...props} />;
  if (state === 'gated') return <GatedShell {...props} />;
  return <DeadEndShell {...props} />;
}

// ── valid(B1/B2) — masthead + notice strip + body slot + footer ─────────
async function ValidShell({
  locale,
  title,
  tone,
  sharedAt,
  expiresAt,
  children,
}: ShareShellProps) {
  const t = await getTranslations('Share.shell');
  return (
    <Frame size="wide">
      {/* masthead — 톤 밴드. D2: attribution=공유일만(실명 없음). */}
      <header
        className={`shrink-0 border-b-[3px] border-ink px-[22px] py-[15px] ${TONE_BG[tone]}`}
      >
        <BrandRow badge={t('readOnly')} badgeTone="ink" />
        <div className="mt-3 flex items-end gap-3">
          <div className="min-w-0 flex-1">
            {/* §1 — title wraps, never truncates. */}
            <h1 className="font-display text-3xl font-extrabold leading-[1.25] tracking-[-0.5px] text-ink">
              {title}
            </h1>
            <div className="mt-1 text-sm text-ink">
              {t('sharedOn', { date: fmtDate(sharedAt, locale) })}
            </div>
          </div>
          {/* 다운로드 컨트롤: 공개 비인증 export 엔드포인트 부재 → 숨김
              (spec §3 · DECISIONS #6 — export-registry 공개 배선은 후속). */}
        </div>
      </header>

      {/* notice strip — valid/gated 에서만. 만료 유무와 무관(무만료도 정보). */}
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-paper-soft px-[22px] py-2 text-sm text-mute">
        <span aria-hidden>🔗</span>
        <span>
          {t('anyoneWithLink')}{' '}
          <b className="font-bold text-ink">
            {expiresAt
              ? t('expiresOn', { date: fmtDate(expiresAt, locale) })
              : t('noExpiry')}
          </b>
        </span>
      </div>

      {/* body slot — 스크롤 컨테이너 + 패딩만(max-width/prose 금지, §1). */}
      <div className="sc min-h-0 flex-1 overflow-y-auto bg-paper px-[22px] py-5">
        {children}
      </div>

      <Footer />
    </Frame>
  );
}

// ── loading(B3a) — chrome 즉시 · 본문만 skeleton ─────────────────────────
async function LoadingShell({ tone }: ShareShellProps) {
  const t = await getTranslations('Share.shell');
  const ladder = [1, 0.86, 0.68, 0.46, 0.26];
  return (
    <Frame size="compact">
      <header
        className={`shrink-0 border-b-[3px] border-ink px-[18px] py-[14px] ${TONE_BG[tone]}`}
      >
        <BrandRow badge={t('readOnly')} badgeTone="ink" />
        <div className="mt-[11px] flex flex-col gap-1.5">
          <div className="h-[19px] w-[58%] rounded-chip bg-line" />
          <div className="h-2.5 w-[34%] rounded-chip bg-line-soft" />
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-4 bg-paper px-[18px] py-5">
        {ladder.map((op, i) => (
          <div key={i} className="flex gap-[11px]" style={{ opacity: op }}>
            <div className="h-8 w-8 shrink-0 rounded-full bg-line-soft" />
            <div className="flex flex-1 flex-col gap-1.5">
              <div className="h-2 w-[22%] rounded-chip bg-line-soft" />
              <div className="h-2.5 w-[86%] rounded-chip bg-line-soft" />
              <div className="h-2.5 w-[52%] rounded-chip bg-line-soft" />
            </div>
          </div>
        ))}
      </div>
      <div className="shrink-0 border-t-2 border-ink bg-paper-soft px-[18px] py-2.5 text-xs text-mute-soft">
        {t('loadingNote')}
      </div>
    </Frame>
  );
}

// ── dead-end(B3b expired/revoked · B3c not_found) — 톤 drop(무채색) ──────
async function DeadEndShell({ state, locale, expiresAt, tokenEcho }: ShareShellProps) {
  const t = await getTranslations('Share.shell');
  // D1 — not_found 와 deleted 는 구별하지 않는다(같은 B3c).
  const isNotFound = state === 'not_found';
  const isRevoked = state === 'revoked';

  const badge = isNotFound
    ? t('badgeNotFound')
    : isRevoked
      ? t('badgeRevoked')
      : t('badgeExpired');
  const headline = isNotFound
    ? t('notFoundTitle')
    : isRevoked
      ? t('revokedTitle')
      : t('expiredTitle');
  const body = isNotFound
    ? t('notFoundBody')
    : isRevoked
      ? t('revokedBody')
      : expiresAt
        ? t('expiredBodyDated', { date: fmtDate(expiresAt, locale) })
        : t('expiredBody');

  return (
    <Frame size="compact">
      <header className="flex shrink-0 items-center gap-2.5 border-b-[3px] border-ink bg-surface-disabled px-[18px] py-[14px]">
        <BrandRow badge={badge} badgeTone="mute" />
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-3.5 bg-paper px-[34px] py-[34px] text-center">
        {isNotFound ? (
          // never resolved — dashed 타일.
          // design-allow-hardcoded -- CD share-shell.dc.html dead-end 아이콘 타일 radius 19(AUTHORITY: 전용 CD 절대값, DS 토큰 없음 — nearest 로 굽히지 않음)
          <div className="flex h-[70px] w-[70px] items-center justify-center rounded-[19px] border-[2.5px] border-dashed border-line-empty bg-surface-canvas text-3xl">
            🔗
          </div>
        ) : (
          // was valid, now closed — solid 타일.
          // design-allow-hardcoded -- CD share-shell.dc.html dead-end 아이콘 타일 radius 19(AUTHORITY: 전용 CD 절대값, DS 토큰 없음)
          <div className="flex h-[70px] w-[70px] items-center justify-center rounded-[19px] border-[3px] border-ink bg-paper-soft text-3xl shadow-memphis-lg">
            ⏳
          </div>
        )}
        <div className="font-display text-3xl font-extrabold tracking-[-0.4px] text-ink">
          {headline}
        </div>
        <div className="max-w-[360px] text-lg leading-[1.65] text-mute">
          {body}
        </div>
        {isNotFound ? (
          tokenEcho ? (
            <div className="rounded-chip border border-line bg-paper-soft px-2.5 py-1 font-mono-label text-xs text-mute-soft">
              {tokenEcho}
            </div>
          ) : null
        ) : (
          <div className="inline-flex items-center gap-1.5 rounded-pill border-[1.5px] border-line bg-paper px-[15px] py-2 text-md font-semibold text-mute">
            ✉ {t('requestAccess')}
          </div>
        )}
      </div>
      <div className="shrink-0 border-t-2 border-ink bg-paper-soft px-[18px] py-2.5 text-xs text-mute-soft">
        {isNotFound ? t('notFoundNote') : t('deadEndNote')}
      </div>
    </Frame>
  );
}

// ── gated(B3d) — 톤 유지. chrome 은 셸, 폼(children)은 client 주입 ────────
async function GatedShell({ tone, children }: ShareShellProps) {
  const t = await getTranslations('Share.shell');
  return (
    <Frame size="compact">
      <header
        className={`flex shrink-0 items-center gap-2.5 border-b-[3px] border-ink px-[18px] py-[14px] ${TONE_BG[tone]}`}
      >
        <BrandRow badge={t('restricted')} badgeTone="ink" />
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-[11px] bg-paper px-8 py-8 text-center">
        {/* design-allow-hardcoded -- CD share-shell.dc.html gate 아이콘 타일 radius 17(AUTHORITY: 전용 CD 절대값, DS 토큰 없음) */}
        <div className={`flex h-[62px] w-[62px] items-center justify-center rounded-[17px] border-[3px] border-ink text-2xl shadow-memphis-lg ${TONE_BG[tone]}`}>
          ✉
        </div>
        <div className="mt-1 font-display text-3xl font-extrabold tracking-[-0.4px] text-ink">
          {t('gateTitle')}
        </div>
        <div className="max-w-[350px] text-md leading-[1.6] text-mute">
          {t('gateSubtitle')}
        </div>
        {/* 폼 slot — client(ShareGateForm): 필드 + Continue + 인라인 에러. */}
        <div className="mt-2 w-full max-w-[330px]">{children}</div>
        <div className="mt-1.5 flex max-w-[340px] items-start gap-1.5 text-left">
          <span aria-hidden className="text-xs">
            🛈
          </span>
          <span className="text-xs leading-[1.5] text-mute-soft">
            {t('gatePrivacy')}
          </span>
        </div>
      </div>
      <Footer />
    </Frame>
  );
}
