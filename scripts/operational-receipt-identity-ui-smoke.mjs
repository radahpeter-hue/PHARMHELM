// Exercises the real receipt UI with isolated records and no live Firebase access.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = await mkdtemp(path.join(tmpdir(), 'receipt-identity-'));
const line = { id:'line',tenantId:'test',inventoryClass:'OPERATIONAL',transferId:'transfer',destinationBranchId:'masaka',masterItemId:'EbZDsZuzm3QcJJ2oRCBT',itemName:'Pens',quantityDispatched:24,unitOfIssue:'units',status:'dispatched' };
const transfer = {id:'transfer',tenantId:'test',transferNumber:'OT-TEST',sourceOrderNumber:'ORD-TEST',destinationBranchId:'masaka',destinationBranchName:'Masaka',status:'dispatched'};
const stubs = {
 auth: `export const useAuth=()=>({profile:{tenantId:'test',uid:'tester'},activeBranchId:'masaka',hasPermission:()=>true});`,
 firebase: 'export const db={},auth={},storage={},googleProvider={}; export const registerAuthUser=()=>{};',
 firestore: `export const firestoreService={subscribeToCollectionByQuery:(c,t,q,cb)=>{cb([${JSON.stringify(transfer)}]);return ()=>{};},getDocumentsByQuery:async()=>[${JSON.stringify(line)}],getDocument:async()=>{if(location.search==='?failed')throw new Error('Permission denied');return {tenantId:location.search==='?foreign'?'other':'test',inventoryClass:'OPERATIONAL',uniqueId:location.search==='?missing'?'':'OPS-000123'};}};`,
 feature: 'export const useOperationalInventoryFeature=()=>true;',
 transfer: `export async function receiveOperationalTransferLine(input){window.receipt=input;} export async function createOperationalBranchReturn(){throw new Error('unexpected write');}`
};
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {OperationalBranchReceiptQueue} from './src/pages/StockInOut';createRoot(document.getElementById('root')).render(<main className="p-3 text-white"><OperationalBranchReceiptQueue/></main>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,format:'iife',outfile:path.join(output,'app.js'),plugins:[{name:'isolated-receipt',setup(b){
 for(const [filter,key] of [[/AuthContext$/,'auth'],[/\/firebase$/,'firebase'],[/services\/firestore$/,'firestore'],[/useOperationalInventoryFeature$/,'feature'],[/operationalTransferService$/,'transfer']]) b.onResolve({filter},()=>({path:key,namespace:'stub'}));
 b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path],loader:'js'}));
}}]});
const css=(await readdir('dist/assets')).find(n=>n.endsWith('.css'));assert.ok(css);
await copyFile(path.join('dist/assets',css),path.join(output,'style.css'));
await writeFile(path.join(output,'index.html'),'<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="style.css"></head><body><div id="root"></div><script src="app.js"></script></body></html>');
const server=createServer(async(req,res)=>{const pathname=req.url.split('?')[0];const name=pathname==='/'?'index.html':pathname.slice(1);if(!['index.html','app.js','style.css'].includes(name)){res.statusCode=404;res.end();return;}res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(await readFile(path.join(output,name)));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
 browser=await chromium.launch({headless:true});
 for(const width of [360,390,1280]) {
  const page=await browser.newPage({viewport:{width,height:844}});
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button',{name:/Receive & verify/i}).click();
  await page.getByText('Item code: OPS-000123',{exact:true}).waitFor();
  assert.equal(await page.getByText(line.masterItemId,{exact:false}).count(),0);
  assert.equal(await page.locator('body').evaluate(e=>e.scrollWidth<=innerWidth),true);
  assert.notEqual(await page.getByText('24 units',{exact:true}).evaluate(e=>getComputedStyle(e).color),'rgb(255, 255, 255)');
  const accepted=page.getByLabel('Accepted quantity Pens',{exact:true});
  assert.equal(await accepted.inputValue(),'24');
  await accepted.fill('20');
  assert.equal(await page.getByLabel('Queried quantity Pens',{exact:true}).inputValue(),'4');
  const reason=page.locator('select');await reason.selectOption('damaged');
  for(const control of [accepted,reason,page.getByRole('button',{name:'Confirm Operational receipt'})]) {
   await control.scrollIntoViewIfNeeded();const box=await control.boundingBox();
   assert.ok(box&&box.x>=0&&box.x+box.width<=width&&box.y>=0&&box.y+box.height<=844,'all receipt controls reachable');
  }
  assert.notEqual(await page.getByText('Item code: OPS-000123',{exact:true}).evaluate(e=>getComputedStyle(e).color),'rgb(255, 255, 255)');
  await page.screenshot({path:path.join(output,`receipt-${width}.png`),fullPage:true});
  await page.getByRole('button',{name:'Confirm Operational receipt'}).click();
  await page.waitForFunction(()=>Boolean(window.receipt));
  assert.equal(await page.evaluate(()=>window.receipt.accepted),20);
  assert.equal(await page.evaluate(()=>window.receipt.queried),4);
  console.log(`Canonical code and receipt controls passed at ${width}px`);
  await page.close();
 }
 for(const scenario of ['foreign','missing','failed']) {
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.goto(`http://127.0.0.1:${server.address().port}/?${scenario}`);
  await page.getByRole('button',{name:/Receive & verify/i}).click();
  await page.getByText('Item code: Unavailable',{exact:true}).waitFor();
  assert.equal(await page.getByText('Item code: OPS-000123',{exact:true}).count(),0);
  assert.equal(await page.getByText(line.masterItemId,{exact:false}).count(),0);
  await page.close();console.log(`Identity fails closed: ${scenario}`);
 }
 console.log(`Screenshots: ${output}`);
} finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
