// Artifact 통합(narrow-waist) — DeliverableAdapter 레지스트리 = the waist.
//
// 이 파일이 산출물 통합의 유일한 결합점(narrow waist)이다. 각 기능은 자기
// 상세 테이블/스코프/투영(toRow)/공유타입/export 포맷을 여기에 한 번 등록하고,
// 통합 리스트 API(route.ts)와 assign facade 는 이 레지스트리만 소비한다.
// 리스트 라우트에 `if (feature === 'ut')` 같은 기능 분기는 금지 — 전부 adapter
// 위임(셸 god-component 안티패턴의 백엔드 버전).
//
// assign 라우트의 옛 로컬 `FEATURES` 맵을 여기로 승격했다. 그 맵이 담고 있던
// 정확한 뉘앙스 — recruiting=form_id+user_id 스코프, transcript/desk 는
// interview_projects FK(mirror-crash 방지) — 를 그대로 보존한다.

import type {
  DeliverableFeature,
  DeliverableRow,
  DeliverableStatus,
} from './types';

// ── assign-target(공통 매핑) ────────────────────────────────────────────
// recruiting_forms 는 `form_id text primary key`, 나머지는 uuid `id`.
// recruiting_forms 는 org-scoping 이전에 생긴 테이블이라 옛 행에 org_id 가
// 없을 수 있어 write 스코프를 user_id 로 둔다.
// projectTable — row 의 project_id FK 가 가리키는 테이블. 대부분 public.projects
// 지만 transcript_jobs / desk_jobs 는 interview_projects(위젯 선택 SSOT)로
// re-point 됐다. 잘못된 FK 대상에 valid-but-foreign id 를 검증하면 update 가
// 23503 으로 mirror-crash 하므로 반드시 올바른 대상에 검증해야 한다.
export type AssignTarget = {
  table: string;
  idColumn: 'id' | 'form_id';
  scopeColumn: 'org_id' | 'user_id';
  projectTable: 'projects' | 'interview_projects';
};

// assign 이 다루는 6기능. DeliverableRow 투영(리스팅)은 Phase1 4기능만이지만
// project/folder 배정(assign)은 report/interview/scheduler 까지 6기능 전부.
export type AssignFeature =
  | DeliverableFeature
  | 'report'
  | 'interview'
  | 'scheduler';

// ── DeliverableAdapter(플러그인 계약) ───────────────────────────────────
export type DeliverableAdapter = AssignTarget & {
  feature: DeliverableFeature;
  // shared_views.resource_type 매핑 (null=공유 불가). Phase1 에선 후속 PR 이
  // 채움 → 지금은 선언만, shareable 계산에 사용.
  shareResourceType: string | null;
  // 사람이 읽는 기능명 (예: "Transcript") — 공유 셸 eyebrow 등 UI 가 prop 으로
  // 소비(셸 feature-blind 유지).
  label: string;
  exportFormats: string[];
  // 이 기능 산출물을 스코프로 조회할 select 컬럼(가벼운 리스트용 — 무거운
  // 본문 컬럼 제외). project_id/folder_id 를 포함하는지가 곧 그 필터 지원 여부.
  selectColumns: string[];
  // 기능 상태 enum → DeliverableStatus 정규화.
  normalizeStatus(raw: string | null | undefined): DeliverableStatus;
  // feature 테이블 row(선택 컬럼) → DeliverableRow 투영. 순수 함수.
  toRow(featureRow: Record<string, unknown>): DeliverableRow;
};

// ── 포맷 헬퍼(서버 meta_display 생성) ───────────────────────────────────
function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function iso(v: unknown, fallback: string): string {
  const s = str(v);
  return s ?? fallback;
}
function minutesBadge(seconds: number | null): string | null {
  if (seconds == null || seconds <= 0) return null;
  const m = Math.round(seconds / 60);
  return m >= 1 ? `${m} min` : `${Math.round(seconds)} sec`;
}

// ── transcript ──────────────────────────────────────────────────────────
const transcriptAdapter: DeliverableAdapter = {
  feature: 'transcript',
  table: 'transcript_jobs',
  idColumn: 'id',
  scopeColumn: 'org_id',
  projectTable: 'interview_projects',
  // shared_views 편입(pr-shared-views-extend-deliverables) — 발급/로더 배선.
  shareResourceType: 'transcript',
  label: 'Transcript',
  exportFormats: ['docx', 'md', 'txt', 'srt'],
  selectColumns: [
    'id',
    'filename',
    'status',
    'mode',
    'duration_seconds',
    'speakers_count',
    'project_id',
    'folder_id',
    'created_at',
    'updated_at',
  ],
  normalizeStatus(raw) {
    switch (raw) {
      case 'done':
        return 'ready';
      case 'error':
        return 'error';
      case 'cancelled':
        return 'draft';
      // uploading / queued / submitting / transcribing
      default:
        return 'processing';
    }
  },
  toRow(row) {
    const created = iso(row.created_at, '');
    const durationSeconds = num(row.duration_seconds);
    const speakers = num(row.speakers_count);
    const mode = str(row.mode);
    const badges: string[] = [];
    const dur = minutesBadge(durationSeconds);
    if (dur) badges.push(dur);
    if (speakers && speakers > 0) badges.push(`${speakers} speakers`);
    if (mode === 'meeting') badges.push('Meeting');
    return {
      feature: 'transcript',
      id: String(row.id ?? ''),
      kind: 'transcript',
      // title 폴백은 소스 컬럼이 비었을 때만. 이 계층은 locale 컨텍스트가 없어
      // (read-model), 영어 기본 뷰와 일관되게 기능명(label)으로 폴백한다.
      title: str(row.filename) ?? this.label,
      status: this.normalizeStatus(str(row.status)),
      project_id: (str(row.project_id) ?? null) as string | null,
      folder_id: (str(row.folder_id) ?? null) as string | null,
      created_at: created,
      updated_at: iso(row.updated_at, created),
      shareable: this.shareResourceType != null,
      export_formats: this.exportFormats,
      meta: {
        duration_seconds: durationSeconds,
        speakers_count: speakers,
        mode,
      },
      meta_display: badges,
      progress: null,
    };
  },
};

