import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const layoutSource = readFileSync(new URL('../src/components/Layout.tsx', import.meta.url), 'utf8');
const salesSource = readFileSync(new URL('../src/pages/Sales.tsx', import.meta.url), 'utf8');

test('Layout removes max-w-7xl restriction and applies 16-24px padding on sales route', () => {
  assert.ok(layoutSource.includes("const isSalesRoute = routeSegment === 'sales' || location.pathname.includes('/sales');"));
  assert.ok(layoutSource.includes('isSalesRoute'));
  assert.ok(layoutSource.includes('max-w-none'));
  assert.ok(layoutSource.includes('lg:px-6'));
  assert.ok(layoutSource.includes('max-w-7xl mx-auto')); // preserved for other routes
});

test('Sales POS workspace rebalances columns to 58% basket and 42% operational panel with 16-20px gaps', () => {
  // Active basket column is 7/12 (58.33%)
  assert.ok(salesSource.includes('lg:col-span-7 flex flex-col bg-white rounded-3xl'));
  // Right panel is 5/12 (41.67%)
  assert.ok(salesSource.includes('lg:col-span-5 flex flex-col gap-4 lg:gap-5'));
  // Inter-panel gap is 16px to 20px (gap-4 lg:gap-5)
  assert.ok(salesSource.includes('grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-5'));
});

test('Available Items removes generic decorative box icon', () => {
  // Confirm Package icon in h-10 w-10 container is no longer inside the Available Items list
  assert.equal(salesSource.includes('bg-slate-100 text-slate-600 group-hover:bg-emerald-500 group-hover:text-white'), false);
  assert.equal(salesSource.includes('<Package size={16} strokeWidth={2.5} />'), false);
});

test('Available Items displays complete product names with wrapping and no truncation', () => {
  // Product title uses break-words and does NOT truncate
  assert.ok(salesSource.includes('{item.name}'));
  assert.ok(salesSource.includes('break-words'));
  // Confirm the old truncated product name pattern is removed
  assert.equal(salesSource.includes('font-extrabold text-zinc-900 text-xs truncate uppercase tracking-tight group-hover:text-emerald-950'), false);
});

test('Available Items clearly displays stock availability and unit', () => {
  assert.ok(salesSource.includes("totalBaseStock.toLocaleString()} {product?.baseUnit || product?.unit || 'base units'}"));
  assert.ok(salesSource.includes('OUT OF STOCK'));
});

test('Available Items displays selectable selling-tier controls with name, UGX price, and unit', () => {
  assert.ok(salesSource.includes('resolution.tiers.map(tier => {'));
  assert.ok(salesSource.includes('{tier.label}:'));
  assert.ok(salesSource.includes('UGX {tierPrice.toLocaleString()}'));
  assert.ok(salesSource.includes('/ {tier.label.toLowerCase()}'));
  assert.ok(salesSource.includes('addToCart(item, tier.code)'));
  assert.ok(salesSource.includes('disabled={!hasTierStock}'));
});
