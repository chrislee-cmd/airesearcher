'use client';

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { ChromeButton } from '@/components/ui/chrome-button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Modal } from '@/components/ui/modal';
import { Textarea } from '@/components/ui/textarea';
import { SelectMenu } from '@/components/ui/select-menu';
import { ShareInviteButton } from '@/components/share/share-invite-button';
import { useToast } from '@/components/toast-provider';
import {
  isEditableToplineBlockType,
  isToplineHardBillingMessage,
} from '@/lib/interview-v2/types';
import { useInterviewTopline } from '@/hooks/use-interview-topline';
import { useCountUp } from '@/hooks/use-count-up';
import { Prose, ToplineBlockView } from './topline-blocks';

// 출력 언어 선택 옵션 — SSOT 는 topline-prompt.ts 의 TOPLINE_OUTPUT_LANGS
// (zod enum) / TOPLINE_DEFAULT_LANG. 여기선 서버 프롬프트 모듈을 client 번들에
// 끌어오지 않으려 라벨만 로컬로 미러한다(값은 반드시 동기 유지). 라벨은 각
// 언어의 자기표기 — locale 무관하게 통용.
const TOPLINE_LANG_OPTIONS = [
  { value: 'ko', label: '한국어' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'zh', label: '中文' },
  { value: 'es', label: 'Español' },
  { value: 'th', label: 'ไทย' },
] as const;
const TOPLINE_DEFAULT_LANG = 'ko';
// 재생성 방향 입력 최대 길이 — SSOT 는 topline-prompt.ts 의 TOPLINE_DIRECTION_MAX.
// 서버 프롬프트 모듈을 client 번들에 끌어오지 않으려 값만 로컬로 미러한다(반드시
// 동기 유지). textarea maxLength 와 route zod .max 가 같은 값을 공유한다.
const TOPLINE_DIRECTION_MAX = 600;
import {
  useToplineDragToAsk,
  type PendingQa,
} from '@/hooks/use-topline-drag-to-ask';
import { useToplineEdit } from '@/hooks/use-topline-edit';
import { useToplineImport } from '@/hooks/use-topline-import';
import {
  useToplineSectionInsert,
  type PendingSection,
} from '@/hooks/use-topline-section-insert';
import { useToplineSelection, ToplineAskPopup } from './topline-selection';

