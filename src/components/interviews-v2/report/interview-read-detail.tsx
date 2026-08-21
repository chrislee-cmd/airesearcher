'use client';

/* ────────────────────────────────────────────────────────────────────
   InterviewReadDetail — 인터뷰 풀뷰 읽기 모드 상세 (fresh · FullviewShell 슬롯
   본문 · S2/S3 .dc.html 비주얼 SSOT).

   공유 <FullviewShell> 의 우 슬롯에 portal 되는 상세 본문. 셸이 프레임·240px
   사이드바·헤더밴드(rose)를 소유하고, 이 본문은:
   - 헤더밴드 슬롯 publish: 프로젝트 pill · 상태 chip(done/generating/no report).
   - 본문 첫 행: **탭바**(← 목록 · 탑라인/검색 pill · 우측 액션 그룹).
   - 3열: 파일 패널(done=접힘 56 / 그 외 펼침 300) · 본문 캔버스(764 컬럼) ·
     목차 rail(done 한정 220).

   로직/데이터 전부 재사용(useInterviewTopline·export/공유/재생성 핸들러·검색
   훅). 프레젠테이션만 fresh. 편집(SectionGap·drag-to-ask·재생성/공유 모달)은
   C2 — 여기엔 없다. 재생성 버튼·배너 CTA 는 방향 모달 없이 generate(true) 직접
   호출(읽기 모드 최소 동작 — 보수적, PR 본문 명시). ✎ 편집 토글은 렌더만/비활성.
   ──────────────────────────────────────────────────────────────────── */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';
import { useInterviewTopline } from '@/hooks/use-interview-topline';
import { useInterviewV2Documents } from '@/hooks/use-interview-v2-documents';
import { useFullviewHeaderSlotPublisher } from '@/components/canvas/shell/fullview-header-slot-context';
import { FullviewProjectPill } from '@/components/canvas/fullview/fullview-header';
import { DuotoneIcon, type DuotoneIconName } from '@/components/ui/icons/duotone-icon';
import { SelectMenu } from '@/components/ui/select-menu';
import { useToast } from '@/components/toast-provider';
import { useToplineGuideline } from '@/hooks/use-topline-guideline';
import { isToplineHardBillingMessage } from '@/lib/interview-v2/types';
import { exportDomToPdf } from '@/lib/export/pdf-from-dom';
import { UploadModal } from '../upload-modal';
import { SearchChat } from '../search-chat';
import {
  CitationBackrefProvider,
  type CitationBackref,
  type CitationDocRef,
} from '../citation-backref-context';
import { CitationResolveProvider } from './citation';
import { ReportBody, buildToc } from './report-blocks';
import { ReportEditBody } from './report-edit-body';
import { RegenerateModal } from './regenerate-modal';
import { InterviewShareModal } from './share-modal';
import {
  ReportBanner,
  ReportEmpty,
  ReportGenerating,
  ReportLoading,
  IndexingGatePrompt,
  type ReportBannerKind,
} from './report-states';

