import test from 'node:test';
import assert from 'node:assert/strict';
import { installStructuredCloneFallback } from '../front/browser-compat.mjs';

test('older browser can clone JSON model data and check own properties', () => {
  const target = { Object: {} };
  installStructuredCloneFallback(target);
  const source = { members: [{ name: 'J35' }] };
  const copy = target.structuredClone(source);
  copy.members[0].name = 'changed';
  assert.equal(source.members[0].name, 'J35');
  assert.equal(target.Object.hasOwn(Object.create({ inherited: 1 }), 'inherited'), false);
  assert.equal(target.Object.hasOwn({ own: 1 }, 'own'), true);
});

test('native browser implementations remain unchanged', () => {
  const clone = () => {};
  const hasOwn = () => {};
  const target = { structuredClone: clone, Object: { hasOwn } };
  installStructuredCloneFallback(target);
  assert.equal(target.structuredClone, clone);
  assert.equal(target.Object.hasOwn, hasOwn);
});