// ── desk ────────────────────────────────────────────────────────────────
const deskAdapter: DeliverableAdapter = {
  feature: 'desk',
  table: 'desk_jobs',
  idColumn: 'id',
  scopeColumn: 'org_id',
  projectTable: 'interview_projects',
  // shared_views 편입(pr-shared-views-extend-deliverables) — 발급/로더 배선.
  shareResourceType: 'desk_report',
  label: 'Desk Research',
  exportFormats: ['docx'],
  selectColumns: [
    'id',
    'keywords',
    'status',
    'locale',
    'sources',
    'mode',
    // progress jsonb 는 crawl_done/crawl_total 카운터 + 최근 이벤트(≤80)라
    // 가벼움. 본문(output/articles)이 아니므로 리스트 select 에 포함해
    // processing 행의 진행률(fraction)을 파생한다.
    'progress',
    'project_id',
    'folder_id',
    'created_at',
    'updated_at',
  ],
  normalizeStatus(raw) {
    switch (raw) {
      case 'done':
        return 'ready';
      case 'error':
        return 'error';
      case 'cancelled':
        return 'draft';
      // queued / expanding / crawling / summarizing
      default:
        return 'processing';
    }
  },
  toRow(row) {
    const created = iso(row.created_at, '');
    const keywords = Array.isArray(row.keywords)
      ? (row.keywords as unknown[]).filter((k): k is string => typeof k === 'string')
      : [];
    const sources = Array.isArray(row.sources)
      ? (row.sources as unknown[]).filter((s): s is string => typeof s === 'string')
      : [];
    const locale = str(row.locale);
    const status = this.normalizeStatus(str(row.status));
    // desk progress jsonb → 0~1 fraction (crawl 단계에서만 의미 있음).
    let progress: number | null = null;
    const p = row.progress;
    if (p && typeof p === 'object') {
      const total = num((p as Record<string, unknown>).crawl_total);
      const done = num((p as Record<string, unknown>).crawl_done);
      if (total != null && total > 0 && done != null) {
        progress = Math.max(0, Math.min(1, done / total));
      }
    }
    const badges: string[] = [];
    if (sources.length > 0) badges.push(`${sources.length} sources`);
    if (locale) badges.push(locale);
    return {
      feature: 'desk',
      id: String(row.id ?? ''),
      kind: 'desk_report',
      title: keywords.length > 0 ? keywords.join(', ') : this.label,
      status,
      project_id: (str(row.project_id) ?? null) as string | null,
      folder_id: (str(row.folder_id) ?? null) as string | null,
      created_at: created,
      updated_at: iso(row.updated_at, created),
      shareable: this.shareResourceType != null,
      export_formats: this.exportFormats,
      meta: { locale, sources },
      meta_display: badges,
      progress: status === 'processing' ? progress : null,
    };
  },
};

