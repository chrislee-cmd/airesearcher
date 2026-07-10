// probing 질문 emit 가드 — 중복 + cadence + 웜업 판정.
//
// prod 실측(2026-07-10): 세션 초반 67초에 질문 21건 폭주(동일 오프닝 8변형).
// 질문 "내용" 은 양호하고 "언제/몇 개" 만 문제라, emit(팝업/저장) 직전에 이
// 가드를 통과한 질문만 표출·저장한다.
//
// 왜 module-scope 클래스인가: probing-card 는 React Compiler(react-hooks/
// immutability) 아래라 컴포넌트 안에서 ref 필드를 여러 hook 에서 직접
// mutation 하면 막힌다(ref 를 "소유한" hook 이 아닌 곳의 mutation 거부). Map 의
// `.set/.clear` 처럼 **ref 가 든 객체의 메서드 호출** 은 예외라, 상태를 이
// 클래스에 넣고 메서드로만 갱신하면 어느 hook 에서 호출해도 통과한다. 겸사
// cadence/dedup 로직이 순수 함수처럼 단위 테스트 가능해진다.

import { isDuplicateQuestion } from './question-similarity';

// 중복 비교 + 프롬프트 "반복 금지" 이력에 실을 "이미 낸 질문" 보관 개수.
export const RECENT_EMITTED_MAX = 12;
// emit 최소 간격(ms) — 보수적. 같은 think 스트림이 EMIT 여러 줄을 쏟아도 이
// 간격 안의 후속분은 drop(큐 누적 X). 67초 21건 → 이 간격이면 최대 ~3건.
export const EMIT_MIN_GAP_MS = 20_000;
// 분당 emit 상한 — 최소 간격과 함께 상한 캡.
export const EMIT_MAX_PER_MIN = 3;
// 웜업 — 실질 대화가 누적되기 전(오프닝 독백 구간)엔 오프닝 질문을 이 개수까지만.
// 발화 전 전 위젯 0% fill 이라 매 think 가 같은 오프닝 질문을 재생산하던 폭주를
// 차단. cumulativeChars 가 이 값에 도달하면 웜업 해제(이후는 cadence 가 관리).
export const WARMUP_MIN_CHARS = 400;
export const WARMUP_MAX_OPENING_EMITS = 1;

export type EmitAdmitOpts = {
  // 사용자 명시 주입 질문 — 모든 게이트 우회(스펙 §D 예외). 단 이력엔 기록해
  // 이후 auto 가 같은 질문을 재emit 하지 않게 한다.
  isInjection: boolean;
  // 현재 누적 transcript 문자 수 — 웜업 판정.
  cumulativeChars: number;
  // 호출 시각(ms). 테스트 결정성 위해 주입받는다(Date.now 직접 호출 X).
  now: number;
};

export class ProbingEmitGuard {
  // 이번 세션에서 실제 emit 한 질문 원문(중복 비교 소스 + 프롬프트 이력).
  private recent: string[] = [];
  // 통과한 auto emit 시각(ms) — 최소 간격 / 분당 상한 계산.
  private timestamps: number[] = [];
  // 웜업 구간에서 통과한 오프닝 emit 수.
  private openingCount = 0;
  // 마지막 think 호출 시각 — under-supply 방어(주기 유도) 판정용. 읽기 전용 공개.
  lastThinkAt = 0;

  // 새 세션 시작 시 전 상태 초기화.
  reset(): void {
    this.recent = [];
    this.timestamps = [];
    this.openingCount = 0;
    this.lastThinkAt = 0;
  }

  // think 호출 시각 기록(heartbeat 유도 간격 계산용).
  markThink(now: number): void {
    this.lastThinkAt = now;
  }

  // 프롬프트 "반복 금지" 이력 스냅샷(라이브 배열 유출 방지 위해 복사).
  recentQuestions(): string[] {
    return [...this.recent];
  }

  // emit 판정 + 통과 시 기록. 반환 true = 표출/저장 진행, false = drop.
  //   (A) 중복 — 이미 낸 질문과 유사하면 drop.
  //   (B) 웜업 — 발화 전 오프닝 1건 초과 drop.
  //   (C) 리듬 — 최소 간격 / 분당 상한 초과 drop(폭주분 큐 누적 X).
  // 주입은 (A)~(C) 우회하되 이력엔 기록.
  admit(text: string, opts: EmitAdmitOpts): boolean {
    const { isInjection, cumulativeChars, now } = opts;
    if (!isInjection) {
      if (isDuplicateQuestion(text, this.recent)) return false;
      const inWarmup = cumulativeChars < WARMUP_MIN_CHARS;
      if (inWarmup && this.openingCount >= WARMUP_MAX_OPENING_EMITS) return false;
      const recentTimes = this.timestamps.filter((t) => now - t < 60_000);
      const lastAt = recentTimes.length ? recentTimes[recentTimes.length - 1] : 0;
      if (lastAt && now - lastAt < EMIT_MIN_GAP_MS) return false;
      if (recentTimes.length >= EMIT_MAX_PER_MIN) return false;
      this.timestamps = [...recentTimes, now];
      if (inWarmup) this.openingCount += 1;
    }
    this.recent = [...this.recent, text].slice(-RECENT_EMITTED_MAX);
    return true;
  }
}