// 인터뷰 탑라인 보고서 — 우측 패널 탭1. interview_toplines.blocks 를 보고서
// 톤으로 렌더한다. 각 블록은 data-block-id 를 노출해 후속 drag-to-ask 가
// "이 블록 아래 삽입"을 anchor 로 잡을 수 있게 한다 (사용자 결정 #2 — DOM 계약).
//
// 상태(GET status + stale): generating=skeleton, done=blocks, stale=배너+
// 기존 보고서 유지, error/none=CTA. 재생성은 탭 헤더 우측 버튼(명시적 — Opus 비용).
//
// drag-to-ask pending 삽입 카드 — anchor 블록 바로 아래에 스트리밍 답변을
// 렌더한다. pending 은 옅은 배경 + 점선 테두리로 확정 블록과 시각 구분(사용자
// 결정 flow 3). 스트리밍 완료 시 [✓ 유지][✕ 버리기], 에러 시 버리기만.
function PendingQaCard({
  qa,
  onKeep,
  onDiscard,
}: {
  qa: PendingQa;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  const t = useTranslations('InterviewsV2');
  const streaming = qa.phase === 'streaming';
  const errored = qa.phase === 'error';
  return (
    <div
      aria-busy={streaming}
      className={`my-3 rounded-sm border-l-2 border-l-amore px-4 py-3 ${
        streaming
          ? 'border border-dashed border-line bg-paper-soft'
          : errored
            ? 'border border-warning bg-warning-bg'
            : 'border border-line bg-paper'
      }`}
    >
      <div className="mb-2 flex items-start gap-2">
        <span className="mt-0.5 shrink-0 rounded-xs bg-amore-bg px-1.5 py-0.5 text-xs-soft font-semibold uppercase tracking-[0.18em] text-amore">
          Q
        </span>
        <div className="min-w-0">
          <p className="text-md font-medium leading-[1.6] text-ink-2">
            {qa.question}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {/* 근거 소스 배지 — 웹 답변임을 명시해 인터뷰 데이터와 혼동 방지. */}
            <span className="shrink-0 rounded-xs border border-line-soft px-1.5 py-0.5 text-xs-soft font-semibold uppercase tracking-[0.18em] text-mute-soft">
              {qa.mode === 'web'
                ? `🌐 ${t('toplineAskModeWeb')}`
                : `📚 ${t('toplineAskModeInterview')}`}
            </span>
            {qa.selectedExcerpt && (
              <p className="line-clamp-2 min-w-0 text-xs-soft italic text-mute">
                “{qa.selectedExcerpt}”
              </p>
            )}
          </div>
        </div>
      </div>

      {errored ? (
        <p className="text-sm text-warning">
          {qa.errorMsg === 'web_search_unavailable'
            ? t('toplineAskWebUnavailable')
            : `${t('toplineAskError')}${qa.errorMsg ? ` (${qa.errorMsg})` : ''}`}
        </p>
      ) : qa.answerMd ? (
        <Prose md={qa.answerMd} citations={qa.citations} />
      ) : (
        <div className="flex items-center gap-2 text-sm uppercase tracking-[0.22em] text-amore">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amore" />
          {qa.mode === 'web'
            ? t('toplineAskThinkingWeb')
            : t('toplineAskThinking')}
        </div>
      )}

      {(qa.phase === 'done' || errored) && (
        <div className="mt-3 flex items-center justify-end gap-2 border-t border-line-soft pt-2">
          {qa.phase === 'done' && (
            <Button
              variant="primary"
              size="xs"
              onClick={onKeep}
              disabled={qa.saving}
            >
              ✓ {t('toplineAskKeep')}
            </Button>
          )}
          <Button
            variant="ghost"
            size="xs"
            onClick={onDiscard}
            disabled={qa.saving}
          >
            ✕ {t('toplineAskDiscard')}
          </Button>
        </div>
      )}
    </div>
  );
}

// 인라인 블록 편집기 — 선택 블록의 md 를 plain textarea 로 열어 내용만 수정한다
// (스타일 X — 사용자 결정 1·3). 저장 = 낙관적 반영 + PATCH(edit_block), 취소 =
// 원문 유지(편집 모드만 닫음). 변경 없거나 빈 내용이면 저장은 취소처럼 동작.
function BlockEditor({
  initialMd,
  saving,
  onSave,
  onCancel,
}: {
  initialMd: string;
  saving: boolean;
  onSave: (nextMd: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations('InterviewsV2');
  const [draft, setDraft] = useState(initialMd);
  const unchanged = draft.trim() === initialMd.trim();

  return (
    <div className="my-2 rounded-sm border border-ink bg-paper p-3">
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={Math.min(12, Math.max(3, draft.split('\n').length + 1))}
        autoFocus
        disabled={saving}
        aria-label={t('toplineEditAction')}
      />
      <p className="mt-1.5 text-xs-soft text-mute-soft">{t('toplineEditHint')}</p>
      <div className="mt-2 flex items-center justify-end gap-2 border-t border-line-soft pt-2">
        <Button variant="ghost" size="xs" onClick={onCancel} disabled={saving}>
          {t('toplineEditCancel')}
        </Button>
        <Button
          variant="primary"
          size="xs"
          onClick={() => onSave(draft)}
          disabled={saving || unchanged || draft.trim().length === 0}
        >
          {t('toplineEditSave')}
        </Button>
      </div>
    </div>
  );
}

// 섹션 사이 삽입 — 블록 gap 의 hover 존. 평소엔 얇은 여백이다가 hover(또는
// 패널 열림) 시 중앙에 "＋ 섹션 추가" 가 fade-in 한다. 클릭하면 인라인 명령
// 입력 패널로 바뀌어 자연어 지시를 받아 그 자리에 새 섹션을 생성·삽입한다.
// anchor = gap 바로 위 블록 id(최상단 gap 이면 null). 트리거 UX 는 fungible
// (spec §C) 이나 요청과 정합해 1안으로 채택.
function SectionGap({
  open,
  busy,
  onOpen,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  onOpen: () => void;
  onClose: () => void;
  onSubmit: (prompt: string) => void;
}) {
  const t = useTranslations('InterviewsV2');
  const [draft, setDraft] = useState('');

  const submit = () => {
    const p = draft.trim();
    if (!p || busy) return;
    onSubmit(p);
    setDraft('');
  };

  if (open) {
    return (
      <div className="my-2 rounded-sm border border-ink bg-paper p-3">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === 'Enter' &&
              !e.shiftKey &&
              !(
                e.nativeEvent as KeyboardEvent['nativeEvent'] & {
                  isComposing?: boolean;
                }
              ).isComposing
            ) {
              e.preventDefault();
              submit();
            }
            if (e.key === 'Escape') onClose();
          }}
          rows={2}
          autoFocus
          disabled={busy}
          placeholder={t('toplineSectionPlaceholder')}
          aria-label={t('toplineSectionAdd')}
        />
        <div className="mt-2 flex items-center justify-end gap-2 border-t border-line-soft pt-2">
          <Button variant="ghost" size="xs" onClick={onClose} disabled={busy}>
            {t('toplineSectionCancel')}
          </Button>
          <Button
            variant="primary"
            size="xs"
            onClick={submit}
            disabled={busy || draft.trim().length === 0}
          >
            {t('toplineSectionSubmit')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="group relative flex h-6 items-center justify-center">
      {/* hover 시 드러나는 중앙 구분선 — gap 임을 시각화(평소 숨김). */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line-soft opacity-0 transition-opacity group-hover:opacity-100"
      />
      <div className="relative bg-paper px-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <Button variant="ghost" size="xs" onClick={onOpen}>
          ＋ {t('toplineSectionAdd')}
        </Button>
      </div>
    </div>
  );
}

// 섹션 생성 중 로딩 카드 — 명령 제출 후 생성+영속이 끝날 때까지 그 gap 에
// 렌더된다(낙관적 자리표시). 성공 시 refetch 가 실제 inserted_section 으로
// 대체하고, 실패 시 제거된다(hook 이 롤백 + toast).
function PendingSectionCard({ section }: { section: PendingSection }) {
  const t = useTranslations('InterviewsV2');
  return (
    <div
      aria-busy
      className="my-3 rounded-sm border border-dashed border-line bg-paper-soft px-4 py-3"
    >
      <div className="flex items-center gap-2 text-sm uppercase tracking-[0.22em] text-amore">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amore" />
        {t('toplineSectionGenerating')}
      </div>
      <p className="mt-1 line-clamp-2 text-xs-soft italic text-mute">
        “{section.prompt}”
      </p>
    </div>
  );
}

function StaleBanner({
  onRegenerate,
  disabled,
  stuck = false,
}: {
  onRegenerate: () => void;
  disabled: boolean;
  // 파일 변경 stale(기본) vs 생성 멈춤 stuck — 안내 문구를 바꾼다.
  stuck?: boolean;
}) {
  const t = useTranslations('InterviewsV2');
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-sm border border-amore bg-amore-bg px-4 py-3">
      <span className="text-md text-ink-2">
        {t(stuck ? 'toplineStuckBanner' : 'toplineStaleBanner')}
      </span>
      <Button
        variant="secondary"
        size="sm"
        onClick={onRegenerate}
        disabled={disabled}
      >
        {t('toplineRegenerate')}
      </Button>
    </div>
  );
}

// map-reduce 진행률 — 전 문서 순회 중 "N/M 문서 분석" + 진행 바. map_total 이
// 없으면(레거시/시작 전) 아무것도 그리지 않는다. 이 문구가 "빠짐없이 전 문서를
// 읽는 중"을 사용자에게 보이게 해 긴 생성 시간을 납득시킨다(카드 #430).
// export — 위젯 카드 본문(interviews-card)이 팝업 밖 ambient 진행률로 재사용한다
// (로직 복붙 금지, card #434). 여기가 SSOT.
export function ToplineMapProgress({
  mapTotal,
  mapDone,
}: {
  mapTotal?: number | null;
  mapDone?: number | null;
}) {
  const t = useTranslations('InterviewsV2');
  const total = mapTotal ?? 0;
  const rawDone = total > 0 ? Math.max(0, Math.min(mapDone ?? 0, total)) : 0;
  // 문서 수 count-up — "N/M 문서 분석" 의 N 이 이전 값에서 새 진행 수까지
  // 부드럽게 증가. reduced-motion 시 즉시 최종값(훅이 내부 존중). 진행 바(pct)
  // 는 실제 진행값 기준이라 표시 수와 미세 lag 은 있어도 정확도 유지.
  const displayDone = useCountUp(rawDone);
  if (total <= 0) return null;
  const pct = Math.round((rawDone / total) * 100);
  return (
    <div className="space-y-1.5">
      <div className="text-sm text-mute">
        {t('toplineMapProgress', { done: displayDone, total })}
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-line-soft">
        <div
          className="h-full rounded-full bg-amore transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// reduce(보고서 작성) 진행 신호 — map(N/M) 이 끝나고 streamObject 가 블록을
// 스트리밍하는 동안 "보고서 작성 중… (N블록)" 을 노출한다. blockCount 는 지금까지
// 도착한 부분 블록 수. count 가 0 이면(첫 블록 도착 전) 수치 없는 문구만 그린다.
// export — 카드 ambient 밴드(interviews-card)가 팝업 밖에서 재사용한다. 여기가 SSOT.
export function ToplineReduceProgress({
  blockCount,
}: {
  blockCount?: number | null;
}) {
  const t = useTranslations('InterviewsV2');
  const count = Math.max(0, blockCount ?? 0);
  return (
    <div className="flex items-center gap-2 text-sm text-mute">
      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amore" />
      {count > 0
        ? t('toplineReduceProgress', { count })
        : t('toplineReduceProgressStart')}
    </div>
  );
}

function GeneratingSkeleton({
  mapTotal,
  mapDone,
  inReduce,
  blockCount,
  onCancel,
}: {
  mapTotal?: number | null;
  mapDone?: number | null;
  inReduce?: boolean;
  blockCount?: number | null;
  // 생성 강제종료 — 제공되면 진행 표시 옆에 "생성 중단" 버튼을 노출한다.
  onCancel?: () => void;
}) {
  const t = useTranslations('InterviewsV2');
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm uppercase tracking-[0.22em] text-amore">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amore" />
          {t('toplineGenerating')}
        </div>
        {onCancel && (
          <Button variant="ghost" size="xs" onClick={onCancel}>
            {t('toplineCancel')}
          </Button>
        )}
      </div>
      {/* map 순회 중이면 N/M, map 이 끝나고 reduce 스트리밍 중이면 "작성 중(N블록)". */}
      {inReduce ? (
        <ToplineReduceProgress blockCount={blockCount} />
      ) : (
        <ToplineMapProgress mapTotal={mapTotal} mapDone={mapDone} />
      )}
      <Skeleton className="h-6 w-1/3 rounded-sm" />
      <Skeleton className="h-24 w-full rounded-sm" />
      <Skeleton className="h-6 w-1/4 rounded-sm" />
      <Skeleton className="h-32 w-full rounded-sm" />
    </div>
  );
}

export function ToplineView({ projectId }: { projectId: string }) {
  const t = useTranslations('InterviewsV2');
  const {
    toplineId,
    status,
    blocks,
    stale,
    indexed,
    loading,
    fetchError,
    generating,
    generate,
    refetch,
    cancel,
    applyBlockMd,
    mapTotal,
    mapDone,
    generatingStale,
    savedLang,
    savedDirection,
    source,
    errorMessage,
  } = useInterviewTopline(projectId);

  const toast = useToast();
  const hasBlocks = blocks.length > 0;
  // 편집전용 모드 — 업로드된 외부 보고서인지. 재생성 덮어쓰기 경고 판단에 쓴다.
  const isUploaded = source === 'uploaded';
  // 하드 결제/크레딧(402) 장애로 error 종결됐는지 — 일반 실패("잠시 후 재시도")와
  // 달리 "결제/크레딧 확인 필요" 를 안내한다(카드 #555, 사용자 대기 표시). 자동
  // 재시도는 selfheal 이 제외하므로 사용자가 충전 후 재생성해야 한다.
  const errorIsHardBilling =
    status === 'error' && isToplineHardBillingMessage(errorMessage);
  // 재생성 버튼 활성 = 인덱싱 완료 & POST in-flight 아님 & (생성 중 아님 OR
  // 생성이 멈춰 stuck). stuck('generating' 인데 updated_at 오래됨 = 함수 사망)이면
  // 재생성/추가질문 잠금을 푼다(결정 A). 정상 진행 중(non-stale generating)은
  // 여전히 비활성 — 중복 생성 방지 유지.
  const canGenerate =
    indexed && !generating && (status !== 'generating' || generatingStale);

  // reduce 단계 감지 — map(전 문서 순회)이 끝나면(map_done ≥ map_total) reduce
  // (보고서 작성)로 넘어간다. 이때 streamObject 가 blocks 를 증분 스트리밍하므로
  // "보고서 작성 중… (N블록)" 신호를 노출한다. map_total 이 없으면(레거시) map
  // 진행률 자체를 안 그리므로 reduce 신호도 skip.
  const mapComplete = !!mapTotal && (mapDone ?? 0) >= mapTotal;
  const inReduce = status === 'generating' && mapComplete;

  // 출력 언어 선택(입력 transcript 언어와 독립 — 사용자 결정 1). 기본 = 한국어.
  // 저장된 보고서가 있으면 그 언어로 초기화(GET 이 output_lang 반환)해, 사용자가
  // 마지막에 고른 언어를 선택기에 반영한다. 언어를 바꿔 재생성하면 캐시가
  // 안 걸리고(결정 3) 새 언어로 다시 생성된다.
  const [outputLang, setOutputLang] = useState<string>(TOPLINE_DEFAULT_LANG);
  useEffect(() => {
    // GET 이 저장된 언어를 실어오면 선택기를 그 값으로 초기화(사용자가 마지막에
    // 고른 언어 반영). 이후 사용자가 자유롭게 바꿀 수 있고, 재생성 완료 시
    // savedLang 이 새 값으로 갱신돼도 동일 값이라 무해.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync selector to server-persisted lang on load (use-interview-topline savedLang)
    if (savedLang) setOutputLang(savedLang);
  }, [savedLang]);

  // 편집(인라인 텍스트 수정)은 코퍼스가 필요 없다 — 이미 렌더된 블록의 md 만
  // 바꾼다. 그래서 indexed 와 무관하게 보고서가 렌더 중이면 활성한다. 편집전용
  // (외부 보고서 업로드) 프로젝트는 인터뷰 문서가 아예 없을 수 있는데(indexed=
  // false), 그래도 업로드한 보고서를 편집할 수 있어야 한다(사용자 핵심 요구).
  const editEnabled =
    hasBlocks && !loading && !fetchError && status !== 'generating';
  // drag-to-ask / 섹션 삽입은 인터뷰 근거(코퍼스)로 답을 생성하므로 indexed 필수.
  // 코퍼스가 없으면(편집전용 doc-less) 이 두 기능은 숨기고 인라인 편집만 남긴다.
  const askEnabled = editEnabled && indexed;
  const scrollRef = useRef<HTMLDivElement>(null);
  // 선택(→ 팝업)은 편집만으로도 의미가 있으므로 editEnabled 로 활성.
  const { selection, clear } = useToplineSelection(scrollRef, editEnabled);
  const dta = useToplineDragToAsk({ projectId, onMerged: refetch });

  // 인라인 편집 — 현재 편집 중인 블록 id + 저장 오케스트레이션(낙관 + 롤백).
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const edit = useToplineEdit({ projectId, applyBlockMd, onSaved: refetch });

  // 섹션 사이 삽입 — gap 명령 프롬프트 → 생성+영속. 실패 시 toast 안내(롤백).
  const section = useToplineSectionInsert({
    projectId,
    onInserted: refetch,
    onError: (code) =>
      toast.push(
        code === 'no_answer'
          ? t('toplineSectionNoContent')
          : `${t('toplineSectionError')} (${code})`,
        { tone: 'warn' },
      ),
  });
  // 현재 명령 패널이 열린 gap 키('top' = 최상단 gap, 그 외 = anchor 블록 id).
  // null = 열린 패널 없음.
  const [openGapKey, setOpenGapKey] = useState<string | null>(null);

  // 편집전용 모드 — 외부 보고서(Markdown) 업로드 → md→blocks 파싱·저장 후 편집
  // 모드로 진입. 진입 2버튼("자체 보고서 업로드")과 숨은 file input 이 짝을 이룬다.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importReport = useToplineImport({
    projectId,
    onImported: async () => {
      // 저장된 보고서를 다시 읽어 편집 모드로 열고 성공을 알린다.
      await refetch();
      toast.push(t('toplineImported'), { tone: 'amore' });
    },
    onError: (code) =>
      toast.push(
        code === 'empty_report'
          ? t('toplineImportEmpty')
          : code === 'unsupported_file_type'
            ? t('toplineImportUnsupported')
            : code === 'file_too_large'
              ? t('toplineImportTooLarge')
              : `${t('toplineImportError')} (${code})`,
        { tone: 'warn' },
      ),
  });
  const openReportPicker = () => fileInputRef.current?.click();
  const handleReportFile = (file: File | undefined) => {
    if (!file) return;
    void (async () => {
      await importReport.importFile(file);
    })();
  };

  // 팝업 "편집" 액션 가용성 — 선택 블록이 텍스트 블록일 때만(table/chart/pie 제외).
  const selectionBlock = selection
    ? blocks.find((b) => b.id === selection.anchorBlockId)
    : undefined;
  const selectionEditable =
    !!selectionBlock && isEditableToplineBlockType(selectionBlock.type);

  const handleSaveEdit = async (
    blockId: string,
    prevMd: string,
    nextMd: string,
  ) => {
    // 변경 없음/빈 내용 → 서버 왕복 없이 편집만 닫는다(취소와 동일).
    if (!nextMd.trim() || nextMd.trim() === prevMd.trim()) {
      setEditingBlockId(null);
      return;
    }
    const result = await edit.save(blockId, prevMd, nextMd);
    if (result.ok) {
      setEditingBlockId(null);
      toast.push(t('toplineEditSaved'), { tone: 'amore' });
    } else {
      // 롤백은 hook 이 이미 수행 — 편집 모드는 유지해 재시도 가능.
      toast.push(`${t('toplineEditError')} (${result.error})`, { tone: 'warn' });
    }
  };

  // 재생성 방향 모달 — 🔄 재생성 버튼/stale 배너에서 열린다. 방향은 자유 텍스트
  // 입력(선택 — 빈 값이면 방향 없이 재생성). 삽입 Q&A 유실 경고(사용자 결정 3)도
  // 별도 모달이 아니라 이 모달 안에 함께 노출한다(inserted_qa 가 있을 때만).
  // 재생성해도 보존되는 사용자 삽입 블록(추가질문 Q&A + 삽입 섹션) 존재 여부 —
  // 재생성 모달에 "보존됨" 안내를 노출할지 판단.
  const hasInsertedBlocks = blocks.some(
    (b) => b.type === 'inserted_qa' || b.type === 'inserted_section',
  );
  const [regenOpen, setRegenOpen] = useState(false);
  const [direction, setDirection] = useState('');
  // 저장된 방향을 모달 입력 초기값으로 반영 — 마지막에 지정한 방향을 다시 보여줘
  // 미세 조정을 쉽게 한다(savedLang 선택기 초기화와 동일 패턴).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync textarea to server-persisted direction on load (savedDirection)
    if (savedDirection) setDirection(savedDirection);
  }, [savedDirection]);
  const requestRegenerate = () => setRegenOpen(true);
  const confirmRegenerate = () => {
    setRegenOpen(false);
    // 빈 방향은 undefined 로 넘겨 서버가 "방향 없음"(옛 동작)으로 처리하게 한다.
    void generate(true, outputLang, direction.trim() || undefined);
  };

  // Word 다운로드 = attachment GET 으로 브라우저 다운로드(쿠키 포함 네비게이션).
  const downloadWord = () => {
    const a = document.createElement('a');
    a.href = `/api/interviews/v2/topline/export?project_id=${encodeURIComponent(
      projectId,
    )}&format=docx`;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  // Google Docs 공유 = admin Drive 로 변환 업로드 → 링크 복사 + 새 탭.
  const [sharing, setSharing] = useState(false);
  const shareGoogleDocs = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const res = await fetch('/api/interviews/v2/topline/share-gdoc', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ project_id: projectId }),
      });
      const json = (await res.json().catch(() => null)) as
        | { url?: string; error?: string }
        | null;
      if (!res.ok || !json?.url) {
        // #770 체계 reauth / 미구성 등은 서버 message 를 그대로 안내.
        const code = json?.error ?? `HTTP ${res.status}`;
        toast.push(
          code === 'admin_google_reauth_required' ||
            code === 'google_admin_not_configured'
            ? t('toplineShareUnavailable')
            : `${t('toplineShareError')} (${code})`,
          { tone: 'warn' },
        );
        return;
      }
      // 링크 복사(실패해도 새 탭은 연다).
      try {
        await navigator.clipboard.writeText(json.url);
        toast.push(t('toplineShareCopied'), { tone: 'amore' });
      } catch {
        toast.push(t('toplineShareOpened'), { tone: 'amore' });
      }
      window.open(json.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast.push(
        `${t('toplineShareError')} (${e instanceof Error ? e.message : 'network'})`,
        { tone: 'warn' },
      );
    } finally {
      setSharing(false);
    }
  };

  const blockIds = useMemo(() => new Set(blocks.map((b) => b.id)), [blocks]);
  const orphanPending = dta.pending.filter(
    (p) => !blockIds.has(p.anchorBlockId),
  );

  // 섹션 삽입 가용 = drag-to-ask 와 동일 조건(보고서 done + blocks 있음). 생성/
  // 로딩 중엔 gap 을 숨긴다. 최상단 gap(anchor=null) pending 은 맨 앞에, anchor
  // 소실(그 사이 재생성 등) pending 은 말미에 렌더한다.
  const sectionEnabled = askEnabled;
  const topPendingSections = section.pending.filter(
    (p) => p.anchorBlockId === null,
  );
  const orphanPendingSections = section.pending.filter(
    (p) => p.anchorBlockId !== null && !blockIds.has(p.anchorBlockId),
  );

  // gap 렌더 헬퍼 — anchor(gap 위 블록 id, null=최상단) + 고유 key 로 SectionGap
  // 을 만든다. 제출 시 그 anchor 로 섹션 생성·삽입을 kick 하고 패널을 닫는다.
  const renderGap = (anchorBlockId: string | null, gapKey: string) => (
    <SectionGap
      open={openGapKey === gapKey}
      busy={false}
      onOpen={() => setOpenGapKey(gapKey)}
      onClose={() => setOpenGapKey((k) => (k === gapKey ? null : k))}
      onSubmit={(prompt) => {
        void section.insert(anchorBlockId, prompt);
        setOpenGapKey(null);
      }}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 편집전용 모드 진입용 숨은 file input — 진입 2버튼의 "자체 보고서 업로드"
          가 ref 로 연다. 시각 컨트롤은 <Button> 이라 이 native input 은 화면에
          없다(디자인 시스템 위반 아님 — 파일 선택 primitive 부재로 hidden input
          은 표준 패턴, credits-usage-predictor 의 range input 처럼 disable 명시). */}
      {/* eslint-disable-next-line react/forbid-elements -- 숨은 파일 선택 input; 가시 컨트롤은 <Button>, 파일 피커 primitive 미존재 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown,.txt,.docx,.pdf,.html,.htm,text/markdown,text/plain,text/html,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={(e) => {
          handleReportFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {/* 탭 헤더 우측 = 재생성 버튼 (명시적 — Opus 비용). blocks 가 이미 있을
          때만 노출(최초 생성은 본문 CTA 가 담당). */}
      {hasBlocks && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line-soft px-6 py-2.5">
          <span className="text-xs font-semibold uppercase tracking-[0.22em] text-mute-soft">
            {t('toplineReportLabel')}
          </span>
          <div className="flex items-center gap-3">
            {/* 내보내기 / 공유 — 전부 부 액션이라 한 묶음(quiet chrome 통일).
                Word 다운로드 + Google Docs 공유 + 링크로 공유(#477, export 와
                구분되는 초대 게이트 링크, toplineId 생성 후 활성화). 톤 일치 →
                주 조작(재생성)과 시각 위계로 분리. */}
            <div className="flex items-center gap-1.5">
              <ChromeButton size="sm" onClick={downloadWord} title={t('toplineExportWord')}>
                ⬇ {t('toplineExportWord')}
              </ChromeButton>
              <ChromeButton
                size="sm"
                onClick={() => void shareGoogleDocs()}
                disabled={sharing}
                title={t('toplineShareGdoc')}
              >
                {sharing ? `⏳ ${t('toplineSharing')}` : `📄 ${t('toplineShareGdoc')}`}
              </ChromeButton>
              <ShareInviteButton
                resourceType="interview_topline"
                resourceId={toplineId}
              />
            </div>
            {/* 그룹 구분선 — 내보내기/공유 vs 생성 제어 위계 분리. */}
            <div className="h-5 w-px bg-line-soft" aria-hidden />
            {/* 생성 제어 — 분석 언어 + 🔄 재생성(이 화면 주 조작). 재생성 시 이
                언어로 강제(입력 파일 언어 독립). 언어를 바꾸고 재생성하면 캐시
                안 걸리고 새 언어로 재생성된다. */}
            <div className="flex items-center gap-2">
              <div className="w-[132px]">
                <SelectMenu
                  value={outputLang}
                  onChange={setOutputLang}
                  options={TOPLINE_LANG_OPTIONS.map((o) => ({
                    value: o.value,
                    label: o.label,
                  }))}
                  disabled={!canGenerate}
                  aria-label={t('toplineLangLabel')}
                />
              </div>
              <Button
                variant="ghost"
                size="xs"
                onClick={requestRegenerate}
                disabled={!canGenerate}
                title={t('toplineRegenerate')}
              >
                🔄 {t('toplineRegenerate')}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {loading ? (
          <GeneratingSkeleton />
        ) : fetchError ? (
          <EmptyState
            tone="subtle"
            title={t('toplineLoadError')}
            description={fetchError}
          />
        ) : status === 'generating' && !hasBlocks && !generatingStale ? (
          // 살아 있는 첫 생성만 무한 스켈레톤. stuck(함수 사망)이면 아래 CTA 로
          // 떨어져 재생성 버튼을 노출한다(데드엔드 해제 — 결정 A/C).
          <GeneratingSkeleton
            mapTotal={mapTotal}
            mapDone={mapDone}
            inReduce={inReduce}
            blockCount={blocks.length}
            onCancel={() => void cancel()}
          />
        ) : hasBlocks ? (
          <>
            {/* 생성 중이면 상단에 진행 표시. map 순회 중엔 N/M, reduce(보고서
                작성) 중엔 "작성 중(N블록)". reduce 중엔 아래 <article> 의 blocks
                가 스트리밍으로 점진 렌더된다(부분/미완 블록은 서버가 접두만 보내
                graceful). stuck 이면 진행 표시 대신 아래 stuck 배너를 그린다. */}
            {status === 'generating' && !generatingStale && (
              <div className="mb-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm uppercase tracking-[0.22em] text-amore">
                    <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amore" />
                    {t('toplineGenerating')}
                  </div>
                  {/* 생성 강제종료 — 재생성 스트리밍(부분 블록 노출) 중에도 중단 가능. */}
                  <Button variant="ghost" size="xs" onClick={() => void cancel()}>
                    {t('toplineCancel')}
                  </Button>
                </div>
                {inReduce ? (
                  <ToplineReduceProgress blockCount={blocks.length} />
                ) : (
                  <ToplineMapProgress mapTotal={mapTotal} mapDone={mapDone} />
                )}
              </div>
            )}
            {/* 파일 변경 stale(정상 done) 또는 stuck generating(함수 사망) 이면
                재생성 CTA 배너. stuck 이면 문구를 바꿔 "멈춤" 을 알린다. */}
            {((stale && status !== 'generating') || generatingStale) && (
              <StaleBanner
                onRegenerate={requestRegenerate}
                disabled={!canGenerate}
                stuck={generatingStale}
              />
            )}
            {/* stagger — 완료 보고서 블록이 순차로 떠오르며 등장. 클래스만
                추가(DOM 무변경)라 블록 간 margin collapse 보존. reduce 단계
                스트리밍 중엔 새 블록만 마운트 1회 재생(기존 블록 재애니 없음).
                reduced-motion 은 globals.css 가 독립 존중. */}
            <article className="stagger">
              {/* 최상단 gap(맨 앞 삽입) + 그 자리 pending 로딩. */}
              {sectionEnabled && renderGap(null, 'top')}
              {topPendingSections.map((p) => (
                <PendingSectionCard key={p.id} section={p} />
              ))}
              {blocks.map((b) => (
                <Fragment key={b.id}>
                  {editingBlockId === b.id ? (
                    // 편집 모드 — 블록 대신 인라인 textarea 로 md 수정.
                    <BlockEditor
                      initialMd={b.md ?? ''}
                      saving={edit.savingId === b.id}
                      onSave={(nextMd) =>
                        void handleSaveEdit(b.id, b.md ?? '', nextMd)
                      }
                      onCancel={() => setEditingBlockId(null)}
                    />
                  ) : (
                    <ToplineBlockView block={b} />
                  )}
                  {/* anchor 블록 바로 아래에 pending 삽입을 렌더. */}
                  {dta.pending
                    .filter((p) => p.anchorBlockId === b.id)
                    .map((p) => (
                      <PendingQaCard
                        key={p.id}
                        qa={p}
                        onKeep={() => void dta.keep(p)}
                        onDiscard={() => dta.discard(p.id)}
                      />
                    ))}
                  {/* 이 블록 뒤 gap 의 섹션 생성 로딩(성공 시 실제 블록으로 대체). */}
                  {section.pending
                    .filter((p) => p.anchorBlockId === b.id)
                    .map((p) => (
                      <PendingSectionCard key={p.id} section={p} />
                    ))}
                  {/* 블록 사이 gap — hover +버튼 → 섹션 삽입. */}
                  {sectionEnabled && renderGap(b.id, b.id)}
                </Fragment>
              ))}
              {/* anchor 를 못 찾은 orphan(그 사이 재생성 등) — 말미에. */}
              {orphanPending.map((p) => (
                <PendingQaCard
                  key={p.id}
                  qa={p}
                  onKeep={() => void dta.keep(p)}
                  onDiscard={() => dta.discard(p.id)}
                />
              ))}
              {orphanPendingSections.map((p) => (
                <PendingSectionCard key={p.id} section={p} />
              ))}
            </article>
          </>
        ) : (
          // 빈 상태 진입 2버튼 — ① 탑라인 생성(기존 파이프라인) / ② 자체 보고서
          // 업로드(편집전용). 사용자가 최초 1회 명시 선택한다(자동 생성 없음 —
          // 기존과 동일). none/error/idle/stuck generating & 블록 없음 + 미인덱싱
          // (업로드는 인덱싱 없이도 가능)을 모두 이 화면이 커버한다.
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="max-w-[460px]">
              <h3 className="text-lg font-semibold text-ink-2">
                {generatingStale
                  ? t('toplineStuckTitle')
                  : errorIsHardBilling
                    ? t('toplineErrorBillingTitle')
                    : status === 'error'
                      ? t('toplineErrorTitle')
                      : t('toplineIntroTitle')}
              </h3>
              <p className="mt-2 text-md text-mute">
                {generatingStale
                  ? t('toplineStuckHint')
                  : errorIsHardBilling
                    ? t('toplineErrorBillingHint')
                    : status === 'error'
                      ? t('toplineErrorHint')
                      : !indexed
                        ? t('toplineNotIndexed')
                        : t('toplineIntroHint')}
              </p>
              {/* 분석 언어 선택 — 입력 파일 언어와 독립. 생성(①) 전용이라 업로드
                  버튼과 무관. 미인덱싱 시엔 생성이 불가라 disabled. */}
              <div className="mx-auto mt-5 flex max-w-[240px] flex-col items-start gap-1.5 text-left">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-mute-soft">
                  {t('toplineLangLabel')}
                </span>
                <SelectMenu
                  value={outputLang}
                  onChange={setOutputLang}
                  options={TOPLINE_LANG_OPTIONS.map((o) => ({
                    value: o.value,
                    label: o.label,
                  }))}
                  disabled={!canGenerate}
                  aria-label={t('toplineLangLabel')}
                />
              </div>
              {/* 두 버튼 나란히 — ① 생성(primary) / ② 업로드(secondary). */}
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void generate(false, outputLang)}
                  disabled={!canGenerate}
                >
                  {t('toplineGenerateCta')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={openReportPicker}
                  disabled={importReport.importing}
                >
                  {importReport.importing
                    ? `⏳ ${t('toplineImporting')}`
                    : `⬆ ${t('toplineUploadCta')}`}
                </Button>
              </div>
              {/* 편집전용 모드 안내 — 업로드는 생성을 건너뛰고 편집만 함을 명시. */}
              <p className="mx-auto mt-3 max-w-[380px] text-xs-soft text-mute-soft">
                {t('toplineUploadModeHint')}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* 선택 → 질문/편집 팝업. key 로 새 선택마다 입력 초기화. 코퍼스가 없는
          편집전용(doc-less) 에선 추가질문(askEnabled=false)을 숨기고 편집만 남긴다
          — 편집도 불가한 블록(table/chart)이면 팝업 자체를 띄우지 않는다. */}
      {editEnabled && selection && (askEnabled || selectionEditable) && (
        <ToplineAskPopup
          key={`${selection.anchorBlockId}:${selection.text}`}
          selection={selection}
          busy={false}
          askEnabled={askEnabled}
          editable={selectionEditable}
          onEdit={() => {
            setEditingBlockId(selection.anchorBlockId);
            clear();
          }}
          onSubmit={(q, mode) => {
            void dta.ask(selection.anchorBlockId, selection.text, q, mode);
            clear();
          }}
          onClose={clear}
        />
      )}

      {/* 재생성 방향 모달 — 자유 텍스트로 분석 방향을 지정(선택)하고 재생성한다.
          방향은 reduce 프롬프트에 주입돼 강조점·구성을 조정(근거 밖 생성은 금지).
          inserted_qa 가 있으면 유실 경고를 함께 노출(사용자 결정 3). */}
      <Modal
        open={regenOpen}
        onClose={() => setRegenOpen(false)}
        size="sm"
        title={t('toplineRegenTitle')}
        description={t('toplineRegenDirectionHint')}
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRegenOpen(false)}
            >
              {t('toplineRegenWarnCancel')}
            </Button>
            <Button variant="primary" size="sm" onClick={confirmRegenerate}>
              {t('toplineRegenWarnConfirm')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Textarea
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            rows={4}
            maxLength={TOPLINE_DIRECTION_MAX}
            placeholder={t('toplineRegenDirectionPlaceholder')}
            aria-label={t('toplineRegenDirectionLabel')}
          />
          {/* 편집전용(업로드) 보고서 덮어쓰기 경고 — 재생성은 인터뷰 데이터로
              새 보고서를 만들어 업로드 원본을 대체한다(사용자 결정 §B/D). */}
          {isUploaded && (
            <p className="rounded-sm border border-warning bg-warning-bg px-3 py-2 text-sm text-warning">
              {t('toplineRegenUploadedNote')}
            </p>
          )}
          {hasInsertedBlocks && (
            <p className="text-sm text-mute">{t('toplineRegenPreserveNote')}</p>
          )}
        </div>
      </Modal>
    </div>
  );
}
