import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateNext } from '../src/lib/auth/validate-next.ts';

describe('validateNext (SEC-001 open-redirect guard)', () => {
  it('accepts a path-only target', () => {
    assert.equal(validateNext('/dashboard'), '/dashboard');
  });

  it('rejects protocol-relative URLs (`//attacker.com`)', () => {
    assert.equal(validateNext('//attacker.com'), null);
  });

  it('rejects absolute URLs (`https://attacker.com`)', () => {
    assert.equal(validateNext('https://attacker.com'), null);
  });

  it('rejects null / missing input', () => {
    assert.equal(validateNext(null), null);
    assert.equal(validateNext(undefined), null);
    assert.equal(validateNext(''), null);
  });

  it('rejects `/\\host` (backslash bypass — URL spec resolves to off-site)', () => {
    // `new URL('/\\attacker.com', 'https://app.com').href` === 'https://attacker.com/'
    assert.equal(validateNext('/\\attacker.com'), null);
  });
});
