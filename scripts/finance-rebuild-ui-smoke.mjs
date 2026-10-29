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
const fixture = `const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Kampala',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());const old=new Date(day+'T12:00:00Z');old.setUTCDate(1);old.setUTCMonth(old.getUTCMonth()-1);old.setUTCDate(10);const oldDay=old.toISOString().slice(0,10);
const records={
 system_settings:[{id:'settings',tenantId:'test',taxEngineEnabled:false}],
 staff:[{id:'staff-one',uid:'staff-one',tenantId:'test',staff_code:'MP-001',full_name:'Alex Example',active:true,status:'active',branch_id:'masaka'}, {id:'staff-two',uid:'staff-two',tenantId:'test',staff_code:'MP-002',full_name:'Alex Example',active:true,status:'active',branch_id:'masaka'}, {id:'inactive',tenantId:'test',full_name:'Inactive Employee',active:false,status:'inactive',branch_id:'masaka'}, {id:'cross-tenant',tenantId:'other-tenant',full_name:'Other Tenant Employee',active:true,status:'active',branch_id:'masaka'}],
 branches:[{id:'masaka',name:'Masaka Branch',tenantId:'test',shifts:{dayShift:{enabled:true,startTime:'07:30',endTime:'17:00'},eveningShift:{enabled:true,startTime:'17:00',endTime:'22:00'}}},{id:'other',name:'Other Branch',tenantId:'test'}],
 sales:[{id:'sale',tenantId:'test',branchId:'masaka',status:'completed',paymentMethod:'cash',total:500000,totalAmount:500000,timestamp:day+'T10:00:00Z',items:[]},{id:'other-sale',tenantId:'test',branchId:'other',status:'completed',paymentMethod:'cash',total:300000,totalAmount:300000,timestamp:day+'T10:00:00Z',items:[]}],
 branch_expenses:[{id:'historic-salary',tenantId:'test',branch_id:'masaka',expense_date:day,category:'salaries',description:'Historical salary fixture',amount_ugx:1000,payment_method:'Petty Cash',status:'approved'},{id:'older-allowance',tenantId:'test',branch_id:'masaka',expense_date:oldDay,category:'allowances',description:'Historic allowance fixture',amount_ugx:1200,status:'approved',issued_to:'Historical Recipient'}],
 petty_cash_issues:[{id:'incoming',tenantId:'test',branch_id:'masaka',issue_date:day,amount:10000,reference_number:'CURRENT-INCOMING',status:'issued'},{id:'old-issue',tenantId:'test',branch_id:'masaka',issue_date:oldDay,amount:7000,reference_number:'PREVIOUS-INCOMING',status:'issued'},{id:'received',tenantId:'test',branch_id:'masaka',issue_date:oldDay,amount:3000,reference_number:'RECEIVED-HISTORY',status:'received'}],
 petty_cash_requisitions:[{id:'req',tenantId:'test',branch_id:'masaka',requisition_date:day,amount_requested:11000,reason:'Current request',status:'pending'},{id:'old-req',tenantId:'test',branch_id:'masaka',requisition_date:oldDay,amount_requested:22000,reason:'Previous month request',status:'received'}],
 management_expenses:[{id:'hq',tenantId:'test',expense_date:day,date:day,category:'utilities',description:'HQ outflow fixture',amount:2000,amount_ugx:2000,status:'issued',department:'HQ',logged_by:'tester'}],
 petty_cash_ledger:[{id:'opening',tenantId:'test',type:'incoming',amount:100000,date:day,source:'Opening'}]
};
records.eod_reconciliations=[{id:'today-eod',tenantId:'test',branch_id:'masaka',reconciliation_date:day,cash_actual:500000,cash_expected:500000,total_actual:500000,total_expected:500000,total_variance:0,logged_by:'staff-one',status:'submitted'},{id:'old-eod',tenantId:'test',branch_id:'masaka',reconciliation_date:oldDay,total_actual:500000,total_expected:500000}];
const eodMode=new URLSearchParams(location.search).get('eod');if(eodMode){const amount=eodMode==='float'?0.1+0.2:0.3001;records.sales[0].total=amount;records.sales[0].totalAmount=amount;}
records.sales[0].eodShift={version:1,businessDate:day,shiftId:'dayShift',shiftName:'Day Shift',startTime:'07:30',endTime:'17:00',timeZone:'Africa/Kampala'};
records.staff.push({id:'tester',uid:'tester',tenantId:'test',role:new URLSearchParams(location.search).get('role')||'owner',active:true,status:'active',assigned_branches:['masaka']});
window.fixtureDates={day,oldDay};window.fixtureRecords=records;window.financeWrites=[];window.subscriptions=[];
const watchers=[];
export const rows=name=>(records[name]||[]).filter(r=>r.tenantId==='test');
export const fixtureWrite=(name,id,data)=>{window.financeWrites.push({name,id,data});(records[name]||=[]).push({id,...data});refresh(name);};
const refresh=name=>watchers.filter(w=>w.name===name).forEach(w=>w.cb(rows(name)));
export const firestoreService={
 getCollection:async(name)=>rows(name),
 subscribeToCollection:(name,tenant,cb)=>{window.subscriptions.push({name,tenant});const w={name,cb};watchers.push(w);cb(rows(name));return()=>{const i=watchers.indexOf(w);if(i>=0)watchers.splice(i,1);};},
 addDocument:async(name,data)=>{if(name==='eod_reconciliations'&&new URLSearchParams(location.search).has('slowEod'))await new Promise(r=>setTimeout(r,350));const id='write-'+window.financeWrites.length;window.financeWrites.push({name,data});(records[name]||=[]).push({id,...data});refresh(name);return id;},
 updateDocument:async(name,id,data)=>{window.financeWrites.push({name,id,data});Object.assign((records[name]||[]).find(r=>r.id===id),data);refresh(name);},
 deleteDocument:()=>{throw new Error('Unexpected deletion');}
};`;
const actualSdk = require.resolve('firebase/firestore');
const stubs = {
 auth, fixture,
 tenant: `export const useTenant=()=>({tenant:{id:'test',name:'Fixture Pharma',plan:'enterprise',subscriptionStatus:'active'},hasFeature:()=>true,hasModule:()=>true});`,
 firebase: `export const db={},auth={},storage={},googleProvider={};export const registerAuthUser=()=>{};`,
 sdk: `export * from ${JSON.stringify(actualSdk)};import {rows,fixtureWrite} from 'fixture-data';
 export const collection=(_db,path)=>({path});export const doc=(_db,path,id)=>({path,id});export const query=(ref,...constraints)=>({...ref,constraints});export const where=(...args)=>args;export const orderBy=(...args)=>args;
 const snap=(r)=>({id:r?.id,exists:()=>!!r?.id,data:()=>r});
 export const getDocs=async(ref)=>{const found=rows(ref.path).filter(r=>(ref.constraints||[]).every(([key,op,v])=>op==='=='?r[key]===v:op==='>='?r[key]>=v:op==='<='?r[key]<=v:true));return {docs:found.map(snap),size:found.length,empty:!found.length};};export const getDoc=async(ref)=>snap(rows(ref.path).find(r=>r.id===ref.id));
 export const onSnapshot=(ref,cb)=>{cb({docs:rows(ref.path).map(snap)});return()=>{};};
 export const addDoc=()=>{throw new Error('Live SDK write blocked');};export const updateDoc=addDoc,deleteDoc=addDoc,writeBatch=addDoc;
 export const runTransaction=async(_db,fn)=>{const pending=[];const result=await fn({get:getDoc,set:(ref,data)=>pending.push({ref,data})});if(new URLSearchParams(location.search).has('slowEod'))await new Promise(r=>setTimeout(r,350));for(const {ref,data} of pending){if(ref.path==='eod_reconciliations'&&rows(ref.path).some(r=>r.id===ref.id))throw new Error('Existing audit cannot be replaced');fixtureWrite(ref.path,ref.id,data);}return result;};`,
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
  await page.getByRole('button',{name:'Download Petty cash requisitions XLSX',exact:true}).click();
  const exportedReqs=await page.evaluate(()=>window.exported);
  assert.equal(exportedReqs[0].length,2);assert.equal(exportedReqs[0][0]['Amount (UGX)'],22000);assert.equal(exportedReqs[0][1].Branch,'TOTAL');
  const csvDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Download Petty cash requisitions CSV',exact:true}).click();
  const csvFile=await csvDownload;assert.ok(csvFile.suggestedFilename().endsWith('.csv'));
  const csvContent=await readFile(await csvFile.path(),'utf8');assert.ok(csvContent.includes('22000'));assert.ok(!csvContent.includes('11000'));
  await page.getByRole('button',{name:'All History',exact:true}).click();await page.getByText('UGX 11,000',{exact:true}).waitFor();await page.getByText('UGX 22,000',{exact:true}).waitFor();
  await page.getByLabel('Incoming petty cash from',{exact:true}).fill(dates.oldDay);await page.getByLabel('Incoming petty cash to',{exact:true}).fill(dates.oldDay);
  await page.getByText('Ref: PREVIOUS-INCOMING',{exact:true}).waitFor();assert.equal(await page.getByText('Ref: CURRENT-INCOMING',{exact:true}).count(),0);
  await page.getByLabel('Include received cash',{exact:true}).check();await page.getByText('Ref: RECEIVED-HISTORY',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Download Incoming petty cash XLSX',exact:true}).click();
  const exportedIssues=await page.evaluate(()=>window.exported);assert.ok(exportedIssues[0].some(r=>r.Reference==='RECEIVED-HISTORY'));assert.ok(!exportedIssues[0].some(r=>r.Reference==='CURRENT-INCOMING'));
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

 if(process.env.FINANCE_LEVEL==='2') {
  const page=await open(390,'?role=Finance%20Head');
  await page.getByRole('button',{name:'Expense Log',exact:true}).click();
  const newExpense=async(description,category='utilities')=>{
   await page.getByRole('button',{name:'Log Expense',exact:true}).click();
   const form=page.locator('form');await form.locator('select').first().selectOption(category);
   await form.locator('input[type="number"]').fill('2000');await form.getByPlaceholder('What was this for?').fill(description);
  };
  await newExpense('Staff recipient fixture');await page.getByLabel('Recipient type',{exact:true}).selectOption('staff');
  const staffSelect=page.getByLabel('Issued To — Staff',{exact:true});
  assert.equal(await staffSelect.locator('option').filter({hasText:'Alex Example'}).count(),2);
  assert.equal(await staffSelect.locator('option[value="inactive"]').count(),0);assert.equal(await staffSelect.locator('option[value="cross-tenant"]').count(),0);
  await staffSelect.selectOption('staff-one');await page.getByRole('button',{name:'Save Expense',exact:true}).click();
  await page.getByText('Staff recipient fixture',{exact:true}).waitFor();
  const saved=await page.evaluate(()=>window.financeWrites.at(-1).data);
  assert.equal(saved.recipient_staff_id,'staff-one');assert.equal(saved.recipient_staff_code,'MP-001');assert.equal(saved.issued_to,'Alex Example');assert.equal(saved.recipient_type,'staff');
  const row=page.getByRole('row').filter({hasText:'Staff recipient fixture'});await row.getByRole('button').click();
  assert.equal(await page.getByLabel('Issued To — Staff',{exact:true}).inputValue(),'staff-one');await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await newExpense('Allowance recipient fixture','allowances');
  assert.equal(await page.getByLabel('Recipient type',{exact:true}).inputValue(),'staff');assert.equal(await page.getByLabel('Recipient type',{exact:true}).locator('option[value="external"]').count(),0);
  const before=await page.evaluate(()=>window.financeWrites.length);
  await page.locator('form').evaluate(el=>el.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  await page.getByText('Select an active employee from the authoritative staff register.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.financeWrites.length),before);
  // Bypass the hidden external option to prove the application guard still rejects it.
  await page.getByLabel('Recipient type',{exact:true}).evaluate(el=>{el.append(new Option('Forged external','external'));el.value='external';el.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.locator('form').evaluate(el=>el.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  await page.getByText('Allowances can only be issued to staff.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.financeWrites.length),before);
  await page.getByLabel('Recipient type',{exact:true}).selectOption('staff');await page.getByLabel('Issued To — Staff',{exact:true}).selectOption('staff-two');await page.screenshot({path:path.join(output,'staff-allowance-form-390.png'),fullPage:true});
  await page.getByRole('button',{name:'Save Expense',exact:true}).click();await page.getByText('Allowance recipient fixture',{exact:true}).waitFor();
  const allowance=await page.evaluate(()=>window.financeWrites.at(-1).data);assert.equal(allowance.recipient_staff_id,'staff-two');assert.equal(allowance.recipient_type,'staff');
  await page.getByText('Staff ID: MP-002',{exact:true}).scrollIntoViewIfNeeded();await fit(page,'Staff and Allowance form');await page.screenshot({path:path.join(output,'staff-allowance-390.png'),fullPage:true});await page.close();
  console.log('Staff ID/name persistence, duplicate names, edit restore and forged/missing Allowance recipient guards passed');
  for(const scenario of [{name:'match',actual:'500000',variance:0},{name:'shortage',actual:'495000',variance:-5000},{name:'over',actual:'505000',variance:5000},{name:'float',actual:'0.3',variance:0},{name:'tiny',actual:'0.3',variance:null}]){
   const query='?role=cashier'+(['float','tiny'].includes(scenario.name)?'&eod='+scenario.name:'');
   const eod=await open(390,query);await eod.getByLabel('Configured Shift',{exact:true}).selectOption('dayShift');await eod.locator('input[type="number"]').first().fill(scenario.actual);
   await eod.getByRole('button',{name:'Reveal System Totals',exact:true}).click();
   const submit=eod.getByRole('button',{name:'Submit EOD Audit Report',exact:true});
   const reason=eod.getByLabel('Variance Reason Required',{exact:true});
   if(scenario.variance===0){assert.equal(await reason.count(),0);assert.equal(await submit.isEnabled(),true);}
   else{await reason.waitFor();assert.equal(await submit.isEnabled(),false);await reason.fill('Controlled acceptance test reason');assert.equal(await submit.isEnabled(),true);}
   await eod.getByText('Grand Total',{exact:true}).scrollIntoViewIfNeeded();const varianceText=await eod.getByText('Grand Total',{exact:true}).locator('../..').innerText();
   assert.ok(varianceText.includes('Expected: UGX'));assert.ok(varianceText.includes('Declared: UGX'));assert.ok(varianceText.includes('Variance'));
   assert.equal(/(^|\s)-0(?:\s|$)/.test(varianceText),false,varianceText);
   await fit(eod,'EOD '+scenario.name);await eod.screenshot({path:path.join(output,`eod-${scenario.name}-390.png`),fullPage:true});
   await submit.click();await eod.waitForFunction(()=>window.financeWrites.some(w=>w.name==='eod_reconciliations'));
   const record=await eod.evaluate(()=>window.financeWrites.find(w=>w.name==='eod_reconciliations').data);
   if(scenario.variance!==null)assert.equal(record.total_variance,scenario.variance);else assert.ok(record.total_variance<0&&record.total_variance!==0);
   assert.equal(Object.is(record.total_variance,-0),false);await eod.close();console.log(`EOD ${scenario.name} passes UI, reason validation and saved-value checks`);
  }
  const rapid=await open(390,'?role=cashier&slowEod=1');
  await rapid.getByLabel('Configured Shift',{exact:true}).selectOption('dayShift');
  await rapid.locator('input[type="number"]').first().fill('500000');
  await rapid.getByRole('button',{name:'Reveal System Totals',exact:true}).click();
  await rapid.getByRole('button',{name:'Submit EOD Audit Report',exact:true}).evaluate(el=>{el.click();el.click();el.dispatchEvent(new MouseEvent('click',{bubbles:true}));});
  const progress=rapid.getByRole('button',{name:'Submitting EOD Audit Report…',exact:true});
  assert.equal(await progress.isDisabled(),true);
  assert.equal(await rapid.getByLabel('Configured Shift',{exact:true}).isDisabled(),true);
  await rapid.waitForFunction(()=>window.financeWrites.filter(w=>w.name==='eod_reconciliations').length===1);
  await rapid.getByRole('button',{name:'Reveal System Totals',exact:true}).waitFor();
  assert.equal(await rapid.evaluate(()=>window.financeWrites.filter(w=>w.name==='eod_reconciliations').length),1);
  await rapid.close();console.log('027 synchronous rapid clicks produce one write with visible disabled progress');
  const history=await open(390,'?role=cashier');
  await history.getByRole('heading',{name:'EOD Reconciliation Log',exact:true}).waitFor();
  assert.equal(await history.getByLabel('EOD history branch',{exact:true}).isDisabled(),true);
  await history.getByRole('button',{name:'View audit',exact:true}).first().click();
  const audit=history.getByRole('dialog',{name:'EOD audit history',exact:true});
  await audit.getByText('Historical whole-day record — shift not recorded',{exact:true}).waitFor();
  await audit.getByText('Expected',{exact:true}).waitFor();await audit.getByText('Declared',{exact:true}).waitFor();
  await fit(history,'EOD audit history');await audit.getByRole('button',{name:'Close',exact:true}).click();
  await history.getByLabel('EOD history from',{exact:true}).fill((await history.evaluate(()=>window.fixtureDates)).oldDay);
  await history.getByRole('button',{name:'Download Report',exact:true}).click();
  const auditExport=await history.evaluate(()=>window.exported);
  assert.equal(auditExport[0].length,3);assert.equal(auditExport[0][0]['Expected Total (UGX)'],500000);assert.equal(auditExport[0][0]['Declared Total (UGX)'],500000);assert.equal(auditExport[0][0].Shift,'Historical whole-day — shift not recorded');
  await history.close();console.log('029 branch-scoped history, historical dates, audit detail and shift export pass');
  const offset=await open(390,'?role=cashier');await offset.getByLabel('Configured Shift',{exact:true}).selectOption('dayShift');await offset.locator('input[type="number"]').nth(0).fill('495000');await offset.locator('input[type="number"]').nth(1).fill('5000');await offset.getByRole('button',{name:'Reveal System Totals',exact:true}).click();await offset.getByLabel('Variance Reason Required',{exact:true}).waitFor();assert.equal(await offset.getByRole('button',{name:'Submit EOD Audit Report',exact:true}).isEnabled(),false);await offset.close();
 }
 for (const role of ['IT Head','IT Support Staff','Finance Head','owner']) {
  const page=await open(390,'?role='+encodeURIComponent(role));
  await page.getByRole('button',{name:'Management',exact:true}).click();
  await page.getByRole('button',{name:'Reconciliation Inbox',exact:true}).click();
  const edit=page.getByRole('button',{name:'Correct EOD',exact:true});
  assert.equal(await edit.count(),role==='IT Head'?1:0);
  if(role==='IT Head') {
   await edit.click();const modal=page.getByRole('dialog',{name:'Correct EOD reconciliation'});
   assert.equal(await modal.getByRole('button',{name:'Save correction',exact:true}).isEnabled(),false);
   await modal.getByLabel('Correction reason',{exact:true}).fill('Count correction');
   assert.equal(await modal.getByRole('button',{name:'Save correction',exact:true}).isEnabled(),true);
   await fit(page,'EOD correction modal');await page.screenshot({path:path.join(output,'eod-correction-390.png'),fullPage:true});
   await modal.getByRole('button',{name:'Cancel',exact:true}).click();
  }
  await page.close();
 }
 for(const role of ['dispenser','owner']){
  const page=await open(390,`?surface=welfare&role=${role}`);await page.getByRole('button',{name:'Welfare Log',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Admin Welfare',exact:true}).count(),role==='owner'?1:0);await fit(page,'Welfare '+role);await page.close();
 }
 const cashier=await open(390,'?role=cashier');assert.equal(await cashier.getByRole('button',{name:'Management',exact:true}).count(),0);await cashier.close();
 assert.deepEqual(blocked,[],'No backend requests permitted');assert.deepEqual(errors,[],'No React/runtime errors');
 console.log(`Isolated role and responsive checks passed. Screenshots: ${output}`);
} finally {if(browser)await browser.close();await new Promise(r=>server.close(r));}
