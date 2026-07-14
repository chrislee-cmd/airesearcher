// ─────────────────────────────────────────────────────────────────────────
// Locale key-parity gate — asserts the invariant enforced in CI by
// scripts/check-i18n.ts. The pure checker is reused here so `pnpm test`
// catches drift locally; the same script is run standalone in CI.
// ─────────────────────────────────────────────────────────────────────────

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checkI18n, leafKeys, findDuplicateKeys } from '../scripts/check-i18n.ts';

const messagesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'messages');

describe('i18n locale parity — messages/*.json', () => {
  it('the real message files pass every parity rule (0 errors)', () => {
    const { errors } = checkI18n(messagesDir);
    assert.equal(errors.length, 0, `\nparity errors:\n${errors.join('\n')}\n`);
  });
});

describe('i18n parity gate logic — synthetic red conditions', () => {
  it('ko orphan (key in ko missing from en) is flagged', () => {
    assert.equal(hasEnKoOrphan({ a: '1' }, { a: '1', b: '2' }), true);
  });

  it('en orphan (key in en missing from ko) is flagged', () => {
    assert.equal(hasEnKoOrphan({ a: '1', b: '2' }, { a: '1' }), true);
  });

  it('exact ko↔en parity is not flagged', () => {
    assert.equal(hasEnKoOrphan({ a: '1', nested: { x: '2' } }, { a: '1', nested: { x: '2' } }), false);
  });

  it('a ja/th key absent from en breaks the subset rule', () => {
    const en = leafKeys({ a: '1' });
    const ja = leafKeys({ a: '1', extra: '2' });
    const orphans = [...ja].filter((k) => !en.has(k));
    assert.deepEqual(orphans, ['extra']);
  });

  it('ja/th as a strict subset of en is allowed (missing keys OK)', () => {
    const en = leafKeys({ a: '1', b: '2', c: '3' });
    const ja = leafKeys({ a: '1' });
    const orphans = [...ja].filter((k) => !en.has(k));
    assert.equal(orphans.length, 0);
  });
});

describe('duplicate-key scanner', () => {
  it('detects a repeated key within the same object', () => {
    const dups = findDuplicateKeys('{ "a": 1, "b": 2, "a": 3 }');
    assert.deepEqual(dups, ['a']);
  });

  it('reports the nested breadcrumb of the duplicate', () => {
    const dups = findDuplicateKeys('{ "outer": { "x": 1, "x": 2 } }');
    assert.deepEqual(dups, ['outer.x']);
  });

  it('does not false-positive on the same key name in different objects', () => {
    const dups = findDuplicateKeys('{ "one": { "id": 1 }, "two": { "id": 2 } }');
    assert.equal(dups.length, 0);
  });

  it('is not fooled by braces/colons inside string values', () => {
    const dups = findDuplicateKeys('{ "a": "value with { and : and \\"quotes\\"", "b": 2 }');
    assert.equal(dups.length, 0);
  });
});

// Compact helper mirroring the ko↔en symmetric-difference rule.
function hasEnKoOrphan(en: Record<string, unknown>, ko: Record<string, unknown>): boolean {
  const e = leafKeys(en);
  const k = leafKeys(ko);
  const koOnly = [...k].some((key) => !e.has(key));
  const enOnly = [...e].some((key) => !k.has(key));
  return koOnly || enOnly;
}
