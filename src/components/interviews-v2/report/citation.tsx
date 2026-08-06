'use client';

/* ────────────────────────────────────────────────────────────────────
   Citation — 근거 칩 + 원문 팝오버 (BUILD-SPEC §0.3·§1.4·S5d · DECISIONS #1).

   fresh 신규 빌드 (읽기 모드). 문장 끝 위첨자 칩(mono 9.5/800 · rose-bg ·
   border rose · rounded-xs · text-amore-deep · translateY(-3px))을 렌더하고,
   hover/클릭 시 원문 팝오버(청크 발췌 + 파일명 + 지점 + "원문에서 열기")를
   띄운다. citations 배열이 비면 아무것도 렌더하지 않는다(회색 칩·빈 칩 금지).

   근거 본문은 `POST /api/interviews/v2/chunks/resolve`(D PR)가 제공한다.
   D 미머지/resolve 실패 시 **폴백 = 칩만 렌더**(팝오버 미동작, 에러 UI 없음 —
   소프트 의존, DECISIONS #1 점진 배선). 배치 상한 20 이라 provider 가 요청
   청크를 모아 20개씩 나눠 한 번만 조회하고 캐시한다.

   칩 라벨 = 보고서 전역 순번(첫 등장 순서 1-based). chunk_id 문자열은 resolve
   호출에만 쓰고 화면엔 순번만 노출한다(컴프가 작은 숫자 "12"·"33" 으로 그린
   방식과 정합 — 데이터 계약은 chunk_id string[] 만 주므로 순번은 렌더러 파생).
   ──────────────────────────────────────────────────────────────────── */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';

// resolve API 응답 원소 (route.ts 계약). position 은 timestamp("18분 32초 지점")
// 또는 offset 문구 — 서버가 사람이 읽을 형태로 반환. 없으면 미표시.
export type ResolvedChunk = {
  chunk_id: string;
  excerpt: string;
  file_name: string;
  position: string | null;
};

type CacheEntry = ResolvedChunk | 'pending' | 'unavailable';

type CitationApi = {
  // 첫 등장 순번(1-based). 라벨 · 팝오버 헤더("chunk N")에 쓴다.
  numberOf: (chunkId: string) => number;
  // 조회 결과 — 해결됨(payload) / 조회 중 / 조회 불가(폴백=칩만).
  get: (chunkId: string) => CacheEntry;
  // 팝오버 열릴 때 실제 조회를 트리거(lazy — 스크롤 밖 칩은 조회 안 함).
  request: (chunkId: string) => void;
};

const CitationCtx = createContext<CitationApi | null>(null);

// 근거 조회 provider — 읽기 뷰 하나당 하나. projectId 스코프로 resolve 를
// 호출한다. projectId 가 없으면(리스트 등) 항상 unavailable → 칩만 렌더.
export function CitationResolveProvider({
  projectId,
  children,
}: {
  projectId: string | null;
  children: ReactNode;
}) {
  const [cache, setCache] = useState<Map<string, CacheEntry>>(new Map());
  // 순번 대장 — 첫 등장 순서로 chunk_id → n. 렌더 중 안정적으로 유지.
  const numberMap = useRef<Map<string, number>>(new Map());
  // 이번 tick 에 모을 미조회 id (배치). flush 시 20개씩 나눠 fetch.
  const pending = useRef<Set<string>>(new Set());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // projectId 가 바뀌면 캐시·순번 초기화(다른 보고서).
  useEffect(() => {
    numberMap.current = new Map();
    pending.current = new Set();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 프로젝트 전환 시 다른 보고서라 캐시를 비운다(외부 소스 = projectId prop 동기화)
    setCache(new Map());
  }, [projectId]);

  const flush = useMemo(
    () => async () => {
      const ids = Array.from(pending.current);
      pending.current = new Set();
      if (!projectId || ids.length === 0) return;
      // 낙관적 pending 표시.
      setCache((prev) => {
        const next = new Map(prev);
        for (const id of ids) if (!next.has(id)) next.set(id, 'pending');
        return next;
      });
      // 배치 상한 20 — 나눠 조회.
      for (let i = 0; i < ids.length; i += 20) {
        const batch = ids.slice(i, i + 20);
        try {
          const res = await fetch('/api/interviews/v2/chunks/resolve', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ project_id: projectId, chunk_ids: batch }),
          });
          const json = (await res.json().catch(() => null)) as
            | { chunks?: ResolvedChunk[] }
            | null;
          if (!alive.current) return;
          const found = new Map(
            (json?.chunks ?? []).map((c) => [c.chunk_id, c] as const),
          );
          setCache((prev) => {
            const next = new Map(prev);
            for (const id of batch) {
              // 응답에 없는 id(미머지 이전·타 프로젝트) = 조회 불가 → 칩만.
              next.set(id, found.get(id) ?? 'unavailable');
            }
            return next;
          });
        } catch {
          // resolve 실패(D 미머지·네트워크) — 폴백=칩만, 에러 UI 없음.
          if (!alive.current) return;
          setCache((prev) => {
            const next = new Map(prev);
            for (const id of batch) next.set(id, 'unavailable');
            return next;
          });
        }
      }
    },
    [projectId],
  );

  const api = useMemo<CitationApi>(
    () => ({
      numberOf: (chunkId) => {
        const existing = numberMap.current.get(chunkId);
        if (existing) return existing;
        const n = numberMap.current.size + 1;
        numberMap.current.set(chunkId, n);
        return n;
      },
      get: (chunkId) => cache.get(chunkId) ?? 'pending',
      request: (chunkId) => {
        if (!projectId) return;
        if (cache.has(chunkId)) return;
        pending.current.add(chunkId);
        if (flushTimer.current) clearTimeout(flushTimer.current);
        flushTimer.current = setTimeout(() => void flush(), 60);
      },
    }),
    [cache, flush, projectId],
  );

  return <CitationCtx.Provider value={api}>{children}</CitationCtx.Provider>;
}