const LANG_OPTIONS = [
  // i18n-allow-korean -- 언어 자기표기(로케일 무관 self-label · topline-view 선례)
  { value: 'ko', label: '한국어' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
  { value: 'zh', label: '中文' },
  { value: 'es', label: 'Español' },
  { value: 'th', label: 'ไทย' },
] as const;
const DEFAULT_LANG = 'ko';

type RightTab = 'topline' | 'search';

// 파일 타입별 듀오톤 아이콘 — 오디오/비디오=mic · 표(csv/xlsx)=dataset · 그 외
// =document.
function fileIcon(mime: string | null, filename: string): DuotoneIconName {
  const m = (mime ?? '').toLowerCase();
  const ext = filename.toLowerCase();
  if (m.startsWith('audio') || m.startsWith('video') || /\.(m4a|mp3|wav|mp4|mov)$/.test(ext))
    return 'mic';
  if (m.includes('csv') || m.includes('sheet') || /\.(csv|xlsx?|tsv)$/.test(ext))
    return 'dataset';
  return 'document';
}

// 탭바 액션 pill — CD S3 전용 chrome(paper·border 1.5 ink·rounded-pill·
// memphis-sm-faint). Button primitive 형태와 달라 native(FullviewHeader pill 선례).
function ActionPill({
  label,
  icon,
  onClick,
  disabled,
  title,
}: {
  label: string;
  icon?: DuotoneIconName;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    // eslint-disable-next-line react/forbid-elements -- CD S3 탭바 액션은 rounded-pill·memphis-sm-faint 전용 chrome; Button variant 형태와 불일치(FullviewHeader pill 선례).
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-pill border-[1.5px] border-ink bg-paper px-3 py-1.5 text-md font-bold text-ink shadow-memphis-sm-faint disabled:opacity-45"
    >
      {icon && <DuotoneIcon name={icon} size={15} />}
      {label}
    </button>
  );
}

// 내보내기 3상태(§S4c) — idle / busy / done. Word·PDF·Gdoc 공용. 진행 중엔
// 다시 못 누르고, done 은 4초 뒤 idle 로 자동 복귀(호출측 타이머).
type ExportPhase = 'idle' | 'busy' | 'done';

// 액션바 무테 아이콘 버튼(§0.4b·§1.2) — 34×34 · radius 9 · 투명 · mono mute
// 스트로크 17 · hover surface-canvas. 아이콘만으론 export vs 공유가 안 갈리므로
// 툴팁 필수(hover 400ms · ink 배경 · paper — §0.4b ⚠️). 내보내기 3상태는 아이콘
// 자리에서 처리(busy=처리중 도트 · done=✓ success). reduced-motion 무력화.
function ActionIconButton({
  icon,
  title,
  onClick,
  disabled,
  phase = 'idle',
}: {
  icon: DuotoneIconName;
  title: string;
  onClick?: () => void;
  disabled?: boolean;
  phase?: ExportPhase;
}) {
  const busy = phase === 'busy';
  const done = phase === 'done';
  return (
    <span className="group relative inline-flex">
      {/* eslint-disable-next-line react/forbid-elements -- CD S3 무테 아이콘 액션은 34×34 투명 radius-icon chrome; IconButton 고정 radius/배경과 불일치. 라벨은 aria-label + 시각 툴팁이 전달. */}
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || busy}
        aria-label={title}
        className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-icon bg-transparent hover:bg-surface-canvas disabled:opacity-40"
      >
        {done ? (
          <span aria-hidden className="text-md font-extrabold text-success">
            ✓
          </span>
        ) : busy ? (
          <span
            aria-hidden
            className="h-[7px] w-[7px] animate-pulse rounded-full bg-processing motion-reduce:animate-none"
          />
        ) : (
          <DuotoneIcon name={icon} size={17} fill="none" stroke="var(--color-mute)" />
        )}
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-fab mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-xs bg-ink px-2 py-1 text-sm font-bold text-paper opacity-0 transition-opacity delay-[400ms] group-hover:opacity-100 motion-reduce:transition-none motion-reduce:delay-0"
      >
        {title}
      </span>
    </span>
  );
}

// 상태 chip(§1.2) — done(success)·generating(processing dot)·no report(faint
// dot). 헤더밴드 슬롯으로 publish.
function statusChipNode(
  status: string,
  generatedAt: string | null,
  labels: { done: string; generating: string; none: string },
): ReactNode {
  if (status === 'done') {
    return (
      <span className="inline-flex shrink-0 items-center gap-[7px] rounded-pill border-[1.5px] border-success-line bg-success-bg px-3 py-1 font-mono-label text-sm font-extrabold text-success-text">
        <span className="inline-flex h-[14px] w-[14px] items-center justify-center rounded-full bg-success text-xs text-paper">
          ✓
        </span>
        {generatedAt ? new Date(generatedAt).toLocaleString() : labels.done}
      </span>
    );
  }
  if (status === 'generating') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-pill border-[1.5px] border-ink bg-paper px-[11px] py-1 font-mono-label text-sm font-bold text-ink">
        <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-processing" />
        {labels.generating}
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-pill border-[1.5px] border-ink bg-paper px-[11px] py-1 font-mono-label text-sm font-bold text-ink">
      <span aria-hidden className="h-[7px] w-[7px] rounded-full bg-faint" />
      {labels.none}
    </span>
  );
}

