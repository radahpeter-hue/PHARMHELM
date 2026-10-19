import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('mobile dispatch cards explicitly render visible dark values without relying on inherited theme text', () => {
  const source = readFileSync(new URL('../src/pages/Procurement.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('/* On phones, each dispatch');
  const end = source.indexOf('<div className="hidden md:block overflow-x-auto', start);
  assert.ok(start >= 0 && end > start);
  const cards = source.slice(start, end);
  assert.match(cards, /bg-white text-zinc-900/);
  assert.ok((cards.match(/font-semibold text-zinc-900/g) || []).length >= 8);
  assert.doesNotMatch(cards, /className="font-medium(?: break-words| capitalize)?"/);
  assert.match(cards, /Inspect Transfer/);
  assert.match(cards, /Resume Staged Transfer/);
});
