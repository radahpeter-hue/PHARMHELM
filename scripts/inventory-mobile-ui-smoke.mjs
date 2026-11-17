import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.INVENTORY_BROWSER_ENGINE === 'webkit' ? webkit : chromium;
const output = await mkdtemp(path.join(tmpdir(), `inventory-mobile-ui-${engine.name()}-`));
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
      createRoot(document.getElementById('root')).render(<div className="flex h-screen flex-col overflow-hidden bg-zinc-50 text-zinc-900"><div className="h-16 shrink-0" /><main className="relative flex-1 overflow-y-auto p-3 sm:p-5 md:p-8"><Inventory /></main></div>);
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
          if (location.search.includes('catalogue')) {
            data.products.push(...Array.from({ length: 999 }, (_, index) => {
              const number = String(index + 2).padStart(4, '0');
              return { ...data.products[0], id: 'p' + number, name: 'Catalogue product ' + number,
                productId: 'PRD-' + number, sku: 'CAT-' + number,
                category: index === 998 ? 'cosmetic' : 'drug/medicine' };
            }));
          }
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
  browser = await engine.launch(alternate
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
    const box = await dialog.boundingBox();
    assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height);
    assert.equal(await dialog.evaluate(element => element.parentElement.parentElement === document.body), true);
    assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), true);
    const close = dialog.getByRole('button', { name: 'Close product details' });
    await assertTappable(close, width);
    const lastBatch = dialog.getByRole('button', { name: 'Adjust batch BATCH-12', exact: true });
    await assertTappable(lastBatch, width);
    await lastBatch.click();
    const adjustment = page.getByRole('dialog', { name: 'Adjust Stock', exact: true });
    await adjustment.waitFor();
    await page.keyboard.press('Escape');
    await adjustment.waitFor({ state: 'detached' });
    assert.equal(await lastBatch.evaluate(element => element === document.activeElement), true);

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

  const catalogue = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await catalogue.goto(`${address}/?catalogue`);
  const register = catalogue.getByRole('table', { name: 'Product register' });
  const rows = register.locator('tbody tr');
  const pagination = catalogue.getByRole('navigation', { name: 'Product pages', exact: true });
  await pagination.getByText('Page 1 of 10').waitFor();
  assert.equal(await rows.count(), 100);
  assert.equal(await pagination.getByRole('button', { name: 'Previous' }).isDisabled(), true);
  await pagination.getByRole('button', { name: 'Next' }).click();
  await pagination.getByText('Page 2 of 10').waitFor();
  await register.getByText('Catalogue product 0101', { exact: true }).waitFor();
  assert.equal(await rows.count(), 100);
  await pagination.getByRole('combobox', { name: 'Products per page' }).selectOption('150');
  await pagination.getByText('Page 1 of 7').waitFor();
  assert.equal(await rows.count(), 150);

  const scrolledProduct = register.getByRole('button', { name: 'View details for Catalogue product 0150', exact: true });
  await scrolledProduct.click();
  const scrolledCard = catalogue.getByRole('dialog', { name: 'Catalogue product 0150', exact: true });
  await scrolledCard.waitFor();
  const scrolledBox = await scrolledCard.boundingBox();
  assert.ok(scrolledBox && scrolledBox.y >= 0 && scrolledBox.y + scrolledBox.height <= 900);
  await catalogue.keyboard.press('Escape');

  const search = catalogue.getByRole('textbox', { name: 'Search products' });
  await search.fill('CAT-1000');
  await pagination.getByText('Page 1 of 1').waitFor();
  assert.equal(await rows.count(), 1);
  await register.getByText('Catalogue product 1000', { exact: true }).waitFor();
  await search.clear();
  await catalogue.getByRole('combobox', { name: 'Product category' }).selectOption('cosmetic');
  await pagination.getByText('Page 1 of 1').waitFor();
  assert.equal(await rows.count(), 1);
  await catalogue.close();
  console.log('Inventory pagination passed with 1,000 products.');

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
