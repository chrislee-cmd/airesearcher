// ─────────────────────────────────────────────────────────────────────────
// 디자인 하드코드 가드 자체 테스트 (scripts/check-design.ts)
//
// 검출 코어(scanSource)가 다음을 정확히 하는지 강제한다:
//   · Tailwind arbitrary shadow-[…]·색-[#hex]·rounded-[Npx]·[border-radius:Npx] 검출
//   · 인라인 style 객체(color/background/borderRadius/boxShadow)의 hex/px 검출
//   · SVG fill="#…"/stroke="#…" 검출
//   · var(--token) 참조·레이아웃 arbitrary(w-[…]·grid-cols)·border 폭은 제외 (과탐 방지)
//   · `design-allow-hardcoded` 지시자(같은 줄/윗줄)로 개별 예외
// 그리고 화이트리스트(isWhitelisted)가 design-system/canvas-lab/테스트를 제외하는지.
//
// 가드 자체가 회귀하면(예: 레이아웃 치수를 잡거나 지시자를 무시) baseline 이
// 무의미해지므로 이 테스트가 불변식이다. PROJECT.md §9 디자인 시스템 참조.
// ─────────────────────────────────────────────────────────────────────────

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scanSource, isWhitelisted } from '../scripts/check-design.ts';

const F = 'src/components/widget.tsx';

describe('scanSource — 검출', () => {
  it('arbitrary shadow-[…] 를 검출한다', () => {
    const v = scanSource(F, 'const C = () => <div className="shadow-[4px_4px_0_black]" />;');
    assert.equal(v.length, 1);
    assert.equal(v[0].category, 'shadow');
  });

  it('색 리터럴을 담은 var 혼합 shadow 도 검출한다', () => {
    assert.equal(scanSource(F, 'const c = "shadow-[2px_2px_0_var(--color-ink)]";').length, 1);
  });

  it('Tailwind arbitrary 색(bg-[#hex])을 검출한다', () => {
    const v = scanSource(F, 'const c = "bg-[#0EA5E9]";');
    assert.equal(v.length, 1);
    assert.equal(v[0].category, 'color');
  });

  it('rounded-[Npx] radius 를 검출한다', () => {
    const v = scanSource(F, 'const c = "rounded-[2px]";');
    assert.equal(v.length, 1);
    assert.equal(v[0].category, 'radius');
  });

  it('arbitrary CSS property [border-radius:3px] 를 검출한다', () => {
    assert.equal(scanSource(F, 'const c = "[border-radius:3px]";').length, 1);
  });

  it('인라인 style 객체의 hex 색을 검출한다', () => {
    const v = scanSource(F, "const C = () => <div style={{ color: '#fff' }} />;");
    assert.equal(v.length, 1);
    assert.equal(v[0].category, 'inline-color');
  });

  it('인라인 style 객체의 px borderRadius 를 검출한다', () => {
    const v = scanSource(F, "const C = () => <div style={{ borderRadius: '10px' }} />;");
    assert.equal(v.length, 1);
    assert.equal(v[0].category, 'inline-dim');
  });

  it('SVG fill="#…" 를 검출한다', () => {
    const v = scanSource(F, 'const C = () => <path fill="#4285F4" />;');
    assert.equal(v.length, 1);
    assert.equal(v[0].category, 'svg-color');
  });
});

describe('scanSource — 제외 (과탐 방지)', () => {
  it('레이아웃 치수 arbitrary(w-[280px]·grid-cols)는 무시한다', () => {
    assert.equal(scanSource(F, 'const c = "w-[280px] grid-cols-[1fr_2fr] gap-[12px] top-[3px]";').length, 0);
  });

  it('var(--token) 참조는 무시한다', () => {
    assert.equal(scanSource(F, 'const c = "bg-[var(--canvas-bg)] rounded-[var(--r)]";').length, 0);
  });

  it('border 폭(border-[2px])은 무시한다 (DS-6 게이트 담당)', () => {
    assert.equal(scanSource(F, 'const c = "border-[2px] border-[2.5px]";').length, 0);
  });

  it('text-[Npx] 폰트크기는 무시한다 (no-restricted-syntax 담당)', () => {
    assert.equal(scanSource(F, 'const c = "text-[13px]";').length, 0);
  });

  it('토큰 참조 인라인 style(var)은 무시한다', () => {
    assert.equal(scanSource(F, "const C = () => <div style={{ color: 'var(--color-ink)' }} />;").length, 0);
  });

  it('주석의 hex 는 무시한다 (AST trivia)', () => {
    assert.equal(scanSource(F, 'const x = 1; // shadow-[4px_4px_0_#123456] 예시').length, 0);
  });

  it('같은 줄 design-allow-hardcoded 지시자로 예외 처리한다', () => {
    assert.equal(scanSource(F, 'const c = "shadow-[4px_4px_0_black]"; // design-allow-hardcoded -- 사유').length, 0);
  });

  it('바로 윗줄 design-allow-hardcoded 지시자로 예외 처리한다', () => {
    assert.equal(scanSource(F, '// design-allow-hardcoded -- 브랜드 SVG\nconst c = "bg-[#4285F4]";').length, 0);
  });

  it('토큰 유틸 클래스(shadow-memphis-md·rounded-sm)는 무시한다', () => {
    assert.equal(scanSource(F, 'const c = "shadow-memphis-md rounded-sm text-ink border-line";').length, 0);
  });
});

describe('isWhitelisted', () => {
  it('design-system 카탈로그를 제외한다', () => {
    assert.ok(isWhitelisted('src/app/[locale]/(app)/design-system/components/sections.tsx'));
  });

  it('canvas-lab 샌드박스를 제외한다', () => {
    assert.ok(isWhitelisted('src/app/[locale]/(canvas-lab)/lab/page.tsx'));
  });

  it('테스트 파일을 제외한다', () => {
    assert.ok(isWhitelisted('src/components/foo.test.tsx'));
  });

  it('일반 컴포넌트는 제외하지 않는다', () => {
    assert.equal(isWhitelisted('src/components/login-dialog.tsx'), false);
  });
});
