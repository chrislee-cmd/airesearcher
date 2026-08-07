import { z } from 'zod';
import { CANVAS_ORDER, type CanvasWidgetKey } from '@/lib/canvas/visibility';

/* ────────────────────────────────────────────────────────────────────
   캔버스 발행 배치 — 레이아웃 SSOT (순수 모듈, client-safe).

   위젯 key 화이트리스트(CANVAS_ORDER) · zod 스키마 · 정규화 헬퍼만 담는다.
   여기엔 어떤 서버 전용 import(service-role client, next/headers 등)도 두지
   않는다 — 그래야 서버(canvas/page.tsx, 발행 API)와 클라이언트(canvas-board)가
   같은 화이트리스트/스키마를 공유하면서도 service-role 키가 client 번들로 새지
   않는다. DB 읽기/쓰기(service-role)는 이 모듈이 아니라 호출부에 있다.

   dashboard-layout.ts 의 /status 공유 레이아웃과 동형 패턴 — 단일 전역 발행.
   ──────────────────────────────────────────────────────────────────── */

// 발행 배치의 단일 전역 row key. 과설계 금지 — 단일 발행 하나. org 단위는 후속.
export const PUBLISHED_CANVAS_LAYOUT_KEY = 'global';

// 그리드 좌표의 방어적 상한. 실제 그리드는 위젯 개수에서 파생(최대 3×N)이지만,
// 임의 거대값 저장을 막는 방어선일 뿐 — board hydrate 가 실제 그리드 범위에
// 맞춰 재검증(범위 초과 좌표는 빈 셀 fallback)하므로 여기선 느슨한 상한만 둔다.
const MAX_COORD = 99;

const CANVAS_KEYS = CANVAS_ORDER as readonly string[];

// 한 위젯의 배치 좌표 { col, row }. canvas-board 의 Coords 와 동형.
export const CanvasCoordsSchema = z.object({
  col: z.number().int().min(0).max(MAX_COORD),
  row: z.number().int().min(0).max(MAX_COORD),
});

export type CanvasCoords = z.infer<typeof CanvasCoordsSchema>;

// positions = widgetKey → { col, row }. 알 수 없는 key 는 normalize 가 제거한다
// (zod record 의 key 는 임의 string 이라 여기서 열어두고 normalize 에서 걸러
// CanvasWidgetKey 만 남긴다 — 신규 위젯 추가 시 마이그 불요).
export const CanvasLayoutSchema = z.object({
  positions: z.record(z.string(), CanvasCoordsSchema),
});

export type CanvasLayout = z.infer<typeof CanvasLayoutSchema>;

export type PublishedCanvasLayout = {
  positions: Record<CanvasWidgetKey, CanvasCoords>;
  version: number;
};

// 저장/수신 positions 를 안전한 canonical 형태로 정규화한다:
//   - CANVAS_ORDER 화이트리스트 밖 key 제거(임의 key 저장 방어).
//   - col/row 를 정수로 반올림 + 0..MAX_COORD clamp.
// 클라이언트를 신뢰하지 않고 서버가 저장 직전 한 번 더 통과시킨다.
export function normalizeCanvasLayout(
  layout: CanvasLayout,
): Record<CanvasWidgetKey, CanvasCoords> {
  const out = {} as Record<CanvasWidgetKey, CanvasCoords>;
  for (const [key, coords] of Object.entries(layout.positions)) {
    if (!CANVAS_KEYS.includes(key)) continue;
    out[key as CanvasWidgetKey] = {
      col: Math.min(MAX_COORD, Math.max(0, Math.round(coords.col))),
      row: Math.min(MAX_COORD, Math.max(0, Math.round(coords.row))),
    };
  }
  return out;
}

// 임의 jsonb(예: DB row.positions, 최초 '{}' 포함) + version 을 안전하게 파싱한다.
// 무효/빈 값이면 null 반환 — 절대 throw 하지 않는다(캔버스 렌더가 파싱 에러로
// 죽으면 안 됨). positions 가 비면(발행 이력 없음) null 로 폴백 → board 는 종전
// defaultPositions 동작(회귀 0).
export function parsePublishedLayout(
  rawPositions: unknown,
  rawVersion: unknown,
): PublishedCanvasLayout | null {
  const parsed = CanvasLayoutSchema.safeParse({ positions: rawPositions });
  if (!parsed.success) return null;
  const positions = normalizeCanvasLayout(parsed.data);
  if (Object.keys(positions).length === 0) return null;
  const version =
    typeof rawVersion === 'number' && Number.isFinite(rawVersion)
      ? Math.max(0, Math.round(rawVersion))
      : 0;
  return { positions, version };
}
