import test from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { derive } from '../lib/derive.mjs';
import {
  moduleKeywords, moduleContextHash, staleModules, setModuleFunctional,
  saveFunctional, loadFunctional, loadModuleFunctional,
} from '../lib/functional.mjs';

function shopModel() {
  const facts = [
    { file: 'a', pkg: 'com.shop.cart', module: 'shop', hash: 'h1',
      types: [{ kind: 'class', name: 'Cart', ann: ['@Service'], line: 1, methods: [], fields: [] }] },
    { file: 'b', pkg: 'com.shop.checkout', module: 'shop', hash: 'h2',
      types: [{ kind: 'class', name: 'Checkout', ann: ['@Service'], line: 1, methods: [], fields: [] }] },
  ];
  return derive(facts);
}

const FUNC = {
  'shop/com.shop.cart': { purpose: 'Shopping cart management', capabilities: ['Add item to the cart'] },
  'shop/com.shop.checkout': { purpose: 'Checkout and payment', capabilities: ['Process a payment'] },
};

test('moduleKeywords aggregates domain terms and drops stopwords', () => {
  const kw = moduleKeywords(Object.keys(FUNC), FUNC, 8);
  assert.ok(kw.includes('cart'), 'has cart');
  assert.ok(kw.includes('payment'), 'has payment');
  assert.ok(!kw.includes('the') && !kw.includes('and'), 'stopwords removed');
});

test('moduleContextHash is stable and content-sensitive', () => {
  const m = shopModel();
  const h1 = moduleContextHash(m, 'shop', FUNC);
  const h2 = moduleContextHash(m, 'shop', { ...FUNC, 'shop/com.shop.cart': { purpose: 'CHANGED', capabilities: [] } });
  assert.ok(h1 && h1 !== h2, 'hash changes when a context purpose changes');
});

test('setModuleFunctional persists theme and clears module staleness', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thunder-mod-'));
  try {
    const m = shopModel();
    saveFunctional(dir, { ...FUNC }); // seed inferred contexts on disk
    assert.strictEqual(staleModules(m, dir, loadFunctional(dir)).length, 1, 'module initially stale');

    setModuleFunctional(dir, m, 'shop', { theme: 'Shopping' });
    const store = loadFunctional(dir);
    assert.strictEqual(loadModuleFunctional(store).shop.theme, 'Shopping');
    assert.strictEqual(staleModules(m, dir, store).length, 0, 'module no longer stale');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a module with no inferred contexts is not reported stale', () => {
  const m = shopModel();
  assert.strictEqual(staleModules(m, '/tmp/whatever', {}).length, 0);
});
