// Isolated real GRN modal: all database and posting calls are capture-only stubs.
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
const output = await mkdtemp(path.join(tmpdir(), 'operational-route-ui-'));
const lines = [{id:'line-a',tenantId:'test',order_id:'order',product_id:'pens',product_name:'Pens with a long descriptive Operational catalogue name',supplier_name:'Stationery supplier',supplier_id:'supplier',supplier_type:'external',inventoryClass:'OPERATIONAL',masterItemId:'master',line_status:'approved',qty_ordered:2,qty_received:0,unit_cost_ugx:12000}];
const stubs = {
  auth: `export const useAuth=()=>({profile:{tenantId:'test',uid:'buyer',fullName:'Buyer'},hasPermission:()=>true,activeBranchId:'masaka'});`,
  firestore: `export const firestoreService={getDocumentsByQuery:async()=>${JSON.stringify(lines)}};`,
  firebase: `export const db={},auth={},storage={},googleProvider={}; export const registerAuthUser=()=>{};`,
  grn: `export async function processOperationalGrn(input){window.posted=input;return {grnNumber:'TEST-GRN',alreadyProcessed:false};}`,
  sellable: `export async function processProcurementGrn(){throw new Error('Sellable must not run');}`
};
await build({stdin:{contents:`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {GRNProcessModal} from './src/pages/Procurement';const base={id:'order',tenantId:'test',order_number:'ORD-TEST',inventoryClass:'OPERATIONAL',category:'non_sellable',requesting_branch_id:'masaka',requesting_branch_name:'Masaka'};function App(){const [mode,setMode]=useState('branch');return <main className="text-white"><div><button onClick={()=>setMode('hq')}>HQ scenario</button><button onClick={()=>setMode('locked')}>Locked scenario</button><button onClick={()=>setMode('branch')}>Branch scenario</button></div><GRNProcessModal key={mode} order={mode==='hq'?{...base,requesting_branch_id:'HQ',requesting_branch_name:'HQ Operational Store'}:mode==='locked'?{...base,operational_delivery_route:'VIA_HQ',last_grn_id:'existing'}:base} onClose={()=>{window.closed=true}}/></main>}createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:root,loader:'tsx'},bundle:true,format:'iife',outfile:path.join(output,'app.js'),plugins:[{name:'capture-only-grn',setup(builder){
  builder.onResolve({filter:/AuthContext$/},()=>({path:'auth',namespace:'stub'}));
  builder.onResolve({filter:/\/firebase$/},()=>({path:'firebase',namespace:'stub'}));
  builder.onResolve({filter:/services\/firestore$/},()=>({path:'firestore',namespace:'stub'}));
  builder.onResolve({filter:/services\/(operationalGrnService|procurementFinanceService)$/},args=>args.importer.endsWith('/pages/Procurement.tsx')?{path:args.path.endsWith('/operationalGrnService')?'grn':'sellable',namespace:'stub'}:undefined);
  builder.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path],loader:'js'}));
}}]});
const css = (await readdir('dist/assets')).find(name=>name.endsWith('.css'));
assert.ok(css,'Build production CSS first');
await copyFile(path.join('dist/assets',css),path.join(output,'style.css'));
await writeFile(path.join(output,'index.html'),'<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="style.css"></head><body><div id="root"></div><script src="app.js"></script></body></html>');
const server=createServer(async(req,res)=>{const name=req.url==='/'?'index.html':req.url.slice(1);if(!['index.html','app.js','style.css'].includes(name)){res.statusCode=404;res.end();return;}res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(await readFile(path.join(output,name)));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 browser=await chromium.launch({headless:true});
 for(const width of [360,390,1280]){
  const page=await browser.newPage({viewport:{width,height:844}});
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const route=page.getByLabel('Operational delivery route',{exact:true});
  await route.waitFor();
  assert.equal(await route.inputValue(),'DIRECT_BRANCH');
  assert.equal(await route.isEnabled(),true);
  await page.getByText(lines[0].product_name,{exact:true}).filter({visible:true}).waitFor();
  assert.equal(await page.locator('body').evaluate(e=>e.scrollWidth<=innerWidth),true);
  assert.notEqual(await route.evaluate(e=>getComputedStyle(e).color),'rgb(255, 255, 255)');
  await route.selectOption('VIA_HQ');
  await page.getByText('Post received quantities into HQ Operational stock.',{exact:false}).waitFor();
  await route.selectOption('DIRECT_BRANCH');
  const qty=page.getByRole('spinbutton',{name:`Received packs ${lines[0].product_name}`,exact:true}).filter({visible:true});
  await qty.fill('1');
  await page.getByPlaceholder('Required supplier invoice reference').fill('PHONE-INVOICE');
  const complete=page.getByRole('button',{name:'Complete GRN',exact:true});
  const box=await complete.boundingBox();assert.ok(box&&box.y>=0&&box.y+box.height<=844,'posting footer reachable on phone');
  await page.screenshot({path:path.join(output,`grn-${width}.png`),fullPage:true});
  await complete.click();await page.waitForFunction(()=>Boolean(window.posted));
  assert.equal(await page.evaluate(()=>window.posted.deliveryRoute),'DIRECT_BRANCH');
  assert.equal(await page.evaluate(()=>window.posted.editedLines['line-a'].qty),1);
  // Scenario fixtures remount the same real modal without writing to Firebase.
  await page.getByRole('button',{name:'HQ scenario',exact:true}).evaluate(e=>e.click());
  assert.equal(await route.inputValue(),'VIA_HQ');assert.equal(await route.isDisabled(),true);
  await page.getByRole('button',{name:'Locked scenario',exact:true}).evaluate(e=>e.click());
  assert.equal(await route.inputValue(),'VIA_HQ');assert.equal(await route.isDisabled(),true);
  await page.close();
 }
 console.log(`Operational GRN route UI PASS at 360, 390 and 1280px; screenshots ${output}`);
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
