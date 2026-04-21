import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDomain, normalizePhone, normalizeName, makeReviewId, isStockholmsLan } from '../normalize.mjs';

test('normalizeDomain strips protocol, www, and lowercases', () => {
  assert.equal(normalizeDomain('https://www.Foo.se/path?x=1'), 'foo.se');
  assert.equal(normalizeDomain('foo.se'), 'foo.se');
  assert.equal(normalizeDomain(null), null);
  assert.equal(normalizeDomain('not a url at all'), null);
});

test('normalizePhone handles Swedish formats', () => {
  assert.equal(normalizePhone('070-404 10 36'),    '+46704041036');
  assert.equal(normalizePhone('+46 70 404 10 36'), '+46704041036');
  assert.equal(normalizePhone('0046704041036'),    '+46704041036');
  assert.equal(normalizePhone('08-123 45 67'),     '+4681234567');
  assert.equal(normalizePhone(null),               null);
  assert.equal(normalizePhone('abc'),              null);
});

test('normalizeName strips common suffixes', () => {
  assert.equal(normalizeName('Johanssons Bygg AB'), 'johanssons bygg');
  assert.equal(normalizeName('Samuel Rör & VVS'),   'samuel rör & vvs');
  assert.equal(normalizeName(''),                    null);
});

test('makeReviewId is stable', () => {
  const a = makeReviewId('servicefinder', '9336144', 'Max', '2026-03-04');
  const b = makeReviewId('servicefinder', '9336144', 'Max', '2026-03-04');
  assert.equal(a, b);
  assert.notEqual(a, makeReviewId('servicefinder', '9336144', 'Max', '2026-03-05'));
});

test('isStockholmsLan uses postal-code prefix', () => {
  assert.equal(isStockholmsLan('151 62'), true);
  assert.equal(isStockholmsLan('100 12'), true);
  assert.equal(isStockholmsLan('199 99'), true);
  assert.equal(isStockholmsLan('200 00'), false);
  assert.equal(isStockholmsLan('40215'),  false);
  assert.equal(isStockholmsLan(null),     false);
});
