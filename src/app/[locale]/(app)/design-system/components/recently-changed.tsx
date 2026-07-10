'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
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
  previewPath: string | null;
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

// iframe 미리보기 논리 크기 — 데스크톱 폭으로 렌더 후 컨테이너 폭에 맞춰 축소.
const PREVIEW_W = 1280;
const PREVIEW_H = 1600;
const PREVIEW_BOX_H = 440; // 크롭된 썸네일 높이

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

function PrNumber({ pr }: { pr: number | null }) {
  if (!pr) return null;
  return (
    <a
      href={`${GH_REPO}/pull/${pr}`}
      target="_blank"
      rel="noreferrer"
      className="text-mute transition-colors hover:text-amore hover:underline"
    >
      PR #{pr}
    </a>
  );
}

// ── 화면 미리보기 — 실제 앱 라우트를 same-origin iframe 으로 라이브 렌더.
//    IntersectionObserver 로 뷰포트 근처일 때만 로드(지연) · ResizeObserver 로
//    컨테이너 폭에 맞춰 축소. 클릭 = 새 탭에서 실물 화면 열기.
function ScreenFrame({ path, enabled }: { path: string; enabled: boolean }) {
  const locale = useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) setNear(true);
      },
      { rootMargin: '300px' },
    );
    io.observe(el);
    return () => {
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  const scale = width ? width / PREVIEW_W : 0;
  const src = `/${locale}${path}`;
  const show = enabled && near && scale > 0;

  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer"
      title="새 탭에서 실제 화면 열기"
      className="group relative block overflow-hidden rounded-sm border border-line bg-paper-soft"
      style={{ height: PREVIEW_BOX_H }}
    >
      <div ref={ref} className="absolute inset-0">
        {show ? (
          <iframe
            src={src}
            title={path}
            loading="lazy"
            tabIndex={-1}
            className="pointer-events-none"
            style={{
              width: PREVIEW_W,
              height: PREVIEW_H,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
              border: 0,
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-mute-soft">
            {enabled ? '미리보기 로딩…' : '미리보기 꺼짐'}
          </div>
        )}
      </div>
      <span className="absolute right-2 top-2 rounded-xs border border-line bg-paper/90 px-1.5 py-0.5 text-xs-soft text-mute opacity-0 transition-opacity group-hover:opacity-100">
        ↗ 새 탭에서 열기
      </span>
    </a>
  );
}

type ScreenGroup = { path: string; items: ChangedEntry[]; newest: string };

function ScreenCard({
  group,
  reference,
  previewEnabled,
}: {
  group: ScreenGroup;
  reference: string;
  previewEnabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border border-line bg-paper p-4 rounded-sm">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="inline-flex items-center rounded-xs border border-line bg-paper-soft px-1.5 py-0.5 text-xs uppercase tracking-wider text-mute">
          화면
        </span>
        <code className="font-mono text-lg font-semibold text-ink">{group.path}</code>
        <span className="text-sm text-mute-soft">· {group.items.length}개 변경</span>
        <span className="ml-auto text-sm text-mute-soft tabular-nums" title={group.newest}>
          {relativeDays(group.newest, reference)} · {isoDate(group.newest)}
        </span>
      </div>

      <ScreenFrame path={group.path} enabled={previewEnabled} />

      <div className="mt-2">
        <Button size="xs" variant="link" onClick={() => setOpen((v) => !v)}>
          {open ? '▾ 변경 내역 닫기' : `▸ 변경 내역 (${group.items.length})`}
        </Button>
        {open ? (
          <ul className="mt-1.5 space-y-1.5">
            {group.items.map((e) => (
              <li key={e.file} className="text-sm">
                <span className="text-mute">{cleanTitle(e.oneLine)}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs-soft">
                  <PrNumber pr={e.prNumber} />
                  <a
                    href={`${GH_BLOB}${e.file}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-mute transition-colors hover:text-amore hover:underline"
                  >
                    {e.file}
                  </a>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

type PrimitiveGroup = { key: SectionId; items: ChangedEntry[]; newest: string };

function PrimitiveCard({ group, reference }: { group: PrimitiveGroup; reference: string }) {
  const [open, setOpen] = useState(false);
  const label = SECTION_INDEX[group.key].label;
  return (
    <li className="border border-line bg-paper p-4 rounded-sm">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="inline-flex items-center rounded-xs bg-amore-bg px-1.5 py-0.5 text-xs uppercase tracking-wider text-ink">
          프리미티브
        </span>
        <span className="text-lg font-semibold text-ink">{label}</span>
        <span className="ml-auto text-sm text-mute-soft tabular-nums" title={group.newest}>
          {relativeDays(group.newest, reference)} · {isoDate(group.newest)}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs-soft">
        {group.items.map((e) => (
          <span key={e.file} className="inline-flex items-center gap-1.5">
            <PrNumber pr={e.prNumber} />
          </span>
        ))}
        <Button size="xs" variant="link" onClick={() => setOpen((v) => !v)}>
          {open ? '▾ 라이브 렌더 닫기' : '▸ 라이브 렌더 보기'}
        </Button>
      </div>
      {open ? (
        <div className="mt-3 rounded-sm border border-line-soft bg-paper-soft p-4">
          {SECTION_INDEX[group.key].render()}
        </div>
      ) : null}
    </li>
  );
}

export function RecentlyChanged() {
  const [days, setDays] = useState<number>(30);
  const [previewEnabled, setPreviewEnabled] = useState(true);
  const reference = DATA.generatedAt;

  const filtered = useMemo(() => {
    const cutoff = new Date(reference).getTime() - days * 86_400_000;
    return DATA.entries.filter((e) => new Date(e.mergedAt).getTime() >= cutoff);
  }, [days, reference]);

  const screens = useMemo<ScreenGroup[]>(() => {
    const map = new Map<string, ScreenGroup>();
    for (const e of filtered) {
      if (!e.previewPath) continue;
      const g = map.get(e.previewPath) ?? { path: e.previewPath, items: [], newest: e.mergedAt };
      g.items.push(e);
      if (e.mergedAt > g.newest) g.newest = e.mergedAt;
      map.set(e.previewPath, g);
    }
    return [...map.values()].sort((a, b) => b.newest.localeCompare(a.newest));
  }, [filtered]);

  const primitives = useMemo<PrimitiveGroup[]>(() => {
    const map = new Map<string, PrimitiveGroup>();
    for (const e of filtered) {
      if (!e.catalogKey || !isSectionId(e.catalogKey)) continue;
      const g = map.get(e.catalogKey) ?? { key: e.catalogKey, items: [], newest: e.mergedAt };
      g.items.push(e);
      if (e.mergedAt > g.newest) g.newest = e.mergedAt;
      map.set(e.catalogKey, g);
    }
    return [...map.values()].sort((a, b) => b.newest.localeCompare(a.newest));
  }, [filtered]);

  const links = useMemo(
    () =>
      filtered
        .filter((e) => !e.previewPath && !(e.catalogKey && isSectionId(e.catalogKey)))
        .sort((a, b) => b.mergedAt.localeCompare(a.mergedAt)),
    [filtered],
  );

  return (
    <PrimitivePage
      title="Recently Changed"
      hint="최근 배포에서 바뀐 UI 를 실제로 렌더해 회귀 확인/리뷰용으로 모은 갤러리. 바뀐 화면은 라이브 iframe 미리보기, 카탈로그 프리미티브는 라이브 렌더, 나머지는 GitHub 링크."
    >
      {/* 컨트롤 바 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
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
        <Button
          size="xs"
          variant={previewEnabled ? 'secondary' : 'ghost'}
          onClick={() => setPreviewEnabled((v) => !v)}
          aria-pressed={previewEnabled}
          className="ml-2"
        >
          {previewEnabled ? '미리보기 켜짐' : '미리보기 꺼짐'}
        </Button>
        <span className="ml-auto text-sm text-mute-soft tabular-nums">
          화면 {screens.length} · 프리미티브 {primitives.length} · 링크 {links.length}
        </span>
      </div>

      {/* 한계 명시 (spec §C) */}
      <div className="mb-5 rounded-xs border border-line-soft bg-paper-soft px-3 py-2 text-sm text-mute">
        <ul className="list-disc space-y-0.5 pl-4">
          <li>
            화면 미리보기는 <strong>실제 앱 라우트를 same-origin iframe 으로 라이브 렌더</strong>합니다
            (로그인 세션 필요 — super admin 으로 이 페이지를 보고 있으면 그대로 렌더). 동적 세그먼트
            ([id]/[token]) 라우트는 미리보기 불가.
          </li>
          <li>
            “최근 N일”은 <strong>gen 재실행(배포) 시점 기준</strong> 갱신(런타임 실시간 아님). 마지막
            생성: <span className="tabular-nums">{isoDate(reference)}</span>.
            <code className="ml-1 font-mono">pnpm gen:changed-ui</code>
          </li>
          <li>before/after 픽셀 비교는 범위 밖(스크린샷 스토리지 별건).</li>
        </ul>
      </div>

      {screens.length === 0 && primitives.length === 0 && links.length === 0 ? (
        <p className="text-md text-mute">해당 기간에 변경된 UI 가 없습니다.</p>
      ) : null}

      {/* 화면 갤러리 */}
      {screens.length > 0 ? (
        <section className="mb-8">
          <div className="eyebrow-mute mb-2">화면 · 라이브 미리보기</div>
          <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {screens.map((g) => (
              <ScreenCard
                key={g.path}
                group={g}
                reference={reference}
                previewEnabled={previewEnabled}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {/* 프리미티브 라이브 렌더 */}
      {primitives.length > 0 ? (
        <section className="mb-8">
          <div className="eyebrow-mute mb-2">프리미티브 · 라이브 렌더</div>
          <ul className="space-y-3">
            {primitives.map((g) => (
              <PrimitiveCard key={g.key} group={g} reference={reference} />
            ))}
          </ul>
        </section>
      ) : null}

      {/* 링크만 — standalone 컴포넌트/스타일 (라이브 렌더 불가) */}
      {links.length > 0 ? (
        <section>
          <div className="eyebrow-mute mb-2">기타 · 링크만 (standalone 렌더 불가)</div>
          <ul className="divide-y divide-line-soft border border-line-soft rounded-sm">
            {links.map((e) => (
              <li key={e.file} className="flex flex-wrap items-baseline gap-x-2 px-3 py-2">
                <a
                  href={`${GH_BLOB}${e.file}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-sm text-mute transition-colors hover:text-amore hover:underline"
                >
                  {e.name}
                </a>
                <span className="text-xs-soft text-mute-soft">{cleanTitle(e.oneLine)}</span>
                <span className="ml-auto flex items-center gap-2 text-xs-soft">
                  <PrNumber pr={e.prNumber} />
                  <span className="text-mute-soft tabular-nums">{isoDate(e.mergedAt)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </PrimitivePage>
  );
}
