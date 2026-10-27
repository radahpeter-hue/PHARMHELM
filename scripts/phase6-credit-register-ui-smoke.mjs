/** Real register component with explicit read-only fixtures. Separate from authenticated financial acceptance. */
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,writeFile,copyFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const output=await mkdtemp(path.join(tmpdir(),'phase6-credit-ui-'));
const auth=`const profile={tenantId:'test',role:'Finance Head',assigned_branches:['masaka']};export const useAuth=()=>({profile,activeBranchId:'masaka'});`;
const loader=`export const creditReadScope=()=>['masaka'];export async function loadCreditRegister(){if(location.search==='?error')throw new Error('Permission denied');return [
{id:'one',receipt_id:'sale',invoice_number:'MSK-2026-001',debtorType:'institution',debtorId:'hospital',client_name:'Masaka Hospital',contact:'0700000000',branch_id:'masaka',branch_name:'Masaka',invoice_amount_ugx:10000,amount_ugx:7500,collectedUGX:0,outstanding_ugx:7500,status:'outstanding',due_date:'2026-11-25',created_at:'2026-10-26',recognizedBy:'seller',paymentId:'payment',verified:true},
{id:'legacy',receipt_id:'old',invoice_number:'LEGACY-001',client_name:'Unverified historical account',branch_id:'masaka',branch_name:'Masaka',amount_ugx:999999,outstanding_ugx:999999,status:'outstanding',verified:false,exception:'Historical or duplicate record requires reconciliation'}];}`;
await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{ReceivablesRegister}from './src/components/finance/ReceivablesRegister';createRoot(document.getElementById('root')).render(<main style={{padding:12}}><ReceivablesRegister/></main>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,format:'iife',outfile:path.join(output,'app.js'),plugins:[{name:'read-only-register',setup(b){
 b.onResolve({filter:/AuthContext$/},()=>({path:'auth',namespace:'stub'}));
 b.onResolve({filter:/creditRegisterLoader$/},()=>({path:'loader',namespace:'stub'}));
 b.onResolve({filter:/excelExport$/},()=>({path:'export',namespace:'stub'}));
 b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:args.path==='auth'?auth:args.path==='loader'?loader:'export const exportRecordsToExcel=async rows=>{window.exported=rows};',loader:'js'}));
}}]});
const css=(await readdir('dist/assets')).find(n=>n.endsWith('.css'));await copyFile(path.join('dist/assets',css),path.join(output,'style.css'));
await writeFile(path.join(output,'index.html'),'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="style.css"></head><body><div id="root"></div><script src="app.js"></script></body></html>');
const server=createServer(async(req,res)=>{const n=req.url.split('?')[0].slice(1)||'index.html';if(!['app.js','style.css','index.html'].includes(n)){res.writeHead(404).end();return;}res.setHeader('Content-Type',n.endsWith('.js')?'text/javascript':n.endsWith('.css')?'text/css':'text/html');res.end(await readFile(path.join(output,n)));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
 browser=await chromium.launch({headless:true});
 for(const width of [360,390,1280]){
  const page=await browser.newPage({viewport:{width,height:844}});await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByText('UGX 7,500',{exact:true}).waitFor();
  for(const target of [page.getByText('UGX 7,500',{exact:true}),page.locator('tbody tr').first().locator('td').nth(1),page.locator('thead th').first()]) {
    const contrast = await target.evaluate(el=>{
      const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');
      const rgba=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return Array.from(ctx.getImageData(0,0,1,1).data);};
      const luminance=rgb=>{const c=rgb.slice(0,3).map(c=>{c/=255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;});return .2126*c[0]+.7152*c[1]+.0722*c[2];};
      let bg=[255,255,255,255];for(let node=el;node;node=node.parentElement){const pixel=rgba(getComputedStyle(node).backgroundColor);if(pixel[3]===255){bg=pixel;break;}}
      const fg=luminance(rgba(getComputedStyle(el).color)),back=luminance(bg);return (Math.max(fg,back)+.05)/(Math.min(fg,back)+.05);
    });assert.ok(contrast>=4.5,`Financial cards, table values and headings require readable contrast (${contrast})`);
  }
  assert.equal(await page.getByText('UGX 1,007,499',{exact:true}).count(),0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:path.join(output,`${width}-register.png`),fullPage:true});
  await page.getByLabel('Search receivables').fill('0700000000');assert.equal(await page.getByRole('button',{name:'LEGACY-001',exact:true}).count(),0);
  await page.getByRole('button',{name:'MSK-2026-001',exact:true}).click();await page.getByRole('dialog',{name:'Receivable history'}).waitFor();
  await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:'Export',exact:true}).click();assert.equal(await page.evaluate(()=>window.exported.length),1);
  await page.getByLabel('Search receivables').fill('');await page.getByLabel('Receivable status').selectOption('unverified');await page.getByRole('button',{name:'LEGACY-001',exact:true}).waitFor();
  await page.screenshot({path:path.join(output,`${width}.png`),fullPage:true});await page.close();
 }
 const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/?error`);await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('button',{name:'Export',exact:true}).isDisabled(),true);await page.close();
 console.log(`PASS real receivables register: 360/390/1280px, filters, debtor contact, source/history, scoped export, excluded legacy totals and permission error. Screenshots ${output}`);
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
