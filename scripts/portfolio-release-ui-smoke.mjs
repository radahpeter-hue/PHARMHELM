// Actual portfolio component with isolated read-only data. No live account/session.
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {mkdtemp,readFile,writeFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const output=await mkdtemp(path.join(tmpdir(),'portfolio-release-ui-'));
const bank='bank_'+'a'.repeat(64),day=new Date().toISOString().slice(0,10);
const ids=['system_branch_cash_sales_masaka','system_petty_cash_masaka','system_mtn_mobile_money','system_airtel_mobile_money',bank];
const accounts=ids.map((id,i)=>({id:'test_'+id,tenantId:'test',accountId:id,portfolioId:id,name:['Masaka Cash','Masaka Petty Cash','MTN','Airtel','Equity Bank'][i],kind:i<2?'petty_cash':'bank',initialized:true,currency:'UGX',balanceUGX:12000+i*1000,openingBalanceUGX:10000,reconciliationReference:'VERIFIED-OPENING'}));
const secondBank='bank_'+'b'.repeat(64);
accounts[4].balanceUGX=12000;
accounts.push({...accounts[4],id:'test_'+secondBank,accountId:secondBank,portfolioId:secondBank,name:'Fixture Bank Two',balanceUGX:4000,openingBalanceUGX:1000});
const custom='custom_fixture';accounts.push({id:'test_'+custom,tenantId:'test',accountId:custom,portfolioId:custom,name:'Equipment Reserve',kind:'petty_cash',initialized:true,currency:'UGX',balanceUGX:9000,openingBalanceUGX:9000,reconciliationReference:'RESERVE-OPENING'});
const portfolios=[{id:custom,tenantId:'test',name:'Equipment Reserve',classification:'restricted_internal_fund',allowsTransfersOut:true,scope:{kind:'organisation'},status:'active',origin:'custom',currency:'UGX'},{id:bank,tenantId:'test',name:'Equity Bank',bankParentId:'system_bank',classification:'bank',scope:{kind:'organisation'},status:'active',origin:'custom',currency:'UGX',bankInstitution:'Equity',bankAccountReference:'123456789'}];
portfolios.push({...portfolios[1],id:secondBank,name:'Fixture Bank Two',bankAccountReference:'987654321'});
const records={branches:[{id:'masaka',tenantId:'test',name:'Masaka'}],credit_receivables:[{id:'credit1',tenantId:'test',client_name:'Fixture Institution',branch_id:'masaka',receipt_id:'sale1',amount_ugx:9000,outstanding_ugx:6000,created_at:day,status:'outstanding'}],cashTransfers:[],sales:[],welfareAllocations:[{id:'funding1',tenantId:'test',amount:1000,notes:'Fixture welfare allocation',created_at:day}],welfare:[{id:'benefit1',tenantId:'test',amount:200,type:'Fixture benefit',date:day}]};
const stubs={
 auth:`export const useAuth=()=>({profile:{tenantId:'test',uid:'ceo',role:window.__mode==='viewer'?'Finance Head':'owner'},activeBranchId:'masaka',hasPermission:(_m,p)=>window.__mode!=='denied'&&(p==='view'||window.__mode!=='viewer')});`,
 firebase:'export const db={},auth={},storage={};',
 tenant:'export const useTenant=()=>({tenant:{id:"test",name:"Fixture organisation"}});',
 service:`const data=${JSON.stringify(records)};export const firestoreService={getCollection:async name=>data[name]||[],subscribeToCollection:(name,_tenant,cb)=>{cb(data[name]||[]);return()=>{};}};`,
 registry:`export const listFinancialPortfolios=async()=>{if(window.__mode==='error')throw Error('Fixture registry error');return ${JSON.stringify(portfolios)};};export const registeredBankAccounts=items=>items.filter(p=>p.bankParentId==='system_bank');export const createCustomFinancialPortfolio=()=>{throw Error('Read-only fixture')};export const registerPortfolioBankIdentity=createCustomFinancialPortfolio;
export async function setCustomPortfolioActive(p,active,actor,reason){if(!window.__mode?.startsWith('lifecycle'))throw Error('Read-only fixture');window.__lifecycleCalls=(window.__lifecycleCalls||0)+1;await new Promise(r=>setTimeout(r,100));if(window.__mode==='lifecycle-nonzero')throw Error('Resolve the non-zero account balance before deactivation.');window.__lifecyclePortfolio={...p,status:active?'active':'inactive'};}
export const setRegisteredBankAccountActive=setCustomPortfolioActive;
export async function removeUnusedPortfolio(){if(!window.__mode?.startsWith('lifecycle'))throw Error('Read-only fixture');window.__lifecycleCalls=(window.__lifecycleCalls||0)+1;await new Promise(r=>setTimeout(r,100));}`,
 ledger:`export const loadAuthoritativePortfolioLedger=async account=>({account,openingBalanceUGX:account.openingBalanceUGX,currentBalanceUGX:account.balanceUGX,reconciliationReference:'VERIFIED-OPENING',entries:account.accountId==='custom_fixture'?[]:[{id:account.id+'-in',tenantId:'test',accountId:account.accountId,occurredAt:'${day}T08:00:00Z',status:'posted',direction:'inflow',runningBalanceUGX:account.balanceUGX+1000,amountUGX:account.balanceUGX-account.openingBalanceUGX+1000,businessDate:'${day}',reference:'EOD-MASAKA',description:'EOD cash',branchId:'masaka',shiftId:'dayShift',eodReconciliationId:'eod~test~masaka~${day}~dayShift',actorId:'branch_operator'},{id:account.id+'-out',tenantId:'test',accountId:account.accountId,occurredAt:'${day}T09:00:00Z',status:'posted',direction:'outflow',runningBalanceUGX:account.balanceUGX,amountUGX:1000,businessDate:'${day}',reference:'OUTFLOW-MASAKA',transferClass:'transfer_out',description:'Verified movement',branchId:'masaka',actorId:'ceo'}]});`,
 sdk:`export * from ${JSON.stringify(require.resolve('firebase/firestore'))};const accounts=${JSON.stringify(accounts)};const records={...${JSON.stringify(records)},finance_payment_accounts:accounts};export const collection=(_db,path)=>({path});export const doc=(_db,path,id)=>({path,id});export const where=(...a)=>a;export const query=(ref,...filters)=>({...ref,filters});const snapshot=ref=>({docs:(records[ref.path]||[]).filter(r=>(ref.filters||[]).every(([key,op,value])=>op!=='=='||r[key]===value)).filter(r=>window.__mode!=='missing'||r.accountId!=='system_airtel_mobile_money').map(r=>({id:r.id,data:()=>r}))});export const getDocs=async ref=>snapshot(ref);export const runTransaction=async(_db,operation)=>{
 const writes=[];
 const result=await operation({
  get:async ref=>{const row=ref.path==='finance_portfolios_v1'?${JSON.stringify(portfolios)}.find(p=>'test__'+p.id===ref.id):(records[ref.path]||[]).find(p=>p.id===ref.id);return {exists:()=>!!row,data:()=>row};},
  set:(ref,row)=>writes.push({ref,row}),update:()=>{}
 });
 await new Promise(resolve=>setTimeout(resolve,100));
 for(const {ref,row} of writes)if(ref.path==='finance_transfers_v1'){
  window.__transferCalls=(window.__transferCalls||0)+1;
  (records.finance_transfers_v1??=[]).push({...row,postedAt:{toDate:()=>new Date()}});
 }
 return result;
};export const onSnapshot=(ref,cb)=>{cb(snapshot(ref));return()=>{};};`
};
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {CashAndBanking} from './src/pages/finance/management/CashAndBanking';import Finance from './src/pages/Finance';import {TreasuryAccountControls} from './src/components/finance/TreasuryAccountControls';
function Lifecycle(){const [p,setP]=React.useState({id:'fixture_unused',tenantId:'test',name:'Fixture fund',origin:'custom',supportsChildAccounts:false,status:window.__mode==='lifecycle-unused'?'inactive':'active'});const account=window.__mode==='lifecycle-unused'?undefined:{id:'test_fixture_unused',accountId:'fixture_unused',tenantId:'test',kind:'bank',initialized:true,balanceUGX:window.__mode==='lifecycle-nonzero'?100:0};return <TreasuryAccountControls portfolio={p} account={account} accounts={[]} actorId="ceo" onChanged={()=>{if(window.__lifecyclePortfolio)setP(window.__lifecyclePortfolio);}}/>;}
createRoot(document.getElementById('root')).render(<main className="min-h-screen bg-zinc-50 p-3 sm:p-6">{window.__mode?.startsWith("lifecycle")?<Lifecycle/>:location.search.includes("finance")?<Finance/>:<CashAndBanking/>}</main>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,format:'iife',outfile:path.join(output,'app.js'),plugins:[{name:'isolated-portfolio',setup(b){
for(const [filter,key] of [[/AuthContext$/,'auth'],[/TenantContext$/,'tenant'],[/services\/firestore$/,'service'],[/\/firebase$/,'firebase'],[/portfolioFirestore$/,'registry'],[/authoritativePortfolioLedger$/,'ledger'],[/^firebase\/firestore$/,'sdk']])b.onResolve({filter},()=>({path:key,namespace:'stub'}));
b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path],loader:'js',resolveDir:process.cwd()}));}}]});
const css=(await readdir('dist/assets')).find(n=>n.endsWith('.css'));
await writeFile(path.join(output,'style.css'),(await readFile(path.join('dist/assets',css),'utf8')).replace(/@import"[^"]*";/g,''));
await writeFile(path.join(output,'index.html'),'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="style.css"></head><body><div id="root"></div><script src="app.js"></script></body></html>');
const server=createServer(async(req,res)=>{const pathname=req.url.split('?')[0];const name=pathname==='/'?'index.html':pathname.slice(1);if(!['index.html','style.css','app.js'].includes(name)){res.statusCode=404;res.end();return;}res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(await readFile(path.join(output,name)));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;const errors=[];
const names=['Branch Cash Sales','Airtel Money','MTN Money','Bank','Credit Receivables','Petty Cash','Staff Welfare Fund'];
const back=async page=>{await page.getByRole('button',{name:'Global Treasury Overview',exact:true}).click();await page.getByRole('heading',{name:'Global Treasury Overview',exact:true}).waitFor();};
const fit=async(page,width)=>{const title=await page.locator('h2').count()?await page.locator('h2').textContent():'access';await page.screenshot({path:path.join(output,`check-${width}-${title.replace(/[^a-z0-9]/gi,'-')}.png`),fullPage:true});assert.ok(await page.locator('body').evaluate(e=>e.scrollWidth<=innerWidth+1),`Treasury must fit ${width}px`);assert.equal(await page.locator('th,td').evaluateAll(cells=>cells.some(e=>getComputedStyle(e).color==='rgb(255, 255, 255)')),false,'Light-surface ledger text must be readable');};
const open=async(page,name)=>page.getByRole('button',{name:new RegExp('^'+name)}).first().click();
try{browser=await chromium.launch({headless:true});
 for(const width of [360,390,768,1024,1280,1440]){
  const page=await browser.newPage({viewport:{width,height:960}});page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:')?route.continue():route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.getByRole('heading',{name:'Global Treasury Overview',exact:true}).waitFor();
  for(const name of names)await page.getByRole('button',{name:new RegExp('^'+name)}).first().waitFor();
  assert.equal(await page.getByLabel('Default financial portfolios').getByRole('button').count(),7);
  await page.getByText('UGX 70,000',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Register bank account',exact:true}).count(),0);
  assert.equal(await page.getByLabel('Bank institution',{exact:true}).count(),0);
  await fit(page,width);await page.screenshot({path:path.join(output,`overview-${width}.png`),fullPage:true});
  await open(page,'Branch Cash Sales');
  await page.getByRole('heading',{name:'Authoritative account ledger'}).waitFor();await page.getByRole('button',{name:'OUTFLOW-MASAKA',exact:true}).waitFor();
  assert.equal(await page.getByLabel('Filter ledger by source branch').evaluate(select=>select.value),'all');
  await page.getByLabel('Filter ledger by source branch').selectOption('masaka');
  await page.getByLabel('Ledger direction').selectOption('outflow');
  assert.equal(await page.getByRole('button',{name:'EOD-MASAKA',exact:true}).count(),0);
  await page.getByLabel('Ledger direction').selectOption('all');
  await page.getByRole('button',{name:'EOD-MASAKA',exact:true}).click();await page.getByText('dayShift',{exact:false}).first().waitFor();
  await page.getByLabel('Ledger from').fill('2099-01-01');await page.getByText('No posted movements match these filters.').waitFor();await page.getByLabel('Ledger from').fill('');
  await fit(page,width);await page.screenshot({path:path.join(output,`cash-ledger-${width}.png`),fullPage:true});await back(page);
  await open(page,'Credit Receivables');await page.getByRole('heading',{name:'Credit Receivables ledger'}).waitFor();await page.getByLabel('Receivables customer or reference').fill('Fixture');
  await fit(page,width);await page.screenshot({path:path.join(output,`credit-ledger-${width}.png`),fullPage:true});await back(page);
  for(const name of ['Airtel Money','MTN Money','Petty Cash']){await open(page,name);await page.getByRole('heading',{name:name,exact:true}).waitFor();await page.getByRole('heading',{name:'Authoritative account ledger'}).waitFor();await fit(page,width);await back(page);}
  await open(page,'Staff Welfare Fund');await page.getByRole('heading',{name:'Staff Welfare Fund records'}).waitFor();await page.getByRole('cell',{name:/Fixture welfare allocation/}).waitFor();assert.equal(await page.getByRole('button',{name:'Initiate Transfer',exact:true}).count(),1);await fit(page,width);await back(page);
  await open(page,'Equipment Reserve');await page.getByRole('heading',{name:'Equipment Reserve',exact:true}).waitFor();await page.getByRole('heading',{name:'Account controls'}).waitFor();await fit(page,width);await back(page);
  await open(page,'Bank');await page.getByRole('heading',{name:'Unified Ledger',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Unified Ledger',exact:true}).getAttribute('aria-pressed'),'true');
  await page.getByRole('columnheader',{name:'Account',exact:true}).waitFor();
  await page.getByRole('cell',{name:'Fixture Bank Two',exact:true}).first().waitFor();
  assert.equal(await page.getByRole('columnheader',{name:'Account balance (UGX)',exact:true}).count(),0);
  assert.equal(await page.getByText('123456789',{exact:false}).count(),0);
  await page.getByLabel('Bank account',{exact:true}).selectOption(bank);
  assert.equal(await page.getByRole('cell',{name:'Fixture Bank Two',exact:true}).count(),0);
  await page.getByRole('cell',{name:'12,000',exact:true}).waitFor();
  await page.getByRole('cell',{name:'Equity Bank',exact:true}).first().waitFor();
  await page.getByLabel('Search transactions').fill('no-result');
  await page.getByText('No posted movements match these filters.').waitFor();
  await page.getByLabel('Search transactions').fill('');
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export CSV'}).click();
  assert.equal((await download).suggestedFilename(),'treasury-ledger.csv');
  await page.getByLabel('Bank account',{exact:true}).selectOption('all');
  await fit(page,width);await page.screenshot({path:path.join(output,`bank-unified-${width}.png`),fullPage:true});
  await page.getByRole('button',{name:'Account Management',exact:true}).click();
  await page.getByRole('heading',{name:'Bank Accounts',exact:true}).waitFor();
  await page.getByLabel('Bank institution',{exact:true}).waitFor();
  await fit(page,width);await page.screenshot({path:path.join(output,`bank-accounts-${width}.png`),fullPage:true});
  await page.getByRole('button',{name:/^Equity Bank/}).click();await page.getByRole('heading',{name:'Equity Bank',exact:true}).waitFor();await page.getByRole('heading',{name:'Authoritative account ledger'}).waitFor();await page.getByRole('navigation',{name:'Treasury navigation'}).getByText('Bank Accounts',{exact:true}).waitFor();
  await fit(page,width);await page.screenshot({path:path.join(output,`bank-ledger-${width}.png`),fullPage:true});
  assert.equal(await page.getByRole('button',{name:'Post reconciled EOD',exact:true}).count(),0);
  await page.close();console.log(`Seven portfolios, nested bank accounts, filters, details, welfare and custom ledgers passed at ${width}px`);
 }
 for(const width of [360,1440]){
  const page=await browser.newPage({viewport:{width,height:960}});
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:')?route.continue():route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}/?finance`);
  await page.getByRole('button',{name:'Management',exact:true}).click();
  for(const [tab,title] of [['Cash & Banking','Global Treasury Overview'],['Reconciliation Inbox','EOD Reconciliation Log'],['Credit Ledger','Credit Ledger'],['Cash & Banking','Global Treasury Overview']]){
   await page.getByRole('button',{name:tab,exact:true}).click();
   await page.getByRole('heading',{name:title,exact:true}).waitFor();
   assert.ok(await page.locator('body').evaluate(e=>e.scrollWidth<=innerWidth+1),`Finance navigation overflow at ${width}px`);
  }
  await page.close();console.log(`Adjacent Finance tabs passed at ${width}px`);
 }
 for(const mode of ['viewer','missing','error','denied']){
  const page=await browser.newPage({viewport:{width:390,height:900}});page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(mode=>window.__mode=mode,mode);await page.goto(`http://127.0.0.1:${server.address().port}/`);
  if(mode==='denied'){await page.getByRole('alert').filter({hasText:'Finance access is required.'}).waitFor();assert.equal(await page.getByRole('heading',{name:'Global Treasury Overview'}).count(),0);}
  else if(mode==='error'){await page.getByRole('alert').filter({hasText:'Unable to load branch or portfolio coverage'}).waitFor();assert.equal(await page.getByLabel('Default financial portfolios').getByRole('button').count(),7);}
  else if(mode==='missing'){await page.getByText('Verified liquid cash (partial)',{exact:true}).waitFor();const card=page.getByRole('button',{name:/^Airtel Money/});await card.getByText('Reconciliation required',{exact:true}).waitFor();await card.click();await page.getByRole('heading',{name:'Account controls'}).waitFor();await page.getByLabel('Verified opening balance (UGX)').waitFor();}
  else {assert.equal(await page.getByRole('button',{name:'Add custom portfolio'}).count(),0);await open(page,'Bank');assert.equal(await page.getByText('Register bank account',{exact:true}).count(),0);await page.getByRole('button',{name:/^Equity Bank/}).click();assert.equal(await page.getByRole('heading',{name:'Account controls'}).count(),0);}
  await fit(page,390);await page.close();console.log(`Treasury ${mode} state passed`);
 }
 for(const width of [360,1440]){
  const page=await browser.newPage({viewport:{width,height:960}});page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:')?route.continue():route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await open(page,'Equipment Reserve');
  await page.getByRole('button',{name:'Initiate Transfer',exact:true}).click();
  const customModal=page.getByRole('dialog',{name:'Initiate Transfer'});
  await customModal.getByText(/Source portfolio · Equipment Reserve/).waitFor();
  assert.equal(await customModal.getByLabel('Source bank account').count(),0);
  await customModal.getByLabel('Destination portfolio',{exact:true}).selectOption('system_bank');
  await customModal.getByLabel('Destination bank account',{exact:true}).selectOption(bank);
  await page.keyboard.press('Escape');
  await customModal.waitFor({state:'hidden'});
  await back(page);
  await open(page,'Bank');
  await page.getByRole('button',{name:'Initiate Transfer',exact:true}).click();
  const modal=page.getByRole('dialog',{name:'Initiate Transfer'});
  await modal.getByLabel('Source bank account',{exact:true}).selectOption(bank);
  await modal.getByLabel('Destination portfolio',{exact:true}).selectOption('system_bank');
  assert.equal(await modal.getByLabel('Destination bank account').locator(`option[value="${bank}"]`).count(),0);
  await modal.getByLabel('Destination bank account',{exact:true}).selectOption(secondBank);
  await page.getByLabel('Principal (UGX)',{exact:true}).fill('500');
  await page.getByLabel('Charge (UGX, optional)',{exact:true}).fill('20');
  await page.getByLabel('Transaction reference',{exact:true}).fill('UI-TRANSFER-001');
  await page.getByRole('button',{name:'Post transfer',exact:true}).dblclick();
  await page.getByText('Transfer posted to both ledgers.',{exact:true}).waitFor();
  await modal.screenshot({path:path.join(output,`transfers-${width}.png`)});
  await modal.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByLabel('Ledger direction').selectOption('transfer_out');
  await page.getByRole('cell',{name:'Transfer Out',exact:true}).first().waitFor();
  assert.equal(await page.getByRole('button',{name:'EOD-MASAKA',exact:true}).count(),0);
  const excelDownload=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export Excel',exact:true}).click();
  assert.equal((await excelDownload).suggestedFilename(),'treasury-ledger.xlsx');
  await back(page);
  await page.getByText('Transfer history',{exact:true}).click();
  await page.getByText(/UGX 500 principal · UGX 20 charge/).waitFor();
  assert.equal(await page.evaluate(()=>window.__transferCalls),1);
  await page.getByLabel('Transfer class',{exact:true}).selectOption('inter_portfolio');
  await page.getByText('No transfers match these filters.',{exact:true}).waitFor();
  await page.getByLabel('Transfer class',{exact:true}).selectOption('intra_portfolio');
  await page.getByText(/UI-TRANSFER-001/).waitFor();
  await fit(page,width);
  await page.close();
 }
 for(const width of [360,1440])for(const mode of ['lifecycle-used','lifecycle-unused','lifecycle-nonzero']){
  const page=await browser.newPage({viewport:{width,height:960}});page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(mode=>window.__mode=mode,mode);await page.goto(`http://127.0.0.1:${server.address().port}/`);
  if(mode==='lifecycle-unused'){
   await page.getByLabel('Deletion reason').fill('Unused duplicate');
   await page.getByRole('button',{name:'Delete unused account',exact:true}).dblclick();
   await page.getByRole('status').filter({hasText:'Unused account deleted.'}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Reactivate account'}).count(),0);
  }else{
   assert.equal(await page.getByRole('button',{name:'Delete unused account'}).count(),0);
   await page.getByLabel('Deactivation reason').fill('Balance resolved');
   await page.getByRole('button',{name:'Deactivate account',exact:true}).dblclick();
   if(mode==='lifecycle-nonzero')await page.getByRole('status').filter({hasText:'Resolve the non-zero account balance'}).waitFor();
   else{
    await page.getByRole('button',{name:'Reactivate account',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Delete unused account'}).count(),0);
    assert.equal(await page.evaluate(()=>window.__lifecycleCalls),1);
    await page.getByRole('button',{name:'Reactivate account',exact:true}).click();
    await page.getByRole('button',{name:'Deactivate account',exact:true}).waitFor();
   }
  }
  assert.equal(await page.evaluate(()=>window.__lifecycleCalls),mode==='lifecycle-used'?2:1);
  await fit(page,width);await page.screenshot({path:path.join(output,`${mode}-${width}.png`),fullPage:true});await page.close();
 }
 assert.deepEqual(errors,[]);console.log(`Portfolio screenshots: ${output}`);
}catch(error){if(browser)for(const context of browser.contexts())for(const [index,page] of context.pages().entries()){await page.screenshot({path:path.join(output,`failure-${index}.png`),fullPage:true}).catch(()=>{});}throw error;}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
