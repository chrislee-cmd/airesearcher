import type { ToplineMeteringReport } from '@/lib/admin/topline-metering';

// 탑라인 생성 비용 실측 카드 — /admin/api-usage 하단에 붙는 섹션 1개(과금 책정
// 선행, 측정 전용). super-admin 전용 내부 도구라 i18n 대상이 아니다(WRITING.md
// 불변식 ① 예외: admin 표면은 한글 유지). 다만 이 컴포넌트 파일은 src/components
// 아래라 가드의 **경로 화이트리스트 밖**이므로, 한글 리터럴을 아래 L 블록에 모아
// 각 줄 `i18n-allow-korean` 지시자로 개별 예외 처리한다(레포 확립 관례 —
// translate-console·credits-bundles 등 선례). 디자인 시스템 토큰만 사용.
//
// 수치의 출처는 전부 interview_toplines.usage jsonb — 생성 경로가 계산해 넣은
// est_cost 를 어드민이 집계만 한 것(단일 계산 경로). 서버 컴포넌트(스냅샷).

// 어드민 카드 한글 카피(비-i18n 표면). 각 줄 자체가 예외 지시자를 동반한다.
const L = {
  label: '과금 책정 선행 · 측정 전용', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  title: '탑라인 생성 비용 실측', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  subtitle: (days: number, runCount: string) =>
    `최근 ${days}일 완료된 보고서 생성 ${runCount}건의 토큰 실측·추정 비용(est_cost). 모델 단가 상수로 서버가 계산한 값을 집계 — 차감과 무관합니다.`, // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  empty: (days: number) =>
    `최근 ${days}일 내 측정된 생성 run 이 없습니다. 신규 탑라인을 한 번 생성하면 여기에 실측이 쌓입니다.`, // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  costAvg: '건당 평균', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  median: '중앙값', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  costTotal: (days: number) => `${days}일 누적`, // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  docTitle: '문서 수 분포 (run 당 응답자)', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  statAvg: '평균', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  statMin: '최소', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  statMax: '최대', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  docMissing: '문서 수 미기록', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  tokensTitle: (days: number) => `토큰 소계 (${days}일)`, // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  mapCalls: 'map 호출', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  reduceCalls: 'reduce 호출', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  tokensMissing: '토큰 미기록', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
  footnote:
    'map = 문서별 Sonnet 추출, reduce = Opus 종합. est_cost 는 공개 단가 상수(lib/chains/llm-pricing.ts) 기반 추정이며 실청구액은 Anthropic 콘솔이 SSOT. 1~2주 실측 적재 후 가격 PR 로 반영합니다.', // i18n-allow-korean -- 어드민 전용(비-i18n 표면)
} as const;

function formatUsd(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    // 건당 비용이 작아 소수 4자리까지 — 센트 미만 차이가 과금 단가에 유의.
    maximumFractionDigits: 4,
  });
}

function formatInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function AdminToplineMetering({
  report,
}: {
  report: ToplineMeteringReport;
}) {
  const { cost, docDistribution: docs, tokens, runCount, windowDays } = report;

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
          {L.subtitle(windowDays, formatInt(runCount))}
        </p>
      </header>

      {cost === null ? (
        <div className="border border-line bg-paper px-4 py-6 text-center text-md text-mute-soft rounded-sm">
          {L.empty(windowDays)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard label={L.costAvg} value={formatUsd(cost.avgUsd)} emphasized />
            <MetricCard label={L.median} value={formatUsd(cost.medianUsd)} />
            <MetricCard label="p90" value={formatUsd(cost.p90Usd)} />
            <MetricCard
              label={L.costTotal(windowDays)}
              value={formatUsd(cost.totalUsd)}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <article className="border border-line bg-paper px-4 py-3 rounded-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-mute-soft">
                {L.docTitle}
              </div>
              {docs ? (
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1.5 text-md">
                  <Stat label={L.statAvg} value={formatInt(docs.avg)} />
                  <Stat label={L.median} value={formatInt(docs.median)} />
                  <Stat label={L.statMin} value={formatInt(docs.min)} />
                  <Stat label={L.statMax} value={formatInt(docs.max)} />
                </div>
              ) : (
                <div className="mt-2 text-md text-mute-soft">{L.docMissing}</div>
              )}
            </article>

            <article className="border border-line bg-paper px-4 py-3 rounded-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-mute-soft">
                {L.tokensTitle(windowDays)}
              </div>
              {tokens ? (
                <div className="mt-2 space-y-1.5 text-md">
                  <div className="flex flex-wrap gap-x-6 gap-y-1">
                    <Stat label={L.mapCalls} value={formatInt(tokens.mapCalls)} />
                    <Stat label="map in" value={formatInt(tokens.mapInputTokens)} />
                    <Stat label="map out" value={formatInt(tokens.mapOutputTokens)} />
                  </div>
                  <div className="flex flex-wrap gap-x-6 gap-y-1">
                    <Stat
                      label={L.reduceCalls}
                      value={formatInt(tokens.reduceCalls)}
                    />
                    <Stat
                      label="reduce in"
                      value={formatInt(tokens.reduceInputTokens)}
                    />
                    <Stat
                      label="reduce out"
                      value={formatInt(tokens.reduceOutputTokens)}
                    />
                  </div>
                </div>
              ) : (
                <div className="mt-2 text-md text-mute-soft">
                  {L.tokensMissing}
                </div>
              )}
            </article>
          </div>

          <p className="text-xs-soft text-mute-soft">{L.footnote}</p>
        </>
      )}
    </section>
  );
}

function MetricCard({
  label,
  value,
  emphasized,
}: {
  label: string;
  value: string;
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
