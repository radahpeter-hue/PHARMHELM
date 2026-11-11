import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const { chromium, devices, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const fixtureModules = {
  '../contexts/AuthContext': 'auth',
  '../../contexts/AuthContext': 'auth',
  '../../services/firestore': 'subscriptions',
};

const { outputFiles: [bundle] } = await build({
  stdin: {
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import Analytics from './src/pages/Analytics';
      import { ModuleErrorBoundary } from './src/components/ModuleErrorBoundary';
      createRoot(document.getElementById('root')).render(
        <ModuleErrorBoundary><Analytics /></ModuleErrorBoundary>
      );
    `,
    loader: 'tsx',
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{
    name: 'analytics-fixtures',
    setup(builder) {
      builder.onResolve({ filter: /AuthContext$|services\/firestore$/ }, ({ path }) => ({
        path: fixtureModules[path], namespace: 'fixture',
      }));
      builder.onResolve({ filter: /^firebase\/firestore$/ }, ({ importer }) => {
        if (importer.endsWith('/POSAnalytics.tsx')) return { path: 'quotations', namespace: 'fixture' };
      });
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
        resolveDir: process.cwd(),
        contents: {
          auth: `
            const branch = { id: 'masaka', name: 'Masaka' };
            export const useAuth = () => ({
              profile: { uid: 'fixture-user', tenantId: 'martin-pharma' },
              activeBranch: branch, assignedBranches: [branch],
              hasPermission: () => true, setActiveBranchId: () => {},
            });
          `,
          subscriptions: `
            import { Timestamp } from 'firebase/firestore';
            const fixtures = {
              sales: [{ id: 'sale', timestamp: Timestamp.fromMillis(Date.parse('2026-11-11T06:00:00Z')), total: 1000 }],
              product_batches: [{ id: 'batch', expiryDate: { seconds: 1_700_000_000 }, quantity: 2, purchasePrice: 10 }],
              clients: [{ name: 'Fixture chronic patient', balance: 100, segment_tags: ['diabetes'],
                next_refill_due_date: Timestamp.fromMillis(Date.parse('2026-11-06T10:00:00Z')) }],
              fridge_temp_logs: [{ date: 'malformed', temperature: 5 }],
              premises_licenses: [
                { licenseName: 'Fixture QA licence', expiryDate: new Date('2027-04-10T06:00:00Z') },
                { licenseName: 'Licence with unknown expiry', expiryDate: { toDate: true } },
              ],
              vehicles: [{ id: 'vehicle', insurance_expiry_date: { toDate: true } }],
              trips: [
                { id: 'trip', status: 'completed', departure_time: { seconds: 1_700_000_000 }, arrival_time: new Date(1_700_007_200_000) },
              ],
            };
            function subscribe(name, onData) {
              const timer = setTimeout(() => onData(fixtures[name] || []), 0);
              return () => clearTimeout(timer);
            }
            export const firestoreService = {
              subscribeToCollection: (name, _tenant, onData) => subscribe(name, onData),
              subscribeToCollectionGroup: (name, _tenant, _branch, onData) => subscribe(name, onData),
            };
          `,
          quotations: `
            import { Timestamp } from 'firebase/firestore';
            const quotations = [
              { status: 'Converted', createdAt: Timestamp.fromDate(new Date('2026-11-01T12:00:00Z')), convertedAt: '2026-11-03T12:00:00Z', grandTotal: 100, convertedValue: 120 },
              { status: 'Converted', createdAt: new Date('2026-11-02T12:00:00Z'), convertedAt: { seconds: Date.parse('2026-11-03T12:00:00Z') / 1000 }, grandTotal: 200 },
              { status: 'Converted', createdAt: 'invalid', convertedAt: null, grandTotal: 300 },
              { status: 'Draft', validityDate: new Date('2026-11-10T12:00:00Z'), grandTotal: 500 },
              { status: 'Draft', validityDate: '2026-11-11', grandTotal: 1000 },
              { status: 'Draft', validityDate: '2026-02-30', grandTotal: 2000 },
              { status: 'Draft', validityDate: { toDate: true }, grandTotal: 3000 },
              { status: 'Draft', validityDate: null, grandTotal: 4000 },
              { status: 'Draft', grandTotal: 5000 },
              { status: 'Expired', grandTotal: 600 },
            ];
            export const collection = (_db, name) => name;
            export const where = (field, operator, value) => [field, operator, value];
            export const query = (...parts) => parts;
            export async function getDocs(parts) {
              if (JSON.stringify(parts) !== JSON.stringify([
                'pos_quotations', ['tenantId', '==', 'martin-pharma'], ['branchId', '==', 'masaka']
              ])) throw new Error('Expected a tenant- and branch-scoped quotation query');
              return { docs: quotations.map((quote, index) => ({ id: String(index), data: () => quote })) };
            }
          `,
        }[path],
      }));
    },
  }],
});

const server = createServer((request, response) => {
  if (request.url === '/app.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(bundle.contents);
  } else {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script src="/app.js"></script>');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

const cases = [
  ['desktop Chromium', chromium, { viewport: { width: 1280, height: 850 } }],
  ['mobile WebKit', webkit, devices['iPhone 13']],
];
try {
  for (const [label, engine, options] of cases) {
    if (engine === webkit && process.env.ANALYTICS_CHROMIUM_ONLY === '1') continue;
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ ...options, timezoneId: 'Africa/Kampala', locale: 'en-GB' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.clock.setFixedTime(new Date('2026-11-11T10:00:00Z'));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      const title = page.getByRole('heading', { name: 'Analytics Intelligence' });
      const errorBoundary = page.getByRole('heading', { name: 'This module could not be displayed' });
      await title.or(errorBoundary).waitFor();
      assert.equal(await errorBoundary.count(), 0, await page.locator('body').innerText());
      const cards = [
        ['Total Quotations', '10'],
        ['Conversion Rate', '60%'],
        ['Avg Time To Convert', '1.5 Days'],
        ['Expired Quotations Value', 'UGX 1,100'],
        ['Sum of Actual POS Receipt Value', 'UGX 620'],
      ];
      for (const [name, value] of cards) {
        const result = page.getByText(name, { exact: true }).locator('..').getByText(value, { exact: true });
        await result.or(errorBoundary).waitFor({ timeout: 5000 });
        assert.equal(await errorBoundary.count(), 0, await page.locator('body').innerText());
      }
      const tabs = [
        ['Inventory', 'ABC / VEN Heatmap', '1 products at risk'],
        ['CRM', 'Chronic Churn Risk List', 'Fixture chronic patient'],
        ['Finance', 'Revenue vs Target Tracking'],
        ['QA & Compliance', 'Cold Chain Deviation Log', 'Fixture QA licence'],
        ['Logistics', 'Fleet Compliance Countdown', '2.0 hours'],
        ['HR & Personnel', 'Dispenser Revenue Leaderboard'],
        ['Predictive Engine', 'Sustainability Score Trend'],
        ['Report Hub', 'Global Audit Log'],
      ];
      for (const [tab, heading, loadedText] of tabs) {
        await page.getByRole('button', { name: tab, exact: true }).click();
        await page.getByRole('heading', { name: heading, exact: true }).or(errorBoundary).waitFor({ timeout: 5000 });
        if (loadedText) {
          await page.getByText(loadedText, { exact: true }).or(errorBoundary).waitFor({ timeout: 5000 });
        }
        assert.equal(await errorBoundary.count(), 0, await page.locator('body').innerText());
      }
      assert.deepEqual(errors, []);
      console.log(`Analytics initial load, quotation metrics and tab navigation passed on ${label}.`);
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise(resolve => server.close(resolve));
}
