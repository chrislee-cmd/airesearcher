// ─────────────────────────────────────────────────────────────────────────
// 체인 단계 설정 — 선언형 메타(ui-meta) + 검증 계약(step-config) 테스트
//
// 고정하는 불변식 3개:
//
//   1. **화이트리스트** — 그 단계 inspectorSchema 의 필드 id 가 아니면 거절.
//      느슨해지면 미지의 키가 jsonb 에 쌓여 "유효한 설정인지 알 수 없는"
//      상태가 된다(= 스펙 §3 이 막으려는 것). 반대로 과하게 좁아지면
//      인스펙터가 그리는 필드를 서버가 거절해 자동 저장이 통째로 깨진다.
//
//   2. **위치 의존 필수 집합** — 전사록은 앞에 프로빙이 있으면 입력이
//      upstream 이라 필수에서 빠지고, 첫 단계면 필수다(필드정의 §3.2).
//      여기가 뒤집히면 "설정 다 했는데 미설정" 또는 "비었는데 준비됨" 이 된다.
//
//   3. **클라이언트-안전** — ui-meta/step-config 가 server-only 를 import
//      하지 않는다. 이 둘은 프론트 렌더러와 서버 검증이 **같이** 읽는 SSOT 라
//      서버 전용 의존이 섞이면 프론트 빌드가 깨지고, 그러면 스키마를 프론트에
//      복제하게 되고(= 두 판정이 갈라진다) 서버가 거절하는 필드를 UI 가
//      그리는 상태가 된다.
//
// ⚠️ 왜 `registerHooks` 가 필요한가: 이 로더(node --experimental-strip-types)
// 는 `@/` alias 도 확장자 없는 상대 import 도 해석하지 못한다(번들러 해석을
// 쓰는 src 전체가 그 문법이다). 기존 체인 테스트들은 **타입 전용 import 만**
// 하는 모듈(state.ts)이라 그냥 로드됐지만, ui-meta 는 언어 레지스트리를
// 런타임으로 읽으므로 번들러 흉내 리졸버가 필요하다. 훅은 이 파일의 자식
// 프로세스에만 등록된다(`node --test` 는 파일당 1 프로세스). Node ≥ 22.15.
// ─────────────────────────────────────────────────────────────────────────

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

registerHooks({
  resolve(spec, ctx, next) {
    let target: string | null = null;
    if (spec.startsWith('@/')) {
      target = resolve(ROOT, 'src', spec.slice(2));
    } else if (spec.startsWith('.') && ctx.parentURL?.startsWith('file:')) {
      const abs = resolve(dirname(fileURLToPath(ctx.parentURL)), spec);
      if (!existsSync(abs)) target = abs;
    }
    if (target && existsSync(`${target}.ts`)) {
      return next(pathToFileURL(`${target}.ts`).href, ctx);
    }
    return next(spec, ctx);
  },
});

// 훅 등록 **후** 로드해야 하므로 동적 import(정적 import 는 hoisting 된다).
const { CHAIN_STEP_UI_META, stepFieldDef, stepUiMeta } = await import(
  '../src/lib/chains/ui-meta.ts'
);
const {
  mergeStepConfig,
  missingRequiredFields,
  resolveToplineKick,
  resolveTranscriptKick,
  validateStepConfigPatch,
} = await import('../src/lib/chains/step-config.ts');

/** 단계 key 로 메타를 집는다 — 없으면 테스트를 실패시킨다(선언 누락 신호). */
function meta(feature: string) {
  const m = stepUiMeta(feature);
  assert.ok(m, `${feature} ui-meta 선언 누락`);
  return m;
}

function validate(feature: string, patch: Record<string, unknown>) {
  return validateStepConfigPatch(meta(feature), patch);
}

