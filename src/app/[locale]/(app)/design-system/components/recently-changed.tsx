'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import changedUi from '../changed-ui.generated.json';
import { PrimitivePage } from './primitive-page';
import { SECTION_INDEX, isSectionId, type SectionId } from './sections';

// scripts/gen-changed-ui.mjs 산출물. 최근 머지된 UI 변경분.
type ChangedEntry = {
  kind: 'component' | 'route' | 'style';
  name: string;
  file: string;
  line: number;
  prNumber: number | null;
  mergedAt: string;
  oneLine: string;
  catalogKey: string | null;
};
type ChangedUi = { generatedAt: string; sinceDays: number; entries: ChangedEntry[] };

const DATA = changedUi as ChangedUi;

const GH_REPO = 'https://github.com/chrislee-cmd/airesearcher';
const GH_BLOB = `${GH_REPO}/blob/main/`;

const PERIODS = [
  { days: 7, label: '7일' },
  { days: 14, label: '14일' },
  { days: 30, label: '30일' },
] as const;

const KIND_LABEL: Record<ChangedEntry['kind'], string> = {
  component: '컴포넌트',
  route: '화면',
  style: '스타일',
};

function relativeDays(fromIso: string, toIso: string): string {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days <= 0) return '오늘';
  if (days === 1) return '어제';
  return `${days}일 전`;
}

function isoDate(iso: string): string {
  return iso.slice(0, 10);
}

// 커밋 제목에서 prefix(feat:/fix:/…) 와 끝의 (#NNN) 을 걷어낸 본문.
function cleanTitle(subject: string): string {
  return subject
    .replace(/^(feat|fix|chore|hotfix|docs|refactor|perf|style|test)(\([^)]*\))?:\s*/i, '')
    .replace(/\s*\(#\d+\)\s*$/, '')
    .trim();
}

function LiveRender({ catalogKey }: { catalogKey: SectionId }) {
  const entry = SECTION_INDEX[catalogKey];
  return (
    <div className="mt-3 rounded-sm border border-line-soft bg-paper-soft p-4">
      {entry.render()}
    </div>
  );
}

function EntryCard({ entry, reference }: { entry: ChangedEntry; reference: string }) {
  const [open, setOpen] = useState(false);
  const live = entry.catalogKey && isSectionId(entry.catalogKey) ? entry.catalogKey : null;

  return (
    <li className="border border-line bg-paper p-4 rounded-sm">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="inline-flex items-center rounded-xs border border-line bg-paper-soft px-1.5 py-0.5 text-xs uppercase tracking-wider text-mute">
          {KIND_LABEL[entry.kind]}
        </span>
        <span className="text-lg font-semibold text-ink">{entry.name}</span>
        {live ? (
          <span className="inline-flex items-center rounded-xs bg-amore-bg px-1.5 py-0.5 text-xs text-ink">
            카탈로그 등록
          </span>
        ) : null}
        <span className="ml-auto text-sm text-mute-soft tabular-nums" title={entry.mergedAt}>
          {relativeDays(entry.mergedAt, reference)} · {isoDate(entry.mergedAt)}
        </span>
      </div>

      <p className="mt-1.5 text-md text-mute">{cleanTitle(entry.oneLine)}</p>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs-soft">
        {entry.prNumber ? (
          <a
            href={`${GH_REPO}/pull/${entry.prNumber}`}
            target="_blank"
            rel="noreferrer"
            className="text-mute transition-colors hover:text-amore hover:underline"
          >
            PR #{entry.prNumber}
          </a>
        ) : null}
        <a
          href={`${GH_BLOB}${entry.file}`}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-mute transition-colors hover:text-amore hover:underline"
        >
          {entry.file}
        </a>
        {live ? (
          <Button size="xs" variant="link" onClick={() => setOpen((v) => !v)}>
            {open ? '▾ 라이브 렌더 닫기' : '▸ 라이브 렌더 보기'}
          </Button>
        ) : null}
      </div>

      {live && open ? <LiveRender catalogKey={live} /> : null}
    </li>
  );
}

export function RecentlyChanged() {
  const [days, setDays] = useState<number>(14);
  const reference = DATA.generatedAt;

  const entries = useMemo(() => {
    const cutoff = new Date(reference).getTime() - days * 86_400_000;
    return DATA.entries
      .filter((e) => new Date(e.mergedAt).getTime() >= cutoff)
      .slice()
      .sort((a, b) => b.mergedAt.localeCompare(a.mergedAt));
  }, [days, reference]);

  const liveCount = entries.filter((e) => e.catalogKey && isSectionId(e.catalogKey)).length;

  return (
    <PrimitivePage
      title="Recently Changed"
      hint="최근 배포에서 바뀐 UI(컴포넌트 · 화면 · 스타일)만 모아 회귀 확인/리뷰용으로 렌더. 카탈로그 등록 프리미티브는 라이브 렌더, 나머지는 GitHub 링크만."
    >
      {/* 한계 명시 (spec §C) */}
      <div className="mb-4 rounded-xs border border-line-soft bg-paper-soft px-3 py-2 text-sm text-mute">
        <ul className="list-disc space-y-0.5 pl-4">
          <li>
            카탈로그 <strong>미등록 컴포넌트(위젯 내부 등)·화면은 라이브 렌더 불가</strong> — GitHub
            링크만 제공합니다.
          </li>
          <li>
            “최근 N일”은 <strong>gen 재실행(배포) 시점 기준</strong>으로 갱신됩니다(런타임 실시간
            아님). 마지막 생성: <span className="tabular-nums">{isoDate(reference)}</span>.
            <code className="ml-1 font-mono">pnpm gen:changed-ui</code>
          </li>
          <li>before/after 픽셀 비교는 범위 밖입니다(스크린샷 스토리지 별건).</li>
        </ul>
      </div>

      {/* 기간 필터 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-sm text-mute-soft">기간</span>
        {PERIODS.map((p) => (
          <Button
            key={p.days}
            size="xs"
            variant={days === p.days ? 'secondary' : 'ghost'}
            onClick={() => setDays(p.days)}
            aria-pressed={days === p.days}
          >
            {p.label}
          </Button>
        ))}
        <span className="ml-auto text-sm text-mute-soft tabular-nums">
          {entries.length}건 · 라이브 렌더 {liveCount}
        </span>
      </div>

      {entries.length === 0 ? (
        <p className="text-md text-mute">해당 기간에 변경된 UI 가 없습니다.</p>
      ) : (
        <ul className="space-y-3">
          {entries.map((e) => (
            <EntryCard key={`${e.file}`} entry={e} reference={reference} />
          ))}
        </ul>
      )}
    </PrimitivePage>
  );
}