// 근거 칩 한 벌 — 블록의 citations[] 를 문장 끝 위첨자 칩으로 렌더한다. 비면
// null(아무것도 안 그림). provider 밖(공유 뷰어 등)에서는 순번만 로컬 계산하고
// 팝오버는 비활성(칩만).
export function CitationChips({ citations }: { citations?: string[] }) {
  const ctx = useContext(CitationCtx);
  if (!citations || citations.length === 0) return null;
  // provider 없을 때 로컬 순번(이 호출 내 결정적) — ref 아닌 렌더-로컬 Map.
  const localSeen = new Map<string, number>();
  const localNumber = (id: string): number => {
    const existing = localSeen.get(id);
    if (existing) return existing;
    const n = localSeen.size + 1;
    localSeen.set(id, n);
    return n;
  };
  return (
    <>
      {citations.map((id, i) => (
        <CitationChip
          key={`${id}:${i}`}
          chunkId={id}
          n={ctx ? ctx.numberOf(id) : localNumber(id)}
          first={i === 0}
        />
      ))}
    </>
  );
}

function CitationChip({
  chunkId,
  n,
  first,
}: {
  chunkId: string;
  n: number;
  // 연속 칩은 margin-left 2, 첫 칩은 3 (§1.4 / GEOMETRY §C5).
  first: boolean;
}) {
  const t = useTranslations('InterviewsV2');
  const ctx = useContext(CitationCtx);
  const [open, setOpen] = useState(false);
  const data = ctx?.get(chunkId) ?? 'unavailable';

  // 위첨자 칩 — mono 9.5/800 · rose-bg · border 1px rose · rounded-xs ·
  // text-amore-deep · translateY(-3px). 팝오버 가능 여부와 무관하게 항상 렌더.
  return (
    <span className="relative inline-block">
      {/* eslint-disable-next-line react/forbid-elements -- CD §1.4 근거 칩은 위첨자 인라인 chrome(translateY·mono 9.5)으로 Button primitive 형태와 불일치. 팝오버 트리거는 hover/focus, 폴백 시 정적. */}
      <button
        type="button"
        onMouseEnter={() => {
          ctx?.request(chunkId);
          setOpen(true);
        }}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => {
          ctx?.request(chunkId);
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        aria-label={t('citationChunk', { n })}
        className={`inline-block translate-y-[-3px] rounded-xs border border-rose bg-rose-bg px-1 font-mono-label text-xs font-extrabold leading-none text-amore-deep ${
          first ? 'ml-[3px]' : 'ml-[2px]'
        }`}
      >
        {n}
      </button>
      {open && data !== 'unavailable' && data !== 'pending' && (
        <CitationPopover n={n} chunk={data} />
      )}
    </span>
  );
}

// 원문 팝오버 (§1.4 · S5d) — border 2 ink · rounded-panel · paper ·
// shadow-popover · max-w 420 · 헤더 rose-bg. 칩 위에 절대 배치(레이아웃 무영향).
function CitationPopover({ n, chunk }: { n: number; chunk: ResolvedChunk }) {
  const t = useTranslations('InterviewsV2');
  return (
    <span
      role="tooltip"
      className="absolute bottom-full left-1/2 z-overlay mb-1.5 block w-[420px] max-w-[420px] -translate-x-1/2 overflow-hidden rounded-panel border-2 border-ink bg-paper text-left shadow-popover"
    >
      <span className="flex items-center gap-2 border-b-[1.5px] border-line bg-rose-bg px-[13px] py-2">
        <span className="font-mono-label text-xs font-extrabold text-amore-deep">
          {t('citationChunk', { n })}
        </span>
        <span className="ml-auto truncate font-mono-label text-xs text-mute-soft">
          {chunk.file_name}
        </span>
      </span>
      <span className="block px-[13px] py-[13px] text-md leading-[1.75] text-ink-2">
        {chunk.excerpt}
      </span>
      {chunk.position && (
        <span className="flex items-center gap-2 border-t border-line bg-paper-soft px-[13px] py-[9px]">
          <span className="font-mono-label text-xs text-mute-soft">
            {chunk.position}
          </span>
        </span>
      )}
    </span>
  );
}
