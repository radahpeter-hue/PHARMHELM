// Actual shared register, isolated fixtures, no database access.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = await mkdtemp(path.join(tmpdir(), 'stock-in-register-'));
await build({stdin:{contents:`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {StockInRegister} from './src/components/stock/StockInRegister';
function App(){const [history,setHistory]=useState(false);const [kind,setKind]=useState('Sellable');return <main className="p-3 text-white"><button className="min-h-11 text-zinc-900" onClick={()=>setKind(kind==='Sellable'?'Operational':'Sellable')}>{kind}</button><StockInRegister history={history} onHistoryChange={setHistory} canReceive rows={[{id:'a',number:'TEST-2026-001',source:'HQ Store with a long source name',destination:'Masaka',sender:'Dispatch staff',receiver:'Receipt staff',sentAt:'2026-10-18T12:00:00',receivedAt:'2026-10-20T23:59:59',value:38000,status:history?'received':'dispatched',onOpen:()=>{window.opened=true},onExport:()=>{window.exported=true}}]}/></main>}createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,format:'iife',outfile:path.join(output,'app.js')});
const css=(await readdir('dist/assets')).find(n=>n.endsWith('.css'));assert.ok(css);
await copyFile(path.join('dist/assets',css),path.join(output,'style.css'));
await writeFile(path.join(output,'index.html'),'<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="style.css"></head><body><div id="root"></div><script src="app.js"></script></body></html>');
const server=createServer(async(req,res)=>{const name=req.url==='/'?'index.html':req.url.slice(1);if(!['index.html','app.js','style.css'].includes(name)){res.statusCode=404;res.end();return;}res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(await readFile(path.join(output,name)));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try {browser=await chromium.launch({headless:true});for(const width of [360,390,1280]){
 const page=await browser.newPage({viewport:{width,height:844}});await page.goto(`http://127.0.0.1:${server.address().port}`);
 for(const kind of ['Sellable','Operational']){
  if(kind==='Operational')await page.getByRole('button',{name:'Sellable',exact:true}).click();
  await page.getByRole('button',{name:'Pending Reception',exact:true}).click();
  const receive=page.getByRole('button',{name:'Receive & Verify',exact:true}).filter({visible:true});await receive.click();assert.equal(await page.evaluate(()=>window.opened),true);
  await page.getByRole('button',{name:'Reception History',exact:true}).click();
  await page.getByLabel('From date',{exact:true}).fill('2026-10-20');await page.getByLabel('To date',{exact:true}).fill('2026-10-20');
  const detail=page.getByRole('button',{name:'View Details',exact:true}).filter({visible:true});assert.equal(await detail.count(),1);
  await page.getByLabel('Search receptions').fill('nothing');await page.getByText('No receptions match these filters.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();
  await page.getByRole('button',{name:'Excel',exact:true}).filter({visible:true}).click();assert.equal(await page.evaluate(()=>window.exported),true);
  await page.getByLabel('From date',{exact:true}).fill('2026-10-21');await page.getByLabel('To date',{exact:true}).fill('2026-10-19');await page.getByRole('alert').waitFor();
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();
  assert.equal(await page.locator('body').evaluate(e=>e.scrollWidth<=innerWidth),true);
  for(const control of [page.getByLabel('From date',{exact:true}),page.getByLabel('To date',{exact:true}),detail]){await control.scrollIntoViewIfNeeded();const box=await control.boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=width&&box.height>=44);}
  await page.screenshot({path:path.join(output,`${kind}-${width}.png`),fullPage:true});
 }
 await page.close();console.log(`Stock In register passed at ${width}px`);
}}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
console.log(`Screenshots: ${output}`);