describe('ui-meta 선언', () => {
  it('노드 4종 전부 선언돼 있다 — 인스펙터는 모든 노드를 렌더한다', () => {
    assert.deepEqual(Object.keys(CHAIN_STEP_UI_META).sort(), [
      'interview_ingest',
      'probing',
      'topline',
      'transcripts',
    ]);
  });

  it('요약·완료 행은 최대 3개 (§1 공통 규칙)', () => {
    for (const [feature, m] of Object.entries(CHAIN_STEP_UI_META)) {
      assert.ok(m.summaryFields.length <= 3, `${feature} summaryFields`);
      assert.ok(m.doneFields.length <= 3, `${feature} doneFields`);
    }
  });

  it('요약 행·필수 필드는 inspectorSchema 안에 있다 (유령 필드 금지)', () => {
    for (const [feature, m] of Object.entries(CHAIN_STEP_UI_META)) {
      const ids = [
        ...m.summaryFields,
        ...m.requiredFields({ position: 0, upstream: null }),
        ...m.requiredFields({ position: 1, upstream: 'probing' }),
      ];
      for (const id of ids) {
        assert.ok(stepFieldDef(feature, id), `${feature}.${id}`);
      }
    }
  });

  it('레이블은 전부 labelKey — 한글 리터럴 0', () => {
    for (const m of Object.values(CHAIN_STEP_UI_META)) {
      for (const f of m.inspectorSchema) {
        assert.match(f.labelKey, /^[A-Za-z][\w.]*$/);
        assert.match(f.section, /^[A-Za-z][\w.]*$/);
        if (f.hintKey) assert.match(f.hintKey, /^[A-Za-z][\w.]*$/);
        for (const o of f.options ?? []) {
          assert.match(o.labelKey, /^[A-Za-z][\w.-]*$/);
        }
      }
    }
  });

  it('선언된 labelKey 는 messages/ko.json 에 실재한다', () => {
    const ko = JSON.parse(readFileSync(`${ROOT}/messages/ko.json`, 'utf8'));
    const lookup = (path: string) =>
      path.split('.').reduce<unknown>((node, key) => {
        if (node && typeof node === 'object') {
          return (node as Record<string, unknown>)[key];
        }
        return undefined;
      }, ko);
    for (const [feature, m] of Object.entries(CHAIN_STEP_UI_META)) {
      for (const f of m.inspectorSchema) {
        assert.equal(typeof lookup(f.labelKey), 'string', f.labelKey);
        assert.equal(typeof lookup(f.section), 'string', f.section);
        if (f.hintKey) {
          assert.equal(typeof lookup(f.hintKey), 'string', f.hintKey);
        }
        for (const o of f.options ?? []) {
          assert.equal(typeof lookup(o.labelKey), 'string', o.labelKey);
        }
      }
      for (const id of m.doneFields) {
        const key = `Chain.inspector.done.${feature}.${id}`;
        assert.equal(typeof lookup(key), 'string', key);
      }
    }
  });

  it('transcripts 필수 집합은 체인 위치에 따라 달라진다 (§3.2)', () => {
    const m = meta('transcripts');
    // 첫 단계 — 사용자가 직접 올려야 하므로 audio 가 필수.
    assert.deepEqual(m.requiredFields({ position: 0, upstream: null }), [
      'method',
      'language',
      'audio',
    ]);
    // 프로빙 뒤 — 녹음이 upstream 이라 필수에서 빠진다.
    assert.deepEqual(m.requiredFields({ position: 1, upstream: 'probing' }), [
      'method',
      'language',
    ]);
  });

  it('interview_ingest 는 필수 0 — unset 없이 처음부터 ready (§0 구멍 ③)', () => {
    assert.deepEqual(
      meta('interview_ingest').requiredFields({
        position: 2,
        upstream: 'transcripts',
      }),
      [],
    );
  });

  it('단계별 프로젝트 필드는 없다 (프로젝트는 체인 설정 — §0 구멍 ②)', () => {
    for (const m of Object.values(CHAIN_STEP_UI_META)) {
      for (const f of m.inspectorSchema) {
        // 단계에 쓰기 가능한 프로젝트 필드가 생기면 체인 안에서 단계마다
        // 다른 프로젝트를 가리킬 수 있게 되고, 어댑터는 그걸 무시한다.
        if (/project/i.test(f.id)) {
          assert.equal(f.source, 'chain', f.id);
          assert.equal(f.kind, 'readonly', f.id);
        }
      }
    }
  });

  it('topline 필드 id 는 라우트 body 키와 같다 (소비 지점이 그 이름으로 읽는다)', () => {
    const ids = meta('topline').inspectorSchema.map((f) => f.id);
    assert.deepEqual(ids, ['output_lang', 'user_direction', 'allow_partial']);
    // force 는 설정이 아니라 재실행 동작 — 인스펙터에 두지 않는다(§5.4).
    assert.equal(stepFieldDef('topline', 'force'), null);
  });
});

