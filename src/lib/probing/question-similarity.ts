// probing 질문 중복 가드 — 정규화 + 유사도.
//
// 세션 초반 폭주(prod 실측: 67초 21건, 동일 오프닝 8변형)의 하드가드용.
// emit(팝업/저장) 직전에 이미 낸 질문들과 비교해 유사하면 drop 한다.
//
// 설계 원칙: **임베딩 과설계 금지.** 어절 토큰 집합 유사도로 충분하다. 한국어는
// 조사/어미가 붙어 같은 단어도 표면형이 달라지므로(역할을/역할이/역할과), 흔한
// 조사 꼬리만 간단 절단한 뒤 토큰 집합을 비교한다(형태소 분석 X). 실측 8 오프닝
// 변형은 "역할·노션·업무" 같은 내용어가 크게 겹쳐 containment(작은 쪽 기준 겹침)
// 이 높고, 같은 주제라도 다른 질문은 겹침이 낮아 깔끔히 분리된다.
//
// 문자 n-gram Jaccard 도 검토했으나 표현을 바꾼 패러프레이즈에서 값이 너무
// 낮았다(0.18~0.35) — 어절 토큰 쪽이 이 도메인에 robust(PROJECT.md §7.13 의
// "짧은 한국어는 표면형에 휘둘린다" 교훈의 연장선).

// 공백 + 흔한 문장부호를 공백으로 치환(어절 분리 유지).
const PUNCT_TO_SPACE = /[?!.,~…"'“”‘’()[\]{}·・\-–—:;/\\]+/g;

// 어절 끝의 흔한 한국어 조사/어미 꼬리(간단 절단 — 형태소 분석 아님). 2자 초과
// 어절에만 적용해 짧은 어절이 과도하게 깎이는 것을 막는다.
const JOSA_TAIL =
  /(으로|로서|에게|에서|께서|이라고|라고|처럼|보다|까지|부터|마다|조차|밖에|은|는|이|가|을|를|의|에|와|과|도|만|로|나|랑|고|요|죠)$/;

// 퍼지 비교에 필요한 최소 토큰 수 — 이보다 짧으면 정규화 완전 일치만 중복으로.
const MIN_FUZZY_TOKENS = 3;
// 어절 Jaccard(겹침/합집합) 임계값 — 강한 재작성도 잡되 다른 질문은 통과.
const TOKEN_JACCARD_THRESHOLD = 0.5;
// containment(겹침/작은 쪽) 임계값 — 길이가 달라도 내용어가 대부분 겹치면 중복.
const TOKEN_CONTAINMENT_THRESHOLD = 0.55;

// 정규화 — 소문자 + 문장부호/공백 제거(완전 일치 비교용).
export function normalizeQuestion(text: string): string {
  return text.toLowerCase().replace(PUNCT_TO_SPACE, '').replace(/\s+/g, '');
}

// 어절 토큰 집합 — 소문자 + 문장부호 분리 + 조사 꼬리 절단.
function tokenSet(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(PUNCT_TO_SPACE, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 2 ? w.replace(JOSA_TAIL, '') : w))
    .filter((w) => w.length >= 1);
  return new Set(words);
}

function overlapCount(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n += 1;
  return n;
}

// 0(무관) ~ 1(동일). 어절 토큰 Jaccard. 짧아서 토큰이 없으면 0.
export function questionSimilarity(a: string, b: string): number {
  if (normalizeQuestion(a) === normalizeQuestion(b)) return 1;
  const ta = tokenSet(a);
  const tb = tokenSet(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  const inter = overlapCount(ta, tb);
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

// candidate 가 priors 중 하나와 같은 취지(패러프레이즈 포함)인가.
// 완전 일치 / Jaccard / containment 중 하나라도 임계 넘으면 중복.
export function isDuplicateQuestion(
  candidate: string,
  priors: readonly string[],
): boolean {
  const cNorm = normalizeQuestion(candidate);
  if (!cNorm) return false;
  const cTokens = tokenSet(candidate);
  return priors.some((p) => {
    if (normalizeQuestion(p) === cNorm) return true;
    const pTokens = tokenSet(p);
    // 너무 짧으면 퍼지 비교는 오탐 위험 — 완전 일치(위)만 인정.
    if (cTokens.size < MIN_FUZZY_TOKENS || pTokens.size < MIN_FUZZY_TOKENS) {
      return false;
    }
    const inter = overlapCount(cTokens, pTokens);
    const union = cTokens.size + pTokens.size - inter;
    const jaccard = union === 0 ? 0 : inter / union;
    const containment = inter / Math.min(cTokens.size, pTokens.size);
    return (
      jaccard >= TOKEN_JACCARD_THRESHOLD ||
      containment >= TOKEN_CONTAINMENT_THRESHOLD
    );
  });
}
