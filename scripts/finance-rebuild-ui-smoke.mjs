// Actual React Finance/Welfare components, isolated in-memory fixtures. No live backend writes.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(path.join(process.cwd(), 'package.json'));
const { build } = require('esbuild');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = await mkdtemp(path.join(tmpdir(), 'finance-rebuild-ui-'));
const auth = `const role=new URLSearchParams(location.search).get('role')||'owner';
const branches=[{id:'masaka',name:'Masaka Branch',tenantId:'test'},{id:'other',name:'Other Branch',tenantId:'test'}];
const profile={id:'tester',uid:'tester',tenantId:'test',role,full_name:'Finance Tester',assigned_branches:['masaka'],active:true};
const value={profile,activeBranchId:'masaka',activeBranch:branches[0],assignedBranches:role==='cashier'?[branches[0]]:branches,hasPermission:()=>role!=='dispenser'};
export const useAuth=()=>value;`;
const fixture = `const day=new Date().toISOString().slice(0,10);const old=new Date(day+'T12:00:00Z');old.setUTCDate(1);old.setUTCMonth(old.getUTCMonth()-1);old.setUTCDate(10);const oldDay=old.toISOString().slice(0,10);
const records={
 system_settings:[{id:'settings',tenantId:'test',taxEngineEnabled:false}],
 staff:[{id:'staff-one',uid:'staff-one',tenantId:'test',staff_code:'MP-001',full_name:'Alex Example',active:true,status:'active',branch_id:'masaka'}, {id:'staff-two',uid:'staff-two',tenantId:'test',staff_code:'MP-002',full_name:'Alex Example',active:true,status:'active',branch_id:'masaka'}, {id:'inactive',tenantId:'test',full_name:'Inactive Employee',active:false,status:'inactive',branch_id:'masaka'}, {id:'cross-tenant',tenantId:'other-tenant',full_name:'Other Tenant Employee',active:true,status:'active',branch_id:'masaka'}],
 branches:[{id:'masaka',name:'Masaka Branch',tenantId:'test'},{id:'other',name:'Other Branch',tenantId:'test'}],
 sales:[{id:'sale',tenantId:'test',branchId:'masaka',status:'completed',paymentMethod:'cash',total:500000,totalAmount:500000,timestamp:day+'T10:00:00Z',items:[]},{id:'other-sale',tenantId:'test',branchId:'other',status:'completed',paymentMethod:'cash',total:300000,totalAmount:300000,timestamp:day+'T10:00:00Z',items:[]}],
 branch_expenses:[{id:'historic-salary',tenantId:'test',branch_id:'masaka',expense_date:day,category:'salaries',description:'Historical salary fixture',amount_ugx:1000,payment_method:'Petty Cash',status:'approved'},{id:'older-allowance',tenantId:'test',branch_id:'masaka',expense_date:oldDay,category:'allowances',description:'Historic allowance fixture',amount_ugx:1200,status:'approved',issued_to:'Historical Recipient'}],
 petty_cash_issues:[{id:'incoming',tenantId:'test',branch_id:'masaka',issue_date:day,amount:10000,reference_number:'CURRENT-INCOMING',status:'issued'},{id:'old-issue',tenantId:'test',branch_id:'masaka',issue_date:oldDay,amount:7000,reference_number:'PREVIOUS-INCOMING',status:'issued'},{id:'received',tenantId:'test',branch_id:'masaka',issue_date:oldDay,amount:3000,reference_number:'RECEIVED-HISTORY',status:'received'}],
 petty_cash_requisitions:[{id:'req',tenantId:'test',branch_id:'masaka',requisition_date:day,amount_requested:11000,reason:'Current request',status:'pending'},{id:'old-req',tenantId:'test',branch_id:'masaka',requisition_date:oldDay,amount_requested:22000,reason:'Previous month request',status:'received'}],
 management_expenses:[{id:'hq',tenantId:'test',expense_date:day,date:day,category:'utilities',description:'HQ outflow fixture',amount:2000,amount_ugx:2000,status:'issued',department:'HQ',logged_by:'tester'}],
 petty_cash_ledger:[{id:'opening',tenantId:'test',type:'incoming',amount:100000,date:day,source:'Opening'}]
};
window.fixtureDates={day,oldDay};window.fixtureRecords=records;window.financeWrites=[];window.subscriptions=[];
const watchers=[];
export const rows=name=>(records[name]||[]).filter(r=>r.tenantId==='test');
const refresh=name=>watchers.filter(w=>w.name===name).forEach(w=>w.cb(rows(name)));
export const firestoreService={
 getCollection:async(name)=>rows(name),
 subscribeToCollection:(name,tenant,cb)=>{window.subscriptions.push({name,tenant});const w={name,cb};watchers.push(w);cb(rows(name));return()=>{const i=watchers.indexOf(w);if(i>=0)watchers.splice(i,1);};},
 addDocument:async(name,data)=>{const id='write-'+window.financeWrites.length;window.financeWrites.push({name,data});(records[name]||=[]).push({id,...data});refresh(name);return id;},
 updateDocument:async(name,id,data)=>{window.financeWrites.push({name,id,data});Object.assign((records[name]||[]).find(r=>r.id===id),data);refresh(name);},
 deleteDocument:()=>{throw new Error('Unexpected deletion');}
};`;
const actualSdk = require.resolve('firebase/firestore');
const stubs = {
 auth, fixture,
 tenant: `export const useTenant=()=>({tenant:{id:'test',name:'Fixture Pharma',plan:'enterprise',subscriptionStatus:'active'},hasFeature:()=>true,hasModule:()=>true});`,
 firebase: `export const db={},auth={},storage={},googleProvider={};export const registerAuthUser=()=>{};`,
 sdk: `export * from ${JSON.stringify(actualSdk)};import {rows} from 'fixture-data';
 export const collection=(_db,path)=>({path});export const doc=(_db,path,id)=>({path,id});export const query=(ref,...constraints)=>({...ref,constraints});export const where=(...args)=>args;export const orderBy=(...args)=>args;
 const snap=(r)=>({id:r.id,exists:()=>!!r,data:()=>r});
 export const getDocs=async(ref)=>({docs:rows(ref.path).map(snap),size:rows(ref.path).length});export const getDoc=async(ref)=>snap(rows(ref.path).find(r=>r.id===ref.id)||{});
 export const onSnapshot=(ref,cb)=>{cb({docs:rows(ref.path).map(snap)});return()=>{};};
 export const addDoc=()=>{throw new Error('Live SDK write blocked');};export const updateDoc=addDoc,deleteDoc=addDoc,runTransaction=addDoc,writeBatch=addDoc;`,
 exporter: `export const exportRecordsToExcel=async(...args)=>{window.exported=args;};`
};
await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import Finance from './src/pages/Finance';import Welfare from './src/pages/Welfare';import {Toaster} from 'sonner';const welfare=new URLSearchParams(location.search).get('surface')==='welfare';createRoot(document.getElementById('root')).render(<main className="p-3 bg-zinc-50 text-zinc-900 min-w-0 min-h-screen"><Toaster mobileOffset={8}/><>{welfare?<Welfare/>:<Finance/>}</></main>);`, loader:'tsx', resolveDir:process.cwd() }, bundle:true, format:'iife', outfile:path.join(output,'app.js'), plugins:[{name:'isolated-finance',setup(b){
 b.onResolve({filter:/AuthContext$/},()=>({path:'auth',namespace:'stub'}));
 b.onResolve({filter:/TenantContext$/},()=>({path:'tenant',namespace:'stub'}));
 b.onResolve({filter:/\/firebase$/},()=>({path:'firebase',namespace:'stub'}));
 b.onResolve({filter:/services\/firestore$/},()=>({path:'fixture',namespace:'stub'}));
 b.onResolve({filter:/^fixture-data$/},()=>({path:'fixture',namespace:'stub'}));
 b.onResolve({filter:/^firebase\/firestore$/},()=>({path:'sdk',namespace:'stub'}));
 b.onResolve({filter:/utils\/excelExport$/},()=>({path:'exporter',namespace:'stub'}));
 b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path],loader:'js',resolveDir:process.cwd()}));
}}] });
const css=(await readdir('dist/assets')).find(n=>n.endsWith('.css'));assert.ok(css);await writeFile(path.join(output,'style.css'),(await readFile(path.join('dist/assets',css),'utf8')).replace(/@import"[^"]*";/g,''));
await writeFile(path.join(output,'index.html'),'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="style.css"></head><body><div id="root"></div><script src="app.js"></script></body></html>');
const server=createServer(async(req,res)=>{const pathname=req.url.split('?')[0],name=pathname==='/'?'index.html':pathname.slice(1);if(!['index.html','style.css','app.js'].includes(name)){res.statusCode=404;res.end();return;}res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(await readFile(path.join(output,name)));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;const blocked=[];const errors=[];
const open=async(width=390,query='')=>{const page=await browser.newPage({viewport:{width,height:900}});page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>route.request().url().startsWith(`http://127.0.0.1:${server.address().port}/`)?route.continue():(blocked.push(route.request().url()),route.abort()));await page.goto(`http://127.0.0.1:${server.address().port}/${query}`);return page;};
const fit=async(page,label)=>{const excess=await page.locator('body').evaluate(e=>e.scrollWidth-innerWidth);if(excess>1){await page.screenshot({path:path.join(output,'overflow.png'),fullPage:true});console.log(await page.locator('body').evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.right>innerWidth+1&&getComputedStyle(e).overflowX!=='auto';}).slice(0,12).map(e=>({tag:e.tagName,text:e.textContent?.slice(0,60),class:e.className,right:e.getBoundingClientRect().right}))));}assert.ok(excess<=1,`${label}: body overflow ${excess}px; ${output}`);};
try {
 const launch={headless:true};if(process.env.CHROMIUM_EXECUTABLE){launch.executablePath=process.env.CHROMIUM_EXECUTABLE;launch.args=['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'];}
 browser=await chromium.launch(launch);
 for(const width of [360,390,1280]){
  const page=await open(width,'?role=Finance%20Head');
  await page.getByRole('button',{name:'Expense Log',exact:true}).click();
  await page.getByText('Historical salary fixture',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Log Expense',exact:true}).click();
  const form=page.locator('form');assert.equal(await form.locator('option[value="salaries"]').count(),0);assert.equal(await form.locator('option[value="allowances"]').count(),1);
  await form.locator('input[type="number"]').fill('1500');await form.getByPlaceholder('What was this for?').fill('Issued recipient fixture');
  if(process.env.FINANCE_LEVEL==='2'){
   await page.getByLabel('Recipient type',{exact:true}).selectOption('external');
  }
  await page.getByLabel('Issued To',{exact:true}).fill('External Vendor Example');
  await page.getByRole('button',{name:'Save Expense',exact:true}).click();
  await page.getByText('External Vendor Example',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.financeWrites.at(-1).data.issued_to),'External Vendor Example');
  await fit(page,'Expense history '+width);
  await page.getByRole('button',{name:'Petty Cash',exact:true}).click();
  const dates=await page.evaluate(()=>window.fixtureDates);
  assert.equal(await page.getByLabel('Petty cash requisitions to',{exact:true}).inputValue(),dates.day);
  assert.equal(await page.getByText('22,000',{exact:false}).count(),0);
  await page.getByRole('button',{name:'Previous Month',exact:true}).click();await page.getByText('UGX 22,000',{exact:true}).waitFor();
  await page.getByRole('button',{name:'All History',exact:true}).click();await page.getByText('UGX 11,000',{exact:true}).waitFor();await page.getByText('UGX 22,000',{exact:true}).waitFor();
  await page.getByLabel('Incoming petty cash from',{exact:true}).fill(dates.oldDay);await page.getByLabel('Incoming petty cash to',{exact:true}).fill(dates.oldDay);
  await page.getByText('Ref: PREVIOUS-INCOMING',{exact:true}).waitFor();assert.equal(await page.getByText('Ref: CURRENT-INCOMING',{exact:true}).count(),0);
  await page.getByLabel('Include received cash',{exact:true}).check();await page.getByText('Ref: RECEIVED-HISTORY',{exact:true}).waitFor();
  await fit(page,'Petty cash '+width);await page.screenshot({path:path.join(output,`petty-${width}.png`),fullPage:true});
  await page.getByRole('button',{name:'Management',exact:true}).click();
  await page.getByRole('button',{name:'Management Cash Outflows',exact:true}).click();await page.getByRole('heading',{name:'Management Cash Outflows',exact:true}).waitFor();await page.getByText('HQ outflow fixture',{exact:true}).filter({visible:true}).first().waitFor();
  await fit(page,'Management '+width);
  await page.getByRole('button',{name:'Global Cash Outflows',exact:true}).click();await page.getByRole('heading',{name:'Global Cash Outflows',exact:true}).waitFor();await fit(page,'Global '+width);
  await page.getByRole('button',{name:'Branch P&L',exact:true}).click();await page.getByRole('heading',{name:'Branch P&L',exact:true}).waitFor();
  await page.getByLabel('P&L branch',{exact:true}).selectOption('masaka');
  const revenue=page.getByText('Total Sales Revenue',{exact:true}).locator('..');await revenue.getByText('UGX 500,000',{exact:true}).waitFor();
  await page.getByLabel('P&L period',{exact:true}).selectOption('annual');await fit(page,'Branch P&L '+width);
  await page.getByRole('button',{name:'Consolidated Organisation P&L',exact:true}).click();await page.getByRole('heading',{name:'Consolidated Organisation P&L',exact:true}).waitFor();await page.getByText('Total Sales Revenue',{exact:true}).locator('..').getByText('UGX 800,000',{exact:true}).waitFor();
  await fit(page,'Consolidated P&L '+width);await page.screenshot({path:path.join(output,`pnl-${width}.png`),fullPage:true});await page.close();
  console.log(`Level 1 navigation, expense persistence/history, dates and P&L pass at ${width}px`);
 }
 for(const role of ['dispenser','owner']){
  const page=await open(390,`?surface=welfare&role=${role}`);await page.getByRole('button',{name:'Welfare Log',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Admin Welfare',exact:true}).count(),role==='owner'?1:0);await fit(page,'Welfare '+role);await page.close();
 }
 const cashier=await open(390,'?role=cashier');assert.equal(await cashier.getByRole('button',{name:'Management',exact:true}).count(),0);await cashier.close();
 assert.deepEqual(blocked,[],'No backend requests permitted');assert.deepEqual(errors,[],'No React/runtime errors');
 console.log(`Isolated role and responsive checks passed. Screenshots: ${output}`);
} finally {if(browser)await browser.close();await new Promise(r=>server.close(r));}