describe('설정 검증 — 화이트리스트', () => {
  it('선언된 필드는 통과한다', () => {
    assert.deepEqual(validate('transcripts', { method: 'meeting', language: 'ko' }), {
      ok: true,
      patch: { method: 'meeting', language: 'ko' },
    });
  });

  it('미지의 키는 거절 — jsonb 에 쓰레기를 쌓지 않는다', () => {
    const r = validate('transcripts', { speaker_count: 2 });
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.error, 'unknown_field');
    assert.equal(r.ok === false && r.field, 'speaker_count');
  });

  it('다른 단계의 필드도 미지의 키다 (스키마는 단계별)', () => {
    assert.equal(
      validate('transcripts', { output_lang: 'ko' }).ok === false &&
        validate('transcripts', { output_lang: 'ko' }).error,
      'unknown_field',
    );
  });

  it('upstream / chain 공급 필드는 쓰기 거절 (§0 구멍 ②)', () => {
    for (const id of ['upstreamTranscript', 'projectDocuments']) {
      const r = validate('interview_ingest', { [id]: 'x' });
      assert.equal(r.ok === false && r.error, 'readonly_field', id);
    }
  });

  it('dropzone 은 쓰기 거절 — 업로드는 기존 업로드 경로가 소유한다', () => {
    const r = validate('transcripts', { audio: 'some/key' });
    assert.equal(r.ok === false && r.error, 'readonly_field');
  });

  it('하나라도 걸리면 전체 거절 (부분 반영 금지)', () => {
    assert.equal(validate('transcripts', { method: 'meeting', nope: 1 }).ok, false);
  });
});

describe('설정 검증 — 종류별 값', () => {
  it('segment / select 는 선언된 옵션 안의 값만', () => {
    assert.equal(validate('probing', { source: 'mic' }).ok, true);
    assert.equal(validate('probing', { source: 'webcam' }).ok, false);
    assert.equal(validate('probing', { source: 42 }).ok, false);
    // 전사 언어는 전사록 위젯 레지스트리와 같은 집합(multi = 자동 감지).
    assert.equal(validate('transcripts', { language: 'multi' }).ok, true);
    assert.equal(validate('transcripts', { language: 'klingon' }).ok, false);
    // 출력 언어는 기존 topline/probing enum 과 같은 6종.
    assert.equal(validate('topline', { output_lang: 'ja' }).ok, true);
    assert.equal(validate('topline', { output_lang: 'de' }).ok, false);
  });

  it('transcripts.method 는 DB 체크 제약과 같은 집합', () => {
    assert.equal(validate('transcripts', { method: 'research' }).ok, true);
    assert.equal(validate('transcripts', { method: 'meeting' }).ok, true);
    // 위젯 UI 의 카드 id('minutes')가 아니라 DB 값이 계약이다.
    assert.equal(validate('transcripts', { method: 'minutes' }).ok, false);
  });

  it('toggle 은 boolean — 문자열 "true" 는 거절', () => {
    assert.equal(validate('topline', { allow_partial: false }).ok, true);
    const r = validate('topline', { allow_partial: 'true' });
    assert.equal(r.ok === false && r.error, 'invalid_value');
  });

  it('textarea 는 선언된 길이 상한까지 (라우트 상한과 동일)', () => {
    const max = stepFieldDef('topline', 'user_direction')?.maxLength ?? 0;
    assert.ok(max > 0);
    assert.equal(validate('topline', { user_direction: 'a'.repeat(max) }).ok, true);
    const r = validate('topline', { user_direction: 'a'.repeat(max + 1) });
    assert.equal(r.ok === false && r.error, 'invalid_value');
  });

  it('orderedList 는 문자열 배열 + 개수/항목 길이 상한', () => {
    const def = stepFieldDef('probing', 'questions');
    const maxItems = def?.maxItems ?? 0;
    const itemMax = def?.itemMaxLength ?? 0;
    assert.ok(maxItems > 0 && itemMax > 0);
    assert.equal(validate('probing', { questions: ['q1', 'q2'] }).ok, true);
    assert.equal(validate('probing', { questions: [] }).ok, true);
    assert.equal(validate('probing', { questions: 'not-an-array' }).ok, false);
    assert.equal(validate('probing', { questions: [1, 2] }).ok, false);
    assert.equal(
      validate('probing', {
        questions: Array.from({ length: maxItems + 1 }, () => 'q'),
      }).ok,
      false,
    );
    assert.equal(
      validate('probing', { questions: ['q'.repeat(itemMax + 1)] }).ok,
      false,
    );
  });

  it('null 은 통과하고 머지에서 키를 지운다 (RFC 7396)', () => {
    assert.equal(validate('topline', { user_direction: null }).ok, true);
    assert.deepEqual(
      mergeStepConfig(
        { output_lang: 'ko', user_direction: 'focus' },
        { user_direction: null },
      ),
      { output_lang: 'ko' },
    );
  });
});

