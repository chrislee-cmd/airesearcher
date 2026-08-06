'use client';

/* ────────────────────────────────────────────────────────────────────
   ReportStates — 읽기 모드 배너 4종 + 상태(빈/로딩/생성 중) (fresh · §1.4 배너 ·
   §3 상태 매트릭스 · S2 2a/2b/2c · S4a).

   배너(본문 최상단, exec 위):
   - stale(amber)  : warning-bg · shadow-memphis-md-amber · amber-text
   - stuck(processing): lav-bg · shadow-memphis-md-processing · lav-text
   - error         : error-bg · shadow-memphis-md-error · error-text · 코드박스
   - cancelled     : paper-soft · border line-strong · mute — **그림자 없음**(중립)
   배너엔 아이콘을 쓰지 않는다(틴트+그림자색+제목 800 으로 상태 전달, §1.5).

   상태:
   - 2a 빈 상태: 인트로 카드(생성/업로드 CTA + 언어 선택)
   - 2b 로딩: skeleton(GEOMETRY §D3 치수)
   - 2c 생성 중: map(응답자 순회) → reduce(작성) 진행 카드 — **ETA 문구 없음**
     (DECISIONS #2) + 하위 skeleton.

   재생성/업로드 등 mutation 트리거는 소비처(topline-read-view)가 핸들러로 주입.
   ──────────────────────────────────────────────────────────────────── */

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { SelectMenu } from '@/components/ui/select-menu';
import { DuotoneIcon } from '@/components/ui/icons/duotone-icon';

// ── 배너 ────────────────────────────────────────────────────────────

// 배너 액션 pill — CD §4a 전용 chrome(paper·border ink·rounded-pill·memphis-sm).
// Button primitive 의 고정 형태와 달라 native 로(FullviewHeader pill 선례).
function BannerButton({
  label,
  onClick,
  tone = 'default',
  icon,
}: {
  label: string;
  onClick?: () => void;
  tone?: 'default' | 'crimson';
  icon?: boolean;
}) {
  return (
    // eslint-disable-next-line react/forbid-elements -- CD §4a 배너 액션은 rounded-pill·memphis-sm 전용 chrome; Button variant 형태와 불일치(FullviewHeader pill 선례). crimson 은 outline+crimson-memphis 로 destructive solid 와 다름.
    <button
      type="button"
      onClick={onClick}
      className={
        tone === 'crimson'
          ? 'inline-flex shrink-0 items-center gap-1.5 rounded-pill border-2 border-amore-deep bg-paper px-3.5 py-2 text-md font-extrabold text-amore-deep shadow-memphis-sm-crimson'
          : 'inline-flex shrink-0 items-center gap-1.5 rounded-pill border-[1.5px] border-ink bg-paper px-[15px] py-2 text-md font-extrabold text-ink shadow-memphis-sm-faint'
      }
    >
      {icon && <DuotoneIcon name="regenerate" size={15} />}
      {label}
    </button>
  );
}

export type ReportBannerKind = 'stale' | 'stuck' | 'error' | 'cancelled';

export function ReportBanner({
  kind,
  errorCode,
  onRegenerate,
  onCancel,
  disabled,
}: {
  kind: ReportBannerKind;
  // error 코드박스 문구(있으면 렌더).
  errorCode?: string | null;
  onRegenerate?: () => void;
  onCancel?: () => void;
  disabled?: boolean;
}) {
  const t = useTranslations('InterviewsV2');
  if (kind === 'stale') {
    return (
      <div className="flex items-start gap-[13px] rounded-panel border-2 border-ink bg-warning-bg px-[18px] py-[15px] shadow-memphis-md-amber">
        <div className="min-w-0 flex-1">
          <div className="mb-1 text-lg font-extrabold text-amber-text">
            {t('reportStaleTitle')}
          </div>
          <div className="text-md leading-[1.65] text-amber-text">
            {t('reportStaleBody')}
          </div>
        </div>
        {!disabled && (
          <BannerButton label={t('reportRegenerate')} onClick={onRegenerate} icon />
        )}
      </div>
    );
  }
  if (kind === 'stuck') {
    return (
      <div className="flex items-start gap-[13px] rounded-panel border-2 border-ink bg-lav-bg px-[18px] py-[15px] shadow-memphis-md-processing">
        <div className="min-w-0 flex-1">
          <div className="mb-1 text-lg font-extrabold text-lav-text">
            {t('reportStuckTitle')}
          </div>
          <div className="text-md leading-[1.65] text-lav-text">
            {t('reportStuckBody')}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {onCancel && (
            <BannerButton
              label={t('reportStuckStop')}
              onClick={onCancel}
              tone="crimson"
            />
          )}
          {!disabled && (
            <BannerButton label={t('reportRegenerate')} onClick={onRegenerate} icon />
          )}
        </div>
      </div>
    );
  }
  if (kind === 'error') {
    return (
      <div className="flex items-start gap-[13px] rounded-panel border-2 border-ink bg-error-bg px-[18px] py-[15px] shadow-memphis-md-error">
        <div className="min-w-0 flex-1">
          <div className="mb-1 text-lg font-extrabold text-error-text">
            {t('reportErrorTitle')}
          </div>
          <div className="text-md leading-[1.65] text-error-text">
            {t('reportErrorBody')}
          </div>
          {errorCode && (
            <div className="mt-2.5 rounded-chip border-[1.4px] border-error-line bg-paper px-2.5 py-1.5 font-mono-label text-xs leading-[1.5] text-error-text">
              {errorCode}
            </div>
          )}
        </div>
        {!disabled && (
          <BannerButton label={t('reportRetry')} onClick={onRegenerate} />
        )}
      </div>
    );
  }
  // cancelled — 중립(그림자 없음).
  return (
    <div className="flex items-center gap-[13px] rounded-panel border-[1.5px] border-line-strong bg-paper-soft px-[18px] py-3.5">
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 text-md font-extrabold text-mute">
          {t('reportCancelledTitle')}
        </div>
        <div className="text-md leading-[1.6] text-mute-soft">
          {t('reportCancelledBody')}
        </div>
      </div>
      {!disabled && (
        <BannerButton label={t('reportRestart')} onClick={onRegenerate} />
      )}
    </div>
  );
}

