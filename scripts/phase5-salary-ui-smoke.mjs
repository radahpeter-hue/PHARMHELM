// Actual salary payment component, isolated SDK/services. No live reads or postings.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,writeFile,copyFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const output=await mkdtemp(path.join(tmpdir(),'phase5-salary-ui-'));
const stubs={
 firebase:'export const db={};',
 date:"export const getDateKeyForTimezone=()=> '2026-10-22';",
 sdk:`const snap=(id,data)=>({id,exists:()=>true,data:()=>data});const ref=(args)=>({path:[args[0]?.path,...args.slice(1)].filter(Boolean).join('/')});export const doc=(...args)=>ref(args);export const collection=(...args)=>ref(args);export const query=(ref)=>ref;export const where=(...args)=>args;export const serverTimestamp=()=>({});export const runTransaction=()=>{throw new Error('Unexpected live transaction');};export const onSnapshot=(ref,cb)=>{if(ref.path.endsWith('state/current'))cb(snap('current',{outstandingUGX:38000,paidUGX:0,voided:false}));else if(ref.path==='finance_payment_accounts')cb({docs:location.search==='?no-account'?[]:[snap('test_bank',{accountId:'bank',name:'Verified Masaka Bank',kind:'BANK',branchId:'masaka',salaryEligible:true,initialized:true,active:true,balanceUGX:location.search==='?insufficient'?1000:60000})]});else if(ref.path.includes('/opening/'))cb({exists:()=>false});else cb({docs:[]});return()=>{};};`,
 welfare:`export async function settleWelfare(input){window.welfareCalls=window.welfareCalls||[];window.welfareCalls.push(input);return {replay:false};}`,
 payment:`export {validateSalarySettlement} from '${path.join(process.cwd(),'src/services/financeV2Disbursement.ts')}';export async function settleSalary(input){window.paymentCalls=window.paymentCalls||[];window.paymentCalls.push(input);await new Promise(r=>setTimeout(r,100));if(location.search==='?retry'&&window.paymentCalls.length===1)throw new Error('Network response lost. Retry with same payment reference.');return {replay:false};}export async function registerSalaryFundingAccount(input){window.registeredAccount=input;}`
};
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {SalarySettlementPanel} from './src/modules/hr/components/SalarySettlementPanel';createRoot(document.getElementById('root')).render(<SalarySettlementPanel payroll={{id:'test_employee_2026-10',staff_name:'Employee acceptance',period:'2026-10',branch_id:'masaka',amount_requested:10000}} welfareKind={location.search==='?benefit'?'BENEFIT':undefined} profile={{tenantId:'test',uid:'finance',assigned_branches:['masaka']}} onClose={()=>{}}/>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,format:'iife',outfile:path.join(output,'app.js'),plugins:[{name:'isolated-salary-ui',setup(b){
 b.onResolve({filter:/\/firebase$/},()=>({path:'firebase',namespace:'stub'}));
 b.onResolve({filter:/^firebase\/firestore$/},()=>({path:'sdk',namespace:'stub'}));
 b.onResolve({filter:/consumptionService$/},()=>({path:'date',namespace:'stub'}));
 b.onResolve({filter:/financeV2Disbursement$/},()=>({path:'payment',namespace:'stub'}));
 b.onResolve({filter:/hrWelfareSettlement$/},()=>({path:'welfare',namespace:'stub'}));
 b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path],loader:'js',resolveDir:process.cwd()}));
}}]});
const css=(await readdir('dist/assets')).find(n=>n.endsWith('.css'));assert.ok(css);await copyFile(path.join('dist/assets',css),path.join(output,'style.css'));
await writeFile(path.join(output,'index.html'),'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="style.css"></head><body><div id="root"></div><script src="app.js"></script></body></html>');
const server=createServer(async(req,res)=>{const pathname=req.url.split('?')[0],name=pathname==='/'?'index.html':pathname.slice(1);if(!['index.html','style.css','app.js'].includes(name)){res.statusCode=404;res.end();return;}res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(await readFile(path.join(output,name)));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
const open=async(page,scenario='')=>{await page.goto(`http://127.0.0.1:${server.address().port}/${scenario}`);await page.getByLabel('Salary payment (UGX)',{exact:true}).waitFor();};
const fill=async page=>{await page.getByLabel('Funding account',{exact:true}).selectOption('bank');await page.getByLabel('Salary payment (UGX)',{exact:true}).fill('10000');await page.getByLabel('External charge (UGX)',{exact:true}).fill('100');await page.getByLabel('Payment reference',{exact:true}).fill('BANK-001');await page.getByLabel('Verified recipient details',{exact:true}).fill('Verified employee bank 00123');};
try{
 browser=await chromium.launch({headless:true});
 for(const width of [360,390,1280]){
  const page=await browser.newPage({viewport:{width,height:844}});await open(page);await fill(page);
  await page.getByRole('button',{name:'Preview settlement',exact:true}).click();
  await page.getByText('Remaining salary payable: UGX 28,000.',{exact:true}).waitFor();
  await page.getByText('Separate charge expense: UGX 100.',{exact:true}).waitFor();
  const confirm=page.getByRole('button',{name:'Confirm verified payment',exact:true});await confirm.scrollIntoViewIfNeeded();const box=await confirm.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1,'Confirm payment must fit the phone viewport');
  await page.screenshot({path:path.join(output,`salary-${width}.png`),fullPage:true});
  await confirm.click();await page.waitForFunction(()=>window.paymentCalls?.length===1);assert.equal(await page.evaluate(()=>window.paymentCalls[0].amountUGX),10000);assert.equal(await page.evaluate(()=>window.paymentCalls[0].chargeUGX),100);await page.close();
 }
 for(const scenario of ['?insufficient','?no-account']){
  const page=await browser.newPage({viewport:{width:390,height:844}});await open(page,scenario);
  if(scenario==='?insufficient')await fill(page);else{await page.getByLabel('Salary payment (UGX)',{exact:true}).fill('10000');await page.getByLabel('Payment reference',{exact:true}).fill('BANK-001');await page.getByLabel('Verified recipient details',{exact:true}).fill('Verified recipient');}
  await page.getByRole('button',{name:'Preview settlement',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('button',{name:'Confirm verified payment',exact:true}).count(),0);assert.equal(await page.evaluate(()=>window.paymentCalls?.length||0),0);await page.close();
 }
 const retry=await browser.newPage({viewport:{width:390,height:844}});await open(retry,'?retry');await fill(retry);await retry.getByRole('button',{name:'Preview settlement',exact:true}).click();await retry.getByRole('button',{name:'Confirm verified payment',exact:true}).click();await retry.getByRole('alert').filter({hasText:'Network response lost'}).waitFor();await retry.getByRole('button',{name:'Confirm verified payment',exact:true}).click();await retry.waitForFunction(()=>window.paymentCalls?.length===2);assert.equal(await retry.evaluate(()=>window.paymentCalls[0].requestId===window.paymentCalls[1].requestId),true);await retry.close();
 const registration=await browser.newPage({viewport:{width:390,height:844}});await open(registration,'?no-account');await registration.getByText('Register a zero-opening funding account',{exact:true}).click();await registration.getByLabel('Account ID',{exact:true}).fill('masaka_mtn');await registration.getByLabel('Account name',{exact:true}).fill('Masaka MTN salary');await registration.getByLabel('Type',{exact:true}).selectOption('MTN_MOBILE_MONEY');await registration.getByLabel('Reconciliation reference',{exact:true}).fill('Verified zero opening');await registration.getByRole('button',{name:'Register account',exact:true}).click();await registration.waitForFunction(()=>Boolean(window.registeredAccount));assert.equal(await registration.evaluate(()=>window.registeredAccount.openingBalanceUGX),0);await registration.close();
 const benefit=await browser.newPage({viewport:{width:390,height:844}});await benefit.goto(`http://127.0.0.1:${server.address().port}/?benefit`);
 await benefit.getByLabel('Funding account',{exact:true}).selectOption('bank');await benefit.getByLabel('Welfare benefit payment (UGX)',{exact:true}).fill('10000');await benefit.getByLabel('External charge (UGX)',{exact:true}).fill('100');await benefit.getByLabel('Payment reference',{exact:true}).fill('BENEFIT-001');await benefit.getByLabel('Verified recipient details',{exact:true}).fill('Verified employee recipient');await benefit.getByRole('button',{name:'Preview settlement',exact:true}).click();await benefit.getByText('Remaining obligation: UGX 28,000.',{exact:true}).waitFor();await benefit.getByRole('button',{name:'Confirm verified payment',exact:true}).click();await benefit.waitForFunction(()=>window.welfareCalls?.length===1);assert.equal(await benefit.evaluate(()=>window.welfareCalls[0].kind),'BENEFIT');assert.equal(await benefit.evaluate(()=>window.welfareCalls[0].amountUGX),10000);await benefit.close();
 console.log(`Salary UI PASS: 360/390/1280, preview, separate fees, insufficient funds, missing accounts, exact retry and zero-opening registration. Screenshots: ${output}`);
}catch(error){if(browser){let index=0;for(const context of browser.contexts())for(const page of context.pages())await page.screenshot({path:path.join(output,`failed-${index++}.png`),fullPage:true}).catch(()=>{});}throw error;}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