describe('부분 머지', () => {
  it('보낸 키만 바꾸고 나머지는 보존한다 (전체 교체 아님)', () => {
    const current = { method: 'research', language: 'ko' };
    assert.deepEqual(mergeStepConfig(current, { language: 'en' }), {
      method: 'research',
      language: 'en',
    });
    // 입력 불변 — 호출부가 들고 있는 스냅샷이 바뀌지 않는다.
    assert.deepEqual(current, { method: 'research', language: 'ko' });
  });

  it('빈 패치는 현재 값 그대로 (no-op 저장 경로)', () => {
    assert.deepEqual(mergeStepConfig({ a: 1 }, {}), { a: 1 });
  });
});

describe('필수 판정 (unset / ready)', () => {
  const missing = (
    feature: string,
    config: Record<string, unknown>,
    ctx: { position: number; upstream: string | null },
  ) => missingRequiredFields(meta(feature), config, ctx);

  it('비어 있는 필수 필드를 체크리스트로 돌려준다', () => {
    assert.deepEqual(missing('probing', {}, { position: 0, upstream: null }), [
      'source',
      'outputLang',
    ]);
    assert.deepEqual(
      missing('probing', { source: 'mic', outputLang: 'ko' }, { position: 0, upstream: null }),
      [],
    );
  });

  it('빈 문자열·빈 배열은 "비었다"로 본다', () => {
    assert.deepEqual(
      missing('probing', { source: '   ', outputLang: 'ko' }, { position: 0, upstream: null }),
      ['source'],
    );
  });

  it('false 는 채워진 값이다 (사용자가 끄기를 선택한 것)', () => {
    assert.deepEqual(
      missing(
        'topline',
        { output_lang: 'ko', allow_partial: false },
        { position: 3, upstream: 'interview_ingest' },
      ),
      [],
    );
  });

  it('프로빙 뒤 전사록은 입력 없이도 ready (upstream 공급)', () => {
    assert.deepEqual(
      missing(
        'transcripts',
        { method: 'research', language: 'ko' },
        { position: 1, upstream: 'probing' },
      ),
      [],
    );
    // 같은 설정이라도 첫 단계면 입력이 빈다.
    assert.deepEqual(
      missing(
        'transcripts',
        { method: 'research', language: 'ko' },
        { position: 0, upstream: null },
      ),
      ['audio'],
    );
  });

  it('설정 0개 단계는 항상 ready', () => {
    assert.deepEqual(
      missing('interview_ingest', {}, { position: 2, upstream: 'transcripts' }),
      [],
    );
  });
});

