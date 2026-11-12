import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
      import { ProfitabilityLedger } from './src/pages/finance/management/ProfitabilityLedger';
      import { ModuleErrorBoundary } from './src/components/ModuleErrorBoundary';
      createRoot(document.getElementById('root')).render(
        <ModuleErrorBoundary>
          {location.search.includes('pnl') ? <ProfitabilityLedger branchOnly /> : <Analytics />}
        </ModuleErrorBoundary>
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
        path: path.endsWith('AuthContext') ? 'auth' : fixtureModules[path], namespace: 'fixture',
      }));
      builder.onResolve({ filter: /^firebase\/firestore$/ }, ({ importer }) => {
        if (importer.endsWith('/POSAnalytics.tsx')) return { path: 'quotations', namespace: 'fixture' };
        if (importer.endsWith('/useProfitabilityData.ts') || importer.endsWith('/FinanceAnalytics.tsx')) {
          return { path: 'profitability', namespace: 'fixture' };
        }
      });
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
        resolveDir: process.cwd(),
        contents: {
          auth: `
            const branch = { id: 'masaka', name: 'Masaka', tenantId: 'martin-pharma' };
            export const useAuth = () => ({
              profile: { uid: 'fixture-user', tenantId: 'martin-pharma' },
              activeBranch: branch, activeBranchId: branch.id, assignedBranches: [branch],
              hasPermission: () => true, setActiveBranchId: () => {},
            });
          `,
          subscriptions: `
            import { Timestamp } from 'firebase/firestore';
            const fixtures = {
              sales: [{ id: 'sale', tenantId: 'martin-pharma', branchId: 'masaka', status: 'completed', timestamp: Timestamp.fromMillis(Date.parse('2026-11-11T06:00:00Z')), total: 1000 }],
              product_batches: [{ id: 'batch', expiryDate: { seconds: 1_700_000_000 }, quantity: 2, purchasePrice: 10 }],
              clients: [
                { name: 'Fixture chronic patient', balance: 100, segment_tags: ['diabetes'],
                  next_refill_due_date: Timestamp.fromMillis(Date.parse('2026-11-06T10:00:00Z')) },
                { name: 'Upcoming refill', segment_tags: ['diabetes'],
                  next_refill_due_date: Timestamp.fromMillis(Date.parse('2026-11-16T10:00:00Z')) },
              ],
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
          profitability: `
            import { Timestamp } from 'firebase/firestore';
            const scope = { tenantId: 'martin-pharma', branchId: 'masaka', branch_id: 'masaka' };
            const sales = [
              { ...scope, id: 'original', total: 999999, status: 'completed', supersededBySaleId: 'receipt',
                timestamp: '2026-11-11T06:00:00Z', actualSaleCost: 500000 },
              { ...scope, id: 'receipt', totalAmount: 2000000, subtotal: 2200000, discountAmount: 200000,
                status: 'completed', timestamp: Timestamp.fromMillis(Date.parse('2026-11-11T06:00:00Z')),
                actualSaleCost: 1200000, receiptNumber: 'MP-123' },
              { ...scope, id: 'different-branch', branchId: 'kampala', total: 500000, status: 'completed',
                timestamp: '2026-11-11T06:00:00Z', actualSaleCost: 300000 },
              { ...scope, id: 'next-month', total: 500000, status: 'completed',
                timestamp: '2026-12-11T06:00:00Z', actualSaleCost: 300000 },
            ];
            const records = {
              sales,
              branch_expenses: [{ ...scope, id: 'rent', amount_ugx: 300000, status: 'paid', expense_date: '2026-11-11' }],
              banking_records: [{ ...scope, id: 'transfer_fee', amount: 10000, date: '2026-11-11',
                type: 'outgoing', movementClass: 'transfer_charge', portfolioTransferId: 'transfer' }],
              eod_reconciliations: [{ ...scope, id: 'eod', reconciliation_date: '2026-11-11',
                total_expected: 500000, total_actual: 490000 }],
            };
            export const collection = (_db, name) => name;
            export const doc = (_db, name, id) => [name, id];
            export const where = (field, operator, value) => [field, operator, value];
            export const query = (...parts) => parts;
            export async function getDocsFromServer([name, tenant, ...filters]) {
              if (JSON.stringify(tenant) !== JSON.stringify(['tenantId', '==', 'martin-pharma'])) throw new Error('Expected tenant scope');
              return { docs: (records[name] || [])
                .filter(row => filters.every(([field, op, value]) => op === 'in' ? value.includes(row[field]) : row[field] === value))
                .map(row => ({ id: row.id, data: () => row })) };
            }
            export async function getDocFromServer() { return { exists: () => false }; }
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
        ['Finance', 'Net Sales Revenue by Day'],
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
        if (tab === 'Finance') {
          const branchSummary = page.getByRole('heading', { name: 'Branch P&L Summary' }).locator('..');
          const profit = branchSummary.getByText('Net Profit Before Tax', { exact: true }).locator('..');
          assert.equal(await profit.locator('dd').innerText(), 'UGX 490,000');
          const eod = page.getByText('Variance', { exact: true }).locator('..').locator('dd');
          await page.getByText('UGX -10,000', { exact: true }).waitFor();
          assert.equal(await eod.innerText(), 'UGX -10,000');
        }
        if (tab === 'CRM') {
          const adherence = page.getByText('Chronic Adherence Rate', { exact: true }).locator('..');
          assert.equal(await adherence.getByRole('heading').innerText(), '50%');
        }
      }
      await page.goto(`http://127.0.0.1:${server.address().port}/?pnl`);
      await page.getByRole('heading', { name: 'Branch P&L', exact: true }).or(errorBoundary).waitFor();
      const statement = page.getByRole('heading', { name: 'Profitability Breakdown Statement' }).locator('../..');
      const net = statement.getByText('Net Profit Before Tax', { exact: true }).locator('..').locator('dd');
      await net.waitFor();
      assert.match(await net.innerText(), /UGX 490,000/);
      await page.getByRole('combobox', { name: 'P&L period' }).selectOption('monthly');
      assert.match(await net.innerText(), /UGX 490,000/);
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Download Excel Statement' }).click(),
      ]);
      assert.match(download.suggestedFilename(), /^Branch_PnL_2026-11-01_to_2026-11-30\.xlsx$/);
      const workbookData = execFileSync('unzip', ['-p', await download.path(), 'xl/worksheets/sheet1.xml'], { encoding: 'utf8' });
      assert.match(workbookData, /<v>490000<\/v>/);
      assert.deepEqual(errors, []);
      console.log(`Analytics, matching Branch P&L, and Excel download passed on ${label}.`);
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise(resolve => server.close(resolve));
}
