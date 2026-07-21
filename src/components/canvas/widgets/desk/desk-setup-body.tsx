'use client';

/* ────────────────────────────────────────────────────────────────────
   DeskSetupBody — 데스크 리서치 V3 카드 본문 (통합 SSOT #1114, fresh build).

   WIDGET-SHELL §AUTHORITY §D: CD `.dc.html` / README Desk Research 대로 신규
   작성한 프레젠테이션. 옛 `desk-card-body.tsx` / `ControlBoardPanel` 재사용 X —
   레이아웃·조립·footer 전부 fresh. **로직/데이터/폼만 재사용**:
   `useDeskWidget`(hook) · ModeCardGroup/ChipField/SelectMenu/DateRangePopover/
   ProjectPicker(forms) · DeskResultView(PR2 리포트, 회귀 방지로 그대로).
   WidgetShellV3(공유 셸)이 프레임/헤더/툴바 pill 을 렌더 — 이 body 는 스텝
   레일 + footer 만 소유.

   구성 (WIDGET-SHELL Frame spec 조립):
   - setup: 4스텝 아코디언 (all-open ↔ collapsed 요약)
   - started/done: in-place Handoff (리포트는 fullview=PR2)
   - 상태 배너 전부 (error·timeout·stuck·fallback·raw-dump·done-empty·
     cancelled·skipped)
   - footer: footNote(좌) + CTA(우) 한 줄, border-top. CTA = README ink 필
     pill(`Search →`) — 옛 각진 amore divergence 교정.
   raw hex/px 0 (check:design) · i18n 4로케일.
   ──────────────────────────────────────────────────────────────────── */

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useDeskWidget, deskJobSelectorLabel } from './use-desk-widget';
import { DeskSetupAccordion, type DeskStepDef } from './setup-accordion';
import { DeskStartedHandoff } from './started-handoff';
import { DeskResultView } from '@/components/canvas/widgets/desk-result';
import type { DeskMode, DeskCountryScope } from '@/lib/desk-orchestrator/types';
import type { DeskRegion } from '@/lib/desk-sources';
import { Button } from '@/components/ui/button';
import { ModeCardGroup } from '@/components/ui/mode-button';
import { ChipField } from '@/components/ui/chip-field';
import { SelectMenu } from '@/components/ui/select-menu';
import { CONTROL_TRIGGER_CLASS } from '@/components/ui/control-trigger';
import { DateRangePopover } from '@/components/ui/date-range-popover';
import { ProjectPicker } from '@/components/project-picker';
import { Select } from '@/components/ui/select';
import { DownloadMenu } from '@/components/ui/download-menu';
import { ShareMenu } from '@/components/ui/share-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { BrandLoader } from '@/components/ui/brand-loader';
import { Modal } from '@/components/ui/modal';
import { Banner } from '@/components/canvas/shell/banner';
import { WidgetFullviewPanel } from '@/components/canvas/shell/widget-fullview-panel';

