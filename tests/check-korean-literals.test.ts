// ─────────────────────────────────────────────────────────────────────────
// 한글 리터럴 가드 자체 테스트 (scripts/check-korean-literals.ts)
//
// 검출 코어(scanSource)가 다음을 정확히 하는지 강제한다:
//   · 문자열/템플릿/JSX 텍스트 리터럴의 한글은 검출
//   · 주석의 한글은 무시 (AST trivia)
//   · `i18n-allow-korean` 지시자(같은 줄/윗줄)로 개별 예외
//   · 한자/가나(ja) 는 대상 아님
// 그리고 화이트리스트(isWhitelisted)가 admin/design-system/테스트를 제외하는지.
//
// 가드 자체가 회귀하면(예: 주석을 잡거나 지시자를 무시) baseline 이 무의미해지므로
// 이 테스트가 불변식이다. docs/WRITING.md §7 가드 운영 참조.
// ─────────────────────────────────────────────────────────────────────────

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scanSource, isWhitelisted } from '../scripts/check-korean-literals.ts';

const F = 'src/components/probe.tsx';

describe('scanSource — 검출', () => {
  it('문자열 리터럴의 한글을 검출한다', () => {
    const v = scanSource(F, 'export const x = "안녕하세요";');
    assert.equal(v.length, 1);
    assert.equal(v[0].line, 1);
  });

  it('치환 없는 템플릿 리터럴의 한글을 검출한다', () => {
    assert.equal(scanSource(F, 'const s = `완료되었습니다`;').length, 1);
  });

  it('치환 포함 템플릿은 한글 포함 파트마다 센다 (head/tail 분리)', () => {
    // `총 ${n}건 완료` = TemplateHead("총 ") + TemplateTail("건 완료") = 2 파트.
    // 파트별 카운트라 새 한글 파트 유입도 개별 차단된다.
    assert.equal(scanSource(F, 'const s = `총 ${n}건 완료`;').length, 2);
  });

  it('JSX 텍스트의 한글을 검출한다', () => {
    const v = scanSource(F, 'const C = () => <div>준비 중이에요</div>;');
    assert.equal(v.length, 1);
  });

  it('한 파일의 여러 위반을 각각 센다', () => {
    const v = scanSource(F, 'const a = "하나";\nconst b = "둘";\nconst c = "셋";');
    assert.equal(v.length, 3);
  });
});

describe('scanSource — 제외', () => {
  it('라인 주석의 한글은 무시한다', () => {
    assert.equal(scanSource(F, 'const x = 1; // 한글 주석 여러 개 한글').length, 0);
  });

  it('블록 주석의 한글은 무시한다', () => {
    assert.equal(scanSource(F, '/* 한글 블록 주석\n * 계속 한글 */\nconst x = 1;').length, 0);
  });

  it('같은 줄 i18n-allow-korean 지시자로 예외 처리한다', () => {
    assert.equal(scanSource(F, 'const x = "허용된 한글"; // i18n-allow-korean -- 사유').length, 0);
  });

  it('바로 윗줄 i18n-allow-korean 지시자로 예외 처리한다', () => {
    assert.equal(scanSource(F, '// i18n-allow-korean -- 정규식\nconst re = "[가-힣]";').length, 0);
  });

  it('영어/숫자 리터럴은 검출하지 않는다', () => {
    assert.equal(scanSource(F, 'const x = "hello world 123";').length, 0);
  });

  it('한자/가나(일본어)는 대상이 아니다', () => {
    assert.equal(scanSource(F, 'const x = "こんにちは"; const y = "文字起こし";').length, 0);
  });
});

describe('isWhitelisted', () => {
  it('admin 라우트를 제외한다', () => {
    assert.ok(isWhitelisted('src/app/[locale]/(app)/admin/page.tsx'));
  });

  it('design-system 라우트를 제외한다', () => {
    assert.ok(isWhitelisted('src/app/[locale]/(app)/design-system/components/sections.tsx'));
  });

  it('테스트 파일을 제외한다', () => {
    assert.ok(isWhitelisted('src/components/foo.test.tsx'));
  });

  it('.d.ts 를 제외한다', () => {
    assert.ok(isWhitelisted('src/types/global.d.ts'));
  });

  it('일반 컴포넌트는 제외하지 않는다', () => {
    assert.equal(isWhitelisted('src/components/canvas/shell/tokens.ts'), false);
  });
});
