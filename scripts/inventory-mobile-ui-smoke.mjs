import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = await mkdtemp(path.join(tmpdir(), 'inventory-mobile-ui-'));
const productName = 'Flucozyd 200mg Capsules, Extended Product Name for the Inventory Register';
const fixtures = {
  products: [{
    id: 'p1', name: productName, productId: 'PRD-000006', sku: 'SKU-000006', category: 'drug/medicine',
    unitOfSell: 'unit', unitsPerPack: 10, sellingPricePerUnit: 1000, costPricePerPack: 4000,
    vatClassification: 'Zero-Rated'
  }],
  product_batches: Array.from({ length: 12 }, (_, index) => ({
    id: `batch-${index + 1}`, productId: 'p1', branchId: 'masaka', batchNumber: `BATCH-${index + 1}`,
    batch_status: 'active', quantity: 50, expiryDate: '2028-12-01', purchasePrice: 400
  })),
  inventory_movements: [{
    id: 'm1', productId: 'p1', branchId: 'masaka', timestamp: '2026-11-16T10:00:00Z', type: 'in', amount: 50,
    reference: 'GRN-2026-000123-LONG-REFERENCE', initiator: 'Inventory team', receiver: 'Masaka',
    movementClass: 'adjustment', class: 'adjustment', amountAttached: 20000
  }]
};

