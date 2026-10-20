// Real management ledger, account registration and payment modal; all services isolated.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtemp,readFile,writeFile,copyFile,readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const output=await mkdtemp(path.join(tmpdir(),'management-payment-ui-'));
const stubs={
 auth:`export const useAuth=()=>({profile:{tenantId:'test',uid:'finance',fullName:'Finance Tester'},hasPermission:()=>true});`,
 firebase:'export const db={},auth={},storage={},googleProvider={};export const registerAuthUser=()=>{};',
 firestoreService:'export const firestoreService={};',
 sdk:`const day=new Date().toISOString().slice(0,10);const expense={tenantId:'test',source:'procurement_cash_grn',sourceType:'procurement',invoiceId:'invoice',grnId:'grn_test',invoiceRef:'AVN161026001234',amount:38000,originalAmount:38000,paidAmountUGX:0,status:'draft',category:'Procurement & Inventory',department:'Masaka',expense_date:day,date:day,description:'Supplier invoice payment draft',created_at:day};const invoice={tenantId:'test',grnId:'grn_test',invoiceValue:38000,paidAmountUGX:0,invoiceRef:'AVN161026001234',grnRef:'GRN-TEST',supplierName:'Aiveen Pharmacy'};const accounts=()=>location.search==='?no-account'?[]:[{id:'test_management_petty_cash',tenantId:'test',accountId:'management_petty_cash',name:'Management Petty Cash',kind:'petty_cash',currency:'UGX',initialized:true,balanceUGX:location.search==='?insufficient'?1000:60000,reconciliationReference:'Verified opening count'}];const snapshot=(id,data)=>({id,exists:()=>true,data:()=>data});export const collection=(db,path)=>({path});export const doc=(db,path,id)=>({path,id});export const where=(...args)=>args;export const query=(ref,...args)=>ref;export const orderBy=(...args)=>args;export const getDocs=async ref=>({docs:ref.path==='management_expenses'?[snapshot('draft',expense)]:ref.path==='petty_cash_ledger'?[snapshot('opening',{tenantId:'test',type:'incoming',amount:60000})]:[],size:0});export const getDoc=async ref=>snapshot(ref.id,ref.path==='system_settings'?{tenantId:'test',managementCashSettlementV1:location.search!=='?unreleased'}:ref.path==='invoices'?invoice:expense);export const onSnapshot=(ref,cb)=>{cb({docs:accounts().map(a=>snapshot(a.id,a))});return()=>{};};export const Timestamp={now:()=>({toDate:()=>new Date()})};export const writeBatch=()=>{throw new Error('Unexpected live batch');};export const addDoc=()=>{throw new Error('Unexpected live add');};export const updateDoc=()=>{throw new Error('Unexpected live update');};export const runTransaction=()=>{throw new Error('Unexpected live transaction');};`,
 settlement:`export async function settleCashGrnDraft(input){window.paymentCalls=window.paymentCalls||[];window.paymentCalls.push(input);await new Promise(r=>setTimeout(r,100));if(location.search==='?retry'&&window.paymentCalls.length===1)throw new Error('Network response lost. Retry uses the same reference.');return {remainingUGX:38000-input.amountUGX};}`,
 registration:`export async function registerManagementPaymentAccount(input){window.registeredAccount=input;return {openingBalanceUGX:60000,openingEntryCount:22};}`,
 export:'export const exportRecordsToExcel=()=>{};'
};
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ManagementExpenseLedger} from './src/pages/finance/management/ManagementExpenseLedger';createRoot(document.getElementById('root')).render(<main className="p-3 text-white"><ManagementExpenseLedger/></main>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,format:'iife',outfile:path.join(output,'app.js'),plugins:[{name:'isolated-payment',setup(b){
 b.onResolve({filter:/AuthContext$/},()=>({path:'auth',namespace:'stub'}));b.onResolve({filter:/\/firebase$/},()=>({path:'firebase',namespace:'stub'}));b.onResolve({filter:/services\/firestore$/},()=>({path:'firestoreService',namespace:'stub'}));
 b.onResolve({filter:/^firebase\/firestore$/},args=>args.importer.includes('/components/finance/')||args.importer.endsWith('/ManagementExpenseLedger.tsx')?{path:'sdk',namespace:'stub'}:undefined);
 b.onResolve({filter:/cashGrnSettlementService$/},()=>({path:'settlement',namespace:'stub'}));b.onResolve({filter:/managementPaymentAccountService$/},()=>({path:'registration',namespace:'stub'}));b.onResolve({filter:/utils\/excelExport$/},()=>({path:'export',namespace:'stub'}));
 b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path],loader:'js'}));
}}]});
const css=(await readdir('dist/assets')).find(n=>n.endsWith('.css'));assert.ok(css);await copyFile(path.join('dist/assets',css),path.join(output,'style.css'));
await writeFile(path.join(output,'index.html'),'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="style.css"></head><body><div id="root"></div><script src="app.js"></script></body></html>');
const server=createServer(async(req,res)=>{const pathname=req.url.split('?')[0],name=pathname==='/'?'index.html':pathname.slice(1);if(!['index.html','style.css','app.js'].includes(name)){res.statusCode=404;res.end();return;}res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(await readFile(path.join(output,name)));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
const open=async(page,scenario='')=>{await page.goto(`http://127.0.0.1:${server.address().port}/${scenario}`);const button=page.getByRole('button',{name:'Supplier invoice & payments',exact:true});if(await button.isVisible())await button.click();else await page.getByRole('button',{name:'Review Draft',exact:true}).click();await page.getByLabel('Supplier payment amount',{exact:true}).waitFor();await page.getByLabel('Supplier payment reference',{exact:true}).fill('VOUCHER-TEST-001');};
try{
 browser=await chromium.launch({headless:true});
 for(const width of [360,390,1280]){
  const page=await browser.newPage({viewport:{width,height:844}});await open(page);
  await page.getByLabel('Supplier payment account',{exact:true}).selectOption('management_petty_cash');
  await page.getByText('Available balance: UGX 60,000',{exact:true}).waitFor();
  const amount=page.getByLabel('Supplier payment amount',{exact:true});await amount.fill('10000');
  await page.getByRole('button',{name:'Review supplier payment',exact:true}).click();
  await page.getByText('Outstanding after payment: UGX 28,000.',{exact:false}).waitFor();
  const confirm=page.getByRole('button',{name:'Record supplier payment',exact:true});await confirm.scrollIntoViewIfNeeded();
  for(const locator of [amount,confirm]){await locator.scrollIntoViewIfNeeded();const box=await locator.boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=width,'payment fields fit phone width');}
  await page.screenshot({path:path.join(output,`payment-${width}.png`),fullPage:true});
  const overflow=await page.locator('body').evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.right>innerWidth+1;}).map(e=>({tag:e.tagName,text:e.textContent?.slice(0,80),class:e.className,right:e.getBoundingClientRect().right})).slice(0,12));
  assert.equal(await page.locator('body').evaluate(e=>e.scrollWidth<=innerWidth),true,JSON.stringify(overflow));
  assert.notEqual(await amount.evaluate(e=>getComputedStyle(e).color),'rgb(255, 255, 255)');
  await confirm.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,`payment-${width}.png`),fullPage:true});
  await confirm.dblclick();await page.waitForFunction(()=>window.paymentCalls?.length===1);
  assert.equal(await page.evaluate(()=>window.paymentCalls[0].amountUGX),10000);await page.getByRole('heading',{name:'Supplier invoice payment',exact:true}).waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>window.paymentCalls.length),1);await page.close();console.log(`Supplier partial payment confirmation and double-click guard passed at ${width}px`);
 }
 for(const scenario of ['?insufficient','?no-account']){
  const page=await browser.newPage({viewport:{width:390,height:844}});await open(page,scenario);
  if(scenario==='?insufficient')await page.getByLabel('Supplier payment account',{exact:true}).selectOption('management_petty_cash');
  assert.equal(await page.getByRole('button',{name:'Review supplier payment',exact:true}).isEnabled(),false);await page.close();console.log(`Payment disabled for ${scenario}`);
 }
 const retry=await browser.newPage({viewport:{width:390,height:844}});await open(retry,'?retry');await retry.getByLabel('Supplier payment account',{exact:true}).selectOption('management_petty_cash');await retry.getByRole('button',{name:'Review supplier payment',exact:true}).click();await retry.getByRole('button',{name:'Record supplier payment',exact:true}).click();await retry.getByRole('alert').filter({hasText:'Network response lost'}).waitFor();await retry.getByRole('button',{name:'Record supplier payment',exact:true}).click();await retry.waitForFunction(()=>window.paymentCalls?.length===2);assert.equal(await retry.evaluate(()=>window.paymentCalls[0].requestId===window.paymentCalls[1].requestId),true);await retry.close();
 const unreleased=await browser.newPage({viewport:{width:390,height:844}});await unreleased.goto(`http://127.0.0.1:${server.address().port}/?unreleased`);await unreleased.getByRole('button',{name:'Supplier invoice & payments',exact:true}).click();await unreleased.getByRole('alert').filter({hasText:'release activation'}).waitFor();assert.equal(await unreleased.getByRole('button',{name:'Review supplier payment',exact:true}).count(),0);await unreleased.close();
 const registration=await browser.newPage({viewport:{width:390,height:844}});await registration.goto(`http://127.0.0.1:${server.address().port}/?no-account`);await registration.getByText('Register a missing account',{exact:true}).click();await registration.getByLabel('Reconciliation reference',{exact:true}).fill('Checked physical cash count');await registration.getByRole('button',{name:'Confirm opening reconciliation',exact:true}).scrollIntoViewIfNeeded();await registration.screenshot({path:path.join(output,'opening-390.png'),fullPage:true});await registration.getByRole('button',{name:'Confirm opening reconciliation',exact:true}).click();await registration.waitForFunction(()=>Boolean(window.registeredAccount));await registration.close();
 console.log(`Payment retry keeps its request ID; missing accounts require explicit reconciliation. Screenshots: ${output}`);
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
