/* ────────────────────────────────────────────────────────────────────
   체인 커넥터 기하 — 순수 계산 (React 없음).

   CD SSOT: `design-handoff/widget-chain/v2/README.md` §Geometry +
   `widget-chain-v2.dc.html` 의 path 빌더.

   R1(엣지는 거터로만): 엣지는 카드 상단에서 LANE_OFFSET(50) 위의 가로 레인을
   따라간다. 카드를 가로지르지 않으므로 체인 카드 사이에 비체인 카드가 끼어도
   성립한다 — v1 에서 커넥터를 기각했던 "비인접" 문제를 이 규칙이 푼다.

   **다중 행이 기본 케이스다** (WRITER-ANSWERS-V2 §1). 캔버스는 3열 그리드라
   파일럿 4위젯 체인이 두 행에 걸친다. 같은 행 전제 코드는 금지 — 출발 레인 →
   **카드 사이 세로 거터** → 도착 레인으로 잇고, 거터 x 는 가로막는 카드들의
   빈틈에서 고른다(아래 pickCorridorX).
   ──────────────────────────────────────────────────────────────────── */

/** 카드 상단에서 레인까지의 거리(CD §Geometry: lane y = 카드 top − 50). */
export const LANE_OFFSET = 50;
/** 모서리 곡선 반경(CD r=14). */
export const CORNER_R = 14;
/** 포트 중심 = 카드 상단. 엣지는 포트 테두리에서 시작/끝난다. */
export const PORT_R = 8;
/** 출/입 포트의 카드 가장자리로부터의 안쪽 거리(CD 56). */
export const PORT_INSET = 56;
/** 화살촉: 밑변 12 · 높이 8 · 꼭짓점 top−9. */
export const ARROW_HALF = 6;
/** 끊긴 엣지가 비우는 가운데 폭(±17). */
export const BREAK_HALF = 17;
/** 체인 활성 중 체인 행 위에 확보하는 거터(캡슐 높이 + 레인). */
export const CHAIN_GUTTER = 186;
/** 세로 거터를 고를 때 카드에서 띄우는 최소 여유. */
const CORRIDOR_PAD = 12;

export type Box = { left: number; top: number; width: number; height: number };
export type Point = { x: number; y: number };

export const outPortX = (b: Box) => b.left + b.width - PORT_INSET;
export const inPortX = (b: Box) => b.left + PORT_INSET;
export const laneY = (b: Box) => b.top - LANE_OFFSET;

/**
 * 직교 폴리라인을 모서리 r 로 둥글린 path. CD 의 `full()` 과 같은 결과를 내되
 * 좌→우·우→좌·다중 꺾임을 모두 다룬다(CD 빌더는 좌→우 1회 꺾임 전용이었다).
 */
export function roundedPolyline(pts: Point[], r = CORNER_R): string {
  if (pts.length < 2) return '';
  const parts = [`M${round(pts[0].x)} ${round(pts[0].y)}`];
  for (let i = 1; i < pts.length - 1; i += 1) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const next = pts[i + 1];
    // 꺾임 양쪽 변 길이의 절반을 넘지 않게 반경을 줄인다(짧은 구간 방어).
    const rr = Math.max(
      0,
      Math.min(r, dist(prev, cur) / 2, dist(cur, next) / 2),
    );
    const a = along(cur, prev, rr);
    const b = along(cur, next, rr);
    parts.push(`L${round(a.x)} ${round(a.y)}`);
    if (rr > 0) {
      parts.push(`Q${round(cur.x)} ${round(cur.y)} ${round(b.x)} ${round(b.y)}`);
    }
  }
  const last = pts[pts.length - 1];
  parts.push(`L${round(last.x)} ${round(last.y)}`);
  return parts.join(' ');
}

