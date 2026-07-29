import { getTranslations } from 'next-intl/server';
import type { SharedRecruitingSummary } from '@/lib/share/loaders';

// 공개 공유 셸 리크루팅 읽기전용 본문 — 조건 chips + 성별×연령 크로스탭 +
// 부합도 카운트. 톤 = sun(셸 masthead 가 소유). fresh 경량 신규 빌드:
// 인증 풀뷰(criteria-panel · distribution · judged-table)의 프레젠테이션은
// 참조만 하고, 여기선 서버 컴포넌트로 **집계만** 정적 렌더한다.
//
// PII 하드 규칙(스펙): 개별 응답자 행·이름·연락처·자유응답 원문·부합도 근거
// 인용문은 여기 없다 — loaders.loadRecruitingSummary 가 카운트만 내려주고,
// 이 본문도 그 카운트만 그린다(자유텍스트 렌더 경로 없음).

export async function RecruitingShareBody({
  data,
}: {
  data: SharedRecruitingSummary;
}) {
  const t = await getTranslations('Share.shell');
  const { criteria, distribution, fit } = data;

  return (
    <div className="flex flex-col gap-3.5">
      {/* ── 참여자 조건 ─────────────────────────────────────────────── */}
      <section className="overflow-hidden rounded-sm border-[3px] border-ink bg-paper shadow-memphis-md">
        <div className="flex items-center gap-2.5 border-b-2 border-ink bg-sun-bg px-3.5 py-2.5">
          <span
            aria-hidden
            className="h-2.5 w-2.5 shrink-0 rounded-full border-[1.5px] border-ink bg-amore"
          />
          <span aria-hidden className="text-md">
            🎯
          </span>
          <span className="min-w-0 flex-1 font-display text-md font-extrabold text-ink">
            {t('recruitingCriteria')}
          </span>
          {criteria.length > 0 && (
            <span className="font-mono-label text-sm tabular-nums text-mute-soft">
              {criteria.length}
            </span>
          )}
        </div>
        <div className="px-3.5 py-3.5">
          {data.summary && (
            <p className="mb-2.5 text-md leading-[1.6] text-mute">
              {data.summary}
            </p>
          )}
          {criteria.length === 0 ? (
            <p className="text-sm leading-[1.6] text-mute-soft">
              {t('recruitingCriteriaEmpty')}
            </p>
          ) : (
            <ul className="flex flex-wrap gap-[7px]">
              {criteria.map((c, i) => (
                <li
                  key={i}
                  className={`inline-flex items-center gap-1.5 rounded-pill border-[1.4px] bg-paper px-2.5 py-[5px] text-sm ${
                    c.required ? 'border-amore' : 'border-line'
                  }`}
                >
                  {c.category && (
                    <span className="font-mono-label text-xs uppercase tracking-[0.12em] text-mute-soft">
                      {c.category}
                    </span>
                  )}
                  <span className="font-semibold text-ink">{c.label}</span>
                  {c.required && (
                    <span className="text-xs font-bold text-amore">
                      {t('recruitingRequired')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ── 성별 × 연령 분포 ────────────────────────────────────────── */}
      <section className="overflow-hidden rounded-sm border-[3px] border-ink bg-paper shadow-memphis-md">
        <div className="flex items-center gap-2.5 border-b-2 border-ink bg-mint-bg px-3.5 py-2.5">
          <span
            aria-hidden
            className="h-2.5 w-2.5 shrink-0 rounded-full border-[1.5px] border-ink bg-success"
          />
          <span aria-hidden className="text-md">
            📊
          </span>
          <span className="min-w-0 flex-1 font-display text-md font-extrabold text-ink">
            {t('recruitingDistribution')}
          </span>
          {distribution && distribution.grandTotal > 0 && (
            <span className="font-mono-label text-sm tabular-nums text-mute-soft">
              {t('recruitingRespondents', { count: distribution.grandTotal })}
            </span>
          )}
        </div>
        <div className="px-3.5 py-3.5">
          {distribution && distribution.grandTotal > 0 ? (
            <CrosstabGrid table={distribution} axisLabel={t('recruitingDistAxis')} />
          ) : (
            <p className="text-sm leading-[1.6] text-mute-soft">
              {t('recruitingDistEmpty')}
            </p>
          )}
        </div>
      </section>

      {/* ── 참여자 부합도 ───────────────────────────────────────────── */}
      <section className="overflow-hidden rounded-sm border-[3px] border-ink bg-paper shadow-memphis-md">
        <div className="flex items-center gap-2.5 border-b-2 border-ink bg-lav-bg-3 px-3.5 py-2.5">
          <span
            aria-hidden
            className="h-2.5 w-2.5 shrink-0 rounded-full border-[1.5px] border-ink bg-violet"
          />
          <span aria-hidden className="text-md">
            ✅
          </span>
          <span className="min-w-0 flex-1 font-display text-md font-extrabold text-ink">
            {t('recruitingFit')}
          </span>
          {fit.total > 0 && (
            <span className="font-mono-label text-sm tabular-nums text-mute-soft">
              {t('recruitingRespondents', { count: fit.total })}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-2.5 px-3.5 py-3.5">
          {fit.total === 0 ? (
            <p className="text-sm leading-[1.6] text-mute-soft">
              {t('recruitingFitEmpty')}
            </p>
          ) : (
            <>
              <FitBar label={t('recruitingFitHigh')} count={fit.high} total={fit.total} dot="bg-success" />
              <FitBar label={t('recruitingFitMedium')} count={fit.medium} total={fit.total} dot="bg-amber" />
              <FitBar label={t('recruitingFitLow')} count={fit.low} total={fit.total} dot="bg-mute-soft" />
              {fit.unknown > 0 && (
                <FitBar
                  label={t('recruitingFitUnknown')}
                  count={fit.unknown}
                  total={fit.total}
                  dot="bg-line-empty"
                />
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

// 부합도 카운트 한 줄 — 라벨 · 카운트 · 비율 바(집계만).
function FitBar({
  label,
  count,
  total,
  dot,
}: {
  label: string;
  count: number;
  total: number;
  dot: string;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="flex w-[92px] shrink-0 items-center gap-1.5">
        <span
          aria-hidden
          className={`h-2.5 w-2.5 shrink-0 rounded-full border-[1.5px] border-ink ${dot}`}
        />
        <span className="text-md font-semibold text-ink">{label}</span>
      </div>
      <div className="h-3 min-w-0 flex-1 overflow-hidden rounded-pill border border-line bg-paper-soft">
        <div
          className="h-full rounded-pill bg-ink/70"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-[76px] shrink-0 text-right font-mono-label text-sm tabular-nums text-ink-2">
        {count} · {pct}%
      </span>
    </div>
  );
}

// 성별×연령 crosstab — 인증 풀뷰 DistributionGrid 의 정적(비인터랙티브) 판본.
// 셀 = 카운트 텍스트만(크로스필터 버튼 없음). mono 표.
function CrosstabGrid({
  table,
  axisLabel,
}: {
  table: SharedRecruitingSummary['distribution'] & object;
  axisLabel: string;
}) {
  const { xLabels, yLabels, cells, xTotal, yTotal, grandTotal } = table;
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full border-collapse font-mono-label text-md tabular-nums">
        <thead>
          <tr>
            <th className="border-b border-line px-1 py-1.5 text-left text-xs uppercase tracking-[0.1em] text-faint">
              {axisLabel}
            </th>
            {yLabels.map((y) => (
              <th
                key={y}
                className="border-b border-line px-2 py-1.5 text-right text-xs-soft text-mute-soft"
              >
                {y}
              </th>
            ))}
            <th className="border-b border-line px-1 py-1.5 text-right text-xs-soft font-extrabold text-ink">
              Σ
            </th>
          </tr>
        </thead>
        <tbody>
          {xLabels.map((x, i) => (
            <tr key={x} className="border-b border-ink/[0.07] last:border-b-0">
              <td className="whitespace-nowrap px-1 py-1.5 text-left font-sans text-md font-semibold text-ink-2">
                {x}
              </td>
              {yLabels.map((y, j) => {
                const count = cells[i][j];
                return (
                  <td
                    key={y}
                    className={`px-2 py-1.5 text-right tabular-nums ${
                      count ? 'text-ink-2' : 'text-line-empty'
                    }`}
                  >
                    {count || '·'}
                  </td>
                );
              })}
              <td className="px-1 py-1.5 text-right font-extrabold text-ink">
                {xTotal[i]}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-[1.5px] border-ink/15">
            <td className="px-1 py-1.5 text-left font-sans text-md font-extrabold text-ink">
              Σ
            </td>
            {yTotal.map((tot, j) => (
              <td
                key={yLabels[j]}
                className="px-2 py-1.5 text-right font-extrabold text-ink"
              >
                {tot}
              </td>
            ))}
            <td className="px-1 py-1.5 text-right font-extrabold text-amore-deep">
              {grandTotal}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