await build({
  stdin: {
    contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import Inventory from './src/pages/Inventory';
      createRoot(document.getElementById('root')).render(<main className="min-h-screen bg-zinc-50 p-3 text-zinc-900 sm:p-5 md:p-8"><Inventory /></main>);
    `,
    resolveDir: process.cwd(), loader: 'tsx'
  },
  bundle: true, format: 'iife', outfile: path.join(output, 'app.js'),
  plugins: [{
    name: 'inventory-fixtures',
    setup(builder) {
      builder.onResolve({ filter: /\/(AuthContext|firestore|useOperationalInventoryFeature)$/ }, ({ path: name }) => {
        const key = name.split('/').at(-1);
        if (name.startsWith('.')) return { path: key, namespace: 'fixtures' };
      });
      builder.onLoad({ filter: /.*/, namespace: 'fixtures' }, ({ path: name }) => {
        if (name === 'AuthContext') return { contents: `export const useAuth = () => ({
          profile: {tenantId: 'test', uid: 'tester'}, activeBranchId: 'masaka', activeBranch: {name: 'Masaka'},
          hasPermission: (_area, level) => level !== 'operate' || !location.search.includes('viewer')
        });` };
        if (name === 'useOperationalInventoryFeature') return { contents: 'export const useOperationalInventoryFeature = () => true;' };
        return { contents: `
          const data = ${JSON.stringify(fixtures)};
          const subscribe = (name, callback) => { callback(data[name] || []); return () => {}; };
          export const firestoreService = {
            subscribeToCollection: (name, _tenant, callback) => subscribe(name, callback),
            subscribeToCollectionByQuery: (name, _tenant, _constraints, callback) => subscribe(name, callback),
            subscribeToCollectionGroup: (name, _tenant, _branch, callback) => subscribe(name, callback),
            getCollection: async name => data[name] || [],
            getCollectionGroup: async name => data[name] || [],
            deleteDocument: async (name, id) => { window.deleted = [name, id]; }
          };
        ` };
      });
    }
  }]
});

const css = (await readdir('dist/assets')).find(name => name.endsWith('.css'));
assert.ok(css, 'Build the application before running the browser check.');
await copyFile(path.join('dist/assets', css), path.join(output, 'style.css'));
await writeFile(path.join(output, 'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
const files = { '/': ['index.html', 'text/html'], '/style.css': ['style.css', 'text/css'], '/app.js': ['app.js', 'text/javascript'] };
const server = createServer(async (req, res) => {
  const file = files[new URL(req.url, 'http://localhost').pathname];
  if (!file) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', file[1]);
  res.end(await readFile(path.join(output, file[0])));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = `http://127.0.0.1:${server.address().port}`;
let browser;

async function assertTappable(control, width) {
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= width && box.height >= 44);
  assert.equal(await control.evaluate(element => getComputedStyle(element).opacity), '1');
}

try {
  const alternate = process.env.INVENTORY_BROWSER_EXECUTABLE;
  browser = await chromium.launch(alternate
    ? { executablePath: alternate, args: ['--no-sandbox', '--no-zygote'] }
    : { headless: true });
  for (const [width, height] of [[320, 640], [390, 844], [844, 390], [1440, 900]]) {
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: width < 1024, isMobile: width < 1024 });
    await page.goto(address);
    const edit = page.getByRole('button', { name: `Edit ${productName}`, exact: true });
    const remove = page.getByRole('button', { name: `Delete ${productName}`, exact: true });
    await edit.waitFor();
    const register = page.getByRole('table', { name: 'Product register' });
    assert.equal(await register.evaluate(table => table.scrollWidth <= table.parentElement.clientWidth), true);
    for (const control of [page.getByRole('button', { name: 'Add Product', exact: true }), edit, remove]) {
      await assertTappable(control, width);
    }
    await edit.click();
    await page.getByRole('heading', { name: 'Edit Product', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Close product form' }).click();
    page.once('dialog', dialog => dialog.dismiss());
    await remove.click();
    assert.equal(await page.evaluate(() => window.deleted), undefined);

    await page.getByRole('button', { name: `View details for ${productName}` }).click();
    const dialog = page.getByRole('dialog', { name: productName });
    await dialog.waitFor();
    assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), true);
    const close = dialog.getByRole('button', { name: 'Close product details' });
    await assertTappable(close, width);
    const lastBatch = dialog.getByRole('button', { name: 'Adjust batch BATCH-12', exact: true });
    await assertTappable(lastBatch, width);
    await lastBatch.click();
    await dialog.getByRole('heading', { name: 'Adjust Stock', exact: true }).waitFor();
    await page.keyboard.press('Escape');

    for (const [section, evidence] of [
      ['Movement Tracker', 'GRN-2026-000123-LONG-REFERENCE'],
      ['Consumption Intel', 'Consumption Analysis'],
      ['Active Batches', 'BATCH-1']
    ]) {
      const tab = dialog.getByRole('button', { name: section, exact: true });
      await assertTappable(tab, width);
      await tab.click();
      await dialog.getByText(evidence, { exact: true }).waitFor();
      if (section === 'Movement Tracker') {
        const movements = dialog.getByRole('table', { name: 'Stock movements' });
        assert.equal(await movements.evaluate(table => table.scrollWidth <= table.parentElement.clientWidth), true);
      }
    }
    await page.screenshot({ path: path.join(output, `stockcard-${width}.png`) });
    await close.click();

    const navigation = page.getByRole('navigation', { name: 'Inventory sections' });
    for (const section of ['Stock Adjustments', 'Operational', 'Report Hub', 'Inventory Master']) {
      const tab = navigation.getByRole('button', { name: section, exact: true });
      await assertTappable(tab, width);
      await tab.click();
      assert.equal(await page.locator('body').evaluate(body => body.scrollWidth <= innerWidth), true, `${section} overflows at ${width}px`);
    }
    await page.screenshot({ path: path.join(output, `register-${width}.png`) });
    await page.close();
    console.log(`Inventory passed at ${width} × ${height}`);
  }

  const viewer = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await viewer.goto(`${address}/?viewer`);
  await viewer.getByRole('button', { name: `View details for ${productName}` }).waitFor();
  assert.equal(await viewer.getByRole('button', { name: `Edit ${productName}` }).count(), 0);
  assert.equal(await viewer.getByRole('button', { name: `Delete ${productName}` }).count(), 0);
  await viewer.close();
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
console.log(`Screenshots: ${output}`);
