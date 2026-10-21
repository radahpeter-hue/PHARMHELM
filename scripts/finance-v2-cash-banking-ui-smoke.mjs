import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {mkdtemp,readFile,writeFile,readdir,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const output=await mkdtemp(path.join(tmpdir(),'finance-v2-ui-'));
const stubs={auth:`export const useAuth=()=>({profile:{tenantId:'test',uid:'finance'}});`,api:`const accounts=[{tenantId:'test',accountId:'cash',name:'Masaka cash',kind:'BRANCH_CASH_SALES',branchId:'masaka',currency:'UGX',balanceUGX:1004000,controlVersion:2,initialized:true,active:true},{tenantId:'test',accountId:'bank',name:'Bank',kind:'BANK',currency:'UGX',balanceUGX:0,controlVersion:2,initialized:true,active:true}];export async function financeV2Api(action,input){if(action==='accounts')return {accounts,history:[],canRegister:false};window.calls=window.calls||[];window.calls.push(input);await new Promise(r=>setTimeout(r,250));if(location.search==='?retry'&&window.calls.length===1)throw Error('Response lost');return {transferId:'posted-test',replay:window.calls.length>1};}`};
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {CashAndBanking} from './src/pages/finance/management/CashAndBanking';createRoot(document.getElementById('root')).render(<main style={{padding:12}}><CashAndBanking/></main>);`,loader:'tsx',resolveDir:process.cwd()},bundle:true,format:'iife',outfile:path.join(output,'app.js'),plugins:[{name:'isolated-finance',setup(b){b.onResolve({filter:/AuthContext$/},()=>({path:'auth',namespace:'stub'}));b.onResolve({filter:/financeV2Api$/},()=>({path:'api',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path],loader:'js'}));}}]});
const css=(await readdir('dist/assets')).find(n=>n.endsWith('.css'));await copyFile(path.join('dist/assets',css),path.join(output,'style.css'));
await writeFile(path.join(output,'index.html'),'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="style.css"></head><body><div id="root"></div><script src="app.js"></script></body></html>');
const server=createServer(async(req,res)=>{const name=req.url.split('?')[0].slice(1)||'index.html';if(!['index.html','app.js','style.css'].includes(name)){res.writeHead(404).end();return;}res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(await readFile(path.join(output,name)));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{browser=await chromium.launch({headless:true});for(const width of [360,390,1280]){
 const page=await browser.newPage({viewport:{width,height:844}});await page.goto(`http://127.0.0.1:${server.address().port}/${width===390?'?retry':''}`);
 await page.getByLabel('Source account',{exact:true}).selectOption('cash');await page.getByLabel('Destination account',{exact:true}).selectOption('bank');await page.getByLabel('Principal (UGX)',{exact:true}).fill('1000000');await page.getByLabel('External charge (UGX)',{exact:true}).fill('4000');await page.getByLabel('Description or reference',{exact:true}).fill('Masaka test deposit');await page.getByRole('button',{name:'Review transfer',exact:true}).click();
 await page.getByText('Destination receives UGX 1,000,000. Separate charge: UGX 4,000.',{exact:true}).waitFor();
 const confirm=page.getByRole('button',{name:'Confirm or retry same transfer',exact:true});await confirm.scrollIntoViewIfNeeded();const box=await confirm.boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=width);assert.equal(await page.locator('body').evaluate(e=>e.scrollWidth<=innerWidth),true);
 await page.screenshot({path:path.join(output,`transfer-${width}.png`),fullPage:true});await confirm.dblclick();await page.waitForFunction(()=>window.calls?.length===1);
 if(width===390){await page.getByText('Posting not confirmed.',{exact:false}).waitFor();await confirm.click();await page.waitForFunction(()=>window.calls?.length===2);assert.equal(await page.evaluate(()=>window.calls[0].requestId===window.calls[1].requestId),true);}
 await page.getByText(width===390?'Existing transfer confirmed: posted-test':'Transfer posted: posted-test',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.calls[0].principalUGX),1000000);await page.close();console.log(`PASS Cash & Banking review, scrolling, principal, charge and duplicate/retry guard at ${width}px`);
}}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