function dist(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
function along(from: Point, toward: Point, d: number): Point {
  const len = dist(from, toward) || 1;
  return {
    x: from.x + ((toward.x - from.x) / len) * d,
    y: from.y + ((toward.y - from.y) / len) * d,
  };
}
function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export type EdgeRoute = {
  /** 전체 경로(끊기지 않은 엣지). */
  path: string;
  /** 끊긴 엣지(멈춤/실패)의 앞/뒤 반쪽. */
  brokenStart: string;
  brokenEnd: string;
  /** 화살촉 points (도착 포트 바로 위). */
  arrow: string;
  /** 캡슐·라벨·마크가 앉는 지점(도착 쪽 가로 구간 중앙). */
  anchor: Point;
};

/**
 * 출발 카드 → 도착 카드(또는 산출물 노드) 경로.
 * 같은 행이면 레인 하나, 다른 행이면 출발 레인 → 세로 거터 → 도착 레인.
 */
export function routeEdge(
  from: Box,
  to: Box,
  /** 세로 거터 후보를 가로막는 카드들(보통 캔버스의 모든 카드). */
  blockers: Box[],
): EdgeRoute {
  const x1 = outPortX(from);
  const x2 = inPortX(to);
  const lane1 = laneY(from);
  const lane2 = laneY(to);
  const startY = from.top - PORT_R;
  // 화살촉 밑변까지만 선을 긋는다(촉이 선을 덮지 않게).
  const endY = to.top - PORT_R - 7;

  let pts: Point[];
  // 앵커(캡슐·라벨·마크가 앉는 가로 구간)의 pts 내 시작 인덱스.
  let cutIndex: number;

  if (Math.abs(lane1 - lane2) < 1) {
    pts = [
      { x: x1, y: startY },
      { x: x1, y: lane1 },
      { x: x2, y: lane1 },
      { x: x2, y: endY },
    ];
    cutIndex = 1;
  } else {
    const corridorX = pickCorridorX(blockers, lane1, lane2, x2, [x1, x2]);
    pts = [
      { x: x1, y: startY },
      { x: x1, y: lane1 },
      { x: corridorX, y: lane1 },
      { x: corridorX, y: lane2 },
      { x: x2, y: lane2 },
      { x: x2, y: endY },
    ];
    // 앵커(캡슐/마크)는 **도착 레인**의 가로 구간에 둔다 — "들어가는 엣지" 의미와
    // 맞고 도착 카드에 가깝다.
    cutIndex = 3;
  }

  const anchorA = pts[cutIndex];
  const anchorB = pts[cutIndex + 1];
  const anchor = { x: (anchorA.x + anchorB.x) / 2, y: anchorA.y };
  const dir = Math.sign(anchorB.x - anchorA.x) || 1;
  const breakA = { x: anchor.x - BREAK_HALF * dir, y: anchor.y };
  const breakB = { x: anchor.x + BREAK_HALF * dir, y: anchor.y };

  // 끊긴 엣지 = 앵커 구간을 가운데서 비운다. 앞쪽 반은 시작부터 breakA 까지,
  // 뒤쪽 반은 breakB 부터 도착까지.
  const headPts = [...pts.slice(0, cutIndex + 1), breakA];
  const tailPts = [breakB, ...pts.slice(cutIndex + 1)];

  return {
    path: roundedPolyline(pts),
    brokenStart: roundedPolyline(headPts),
    brokenEnd: roundedPolyline(tailPts),
    arrow: arrowPoints(x2, to.top),
    anchor,
  };
}

/**
 * 세로 거터 x — 두 레인 사이 띠를 가로막는 카드들의 **빈틈** 중 목표 x 에 가장
 * 가까운 곳. 빈틈이 없으면(이론상) 목표 x 를 그대로 쓴다.
 */
export function pickCorridorX(
  blockers: Box[],
  laneA: number,
  laneB: number,
  preferX: number,
  fallbackRange: [number, number],
): number {
  const top = Math.min(laneA, laneB);
  const bottom = Math.max(laneA, laneB);
  // 띠와 세로로 겹치는 카드만 장애물이다.
  const spans = blockers
    .filter((b) => b.top < bottom && b.top + b.height > top)
    .map((b) => [b.left - CORRIDOR_PAD, b.left + b.width + CORRIDOR_PAD])
    .sort((a, b) => a[0] - b[0]);

  if (spans.length === 0) return preferX;

  // 장애물 사이 빈틈 + 양 끝 바깥.
  const candidates: number[] = [spans[0][0] - CORRIDOR_PAD];
  for (let i = 0; i < spans.length - 1; i += 1) {
    const gapStart = spans[i][1];
    const gapEnd = spans[i + 1][0];
    if (gapEnd - gapStart > 2) candidates.push((gapStart + gapEnd) / 2);
  }
  candidates.push(spans[spans.length - 1][1] + CORRIDOR_PAD);

  const usable = candidates.filter((x) => Number.isFinite(x));
  if (usable.length === 0) {
    return (fallbackRange[0] + fallbackRange[1]) / 2;
  }
  return usable.reduce((best, x) =>
    Math.abs(x - preferX) < Math.abs(best - preferX) ? x : best,
  );
}

/** 화살촉 삼각형 points (CD: 밑변 12 · 높이 8 · 꼭짓점 top−9). */
export function arrowPoints(x: number, cardTop: number): string {
  const base = cardTop - PORT_R - 9;
  const tip = cardTop - PORT_R - 1;
  return `${x - ARROW_HALF},${base} ${x + ARROW_HALF},${base} ${x},${tip}`;
}

/** 여러 Box 를 감싸는 bounding box (요약 pill 클릭 → 체인으로 이동). */
export function unionBox(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null;
  const left = Math.min(...boxes.map((b) => b.left));
  const top = Math.min(...boxes.map((b) => b.top));
  const right = Math.max(...boxes.map((b) => b.left + b.width));
  const bottom = Math.max(...boxes.map((b) => b.top + b.height));
  return { left, top, width: right - left, height: bottom - top };
}
