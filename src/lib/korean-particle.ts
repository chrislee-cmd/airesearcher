/* ────────────────────────────────────────────────────────────────────
   한국어 조사 선택 — 앞 단어의 받침에 따라 은/는 · 이/가 · 을/를 을 고른다.

   왜 필요한가: 위젯 이름처럼 **런타임에 정해지는 단어** 뒤의 조사는 i18n 문자열에
   박아 넣을 수 없다. "AI UT**는**" / "가이드라인**은**" 이 둘 다 자연스러우려면
   받침 유무를 봐야 한다. 그래서 ko 메시지에 `{josa}` 자리를 두고 호출부가 이
   함수로 값을 채운다(en/ja/th 문자열에는 `{josa}` 가 없으므로 영향 0).

   판정: 마지막 **한글 음절**의 종성(받침) 유무. 한글이 아닌 끝(영문·숫자·기호)은
   보수적으로 **받침 없음**으로 본다 — "AI UT는", "Q1는" 처럼 읽히는 쪽이
   "AI UT은" 보다 자연스럽다. (영문 끝의 엄밀한 처리는 발음 기반이라 과하다.)

   레포 최초의 조사 유틸이다(기존 `translate-stream-join.ts` 는 조사를 *판별*만
   하고 선택하지 않는다). 다른 런타임 단어 + 조사 조합이 생기면 여기에 더한다.
   ──────────────────────────────────────────────────────────────────── */

const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;

/** 마지막 글자에 받침이 있는가. 한글 음절이 아니면 false. */
export function hasFinalConsonant(word: string): boolean {
  const ch = word.trim().slice(-1);
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  if (code < HANGUL_START || code > HANGUL_END) return false;
  // 한글 음절 = ((초성 × 21) + 중성) × 28 + 종성. 종성 0 = 받침 없음.
  return (code - HANGUL_START) % 28 !== 0;
}

export type JosaPair = '은는' | '이가' | '을를' | '와과';

const PAIRS: Record<JosaPair, [withFinal: string, withoutFinal: string]> = {
  은는: ['은', '는'],
  이가: ['이', '가'],
  을를: ['을', '를'],
  와과: ['과', '와'],
};

/** 단어 뒤에 붙일 조사. 한글이 아닌 끝은 받침 없음으로 본다. */
export function josa(word: string, pair: JosaPair = '은는'): string {
  const [withFinal, withoutFinal] = PAIRS[pair];
  return hasFinalConsonant(word) ? withFinal : withoutFinal;
}
