import type { ToplineMeteringReport } from '@/lib/admin/topline-metering';

// 탑라인 생성 비용 실측 카드 — /admin/api-usage 하단에 붙는 섹션 1개(과금 책정
// 선행, 측정 전용). super-admin 전용 내부 도구라 i18n 하지 않고(messages/*.json
// 무수정 — §제약) 한국어 리터럴을 직접 쓴다. 디자인 시스템 토큰만 사용.
//
// 수치의 출처는 전부 interview_toplines.usage jsonb — 생성 경로가 계산해 넣은
// est_cost 를 어드민이 집계만 한 것(단일 계산 경로). 서버 컴포넌트(스냅샷).

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
          과금 책정 선행 · 측정 전용
        </div>
        <h2 className="mt-1 text-2xl font-semibold tracking-[-0.01em] text-ink">
          탑라인 생성 비용 실측
        </h2>
        <p className="mt-1 text-md text-mute">
          최근 {windowDays}일 완료된 보고서 생성 {formatInt(runCount)}건의 토큰
          실측 · 추정 비용(est_cost). 모델 단가 상수로 서버가 계산한 값을 집계 —
          차감과 무관합니다.
        </p>
      </header>

      {cost === null ? (
        <div className="border border-line bg-paper px-4 py-6 text-center text-md text-mute-soft rounded-sm">
          최근 {windowDays}일 내 측정된 생성 run 이 없습니다. 신규 탑라인을 한 번
          생성하면 여기에 실측이 쌓입니다.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard
              label="건당 평균"
              value={formatUsd(cost.avgUsd)}
              emphasized
            />
            <MetricCard label="중앙값" value={formatUsd(cost.medianUsd)} />
            <MetricCard label="p90" value={formatUsd(cost.p90Usd)} />
            <MetricCard
              label={`${windowDays}일 누적`}
              value={formatUsd(cost.totalUsd)}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <article className="border border-line bg-paper px-4 py-3 rounded-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-mute-soft">
                문서 수 분포 (run 당 응답자)
              </div>
              {docs ? (
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1.5 text-md">
                  <Stat label="평균" value={formatInt(docs.avg)} />
                  <Stat label="중앙값" value={formatInt(docs.median)} />
                  <Stat label="최소" value={formatInt(docs.min)} />
                  <Stat label="최대" value={formatInt(docs.max)} />
                </div>
              ) : (
                <div className="mt-2 text-md text-mute-soft">문서 수 미기록</div>
              )}
            </article>

            <article className="border border-line bg-paper px-4 py-3 rounded-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-mute-soft">
                토큰 소계 ({windowDays}일)
              </div>
              {tokens ? (
                <div className="mt-2 space-y-1.5 text-md">
                  <div className="flex flex-wrap gap-x-6 gap-y-1">
                    <Stat
                      label="map 호출"
                      value={formatInt(tokens.mapCalls)}
                    />
                    <Stat
                      label="map in"
                      value={formatInt(tokens.mapInputTokens)}
                    />
                    <Stat
                      label="map out"
                      value={formatInt(tokens.mapOutputTokens)}
                    />
                  </div>
                  <div className="flex flex-wrap gap-x-6 gap-y-1">
                    <Stat
                      label="reduce 호출"
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
                <div className="mt-2 text-md text-mute-soft">토큰 미기록</div>
              )}
            </article>
          </div>

          <p className="text-xs-soft text-mute-soft">
            map = 문서별 Sonnet 추출, reduce = Opus 종합. est_cost 는 공개 단가
            상수(lib/chains/llm-pricing.ts) 기반 추정이며 실청구액은 Anthropic
            콘솔이 SSOT. 1~2주 실측 적재 후 가격 PR 로 반영합니다.
          </p>
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
