import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/pages/Procurement.tsx', import.meta.url), 'utf8');
const modal = source.slice(source.indexOf('const FinancialApprovalModal:'), source.indexOf('const GRNTab:'));

test('mobile financial approval shows full product details as readable cards, not a clipped table', () => {
  assert.match(modal, /data-testid="financial-approval-mobile-products" className="grid gap-3 md:hidden"/);
  assert.match(modal, /<article key=\{line.id\}/);
  for (const field of ['Supplier:', 'Quoted unit cost', 'Requested quantity', 'Approved quantity', 'Approved line total', 'Remove product']) {
    assert.ok(modal.includes(field), field + ' missing in mobile card');
  }
  assert.match(modal, /text-zinc-950 break-words/);
  assert.match(modal, /border-zinc-200 bg-white/);
  assert.match(modal, /text-zinc-950 disabled:bg-zinc-100 disabled:text-zinc-600/);
});

test('desktop financial approval retains a labeled high contrast table', () => {
  assert.match(modal, /data-testid="financial-approval-desktop-products" className="hidden md:block/);
  assert.match(modal, /<table className="w-full min-w-\[740px\] text-left text-zinc-900"/);
  assert.match(modal, /<tbody className="divide-y divide-zinc-200 bg-white text-zinc-900"/);
  assert.match(modal, /Approved line total/);
});

test('approval is blocked when ordered lines fail or are absent and cancel is visible', () => {
  assert.match(modal, /setLoadError\(true\)/);
  assert.match(modal, /loading \|\| loadError \|\| lines.length === 0/);
  assert.match(modal, /disabled=\{submitting \|\| loading \|\| loadError \|\| !canApprove \|\| lines.length === 0\}/);
  assert.match(modal, /Unable to retrieve this order's products/);
  assert.match(modal, /No products awaiting financial approval were found/);
  assert.match(modal, /border-zinc-400 bg-white text-zinc-900 font-semibold rounded-xl px-4 py-2 text-sm">Cancel/);
});

test('substitution editor inputs and supplier dropdown have legible foregrounds', () => {
  assert.match(modal, /rounded-2xl border border-emerald-200 bg-white/);
  assert.match(modal, /border border-zinc-300 bg-white text-zinc-950 rounded-xl/);
  assert.match(modal, /text-zinc-950 bg-white hover:bg-emerald-50/);
});
