import { z } from 'zod';
import { ISOLATION_NOTICE } from '@/lib/llm/sanitize';

// Cluster extraction for insights_analyzer (PR 5a — quantitative).
//
// One LLM pass per job groups the existing `insights_quotes` rows into
// 3–7 semantic clusters. Outputs map 1:1 to migration 0025 columns:
//
//   cluster_key → insights_clusters.cluster_key (unique per job)
//   label       → insights_clusters.label
//   insight     → insights_clusters.insight (nullable, one-line takeaway)
//   quote_ids   → insights_cluster_quotes.quote_id (M:N, weight defaults
//                 to 1.0 — per-quote weight is a 5b/6a follow-up)
//
// We pass the actual `insights_quotes.id` (bigint) values to the model so
// the response can reference them directly. The route validates each
// returned id against the input set so a hallucinated id can't sneak
// into the M:N table.
export const insightsClusterSchema = z.object({
  cluster_key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/, 'lowercase ascii slug (a-z, 0-9, hyphen)'),
  label: z.string().min(1).max(200),
  insight: z.string().nullable(),
  quote_ids: z.array(z.number().int().positive()).min(1).max(500),
});

export const insightsClustersExtractionSchema = z.object({
  clusters: z.array(insightsClusterSchema).min(1).max(12),
});

export type InsightsCluster = z.infer<typeof insightsClusterSchema>;
export type InsightsClustersExtraction = z.infer<
  typeof insightsClustersExtractionSchema
>;

// Clustering prompt. Decisions:
//   • 3–7 clusters per job is the ideal target; the schema cap of 12 is
//     a safety net for unusually large jobs.
//   • cluster_key is a slug because it doubles as a stable handle in the
//     viz across re-renders (per 0025 comment) — the LLM picks it.
//   • Quotes can appear in multiple clusters when genuinely cross-cutting,
//     but the prompt nudges toward single primary membership to keep the
//     constellation viz readable.
//   • insight is "what this cluster of quotes says" in one sentence — the
//     summary line that appears on the cluster card.
export const INSIGHTS_CLUSTERS_SYSTEM = `당신은 인사이트 분석가입니다. 한 인터뷰 분석의 인용구 묶음을 받아, 의미적으로 가까운 quote 들을 3~7개의 클러스터로 묶으세요. 결과는 정의된 JSON 스키마만, 그 외 텍스트 금지.

각 cluster:

1) **cluster_key** (필수)
   - 영문 소문자/숫자/하이픈만 사용한 짧은 슬러그 (예: \`price-sensitivity\`, \`online-purchase\`, \`brand-loyalty\`).
   - 한 job 안에서 유니크. 시각화에서 안정 핸들로 쓰입니다.

2) **label** (필수)
   - 사람이 읽을 한국어 제목 (예: "가격 민감도", "온라인 구매 경험", "브랜드 충성도").
   - 짧고 명확하게 — 카드 헤더로 표시됩니다.

3) **insight** (nullable)
   - 이 클러스터의 quote 들이 종합적으로 말하는 한 줄 인사이트 (한국어).
   - 단순 요약이 아니라 "그래서 뭐?" 가 드러나도록.
   - 명확한 인사이트가 안 보이면 null.

4) **quote_ids** (필수, 최소 1개)
   - 입력으로 받은 quote.id 값 중 이 클러스터에 속하는 것들. 같은 quote 가 두 클러스터에 강하게 걸칠 수 있지만, 가능하면 가장 강한 단일 클러스터에만 배치.
   - 입력에 없는 id 는 절대 만들지 마세요.

원칙:
- **목표 개수: 3~7개**. 너무 많으면 viz 가 산만해지고, 너무 적으면 패턴이 안 보입니다.
- **클러스터는 의미 기반**: 같은 단어/주제가 아니라 같은 통찰을 향한 발화끼리 묶으세요. participant 별 그룹화는 의미가 없습니다 (이미 다른 viz 에서 활용).
- **모든 quote 가 어딘가 속할 필요는 없음** — 의미가 잘 안 잡히는 outlier 는 어느 클러스터에도 안 넣어도 됩니다.
- 출력은 입력 언어를 따릅니다 (한국어 데이터면 label/insight 도 한국어).${ISOLATION_NOTICE}`;