// ── 상태: 빈(2a) ────────────────────────────────────────────────────

const LANG_OPTIONS = [
  // i18n-allow-korean -- 언어 자기표기(로케일 무관 self-label · topline-view 선례)
  { value: 'ko', label: '한국어' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'zh', label: '中文' },
  { value: 'es', label: 'Español' },
  { value: 'th', label: 'ไทย' },
] as const;

export function ReportEmpty({
  outputLang,
  onLangChange,
  onGenerate,
  onUpload,
  uploading,
  canGenerate,
  indexed,
  isError,
  isBilling,
  errorCode,
}: {
  outputLang: string;
  onLangChange: (v: string) => void;
  onGenerate: () => void;
  onUpload: () => void;
  uploading: boolean;
  canGenerate: boolean;
  indexed: boolean;
  // error 종결 상태면 문구를 오류 안내로.
  isError?: boolean;
  isBilling?: boolean;
  errorCode?: string | null;
}) {
  const t = useTranslations('InterviewsV2');
  const title = isBilling
    ? t('toplineErrorBillingTitle')
    : isError
      ? t('toplineErrorTitle')
      : t('reportEmptyTitle');
  const hint = isBilling
    ? t('toplineErrorBillingHint')
    : isError
      ? t('toplineErrorHint')
      : !indexed
        ? t('toplineNotIndexed')
        : t('reportEmptyHint');
  return (
    <div className="flex h-full items-center justify-center p-10">
      <div className="w-full max-w-[620px] overflow-hidden rounded-panel-lg border-[3px] border-ink bg-paper shadow-memphis-lg-faint">
        <div className="border-b-2 border-ink bg-rose-bg px-[26px] py-5">
          <div className="mb-2 font-mono-label text-xs uppercase tracking-[0.16em] text-amore-deep">
            {t('reportEmptyEyebrow')}
          </div>
          <div
            className="text-3xl font-extrabold leading-[1.3] tracking-[-0.5px] text-ink"
            style={{ fontFamily: 'var(--font-outfit), var(--font-sans)' }}
          >
            {title}
          </div>
        </div>
        <div className="flex flex-col gap-4 px-[26px] py-[22px]">
          <p className="text-lg leading-[1.7] text-ink-2">{hint}</p>
          {isError && errorCode && (
            <div className="rounded-chip border-[1.4px] border-error-line bg-paper px-2.5 py-1.5 font-mono-label text-xs leading-[1.5] text-error-text">
              {errorCode}
            </div>
          )}
          <div className="flex flex-col gap-3 border-t-[1.5px] border-line pt-4">
            <div className="flex items-center gap-2.5">
              <span className="font-mono-label text-xs uppercase tracking-[0.14em] text-mute-soft">
                {t('toplineLangLabel')}
              </span>
              <div className="w-[var(--iv-lang-select-w)]">
                <SelectMenu
                  value={outputLang}
                  onChange={onLangChange}
                  options={LANG_OPTIONS.map((o) => ({
                    value: o.value,
                    label: o.label,
                  }))}
                  disabled={!canGenerate}
                  aria-label={t('toplineLangLabel')}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <Button
                variant="primary"
                size="sm"
                onClick={onGenerate}
                disabled={!canGenerate}
              >
                ✦ {t('toplineGenerateCta')} · 💎10
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={onUpload}
                disabled={uploading}
                leftIcon={<DuotoneIcon name="download" size={15} />}
              >
                {uploading ? t('toplineImporting') : t('toplineUploadCta')}
              </Button>
            </div>
            <p className="text-sm leading-[1.55] text-mute-soft">
              {t('reportEmptyFootnote')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 상태: 로딩(2b) ──────────────────────────────────────────────────

// skeleton 라인 헬퍼 — GEOMETRY §D3(본문 11 · 제목 17~20 · eyebrow 9~12).
function Sk({ className }: { className: string }) {
  return <div className={`rounded-xs bg-ink/[0.06] ${className}`} />;
}

export function ReportLoading() {
  const t = useTranslations('InterviewsV2');
  return (
    <div className="mx-auto flex w-[var(--iv-body-col-w)] max-w-full flex-col gap-[26px] py-2">
      <div className="flex flex-col gap-3 rounded-sm border-2 border-line bg-paper p-[22px]">
        <Sk className="h-[11px] w-24" />
        <Sk className="h-5 w-[78%]" />
        <Sk className="h-[11px] w-full" />
        <Sk className="h-[11px] w-[64%]" />
      </div>
      <div className="flex flex-col gap-3">
        <Sk className="h-[18px] w-[52%]" />
        <Sk className="h-[11px] w-full" />
        <Sk className="h-[11px] w-[84%]" />
      </div>
      <Sk className="h-[150px] w-full rounded-panel" />
      <div className="text-center font-mono-label text-sm text-faint">
        {t('reportLoading')}
      </div>
    </div>
  );
}

// ── 상태: 생성 중(2c) ──────────────────────────────────────────────

export function ReportGenerating({
  mapTotal,
  mapDone,
  inReduce,
}: {
  mapTotal: number | null;
  mapDone: number | null;
  inReduce: boolean;
}) {
  const t = useTranslations('InterviewsV2');
  const total = mapTotal ?? 0;
  const done = total > 0 ? Math.max(0, Math.min(mapDone ?? 0, total)) : 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="mx-auto flex w-[var(--iv-body-col-w)] max-w-full flex-col gap-[22px] py-2">
      <div className="flex flex-col gap-3.5 rounded-sm border-2 border-ink bg-paper p-[22px] shadow-memphis-md-faint">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="h-[9px] w-[9px] rounded-full bg-processing"
          />
          <span
            className="text-2xl font-extrabold text-ink"
            style={{ fontFamily: 'var(--font-outfit), var(--font-sans)' }}
          >
            {t('reportGeneratingTitle')}
          </span>
        </div>
        <div className="flex gap-3.5">
          {/* 1 · 응답자 순회 (map) — ETA 문구 없음(DECISIONS #2). */}
          <div
            className={`flex-1 rounded-panel border-[1.5px] px-[15px] py-[13px] ${
              inReduce
                ? 'border-line bg-paper-soft opacity-65'
                : 'border-amber-line bg-lav-bg'
            }`}
          >
            <div className="mb-2.5 flex items-center gap-2">
              <span className="font-mono-label text-xs uppercase tracking-[0.14em] text-lav-text">
                {t('reportGenMapLabel')}
              </span>
              <span className="ml-auto font-mono-label text-md font-extrabold tabular-nums text-ink">
                {done} / {total}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full border border-amber-line bg-paper">
              <div
                className="h-full bg-processing transition-[width] duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="mt-2 text-sm leading-[1.55] text-lav-text">
              {t('reportGenMapHint')}
            </div>
          </div>
          {/* 2 · 보고서 작성 (reduce). */}
          <div
            className={`flex-1 rounded-panel border-[1.5px] px-[15px] py-[13px] ${
              inReduce
                ? 'border-amber-line bg-lav-bg'
                : 'border-line bg-paper-soft opacity-65'
            }`}
          >
            <div className="mb-2.5 flex items-center gap-2">
              <span className="font-mono-label text-xs uppercase tracking-[0.14em] text-mute-soft">
                {t('reportGenReduceLabel')}
              </span>
              <span className="ml-auto font-mono-label text-md font-extrabold tabular-nums text-mute-soft">
                {inReduce ? '…' : t('reportGenWaiting')}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full border border-line bg-paper" />
            <div className="mt-2 text-sm leading-[1.55] text-mute-soft">
              {t('reportGenReduceHint')}
            </div>
          </div>
        </div>
        <div className="border-t-[1.5px] border-line pt-3 text-md leading-[1.6] text-mute">
          {t('reportGenKeepOpen')}
        </div>
      </div>
      {/* 하위 skeleton — 진행 카드가 주인공이라 눕힌다(opacity). */}
      <div className="flex flex-col gap-4 opacity-55">
        <Sk className="h-[17px] w-[44%]" />
        <Sk className="h-[11px] w-full" />
        <Sk className="h-[11px] w-[80%]" />
        <Sk className="h-[130px] w-full rounded-panel" />
      </div>
    </div>
  );
}