export function InterviewReadDetail({
  projectId,
  projectName,
  onBack,
}: {
  projectId: string;
  projectName: string;
  onBack: () => void;
}) {
  const t = useTranslations('InterviewsV2');
  const toast = useToast();
  const publishHeader = useFullviewHeaderSlotPublisher();
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
    pendingIndex,
    clearPendingIndex,
    cancel,
    mapTotal,
    mapDone,
    generatingStale,
    savedLang,
    savedDirection,
    source,
    guidelineFilename,
    generatedAt,
    errorMessage,
    applyBlockMd,
  } = useInterviewTopline(projectId);
  const { documents, mutate } = useInterviewV2Documents(projectId);

  const hasBlocks = blocks.length > 0;
  const errorIsHardBilling =
    status === 'error' && isToplineHardBillingMessage(errorMessage);
  const canGenerate =
    indexed && !generating && (status !== 'generating' || generatingStale);

  const mapComplete = !!mapTotal && (mapDone ?? 0) >= mapTotal;
  const inReduce = status === 'generating' && mapComplete;

  // 출력 언어 — 저장된 언어로 초기화(마지막 선택 반영).
  const [outputLang, setOutputLang] = useState<string>(DEFAULT_LANG);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync selector to server-persisted lang on load (savedLang)
    if (savedLang) setOutputLang(savedLang);
  }, [savedLang]);

  // 우측 탭 — 탑라인(기본) / 검색. 둘 다 상시 mount(hidden 전환).
  const [rightTab, setRightTab] = useState<RightTab>('topline');

  // 편집 모드 — 읽기 기본(false). ON 일 때만 SectionGap ＋ · drag-to-ask · 삽입
  // 카드 액션이 렌더된다(§0.4 — 읽기 DOM 엔 어포던스가 미렌더, display 토글 아님).
  const [editMode, setEditMode] = useState(false);
  // 재생성 방향 모달 · 공유 모달.
  const [regenOpen, setRegenOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  // 내보내기 3상태 — Word · PDF · Gdoc. done 은 4초 뒤 idle 자동 복귀(§S4c).
  const [txtPhase, setTxtPhase] = useState<ExportPhase>('idle');
  const [mdPhase, setMdPhase] = useState<ExportPhase>('idle');
  const [pdfPhase, setPdfPhase] = useState<ExportPhase>('idle');
  const [gdocPhase, setGdocPhase] = useState<ExportPhase>('idle');
  const exportTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(
    () => () => exportTimers.current.forEach(clearTimeout),
    [],
  );

  // 파일 패널 접힘 — done 기본 접힘(56), 그 외 펼침(300). 사용자 토글 존중 +
  // generating→done 전이 시 1회 자동 접힘.
  const [collapsed, setCollapsed] = useState<boolean>(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- status 기반 초기 접힘(done=접힘). 마운트/프로젝트 전환 시 1회.
    setCollapsed(status === 'done');
    // projectId 만 의존 — 이후 status 변화는 아래 edge effect + 사용자 토글이 소유.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);
  const prevStatus = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = status;
    if (prev === 'generating' && status === 'done') setCollapsed(true);
  }, [status]);

  // 근거 팝오버 → 원본 파일 역참조(card 672). 검색 근거 팝오버가 "원본 파일 보기"를
  // 누르면 좌측 파일 패널을 대상 문서로 점프·하이라이트한다. resolve API·검색
  // 파이프라인 무변경 — 이미 로드된 documents 목록으로 매칭만 한다.
  const fileListRef = useRef<HTMLDivElement>(null);
  const [highlightDocId, setHighlightDocId] = useState<string | null>(null);
  // 참조 → 실제 문서 해석. document_id 우선(검색 Citation), 없으면 파일명 유일
  // 매칭(리졸브 청크). 유일 매칭이 아니면 null(보수적 — 동명 파일 오점프 방지).
  const resolveDoc = useCallback(
    (ref: CitationDocRef): { id: string } | null => {
      if (ref.documentId) {
        const byId = documents.find((d) => d.id === ref.documentId);
        if (byId) return byId;
      }
      if (ref.filename) {
        const byName = documents.filter((d) => d.filename === ref.filename);
        if (byName.length === 1) return byName[0];
      }
      return null;
    },
    [documents],
  );
  const backref = useMemo<CitationBackref>(
    () => ({
      has: (ref: CitationDocRef) => resolveDoc(ref) !== null,
      open: (ref: CitationDocRef) => {
        const doc = resolveDoc(ref);
        if (!doc) return;
        setCollapsed(false); // 접혀 있으면 펼쳐 대상이 보이게.
        setHighlightDocId(doc.id);
      },
    }),
    [resolveDoc],
  );
  // 하이라이트 대상이 정해지면(그리고 패널이 펼쳐지면) 그 카드로 스크롤.
  useEffect(() => {
    if (!highlightDocId || collapsed) return;
    const el = fileListRef.current?.querySelector<HTMLElement>(
      `[data-doc-id="${CSS.escape(highlightDocId)}"]`,
    );
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightDocId, collapsed]);

  // 분석 가이드라인 업로드 — 업로드 문서를 **생성이 따라야 할 기준**으로 저장한다
  // (결과물 아님). 파일 피커 hidden input 과 짝. 저장 후 refetch 로 배지/stale 갱신.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const guideline = useToplineGuideline({
    projectId,
    onChanged: refetch,
    onError: (code) =>
      toast.push(
        code === 'empty_report'
          ? t('toplineGuidelineEmpty')
          : code === 'unsupported_file_type'
            ? t('toplineGuidelineUnsupported')
            : code === 'file_too_large'
              ? t('toplineGuidelineTooLarge')
              : `${t('toplineGuidelineError')} (${code})`,
        { tone: 'warn' },
      ),
  });
  const handleGuidelineFile = (file: File | undefined) => {
    if (!file) return;
    void (async () => {
      const ok = await guideline.uploadFile(file);
      if (ok) toast.push(t('toplineGuidelineSaved'), { tone: 'amore' });
    })();
  };
  const handleDeleteGuideline = () => {
    void (async () => {
      const ok = await guideline.deleteGuideline();
      if (ok) toast.push(t('toplineGuidelineDeleted'), { tone: 'amore' });
    })();
  };

  // txt/md 다운로드 — attachment GET(쿠키 포함 네비게이션). 즉시 다운로드라 busy
  // 없이 done 표시(4초 뒤 idle). docx 는 공유 전용(카드 #609).
  const download = (format: 'txt' | 'md') => {
    const phase = format === 'txt' ? txtPhase : mdPhase;
    const setPhase = format === 'txt' ? setTxtPhase : setMdPhase;
    if (phase !== 'idle') return;
    const a = document.createElement('a');
    a.href = `/api/interviews/v2/topline/export?project_id=${encodeURIComponent(
      projectId,
    )}&format=${format}`;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setPhase('done');
    exportTimers.current.push(setTimeout(() => setPhase('idle'), 4000));
  };

  // PDF 다운로드 — 클라이언트 렌더 DOM(읽기 본문)을 exportDomToPdf 로 캡처.
  // 서버 라우트가 아니라 클라 캡처인 이유: pdf-from-dom 은 html2canvas(브라우저
  // DOM) 의존이라 서버에서 재사용 불가 + 이 경로가 recharts 차트를 canvas 로 자동
  // 포함하고 한글 letter-spacing 우회를 그대로 태운다(스펙 §3 명시). busy 동안
  // 재클릭 차단, done 은 4초 뒤 idle.
  const downloadPdf = async () => {
    if (pdfPhase !== 'idle') return;
    const el = readBodyRef.current;
    if (!el) return;
    setPdfPhase('busy');
    try {
      const d = generatedAt ? new Date(generatedAt) : new Date();
      const valid = !Number.isNaN(d.getTime()) ? d : new Date();
      const dateStr = `${valid.getFullYear()}-${String(valid.getMonth() + 1).padStart(2, '0')}-${String(valid.getDate()).padStart(2, '0')}`;
      const safe = (projectName || t('back')).replace(/[\\/:*?"<>|]/g, '').trim();
      await exportDomToPdf(el, `${safe || 'topline'}_${dateStr}.pdf`, {
        width: 764,
        header: { title: projectName || t('back'), subtitle: metaRight },
      });
      setPdfPhase('done');
      exportTimers.current.push(setTimeout(() => setPdfPhase('idle'), 4000));
    } catch (e) {
      toast.push(
        `${t('reportExportPdf')} — ${e instanceof Error ? e.message : 'error'}`,
        { tone: 'warn' },
      );
      setPdfPhase('idle');
    }
  };

  // Google Docs 공유 — admin Drive 변환 → 링크 복사 + 새 탭.
  const shareGoogleDocs = async () => {
    if (gdocPhase !== 'idle') return;
    setGdocPhase('busy');
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
        const code = json?.error ?? `HTTP ${res.status}`;
        toast.push(
          code === 'admin_google_reauth_required' ||
            code === 'google_admin_not_configured'
            ? t('toplineShareUnavailable')
            : `${t('toplineShareError')} (${code})`,
          { tone: 'warn' },
        );
        setGdocPhase('idle');
        return;
      }
      try {
        await navigator.clipboard.writeText(json.url);
        toast.push(t('toplineShareCopied'), { tone: 'amore' });
      } catch {
        toast.push(t('toplineShareOpened'), { tone: 'amore' });
      }
      window.open(json.url, '_blank', 'noopener,noreferrer');
      setGdocPhase('done');
      exportTimers.current.push(setTimeout(() => setGdocPhase('idle'), 4000));
    } catch (e) {
      toast.push(
        `${t('toplineShareError')} (${e instanceof Error ? e.message : 'network'})`,
        { tone: 'warn' },
      );
      setGdocPhase('idle');
    }
  };

  // 재생성 — 방향 모달(S4b) 을 연다. 확정 시 generate(true, lang, direction).
  // 탭바 재생성 버튼·배너 CTA 공용.
  const requestRegenerate = () => {
    if (!canGenerate) return;
    setRegenOpen(true);
  };
  const confirmRegenerate = (direction: string, lang: string) => {
    if (!canGenerate) return;
    void generate(true, lang, direction || undefined);
  };
  const hasInsertedBlocks = blocks.some(
    (b) => b.type === 'inserted_qa' || b.type === 'inserted_section',
  );

  // 헤더밴드 슬롯 publish — 프로젝트 pill + 상태 chip. status/이름 변화 시 갱신,
  // 언마운트 시 비운다.
  useEffect(() => {
    publishHeader({
      projectPill: <FullviewProjectPill name={projectName || t('back')} />,
      statusChip: statusChipNode(status, generatedAt, {
        done: t('statusDone'),
        generating: t('reportStatusGenerating'),
        none: t('reportStatusNone'),
      }),
    });
    return () => publishHeader({});
  }, [publishHeader, projectName, status, generatedAt, t]);

  // 목차 rail 항목 — done 에서만 렌더.
  const toc = useMemo(
    () => buildToc(blocks, t('reportExecLabel')),
    [blocks, t],
  );
  const canvasRef = useRef<HTMLDivElement>(null);
  // 편집 body 루트 ref — drag 선택 감지 스코프(보고서 본문). canvasRef(스크롤
  // 컨테이너)와 분리해 배너·목차가 선택 스코프에 안 들어가게 한다.
  const editBodyRef = useRef<HTMLDivElement>(null);
  // 읽기 본문 루트 ref — PDF export(exportDomToPdf) 캡처 대상. 배너/목차 제외한
  // 순수 보고서 본문만 캡처하도록 canvasRef 와 분리한다.
  const readBodyRef = useRef<HTMLElement>(null);
  const scrollToBlock = (id: string) => {
    const el = canvasRef.current?.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const showToc = status === 'done' && hasBlocks && rightTab === 'topline';
  const showActions = hasBlocks && rightTab === 'topline';
  const actionsDisabled = status === 'generating';

  // exec 우측 메타 — 실제 분석 문서 수(map_total)를 정직하게 반영(카드 #681).
  // 업로드 수(documents.length)가 아니라 이 보고서가 실제로 순회한 문서 수를
  // 쓴다. mapTotal 이 null 인 레거시 row 는 업로드 수로 폴백(옛 동작 유지 —
  // 완전 인덱싱 프로젝트 회귀 0). 분석 수 < 업로드 수면 부분분석 → "전수 순회"
  // 라벨을 떼고 "분석 N / 업로드 M" 로 병기해 완전성 거짓 주장을 제거한다.
  const uploadCount = documents.length;
  const analyzedCount = mapTotal ?? uploadCount;
  const isPartial = mapTotal != null && analyzedCount < uploadCount;
  const metaRight = isPartial
    ? t('reportExecMetaPartial', { analyzed: analyzedCount, uploaded: uploadCount })
    : t('reportExecMeta', { n: analyzedCount });

  // 생성 후 문서가 추가돼 분석 수 < 현재 업로드 수인 done 보고서 = 드리프트 stale
  // (§1b — DB 확정 실제 트리거). 저장 해시 stale(파일 교체)과 별개로, 낡은 부분
  // 보고서를 최신으로 오인하지 않게 stale 배너를 재사용해 재생성을 유도한다.
  const driftStale = status === 'done' && isPartial;

  // 배너 종류 — stuck(generatingStale) > stale/drift > (blocks 있는데 error).
  let banner: ReportBannerKind | null = null;
  if (generatingStale) banner = 'stuck';
  else if ((stale || driftStale) && status !== 'generating') banner = 'stale';
  else if (status === 'error' && hasBlocks) banner = 'error';
  else if (status === 'cancelled' && hasBlocks) banner = 'cancelled';

  // 본문 캔버스 렌더.
  let canvas: ReactNode;
  if (loading) {
    canvas = <ReportLoading />;
  } else if (status === 'generating' && !hasBlocks && !generatingStale) {
    canvas = (
      <ReportGenerating
        mapTotal={mapTotal}
        mapDone={mapDone}
        inReduce={inReduce}
      />
    );
  } else if (hasBlocks) {
    canvas = (
      <div className="mx-auto flex w-[var(--iv-body-col-w)] max-w-full flex-col gap-5">
        {banner && (
          <ReportBanner
            kind={banner}
            errorCode={errorMessage}
            onRegenerate={requestRegenerate}
            onCancel={() => void cancel()}
            disabled={!canGenerate && banner !== 'stuck'}
          />
        )}
        {editMode ? (
          <ReportEditBody
            blocks={blocks}
            metaRight={metaRight}
            projectId={projectId}
            containerRef={editBodyRef}
            refetch={refetch}
            applyBlockMd={applyBlockMd}
            askEnabled={indexed}
          />
        ) : (
          <ReportBody
            blocks={blocks}
            metaRight={metaRight}
            containerRef={readBodyRef}
          />
        )}
      </div>
    );
  } else {
    // 빈/에러/취소 & blocks 없음 → 인트로(생성/업로드) 또는 오류 안내.
    canvas = (
      <ReportEmpty
        outputLang={outputLang}
        onLangChange={setOutputLang}
        onGenerate={() => void generate(false, outputLang)}
        onUpload={() => fileInputRef.current?.click()}
        uploading={guideline.uploading}
        guidelineFilename={guidelineFilename}
        deletingGuideline={guideline.deleting}
        onReplaceGuideline={() => fileInputRef.current?.click()}
        onDeleteGuideline={handleDeleteGuideline}
        canGenerate={canGenerate}
        indexed={indexed}
        isError={status === 'error'}
        isBilling={errorIsHardBilling}
        errorCode={fetchError ?? errorMessage}
      />
    );
  }

  const [uploadOpen, setUploadOpen] = useState(false);

  return (
    <CitationResolveProvider projectId={projectId}>
      <CitationBackrefProvider value={backref}>
      <div className="flex min-h-0 flex-1 flex-col">
        {/* 숨은 파일 피커 — 분석 가이드라인 업로드(생성 기준 문서). */}
        {/* eslint-disable-next-line react/forbid-elements -- 숨은 파일 선택 input; 가시 컨트롤은 <Button>(ReportEmpty), 파일 피커 primitive 미존재(topline-view 선례) */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.markdown,.txt,.docx,.pdf,.html,.htm,text/markdown,text/plain,text/html,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="hidden"
          onChange={(e) => {
            handleGuidelineFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />

        {/* 탭바 (신규 행) — border-b 2px ink · paper. 좌: ← · 탭 pill · 우: 액션. */}
        <div className="flex shrink-0 items-center gap-[11px] border-b-2 border-ink bg-paper px-5 py-[9px]">
          {/* eslint-disable-next-line react/forbid-elements -- CD 탭바 ← 는 텍스트 back 어포던스(inline chrome); Button variant 와 불일치 */}
          <button
            type="button"
            onClick={onBack}
            className="inline-flex shrink-0 items-center gap-1.5 text-md font-bold text-mute"
            aria-label={t('back')}
          >
            ←
          </button>
          {/* 탭 pill 그룹 — border 1.5 ink · rounded-pill · 활성 bg-ink text-paper. */}
          <div className="inline-flex shrink-0 items-stretch overflow-hidden rounded-pill border-[1.5px] border-ink bg-paper">
            {(['topline', 'search'] as const).map((tab) => (
              // eslint-disable-next-line react/forbid-elements -- CD 탭 pill 은 세그먼트 chrome(활성 bg-ink text-paper); Button variant 와 불일치
              <button
                key={tab}
                type="button"
                onClick={() => setRightTab(tab)}
                className={`px-4 py-1.5 text-md font-extrabold ${
                  rightTab === tab
                    ? 'bg-ink text-paper'
                    : 'font-bold text-mute'
                }`}
              >
                {tab === 'topline' ? t('toplineTab') : t('searchTab')}
              </button>
            ))}
          </div>

          {/* 우측 액션 그룹(§0.4b) — 보조는 무테 mono 아이콘 · 언어는 텍스트
              트리거 · 편집만 라벨 버튼(ink 채움). 보고서 있을 때만. */}
          {showActions && (
            <div className="ml-auto flex items-center gap-2">
              <ActionIconButton
                icon="download"
                title={t('reportExportTxt')}
                onClick={() => download('txt')}
                disabled={actionsDisabled}
                phase={actionsDisabled ? 'idle' : txtPhase}
              />
              <ActionIconButton
                icon="download"
                title={t('reportExportMd')}
                onClick={() => download('md')}
                disabled={actionsDisabled}
                phase={actionsDisabled ? 'idle' : mdPhase}
              />
              <ActionIconButton
                icon="download"
                title={t('reportExportPdf')}
                onClick={() => void downloadPdf()}
                disabled={actionsDisabled}
                phase={actionsDisabled ? 'idle' : pdfPhase}
              />
              <ActionIconButton
                icon="document"
                title={t('reportShareGdoc')}
                onClick={() => void shareGoogleDocs()}
                disabled={actionsDisabled}
                phase={actionsDisabled ? 'idle' : gdocPhase}
              />
              <ActionIconButton
                icon="link"
                title={t('reportShareLink')}
                onClick={() => setShareOpen(true)}
                disabled={actionsDisabled || !toplineId}
              />
              <ActionIconButton
                icon="regenerate"
                title={t('reportRegenAction')}
                onClick={requestRegenerate}
                disabled={!canGenerate}
              />
              {/* 언어 — 텍스트 트리거(§0.4b·§1.2). 132px 박스 폐기. */}
              <SelectMenu
                value={outputLang}
                onChange={setOutputLang}
                options={LANG_OPTIONS.map((o) => ({
                  value: o.value,
                  label: o.label,
                }))}
                disabled={!canGenerate}
                aria-label={t('toplineLangLabel')}
                buttonClassName="inline-flex items-center gap-1.5 px-1 py-1.5 text-md font-bold text-mute disabled:opacity-45"
                renderSummary={(vals) =>
                  LANG_OPTIONS.find((o) => o.value === vals[0])?.label ?? DEFAULT_LANG
                }
              />
              <div className="h-[22px] w-px bg-ink/15" aria-hidden />
              {/* 편집 CTA(§0.4b) — ink 채움 · 화면의 유일한 라벨 버튼. 토글 동작
                  유지(#595 무변경) — ON 일 때만 SectionGap·drag-to-ask 활성. */}
              {/* eslint-disable-next-line react/forbid-elements -- CD S3 편집 CTA 는 ink 채움 rounded-pill·memphis-md-faint 전용 chrome; Button variant 형태와 불일치. role=switch 로 토글 의미 노출. */}
              <button
                type="button"
                role="switch"
                aria-checked={editMode}
                onClick={() => setEditMode((v) => !v)}
                title={t('reportEditFull')}
                className={`inline-flex shrink-0 items-center gap-2 rounded-pill border-2 border-ink bg-ink px-[22px] py-[9px] text-md font-extrabold text-paper ${
                  editMode
                    ? 'translate-x-px translate-y-px shadow-none'
                    : 'shadow-memphis-md-faint'
                }`}
              >
                <DuotoneIcon name="typos" size={16} mono />
                {t('reportEditFull')}
              </button>
            </div>
          )}
        </div>

        {/* 3열 본문 — 파일 패널 · 캔버스 · 목차 rail. */}
        <div className="flex min-h-0 flex-1">
          {/* 파일 패널 — done=접힘 56 rail / 그 외 펼침 300. */}
          {collapsed ? (
            <div className="flex w-[var(--iv-file-rail-w)] shrink-0 flex-col items-center gap-3 border-r-2 border-ink bg-paper-soft py-3.5">
              {/* eslint-disable-next-line react/forbid-elements -- CD 접힘 rail 펼치기 버튼은 30px 스퀘어 chrome(rounded-nav·memphis-sm); IconButton 고정 radius 와 불일치 */}
              <button
                type="button"
                onClick={() => setCollapsed(false)}
                aria-label={t('reportExpandFiles')}
                className="flex h-[30px] w-[30px] items-center justify-center rounded-nav border-[1.5px] border-ink bg-paper shadow-memphis-sm"
              >
                <DuotoneIcon name="chevron" size={14} />
              </button>
              <div className="rounded-chip border-[1.4px] border-line-strong bg-paper px-[5px] py-0.5 font-mono-label text-xs font-extrabold text-ink">
                {documents.length}
              </div>
              <div className="font-mono-label text-xs uppercase tracking-[0.16em] text-faint [writing-mode:vertical-rl]">
                {t('reportFilesLabel')}
              </div>
            </div>
          ) : (
            <div
              ref={fileListRef}
              className="flex w-[var(--iv-file-panel-w)] shrink-0 flex-col gap-[11px] overflow-y-auto border-r-2 border-ink bg-paper p-4"
            >
              <div className="flex items-center gap-2">
                <div className="font-mono-label text-xs uppercase tracking-[0.14em] text-mute-soft">
                  {t('reportUploadedFiles', { n: documents.length })}
                </div>
                <ActionPill
                  label={t('upload')}
                  icon="upload"
                  onClick={() => setUploadOpen(true)}
                />
                {status === 'done' && (
                  // eslint-disable-next-line react/forbid-elements -- 접기 버튼(작은 chrome); IconButton 고정 radius 와 불일치
                  <button
                    type="button"
                    onClick={() => setCollapsed(true)}
                    aria-label={t('reportCollapseFiles')}
                    className="ml-auto text-md text-mute-soft"
                  >
                    ◀
                  </button>
                )}
              </div>
              {documents.map((d) => (
                <div
                  key={d.id}
                  data-doc-id={d.id}
                  className={`flex items-center gap-[9px] rounded-card border-[1.5px] px-3 py-2.5 transition-colors ${
                    highlightDocId === d.id
                      ? 'border-amore bg-amore-bg'
                      : 'border-line-strong bg-paper'
                  }`}
                >
                  <DuotoneIcon name={fileIcon(d.mime, d.filename)} size={16} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-md font-bold text-ink" title={d.filename}>
                      {d.filename}
                    </div>
                    {d.total_chunks != null && (
                      <div className="font-mono-label text-xs text-faint">
                        {t('reportChunks', { n: d.total_chunks })}
                      </div>
                    )}
                  </div>
                  <span
                    aria-hidden
                    className={`h-[7px] w-[7px] shrink-0 rounded-full ${
                      d.index_status === 'done'
                        ? 'bg-success'
                        : d.index_status === 'error'
                          ? 'bg-error-text'
                          : d.index_status === 'indexing'
                            ? 'bg-processing'
                            : 'bg-faint'
                    }`}
                  />
                </div>
              ))}
            </div>
          )}

          {/* 캔버스 — surface-canvas · 764 컬럼. 탑라인/검색 상시 mount(hidden). */}
          <div className="relative min-w-0 flex-1">
            <div
              ref={canvasRef}
              className={`absolute inset-0 overflow-y-auto bg-surface-canvas px-6 pb-[46px] pt-[34px] ${
                rightTab === 'topline' ? '' : 'hidden'
              }`}
            >
              {/* 생성 완전성 게이트(카드 #681) — 인덱싱 미완으로 무음 부분분석이
                  차단됐을 때 대기/부분생성 선택. 부분 생성은 기존 보고서가 있으면
                  force=true(교체), 없으면 최초 생성. 방향은 이 경로에선 생략(보수). */}
              {pendingIndex && (
                <div className="mx-auto mb-5 w-[var(--iv-body-col-w)] max-w-full">
                  <IndexingGatePrompt
                    pending={pendingIndex.pending}
                    indexed={pendingIndex.indexed}
                    total={pendingIndex.total}
                    onWait={clearPendingIndex}
                    onGeneratePartial={() =>
                      void generate(hasBlocks, outputLang, undefined, true)
                    }
                    disabled={!canGenerate}
                  />
                </div>
              )}
              {canvas}
            </div>
            <div
              className={`absolute inset-0 ${rightTab === 'search' ? '' : 'hidden'}`}
            >
              <SearchChat
                projectIds={null}
                currentProject={{ id: projectId, name: projectName }}
              />
            </div>
          </div>

          {/* 목차 rail — done 한정 220. */}
          {showToc && (
            <nav className="flex w-[var(--iv-toc-w)] shrink-0 flex-col gap-1 overflow-y-auto border-l-2 border-ink bg-paper px-3.5 py-4">
              <div className="mb-2 font-mono-label text-xs uppercase tracking-[0.14em] text-mute-soft">
                {t('reportToc')}
              </div>
              {toc.map((item, i) => (
                // eslint-disable-next-line react/forbid-elements -- 목차 항목은 좌 3px 강조선 nav chrome; Button variant 와 불일치
                <button
                  key={item.id}
                  type="button"
                  onClick={() => scrollToBlock(item.id)}
                  className={`border-l-[3px] py-1.5 pl-[11px] text-left text-md leading-[1.5] ${
                    i === 0
                      ? 'border-amore bg-rose-bg font-extrabold text-ink'
                      : 'border-transparent text-mute'
                  }`}
                >
                  {item.num != null ? `${String(item.num).padStart(2, '0')} ` : ''}
                  {item.label}
                </button>
              ))}
            </nav>
          )}
        </div>

        <UploadModal
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          projectId={projectId}
          existingFilenames={documents.map((d) => d.filename)}
          onUploaded={() => void mutate()}
        />

        {/* 재생성 방향 모달(S4b) — 방향 + 언어 확정 후 generate(true). */}
        <RegenerateModal
          open={regenOpen}
          onClose={() => setRegenOpen(false)}
          savedDirection={savedDirection}
          outputLang={outputLang}
          isUploaded={source === 'uploaded'}
          hasInserted={hasInsertedBlocks}
          onConfirm={confirmRegenerate}
        />

        {/* 공유 모달(S4c) — 링크 발급·게이트·초대. toplineId 있을 때만 마운트. */}
        {toplineId && (
          <InterviewShareModal
            open={shareOpen}
            onClose={() => setShareOpen(false)}
            resourceId={toplineId}
          />
        )}
      </div>
      </CitationBackrefProvider>
    </CitationResolveProvider>
  );
}