describe('소비 해석 — 저장만 하고 끝나지 않는다', () => {
  // 이 PR 의 핵심 계약: 저장된 설정이 **실제 위젯 파라미터로 변환**된다.
  // 변환이 깨지면 "설정했는데 반영 안 되는 유령 필드"(필드정의 §0 구멍 ①)를
  // 새로 만드는 것이고, 그건 저장소를 만든 의미 자체를 없앤다.
  //
  // 여기서 덮는 것 = config → 파라미터 변환(순수). 덮지 못하는 것 = 그
  // 파라미터가 DB/외부 호출에 실려 나가는 마지막 한 줄(server-only 경로) —
  // 그건 프리뷰에서 실제 체인을 돌려 row/로그로 확인한다.

  it('전사: 설정이 없으면 현행 동작 그대로 (폴백 = 회귀 0)', () => {
    assert.deepEqual(resolveTranscriptKick({}), {
      language: null, // → getLanguage(null) = multi = ElevenLabs Scribe
      mode: 'research',
    });
  });

  it('전사: language / method 가 파라미터로 넘어간다', () => {
    assert.deepEqual(resolveTranscriptKick({ language: 'ko', method: 'meeting' }), {
      language: 'ko',
      mode: 'meeting',
    });
    assert.deepEqual(resolveTranscriptKick({ language: 'ko' }), {
      language: 'ko',
      mode: 'research',
    });
  });

  it('전사: 타입이 틀린 값은 기본값으로 흡수한다 (체인 전진 > 설정 반영)', () => {
    assert.deepEqual(resolveTranscriptKick({ language: 42, method: 'nope' }), {
      language: null,
      mode: 'research',
    });
  });

  it('탑라인: 설정이 없으면 키를 싣지 않는다 (라우트 폴백 유지)', () => {
    assert.deepEqual(resolveToplineKick({}), {});
  });

  it('탑라인: output_lang · user_direction · allow_partial 이 body 로 간다', () => {
    assert.deepEqual(
      resolveToplineKick({
        output_lang: 'en',
        user_direction: '가격 민감도 중심으로',
        allow_partial: true,
      }),
      {
        output_lang: 'en',
        user_direction: '가격 민감도 중심으로',
        allow_partial: true,
      },
    );
    // allow_partial=false 는 "설정됨" 이므로 명시 전달한다.
    assert.deepEqual(resolveToplineKick({ allow_partial: false }), {
      allow_partial: false,
    });
  });

  it('탑라인: 빈 방향은 "지정 안 함" (라우트의 trim() || null 과 동일 해석)', () => {
    assert.deepEqual(resolveToplineKick({ user_direction: '   ' }), {});
  });

  it('탑라인: force 는 설정이 아니라 재실행 동작 — 싣지 않는다 (§5.4)', () => {
    assert.deepEqual(resolveToplineKick({ force: true }), {});
  });
});

describe('클라이언트-안전 제약', () => {
  // 위 동적 import 가 두 모듈을 **실제로 로드**한 것이 1차 확인이고(서버 전용
  // 의존이 있으면 이 파일 자체가 깨진다), 아래 정적 스캔이 2차 확인이다 —
  // 조건부 import 처럼 로드만으로 드러나지 않는 경로까지 덮는다.
  const DENY = [
    '@/env',
    'supabase/admin',
    'supabase/server',
    'next/headers',
    'next/server',
    'server-only',
    'node:',
  ];

  for (const file of ['ui-meta.ts', 'step-config.ts']) {
    it(`${file} 은 server-only 를 import 하지 않는다`, () => {
      const src = readFileSync(`${ROOT}/src/lib/chains/${file}`, 'utf8');
      const specifiers = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
      assert.ok(specifiers.length > 0, 'import 를 하나도 못 읽었다');
      for (const spec of specifiers) {
        for (const bad of DENY) {
          assert.ok(!spec.includes(bad), `${file} imports ${spec} (${bad})`);
        }
      }
    });
  }
});