export function DeskSetupBody() {
  const d = useDeskWidget();
  const tDesk = useTranslations('Desk');
  const tCommon = useTranslations('Common');
  const tWidgets = useTranslations('Widgets');
  const tProcess = useTranslations('Process');
  const tProject = useTranslations('ProjectPicker');

  // 세팅 아코디언 접힘 (all-open ↔ all-collapsed). 프레젠테이션 로컬 상태.
  const [setupCollapsed, setSetupCollapsed] = useState(false);

  // 이벤트 로그 자동 스크롤.
  const thoughtsScroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (thoughtsScroller.current) {
      thoughtsScroller.current.scrollTop = thoughtsScroller.current.scrollHeight;
    }
  }, [d.events.length]);

  // ── mode 카드 (step 3) ──
  const MODE_OPTIONS: { key: DeskMode; icon: string }[] = [
    { key: 'trend', icon: '🔥' },
    { key: 'market', icon: '📊' },
  ];
  const modeSelector = (
    <ModeCardGroup
      ariaLabel={tDesk('modeLabel')}
      options={MODE_OPTIONS.map((opt) => ({
        key: opt.key,
        icon: opt.icon,
        label: tDesk(`modeTitle.${opt.key}` as never),
        description: tDesk(`modeDesc.${opt.key}` as never),
      }))}
      value={d.mode}
      onChange={(key) => d.setMode(key as DeskMode)}
    />
  );

  // ── 접힘 요약 값 ──
  const regionSummary = Array.from(d.regions)
    .map((r) => tDesk(`region.${r}`))
    .join(', ');
  const periodSummary =
    d.dateFrom || d.dateTo
      ? `${d.dateFrom || '…'} ~ ${d.dateTo || '…'}`
      : tDesk('range_all');

  // ── 4스텝 정의 (기존 primitive/로직 배선, 신규 백엔드 0) ──
  const setupSteps: DeskStepDef[] = [
    {
      n: 1,
      title: tDesk('setupStepProject'),
      summaryLabel: `${tDesk('setupStepShort')} 01 · ${tDesk('setupSummaryProject')}`,
      summaryValue: d.projectId ? (
        tDesk('setupProjectSelected')
      ) : (
        <span className="text-mute-soft">{tProject('placeholder')}</span>
      ),
      done: !!d.projectId,
      children: (
        <ProjectPicker
          widget="desk"
          value={d.projectId}
          onChange={(id) => d.setProject(id)}
        />
      ),
    },
    {
      n: 2,
      title: tDesk('setupStepKeywords'),
      summaryLabel: `${tDesk('setupStepShort')} 02 · ${tDesk('setupSummaryKeywords')}`,
      summaryValue: d.hasKeywords ? (
        tDesk('controlsSummaryKeywords', { count: d.keywords.length })
      ) : (
        <span className="text-mute-soft">{tDesk('setupKeywordsNone')}</span>
      ),
      done: d.hasKeywords,
      children: (
        <ChipField
          variant="bordered"
          values={d.keywords}
          onChange={d.setKeywords}
          maxItems={10}
          commitOnComma
          placeholderEmpty={tDesk('keywordPlaceholder')}
          placeholderAdd={tDesk('keywordAddMore')}
        />
      ),
    },
    {
      n: 3,
      title: tDesk('setupStepPurpose'),
      summaryLabel: `${tDesk('setupStepShort')} 03 · ${tDesk('setupSummaryPurpose')}`,
      summaryValue: tDesk(`modeTitle.${d.mode}` as never),
      done: true,
      children: (
        <div className="space-y-4">
          {modeSelector}
          {d.mode === 'market' && (
            <ModeCardGroup
              ariaLabel={tDesk('countryScopeLabel')}
              columns={2}
              options={[
                {
                  key: 'kr',
                  icon: '🇰🇷',
                  label: tDesk('countryScopeTitle.kr'),
                  description: tDesk('countryScopeDesc.kr'),
                },
                {
                  key: 'global',
                  icon: '🌐',
                  label: tDesk('countryScopeTitle.global'),
                  description: tDesk('countryScopeDesc.global'),
                },
              ]}
              value={d.countryScope}
              onChange={(key) => d.setCountryScope(key as DeskCountryScope)}
            />
          )}
        </div>
      ),
    },
    {
      n: 4,
      title: tDesk('setupStepScope'),
      summaryLabel: `${tDesk('setupStepShort')} 04 · ${tDesk('setupSummaryScope')}`,
      summaryValue: `${regionSummary} · ${periodSummary}`,
      done: true,
      children: (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectMenu
              multi
              options={d.DESK_REGIONS.map((r) => ({
                value: r,
                label: tDesk(`region.${r}`),
              }))}
              value={Array.from(d.regions)}
              onChange={(next) => {
                if (next.length === 0) return;
                d.setRegions(new Set(next as DeskRegion[]));
              }}
              placeholder={tDesk('regionLabel')}
              buttonClassName={CONTROL_TRIGGER_CLASS}
            />
            <DateRangePopover
              value={{ from: d.dateFrom, to: d.dateTo }}
              onChange={(next) => {
                d.setDateFrom(next.from);
                d.setDateTo(next.to);
              }}
              presets={d.rangePresets}
              placeholder={tDesk('range_all')}
              locale={d.locale}
              buttonClassName={CONTROL_TRIGGER_CLASS}
            />
          </div>
          {/* AI 자동 소스 안내 (copy 가 trend 특정 — 통계·공시 제외 — 이라
              trend 에서만; market 은 다른 소스셋). 기존 gating 보존. */}
          {d.mode === 'trend' && (
            <p className="text-xs leading-[1.6] text-mute-soft">
              {tDesk('modeTrendSourcesHint')}
            </p>
          )}
          {/* 범위 견적 (§3 step4). heavy 면 amore warning. */}
          {d.hasKeywords && d.mode !== 'market' && (
            <p
              className={`text-xs leading-[1.6] ${
                d.estimate.heavy ? 'text-amore' : 'text-mute-soft'
              }`}
            >
              {tDesk('estimateLabel', {
                kw: d.estimate.kw,
                src: d.estimate.src,
                region: d.estimate.region,
                count: d.estimate.count,
              })}
              {' · '}
              {d.estimate.heavy ? tDesk('estimateHeavy') : tDesk('estimateOk')}
            </p>
          )}
        </div>
      ),
    },
  ];

  const errorBanner = d.error ? (
    <Banner tone="warning" title={tDesk('error')}>
      <span className="font-mono">{d.error}</span>
    </Banner>
  ) : null;

  // ── 세팅 영역 (아코디언 / 핸드오프) ──
  const doneHandoff = d.showResult && !d.forceControls;
  const setupArea = d.deskRunning ? (
    <DeskStartedHandoff
      title={tDesk('handoffTitle')}
      subtitle={tDesk('handoffBody')}
      onFullview={d.handleDeskFullview}
      fullviewLabel={tWidgets('viewAll')}
    />
  ) : doneHandoff ? (
    <DeskStartedHandoff
      title={tProcess('completeTitle')}
      subtitle={tDesk('doneHandoffBody')}
      onFullview={d.handleDeskFullview}
      fullviewLabel={tWidgets('viewAll')}
    >
      <Button
        variant="ghost"
        size="sm"
        onClick={() => d.setForceControls(true)}
      >
        {tProcess('newResearch')}
      </Button>
    </DeskStartedHandoff>
  ) : (
    <>
      <DeskSetupAccordion
        steps={setupSteps}
        collapsed={setupCollapsed}
        onCollapse={() => setSetupCollapsed(true)}
        onExpand={() => setSetupCollapsed(false)}
        changeLabel={tDesk('setupChange')}
      />
      {errorBanner}
    </>
  );

  // ── footNote / CTA (footer) ──
  const footNote = d.deskRunning
    ? tWidgets('deskRunning')
    : d.hasKeywords
      ? tDesk('setupReady')
      : tDesk('setupAddKeywords');

  return (
    <>
      <div className="flex h-full flex-col">
        {/* 스크롤 영역 — setup/handoff + 산출물(배너/이벤트/타이밍). 프레임
            padding/폭은 fresh(ControlBoardPanel 미사용). max-w-lg ≈ CD 514 컬럼. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="flex flex-col items-center px-5 pt-8 pb-5">
            <div className="w-full max-w-lg">{setupArea}</div>
          </div>

          {/* 산출물 — active(제출/진행/결과) 일 때만. */}
          {d.active && (
            <div className="flex flex-col items-center px-5">
              <div className="w-full max-w-lg space-y-3 pb-4">
                {/* 진행 로그 (secondary, 기본 접힘) */}
                {d.showStream && d.events.length > 0 && (
                  <details className="group border-t border-line-soft pt-3">
                    <summary className="flex cursor-pointer list-none items-center justify-between text-xs uppercase tracking-[.18em] text-mute-soft">
                      <span>{tDesk('thinkingDetails')}</span>
                      <span className="tabular-nums normal-case tracking-normal">
                        {d.events.length}
                      </span>
                    </summary>
                    <div
                      ref={thoughtsScroller}
                      className="mt-2 h-60 overflow-y-auto rounded-xs border border-line bg-paper px-4 py-3 text-md leading-[1.7]"
                    >
                      {d.events.map((line, i) => (
                        <div key={i} className="fade-in-up py-0.5 text-ink-2">
                          <span className="mr-2 text-amore">›</span>
                          {line}
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {/* §3 상태 배너 — 전부 보존 */}
                {d.isStuck && d.job && (
                  <Banner tone="info" title={tDesk('stuckTitle')}>
                    <div className="flex flex-wrap items-center gap-3">
                      <span>{d.stuckBodyText}</span>
                      {d.showStuckCancel && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void d.cancelJob(d.job!.id)}
                          disabled={d.job.cancel_requested}
                        >
                          {d.job.cancel_requested
                            ? tDesk('stopRequested')
                            : tDesk('stopAndRefund')}
                        </Button>
                      )}
                    </div>
                  </Banner>
                )}
                {d.job?.status === 'error' && (
                  <Banner
                    tone="warning"
                    title={
                      d.isTimeoutError ? tDesk('timeoutTitle') : tDesk('errorTitle')
                    }
                  >
                    <span>
                      {d.isTimeoutError
                        ? tDesk('timeoutBody')
                        : d.job.error_message ?? tDesk('errorBody')}
                    </span>
                    <Button
                      variant="link"
                      size="sm"
                      onClick={d.onClickRetry}
                      disabled={!d.hasKeywords || d.submitting || !!d.pendingJobId}
                      className="ml-2 uppercase tracking-[0.18em]"
                    >
                      {tDesk('retry')}
                    </Button>
                  </Banner>
                )}
                {d.isFallbackReport && (
                  <Banner tone="info" title={tDesk('fallbackTitle')}>
                    <span>{tDesk('fallbackBody')}</span>
                    <Button
                      variant="link"
                      size="sm"
                      onClick={d.onClickRetry}
                      disabled={!d.hasKeywords || d.submitting || !!d.pendingJobId}
                      className="ml-2 uppercase tracking-[0.18em]"
                    >
                      {tDesk('retry')}
                    </Button>
                  </Banner>
                )}
                {d.isRawDump && (
                  <Banner tone="info" title={tDesk('rawDumpTitle')}>
                    <span>{tDesk('rawDumpBody')}</span>
                    <Button
                      variant="link"
                      size="sm"
                      onClick={d.onClickRetry}
                      disabled={!d.hasKeywords || d.submitting || !!d.pendingJobId}
                      className="ml-2 uppercase tracking-[0.18em]"
                    >
                      {tDesk('retry')}
                    </Button>
                  </Banner>
                )}
                {d.doneEmpty && (
                  <Banner tone="warning" title={tDesk('doneEmptyTitle')}>
                    <span>{tDesk('doneEmptyBody')}</span>
                    <Button
                      variant="link"
                      size="sm"
                      onClick={d.onClickRetry}
                      disabled={!d.hasKeywords || d.submitting || !!d.pendingJobId}
                      className="ml-2 uppercase tracking-[0.18em]"
                    >
                      {tDesk('retry')}
                    </Button>
                  </Banner>
                )}
                {d.job?.status === 'cancelled' && (
                  <EmptyState tone="subtle" title={tDesk('cancelledNotice')} />
                )}

                {/* 단계별 timing chips */}
                {d.timingChips.length > 0 && (
                  <div className="border-t border-line-soft pt-3">
                    <div className="flex items-center justify-between text-xs uppercase tracking-[.18em] text-mute-soft">
                      <span>{tDesk('timingsLabel')}</span>
                      {d.elapsedSec != null && (
                        <span className="tabular-nums normal-case tracking-normal">
                          {tDesk('elapsedLabel')} {d.elapsedSec}s
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {d.timingChips.map((c) => (
                        <span
                          key={c.key}
                          className="inline-flex items-center rounded-pill border border-line bg-paper px-2 py-0.5 text-xs text-mute"
                        >
                          {c.text}
                        </span>
                      ))}
                      {d.skippedSteps?.map((s) => (
                        <span
                          key={`skip-${s}`}
                          className="inline-flex items-center rounded-pill border border-warning-line bg-warning-bg px-2 py-0.5 text-xs text-ink-2"
                        >
                          {tDesk('skippedChipPrefix')} {s}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* footer — footNote(좌) + CTA(우) 한 줄, border-top (§S1). done-handoff
            에서는 핸드오프 자체가 CTA 를 제공하므로 숨김. */}
        {!doneHandoff && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line-soft px-5 py-3.5">
            <span className="text-xs text-mute-soft">{footNote}</span>
            {d.deskRunning ? (
              d.job &&
              (d.job.cancel_requested ? (
                <span className="text-xs text-mute-soft">
                  {tDesk('stopRequested')}
                </span>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void d.cancelJob(d.job!.id)}
                >
                  {tDesk('stop')}
                </Button>
              ))
            ) : (
              <Button
                variant="primary"
                size="sm"
                // README CTA = ink 필 pill (999px). primary=ink bg(각진 amore
                // divergence 교정) + !rounded-pill 로 sm 의 rounded-sm(14) 을
                // 덮어 pill 로. rightIcon 화살표로 "Search →" 재현.
                className="!rounded-pill"
                onClick={d.onClickRun}
                disabled={!d.canRun}
                loading={d.submitting || !!d.pendingJobId || d.isWorking}
                loadingLabel={tCommon('loading')}
                rightIcon={
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M3 8h9M8.5 4.5 12 8l-3.5 3.5"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                }
              >
                {tDesk('search')}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* 미리보기 모달 (기존 로직) */}
      <Modal
        open={d.previewOpen && d.showResult && d.job != null}
        onClose={() => d.setPreviewOpen(false)}
        size="full"
        title={
          d.job ? `${d.job.keywords.join(', ')} · ${tDesk('reportTitle')}` : ''
        }
        footer={
          d.job ? (
            <>
              <DownloadMenu
                tone="ghost"
                align="end"
                disabled={d.exporting}
                items={[
                  {
                    format: 'md',
                    kind: 'blob',
                    filename: `${d.buildFilename()}.md`,
                    build: () =>
                      new Blob([d.job!.output ?? ''], {
                        type: 'text/markdown;charset=utf-8',
                      }),
                  },
                  {
                    format: 'docx',
                    kind: 'action',
                    onSelect: () => d.downloadDocx(d.job!.output ?? ''),
                  },
                ]}
              />
              <ShareMenu
                align="end"
                disabled={!d.job.output}
                items={[
                  {
                    destination: 'google-docs',
                    title: d.buildFilename(),
                    getBlob: async () => {
                      const res = await fetch('/api/desk/export', {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({
                          markdown: d.job!.output ?? '',
                          filename: d.buildFilename(),
                          title: d.job!.keywords?.length
                            ? `데스크 리서치 — ${d.job!.keywords.join(', ')}`
                            : '데스크 리서치',
                        }),
                      });
                      return {
                        blob: await res.blob(),
                        mimeType:
                          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                      };
                    },
                  },
                ]}
              />
            </>
          ) : null
        }
      >
        {d.job && <DeskResultView job={d.job} tDesk={tDesk} />}
      </Modal>

      {/* 통일 "전체 보기" — 이전 산출물 드롭다운(최근 20) + 선택 job 리포트.
          리포트 상세 렌더는 PR2 영역(DeskResultView 그대로, 회귀 방지). */}
      {d.renderInSlot(
        <WidgetFullviewPanel
          title="데스크 리서치 — 전체 보기"
          subtitle={
            d.fullviewJob
              ? `${d.fullviewJob.keywords.join(', ')} · ${tDesk('reportTitle')}`
              : '완료된 리포트를 풀스크린으로 봅니다'
          }
          onClose={d.closeFullview}
        >
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line-soft px-5 py-3">
              {d.jobs.length > 0 ? (
                <Select
                  size="sm"
                  fullWidth={false}
                  aria-label="이전 산출물 선택"
                  className="min-w-[280px]"
                  value={d.fullviewJob?.id ?? ''}
                  onChange={(e) => d.setSelectedJobId(e.target.value || null)}
                  options={d.jobs.map((j) => ({
                    value: j.id,
                    label: deskJobSelectorLabel(j),
                  }))}
                />
              ) : (
                <span className="text-sm text-mute-soft">이전 산출물 없음</span>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {d.fullviewJob &&
              d.fullviewJob.status === 'done' &&
              d.fullviewJob.output ? (
                <div className="px-6 py-6">
                  <DeskResultView job={d.fullviewJob} tDesk={tDesk} />
                </div>
              ) : d.fullviewHydrationFailed ? (
                <div className="flex h-full items-center justify-center p-10">
                  <EmptyState
                    tone="subtle"
                    title="리포트를 불러오지 못했습니다"
                    description="네트워크 상태를 확인한 뒤 다시 시도해 주세요."
                    action={
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={d.retryHydration}
                      >
                        {tDesk('retry')}
                      </Button>
                    }
                  />
                </div>
              ) : d.fullviewNeedsHydration ? (
                <div className="flex h-full items-center justify-center p-10">
                  <BrandLoader size={36} label={tCommon('loading')} />
                </div>
              ) : d.fullviewJob ? (
                <div className="flex h-full items-center justify-center p-10">
                  <EmptyState
                    tone="subtle"
                    title="이 산출물은 완료되지 않았습니다"
                    description="위 드롭다운에서 완료된 다른 산출물을 선택해 주세요."
                  />
                </div>
              ) : (
                <div className="flex h-full items-center justify-center p-10">
                  <EmptyState
                    tone="subtle"
                    title="아직 완료된 리포트가 없습니다"
                    description="검색을 실행하면 결과 리포트를 여기서 풀스크린으로 볼 수 있어요."
                  />
                </div>
              )}
            </div>
          </div>
        </WidgetFullviewPanel>,
      )}
    </>
  );
}
