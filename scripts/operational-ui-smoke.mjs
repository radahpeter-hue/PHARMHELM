import { build } from 'esbuild';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = process.cwd();
const output = await mkdtemp(path.join(tmpdir(), 'operational-ui-'));
const masters = [
  { id: 'master-pens', name: 'Ballpoint pens with a long descriptive catalogue name', type: 'non-fixed', category: 'Stationery', unitOfIssue: 'piece', unitPerPack: 12, inventoryClass: 'OPERATIONAL', operationalType: 'CONSUMABLE_OPERATIONAL', uniqueId: 'OPS-123456' },
  { id: 'master-desk', name: 'Office desk', type: 'fixed', category: 'Furniture & Fittings', unitOfIssue: 'piece', unitPerPack: 1, inventoryClass: 'OPERATIONAL', operationalType: 'FIXED_ASSET', uniqueId: 'AST-123456' }
];
const stubs = {
  AuthContext: `export const useAuth=()=>({profile:{tenantId:'tenant-test',uid:'tester',displayName:'Test User',branchId:'branch-test'},activeBranchId:'branch-test',hasPermission:()=>true});`,
  firestore: `export const firestoreService={subscribeToCollection:(c,t,cb)=>{cb(${JSON.stringify(masters)});return ()=>{};}};`,
  operationalInventoryMasterService: `export async function saveOperationalLocationItem(data){window.savedItem=data;return {itemId:'test',masterItemId:'master'};}`,
  operationalInventoryUsageService: `export async function logOperationalUsage(){return {};}`
};
await build({
  stdin: { contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {InventoryItemModal,OperationalMasterCatalogue} from './src/components/inventory/OperationalInventoryTab';import {OperationalStockBalance} from './src/components/inventory/OperationalStockBalance';const App=()=>{const [open,setOpen]=useState(false);return <main className="p-4 text-white"><button className="p-3 bg-sky-700 text-white" onClick={()=>setOpen(true)}>Register item</button><OperationalMasterCatalogue locationId="HQ" items={[]}/><div className="bg-white p-4"><OperationalStockBalance quantity={0} unit="1"/></div>{open&&<InventoryItemModal isOpen onClose={()=>setOpen(false)} item={null}/>}</main>};createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: root, loader: 'tsx' },
  bundle: true, format: 'iife', outfile: path.join(output, 'app.js'),
  plugins: [{ name: 'isolated-ui-services', setup(builder) {
    builder.onResolve({ filter: /AuthContext|services\/(firestore|operationalInventoryMasterService|operationalInventoryUsageService)$/ }, args => ({ path: args.path.split('/').pop(), namespace: 'stub' }));
    builder.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], loader: 'js' }));
  } }]
});
const css = (await readdir('dist/assets')).find(name => name.endsWith('.css'));
assert.ok(css, 'Build the production CSS before running the UI check.');
await copyFile(path.join(root, 'dist/assets', css), path.join(output, 'style.css'));
await writeFile(path.join(output, 'index.html'), '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="style.css"></head><body><div id="root"></div><script src="app.js"></script></body></html>');
const server = createServer(async (req, res) => {
  const name = req.url === '/' ? 'index.html' : req.url.slice(1);
  if (!['index.html', 'app.js', 'style.css'].includes(name)) { res.statusCode = 404; res.end(); return; }
  res.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'text/javascript' : 'text/html');
  res.end(await readFile(path.join(output, name)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByText('Office desk', { exact: true }).waitFor();
    assert.notEqual(await page.getByText('Office desk', { exact: true }).evaluate(element => getComputedStyle(element).color), 'rgb(255, 255, 255)');
    assert.equal(await page.locator('body').evaluate(element => element.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(output, `catalogue-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Register item', exact: true }).click();
    const opening = page.getByLabel('Opening stock', { exact: true });
    await opening.waitFor();
    assert.equal(await opening.inputValue(), '0');
    await page.locator('select').first().selectOption('fixed');
    assert.equal(await opening.inputValue(), '0');
    const save = page.getByRole('button', { name: 'Save Item', exact: true });
    await save.scrollIntoViewIfNeeded();
    const buttonBox = await save.boundingBox();
    assert.ok(buttonBox && buttonBox.y + buttonBox.height <= 844, 'Save control must remain reachable within the viewport.');
    await page.screenshot({ path: path.join(output, `fixed-${width}.png`), fullPage: true });
    // Submit the real form to a capture-only service, never to Firestore.
    await page.locator('input').nth(2).fill('Test office desk');
    await page.locator('select').nth(1).selectOption('Furniture & Fittings');
    await page.locator('input[list="operational-issue-units"]').fill('piece');
    await save.click();
    await page.waitForFunction(() => Boolean(window.savedItem));
    assert.equal(await page.evaluate(() => window.savedItem.data.quantityInStock), 0);
    await page.getByRole('button', { name: 'Register at HQ' }).first().click();
    await page.getByRole('searchbox', { name: 'Search catalogue' }).fill('Office');
    assert.equal(await page.locator('select option[value="master-desk"]').count(), 1);
    await page.locator('select').first().selectOption('master-desk');
    assert.equal(await page.getByLabel('Opening stock', { exact: true }).inputValue(), '0');
    await page.screenshot({ path: path.join(output, `link-${width}.png`), fullPage: true });
    await page.close();
    console.log(`Operational UI checks passed at ${width}px.`);
  }
  console.log(`UI screenshots: ${output}`);
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
