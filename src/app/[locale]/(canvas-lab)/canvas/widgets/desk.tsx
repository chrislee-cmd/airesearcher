'use client';

import type { WidgetContent } from '../widget-types';
import { CTA, Label } from '../shell/primitives';

const KEYWORDS = ['광고 시장', 'D2C', 'MZ세대'];
const SOURCES = [
  { label: '뉴스', on: true },
  { label: '블로그', on: true },
  { label: '커뮤니티', on: true },
  { label: '리포트', on: false },
  { label: '논문', on: false },
];
const PERIODS = ['최근 7일', '최근 30일', '최근 1년', '사용자 정의'];
const FORMATS = ['한 줄 요약 + 인용', '상세 보고서'];

function PrimaryAction() {
  return (
    <div className="space-y-3.5">
      {/* 주제 — 단문 입력 */}
      <div>
        <Label>주제 (한 문장으로)</Label>
        <input
          className="mt-1.5 w-full rounded-xs border border-line bg-paper px-3 py-2.5 text-md text-ink placeholder:text-mute-soft focus:border-ink focus:outline-none"
          placeholder="이 주제에 대해 무엇을 알고 싶으세요?"
          defaultValue="2026년 상반기 광고시장에서 MZ세대 타겟 D2C 브랜드의 위치"
        />
      </div>

      {/* 키워드 — chip input */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <Label>키워드 (최대 5)</Label>
          <span className="text-xs text-mute-soft">{KEYWORDS.length} / 5</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 rounded-xs border border-line bg-paper px-2 py-2 min-h-[40px]">
          {KEYWORDS.map((c) => (
            <span
              key={c}
              className="inline-flex items-center gap-1 rounded-pill bg-lav px-2.5 py-1 text-xs text-ink"
            >
              {c}
              <span className="text-mute-soft">×</span>
            </span>
          ))}
          <input
            className="flex-1 bg-transparent text-md text-ink placeholder:text-mute-soft focus:outline-none"
            placeholder="+ 추가"
          />
        </div>
      </div>

      {/* 출처 / 기간 / 형식 — 라벨 + 토글 그룹 */}
      <div className="grid grid-cols-[64px_1fr] items-center gap-x-3 gap-y-2">
        <Label>출처</Label>
        <div className="flex flex-wrap gap-1.5">
          {SOURCES.map((s) => (
            <button
              key={s.label}
              className={`rounded-pill border px-2.5 py-1 text-xs ${
                s.on
                  ? 'border-amore bg-amore-bg text-amore'
                  : 'border-line bg-paper text-mute hover:border-ink hover:text-ink'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <Label>기간</Label>
        <div className="flex flex-wrap gap-1.5">
          {PERIODS.map((p, i) => (
            <button
              key={p}
              className={`rounded-pill border px-2.5 py-1 text-xs ${
                i === 1
                  ? 'border-amore bg-amore-bg text-amore'
                  : 'border-line bg-paper text-mute hover:border-ink hover:text-ink'
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        <Label>형식</Label>
        <div className="flex flex-wrap gap-1.5">
          {FORMATS.map((f, i) => (
            <button
              key={f}
              className={`rounded-pill border px-2.5 py-1 text-xs ${
                i === 0
                  ? 'border-amore bg-amore-bg text-amore'
                  : 'border-line bg-paper text-mute hover:border-ink hover:text-ink'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* CTA + 비용 / 시간 미리보기 */}
      <div className="space-y-1.5 pt-1">
        <CTA label="리서치 시작 →" />
        <div className="flex items-center justify-between text-xs text-mute-soft">
          <span>25 크레딧 차감</span>
          <span>평균 4분 · 출처 14건 내외</span>
        </div>
      </div>
    </div>
  );
}

export const deskContent: WidgetContent = {
  key: 'desk',
  meta: {
    label: '데스크 리서치',
    subtitle: '키워드만 넣으면 웹을 훑어 인용 + 한 줄 요약 보고서로',
    cost: 25,
    accent: 'sky',
  },
  state: 'idle',
  stats: [
    { label: '이번 달 리서치', value: '12회', trend: 'up' },
    { label: '평균 출처 수', value: '14건' },
    { label: '평균 처리 시간', value: '4분 12초' },
  ],
  recents: [
    { name: '광고 시장 동향 2026 Q2', meta: '2026.06.18 · 18 sources' },
    { name: '헬스케어 D2C 경쟁사 스캔', meta: '2026.06.15 · 24 sources' },
    { name: 'MZ 금융 행동 패턴', meta: '2026.06.11 · 9 sources' },
  ],
  PrimaryAction,
  expandedHeight: 620,
};