// ── ut (AI UT) ──────────────────────────────────────────────────────────
// ut_sessions 는 org_id 가 nullable(best-effort)이고 RLS 가 user 스코프라
// user_id 로 스코프한다. project_id/folder_id/updated_at 컬럼이 없어
// project/folder 는 항상 null, updated_at 은 created_at 폴백.
const utAdapter: DeliverableAdapter = {
  feature: 'ut',
  table: 'ut_sessions',
  idColumn: 'id',
  scopeColumn: 'user_id',
  projectTable: 'projects',
  // shared_views 편입(pr-shared-views-extend-deliverables) — 발급/로더 배선.
  shareResourceType: 'ut_insight',
  label: 'AI UT',
  // export 신설(pr-artifacts-export-registry): insight 리포트 → docx.
  // CD BUILD-SPEC §3.4 는 .pdf 를 명시하나, jsPDF 는 CJK 폰트 임베드 없이 한국어
  // 인용문을 렌더 못 해 §3.4 verbatim-quote 요구를 깬다 → 스펙이 허용한
  // "pdf(또는 docx)" 중 한글-safe 한 docx 채택(insight-docx.ts 주석 참고).
  exportFormats: ['docx'],
  selectColumns: [
    'id',
    'target_url',
    'status',
    'insight_status',
    'duration_ms',
    'created_at',
  ],
  normalizeStatus(raw) {
    switch (raw) {
      case 'done':
        return 'ready';
      case 'error':
        return 'error';
      // recording / uploading / transcribing / waiting / live / analyzing
      default:
        return 'processing';
    }
  },
  toRow(row) {
    const created = iso(row.created_at, '');
    // insight_status 가 있으면 그 파이프라인을 우선 반영(세션 status 는 done
    // 이어도 인사이트가 아직 도는 중일 수 있다).
    const insight = str(row.insight_status);
    let status: DeliverableStatus;
    if (insight) {
      status =
        insight === 'done'
          ? 'ready'
          : insight === 'error'
            ? 'error'
            : 'processing'; // indexing / searching / clipping / analyzing / reporting
    } else {
      status = this.normalizeStatus(str(row.status));
    }
    const durationMs = num(row.duration_ms);
    const badges: string[] = [];
    const dur = minutesBadge(durationMs != null ? durationMs / 1000 : null);
    if (dur) badges.push(dur);
    return {
      feature: 'ut',
      id: String(row.id ?? ''),
      kind: 'ut_insight',
      title: str(row.target_url) ?? this.label,
      status,
      project_id: null, // 컬럼 없음
      folder_id: null, // 컬럼 없음
      created_at: created,
      updated_at: created, // updated_at 컬럼 없음 → created_at 폴백
      shareable: this.shareResourceType != null,
      export_formats: this.exportFormats,
      meta: { duration_ms: durationMs },
      meta_display: badges,
      progress: null,
    };
  },
};

// ── recruiting ──────────────────────────────────────────────────────────
// recruiting_forms 는 form_id PK, user_id 스코프, updated_at 컬럼 없음.
// assign 은 옛 project_id(references projects)를 쓰므로 projectTable='projects'
// 를 보존한다(interview_project_id 는 pill 축이라 assign 과 별개).
const recruitingAdapter: DeliverableAdapter = {
  feature: 'recruiting',
  table: 'recruiting_forms',
  idColumn: 'form_id',
  scopeColumn: 'user_id',
  projectTable: 'projects',
  shareResourceType: null,
  label: 'Recruiting',
  exportFormats: ['csv'],
  selectColumns: [
    'form_id',
    'title',
    'status',
    'project_id',
    'folder_id',
    'created_at',
  ],
  normalizeStatus(raw) {
    switch (raw) {
      case 'draft':
        return 'draft';
      case 'error':
        return 'error';
      case 'extracting':
        return 'processing';
      // published / extracted → 발행된 폼은 준비된 산출물
      default:
        return 'ready';
    }
  },
  toRow(row) {
    const created = iso(row.created_at, '');
    return {
      feature: 'recruiting',
      id: String(row.form_id ?? ''),
      kind: 'recruiting_form',
      title: str(row.title) ?? this.label,
      status: this.normalizeStatus(str(row.status)),
      project_id: (str(row.project_id) ?? null) as string | null,
      folder_id: (str(row.folder_id) ?? null) as string | null,
      created_at: created,
      updated_at: created, // updated_at 컬럼 없음 → created_at 폴백
      shareable: this.shareResourceType != null,
      export_formats: this.exportFormats,
      meta: { form_status: str(row.status) },
      meta_display: ['Google Forms'],
      progress: null,
    };
  },
};

// ── 레지스트리(the waist) ───────────────────────────────────────────────
// DeliverableRow 투영을 갖는 Phase1 4기능.
export const DELIVERABLE_REGISTRY: Record<DeliverableFeature, DeliverableAdapter> = {
  transcript: transcriptAdapter,
  desk: deskAdapter,
  ut: utAdapter,
  recruiting: recruitingAdapter,
};

// assign(project/folder 배정)이 다루는 6기능의 매핑 SSOT. 4기능은 위 어댑터의
// target 필드를 그대로 재사용(중복 금지)하고, 리스팅 대상이 아닌
// report/interview/scheduler 3기능은 여기에서만 매핑을 선언한다.
export const ASSIGN_TARGETS: Record<AssignFeature, AssignTarget> = {
  transcript: pickTarget(transcriptAdapter),
  desk: pickTarget(deskAdapter),
  ut: pickTarget(utAdapter),
  recruiting: pickTarget(recruitingAdapter),
  report: { table: 'report_jobs', idColumn: 'id', scopeColumn: 'org_id', projectTable: 'projects' },
  interview: { table: 'interview_jobs', idColumn: 'id', scopeColumn: 'org_id', projectTable: 'projects' },
  scheduler: { table: 'scheduler_sessions', idColumn: 'id', scopeColumn: 'org_id', projectTable: 'projects' },
};

function pickTarget(a: DeliverableAdapter): AssignTarget {
  return {
    table: a.table,
    idColumn: a.idColumn,
    scopeColumn: a.scopeColumn,
    projectTable: a.projectTable,
  };
}
