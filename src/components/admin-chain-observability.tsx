import type { ReactNode } from 'react';
import type {
  ChainObservabilityReport,
  ChainStepStat,
} from '@/lib/admin/chain-observability';
import { CHAIN_STATUSES } from '@/lib/admin/chain-observability';
import type { CronHeartbeat } from '@/lib/observability/cron-heartbeat';

// 위젯 체인 현황 카드 — /admin/api-usage 하단 섹션(파일럿 평가 + 운영 생존 신호).
// super-admin 전용 내부 도구라 i18n 대상이 아니다(WRITING.md 불변식 ① 예외:
// admin 표면은 한글 유지). 다만 이 파일은 src/components 아래라 한글 가드의
// **경로 화이트리스트 밖**이므로, 한글 리터럴을 아래 L 블록에 모아 각 줄
// `i18n-allow-korean` 지시자로 개별 예외 처리한다(admin-topline-metering 선례).
// 디자인 시스템 토큰만 사용. 서버 컴포넌트(스냅샷).
//
// 카드의 첫 블록이 집계가 아니라 **cron 생존 신호**인 이유: 집계 수치는 "체인이
// 돌고 있다면" 의미가 있는데, sweep 이 죽었는지 여부가 그 전제를 결정한다.
// 무음을 정상으로 읽지 않게 하려면 그 판정이 제일 위에 있어야 한다.

// 어드민 카드 한글 카피(비-i18n 표면). 각 줄 자체가 예외 지시자를 동반한다.
const L = {
  label: '체인 파일럿 · 관측 전용', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  title: '위젯 체인 현황', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  subtitle: (days: number, total: string) =>
    `최근 ${days}일 생성된 체인 ${total}건의 진행·완주 집계. widget_chains raw 행을 코드로 센 값(집계 뷰 없음) — 수치가 raw 수계산과 정의상 일치합니다.`, // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  empty: (days: number) =>
    `최근 ${days}일 내 생성된 체인이 없습니다. 프로빙·전사록에서 체인을 한 번 시작하면 여기에 집계가 쌓입니다.`, // i18n-allow-korean -- 어드민 전용(비-i18n 표면)

  // ── cron 생존 신호 ──
  cronTitle: 'cron 생존 신호 (성공 실행 기록)', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  cronNote:
    '실패가 아니라 성공을 기록합니다 — cron 이 아예 안 돌면 error_events 에 아무 신호도 안 나기 때문입니다(무음 ≠ 정상). 기대 주기의 2배를 넘기면 경고.', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  cronJobLabels: {
    'chain-sweep': '체인 stale-sweep', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  } as Record<string, string>,
  lastRun: '마지막 실행', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  neverRan: '기록 없음 — 한 번도 완주하지 않았습니다', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  cronUnavailable: 'heartbeat 테이블 미적용 — 판정 보류', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  badgeStale: 'STALE', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  badgeLive: '정상', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  badgeUnknown: '미확인', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  cronEvery: (text: string) => `기대 주기 ${text}`, // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  cronScanned: '훑음', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  cronActed: '처리', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  staleAfter: (text: string) => `${text} 초과 시 경고`, // i18n-allow-korean -- 어드민 전용(비-i18n 표면)

  // ── 집계 ──
  created: '생성 수', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  completionRate: '완주율', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  completionSub: (done: string, terminal: string) =>
    `done ${done} / 종결 ${terminal}`, // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  completionNone: '종결 체인 없음', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  modeApprove: '승인 모드', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  modeAuto: '자동 모드', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  statusTitle: '상태별 분포', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  statusLabels: {
    running: '진행 중', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
    awaiting_approval: '승인 대기', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
    paused_insufficient_credits: '잔액 부족 정지', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
    done: '완주', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
    error: '실패', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
    cancelled: '사용자 종료', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  } as Record<string, string>,
  stepsTitle: '단계별 진행 / skip 률', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  stepLabels: {
    probing: '프로빙', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
    transcripts: '전사록', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
    interview_ingest: '인터뷰 분석', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
    topline: '탑라인 보고서', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  } as Record<string, string>,
  colStep: '단계', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  colInstances: '포함 체인', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  colDone: '완료', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  colSkipped: 'skip', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  colError: '실패', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  colSkipRate: 'skip 률', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  stepsEmpty: '단계 인스턴스가 없습니다', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  footnote:
    '체인 동작 로직은 이 PR 에서 수정하지 않습니다 — 집계·표시 전용. 완주율의 분모는 종결 체인(done+error+cancelled)이고 진행 중 체인은 빠집니다. skip 률은 해당 단계를 품은 체인 중 사용자가 건너뛴 비율(가변 진입점 때문에 단계마다 분모가 다릅니다).', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  minutesAgo: (n: string) => `${n}분 전`, // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  hoursAgo: (n: string) => `${n}시간 전`, // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  daysAgo: (n: string) => `${n}일 전`, // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  justNow: '방금', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  minutes: (n: string) => `${n}분`, // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  hours: (n: string) => `${n}시간`, // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
} as const;

function formatInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

function formatPct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

/** 경과 ms → "N분 전" 류. 서버 렌더 시점 스냅샷이라 상대 표기가 읽기 쉽다. */
function formatAgo(ms: number): string {
  const min = Math.floor(ms / 60000);
  if (min < 1) return L.justNow;
  if (min < 60) return L.minutesAgo(formatInt(min));
  const hours = Math.floor(min / 60);
  if (hours < 48) return L.hoursAgo(formatInt(hours));
  return L.daysAgo(formatInt(Math.floor(hours / 24)));
}

/** 주기/판정선 ms → "60분" / "2시간". */
function formatDuration(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 120) return L.minutes(formatInt(min));
  return L.hours(formatInt(Math.round(min / 60)));
}

export function AdminChainObservability({
  report,
}: {
  report: ChainObservabilityReport;
}) {
  const { total, byMode, byStatus, completion, steps, heartbeats, windowDays } =
    report;

  return (
    <section className="mx-auto mt-8 max-w-[960px] space-y-4">
      <header className="border-b border-line pb-3">
        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-amore">
          {L.label}
        </div>
        <h2 className="mt-1 text-2xl font-semibold tracking-[-0.01em] text-ink">
          {L.title}
        </h2>
        <p className="mt-1 text-md text-mute">
          {L.subtitle(windowDays, formatInt(total))}
        </p>
      </header>

      {/* 생존 신호 — 집계보다 위. 체인이 0건이어도 이 블록은 항상 그린다. */}
      <article className="border border-line bg-paper px-4 py-3 rounded-sm">
        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-mute-soft">
          {L.cronTitle}
        </div>
        <div className="mt-2 space-y-2">
          {heartbeats.map((hb) => (
            <CronRow key={hb.job} hb={hb} />
          ))}
        </div>
        <p className="mt-2 text-xs-soft text-mute-soft">{L.cronNote}</p>
      </article>

      {total === 0 ? (
        <div className="border border-line bg-paper px-4 py-6 text-center text-md text-mute-soft rounded-sm">
          {L.empty(windowDays)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard label={L.created} value={formatInt(total)} />
            <MetricCard
              label={L.completionRate}
              value={completion ? formatPct(completion.rate) : '—'}
              sub={
                completion
                  ? L.completionSub(
                      formatInt(completion.done),
                      formatInt(completion.terminal),
                    )
                  : L.completionNone
              }
              emphasized
            />
            <MetricCard label={L.modeApprove} value={formatInt(byMode.approve)} />
            <MetricCard label={L.modeAuto} value={formatInt(byMode.auto)} />
          </div>

          <article className="border border-line bg-paper px-4 py-3 rounded-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-mute-soft">
              {L.statusTitle}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1.5 text-md">
              {CHAIN_STATUSES.map((s) => (
                <Stat
                  key={s}
                  label={L.statusLabels[s] ?? s}
                  value={formatInt(byStatus[s])}
                />
              ))}
            </div>
          </article>

          <article className="border border-line bg-paper px-4 py-3 rounded-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-mute-soft">
              {L.stepsTitle}
            </div>
            {steps.length === 0 ? (
              <div className="mt-2 text-md text-mute-soft">{L.stepsEmpty}</div>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[480px] border-collapse text-md">
                  <thead>
                    <tr className="border-b border-line-soft text-left">
                      <Th>{L.colStep}</Th>
                      <Th numeric>{L.colInstances}</Th>
                      <Th numeric>{L.colDone}</Th>
                      <Th numeric>{L.colSkipped}</Th>
                      <Th numeric>{L.colError}</Th>
                      <Th numeric>{L.colSkipRate}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {steps.map((s) => (
                      <StepRow key={s.key} stat={s} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>

          <p className="text-xs-soft text-mute-soft">{L.footnote}</p>
        </>
      )}
    </section>
  );
}

function CronRow({ hb }: { hb: CronHeartbeat }) {
  const label = L.cronJobLabels[hb.job] ?? hb.job;
  // 세 가지 상태를 구분한다: 판정 보류(테이블 미적용) · STALE(미실행 포함) · 정상.
  // 미적용을 STALE 로 칠하면 거짓 경보가 되므로 중립 톤으로 둔다.
  const tone = hb.unavailable ? 'unknown' : hb.stale ? 'stale' : 'live';

  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-1 border px-3 py-2 rounded-xs ${
        tone === 'stale'
          ? 'border-warning-line bg-warning-bg'
          : 'border-line-soft bg-paper'
      }`}
    >
      <span className="font-semibold text-ink">{label}</span>
      <Badge tone={tone} />
      <span className="text-mute">
        {hb.unavailable ? (
          L.cronUnavailable
        ) : hb.ranAt === null || hb.ageMs === null ? (
          L.neverRan
        ) : (
          <>
            {L.lastRun} <span className="tabular-nums text-ink-2">{formatAgo(hb.ageMs)}</span>
          </>
        )}
      </span>
      <span className="text-xs-soft text-mute-soft">
        {L.cronEvery(formatDuration(hb.intervalMs))} ·{' '}
        {L.staleAfter(formatDuration(hb.staleAfterMs))}
      </span>
      {hb.scanned !== null && hb.acted !== null && (
        <span className="flex gap-x-4">
          <Stat label={L.cronScanned} value={formatInt(hb.scanned)} />
          <Stat label={L.cronActed} value={formatInt(hb.acted)} />
        </span>
      )}
    </div>
  );
}

function Badge({ tone }: { tone: 'stale' | 'live' | 'unknown' }) {
  const text =
    tone === 'stale' ? L.badgeStale : tone === 'live' ? L.badgeLive : L.badgeUnknown;
  const cls =
    tone === 'stale'
      ? 'border-warning text-warning'
      : tone === 'live'
        ? 'border-success text-success'
        : 'border-line text-mute-soft';
  return (
    <span
      className={`inline-flex items-center border px-1.5 py-0.5 text-xs font-semibold uppercase tracking-[0.18em] rounded-xs ${cls}`}
    >
      {text}
    </span>
  );
}

function StepRow({ stat }: { stat: ChainStepStat }) {
  return (
    <tr className="border-b border-line-soft last:border-0">
      <td className="py-1.5 pr-3 text-ink-2">
        {L.stepLabels[stat.key] ?? stat.key}
      </td>
      <Td>{formatInt(stat.instances)}</Td>
      <Td>{formatInt(stat.done)}</Td>
      <Td>{formatInt(stat.skipped)}</Td>
      <Td>{formatInt(stat.error)}</Td>
      <Td>{stat.skipRate === null ? '—' : formatPct(stat.skipRate)}</Td>
    </tr>
  );
}

function Th({
  children,
  numeric,
}: {
  children: ReactNode;
  numeric?: boolean;
}) {
  return (
    <th
      className={`py-1.5 pr-3 text-xs font-semibold uppercase tracking-[0.18em] text-mute-soft ${
        numeric ? 'text-right' : ''
      }`}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td className="py-1.5 pr-3 text-right font-semibold tabular-nums text-ink-2">
      {children}
    </td>
  );
}

function MetricCard({
  label,
  value,
  sub,
  emphasized,
}: {
  label: string;
  value: string;
  sub?: string;
  emphasized?: boolean;
}) {
  return (
    <div
      className={`border bg-paper px-4 py-3 rounded-sm ${
        emphasized ? 'border-amore' : 'border-line'
      }`}
    >
      <div
        className={`text-xs font-semibold uppercase tracking-[0.22em] ${
          emphasized ? 'text-amore' : 'text-mute-soft'
        }`}
      >
        {label}
      </div>
      <div
        className={`mt-1 text-2xl font-semibold tabular-nums tracking-[-0.01em] ${
          emphasized ? 'text-amore' : 'text-ink'
        }`}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs-soft text-mute-soft">{sub}</div>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-xs uppercase tracking-[0.18em] text-mute-soft">
        {label}
      </span>
      <span className="font-semibold tabular-nums text-ink-2">{value}</span>
    </span>
  );
}
