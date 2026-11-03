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
const portfolios=[{id:bank,tenantId:'test',name:'Equity Bank',bankParentId:'system_bank',classification:'bank',scope:{kind:'organisation'},status:'active',origin:'custom',currency:'UGX'}];
const records={branches:[{id:'masaka',tenantId:'test',name:'Masaka'}],credit_receivables:[{id:'credit1',tenantId:'test',client_name:'Fixture Institution',branch_id:'masaka',receipt_id:'sale1',amount_ugx:9000,outstanding_ugx:6000,created_at:day,status:'outstanding'}],cashTransfers:[],sales:[]};
const stubs={
 auth:`export const useAuth=()=>({profile:{tenantId:'test',uid:'ceo',role:'owner'},activeBranchId:'masaka'});`,
 firebase:'export const db={},auth={};',
 accounts:`const accounts=${JSON.stringify(accounts)};export const useManagementPaymentAccounts=()=>({accounts,loading:false,error:''});`,
 registry:`export const listFinancialPortfolios=async()=>${JSON.stringify(portfolios)};export const registeredBankAccounts=items=>items.filter(p=>p.bankParentId==='system_bank');export const createCustomFinancialPortfolio=()=>{throw Error('Read-only fixture')};export const registerPortfolioBankIdentity=createCustomFinancialPortfolio,setRegisteredBankAccountActive=createCustomFinancialPortfolio,setCustomPortfolioActive=createCustomFinancialPortfolio;`,
 ledger:`export const loadAuthoritativePortfolioLedger=async account=>({account,openingBalanceUGX:10000,currentBalanceUGX:account.balanceUGX,reconciliationReference:'VERIFIED-OPENING',entries:[{id:account.id+'-in',tenantId:'test',accountId:account.accountId,occurredAt:'${day}T08:00:00Z',status:'posted',direction:'inflow',amountUGX:5000,businessDate:'${day}',reference:'EOD-MASAKA',branchId:'masaka',runningBalanceUGX:15000},{id:account.id+'-out',tenantId:'test',accountId:account.accountId,occurredAt:'${day}T09:00:00Z',status:'posted',direction:'outflow',amountUGX:3000,businessDate:'${day}',reference:'OUTFLOW-MASAKA',branchId:'masaka',runningBalanceUGX:12000}]});`,
 sdk:`export * from ${JSON.stringify(require.resolve('firebase/firestore'))};const records=${JSON.stringify(records)};export const collection=(_db,path)=>({path});export const doc=(_db,path,id)=>({path,id});export const where=(...a)=>a;export const query=(ref,...filters)=>({...ref,filters});const snapshot=ref=>({docs:(records[ref.path]||[]).filter(r=>(ref.filters||[]).every(([key,op,value])=>op!=='=='||r[key]===value)).map(r=>({id:r.id,data:()=>r}))});export const getDocs=async ref=>snapshot(ref);export const onSnapshot=(ref,cb)=>{cb(snapshot(ref));return()=>{};};`
};
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {FinancialPortfoliosPanel} from './src/components/finance/FinancialPortfoliosPanel';createRoot(document.getElementById('root')).render(<main className="p-3 bg-zinc-900 text-white min-h-screen"><FinancialPortfoliosPanel/></main>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,format:'iife',outfile:path.join(output,'app.js'),plugins:[{name:'isolated-portfolio',setup(b){
for(const [filter,key] of [[/AuthContext$/,'auth'],[/\/firebase$/,'firebase'],[/ManagementPaymentAccounts$/,'accounts'],[/portfolioFirestore$/,'registry'],[/authoritativePortfolioLedger$/,'ledger'],[/^firebase\/firestore$/,'sdk']])b.onResolve({filter},()=>({path:key,namespace:'stub'}));
b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path],loader:'js',resolveDir:process.cwd()}));}}]});
const css=(await readdir('dist/assets')).find(n=>n.endsWith('.css'));
await writeFile(path.join(output,'style.css'),(await readFile(path.join('dist/assets',css),'utf8')).replace(/@import"[^"]*";/g,''));
await writeFile(path.join(output,'index.html'),'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="style.css"></head><body><div id="root"></div><script src="app.js"></script></body></html>');
const server=createServer(async(req,res)=>{const name=req.url==='/'?'index.html':req.url.slice(1);if(!['index.html','style.css','app.js'].includes(name)){res.statusCode=404;res.end();return;}res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(await readFile(path.join(output,name)));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;const errors=[];
try{browser=await chromium.launch({headless:true});
 for(const width of [360,390,1280]){
  const page=await browser.newPage({viewport:{width,height:900}});page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:')?route.continue():route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const cash=page.getByRole('button',{name:/^Branch Cash Sales/});await cash.waitFor();await cash.click();
  await page.getByRole('heading',{name:'Authoritative account ledger'}).waitFor();await page.getByText('OUTFLOW-MASAKA',{exact:true}).waitFor();
  await page.getByLabel('Filter ledger by source branch').selectOption('masaka');
  await page.getByLabel('Ledger direction').selectOption('outflow');
  assert.equal(await page.getByRole('cell',{name:'EOD-MASAKA',exact:true}).count(),0);
  await page.screenshot({path:path.join(output,`cash-ledger-${width}.png`),fullPage:true});
  await page.getByRole('button',{name:/^Credit Receivables/}).click();
  await page.getByRole('heading',{name:'Credit Receivables ledger'}).waitFor();await page.getByLabel('Receivables customer or reference').fill('Fixture');
  await page.screenshot({path:path.join(output,`credit-ledger-${width}.png`),fullPage:true});
  assert.ok(await page.locator('body').evaluate(e=>e.scrollWidth<=innerWidth+1),`Portfolio must fit ${width}px`);
  assert.notEqual(await cash.evaluate(e=>getComputedStyle(e).color),'rgb(255, 255, 255)');
  await page.getByRole('button',{name:/^Bank/}).first().click();
  await page.getByRole('button',{name:/Equity Bank · UGX/}).click();await page.getByText('Current reconciled balance: UGX 16,000',{exact:true}).waitFor();
  await page.screenshot({path:path.join(output,`bank-ledger-${width}.png`),fullPage:true});
  assert.ok(await page.locator('body').evaluate(e=>e.scrollWidth<=innerWidth+1),`Bank ledger must fit ${width}px`);
  assert.equal(await page.getByRole('button',{name:'Post reconciled EOD',exact:true}).count(),0);
  await page.close();console.log(`Portfolio navigation, inflows/outflows, bank selection and receivables passed at ${width}px`);
 }
 assert.deepEqual(errors,[]);console.log(`Portfolio screenshots: ${output}`);
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
