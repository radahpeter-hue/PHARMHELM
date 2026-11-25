// Render real CRM/Procurement pages and editor with isolated services. No tenant database access.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = await mkdtemp(path.join(tmpdir(), 'supplier-registry-ui-'));
const fixtures = {
  auth: `export const useAuth=()=>({profile:{uid:'fixture-user',tenantId:'fixture-tenant',role:'CEO',secondaryRoles:[]},hasPermission:(_module,level)=>level==='view'||!location.search.includes('readonly')});`,
  feature: `export const useOperationalInventoryFeature=()=>false;`,
  subscriptions: `
    const suppliers=[{id:'legacy',supplier_id:'SUP-legacy',supplier_name:'Existing Supplier',commercial_category:'Wholesale',nda_licence_status:'valid',payment_terms:'50% deposit, balance at delivery',inventoryCapabilities:['DRUGS']}];
    export const firestoreService={
      subscribeToCollection:(name,_tenant,callback)=>{callback(name==='supplier_registry'?suppliers:[]);return ()=>{};},
      subscribeToCollectionByQuery:(_name,_tenant,_query,callback)=>{callback([]);return ()=>{};}
    };`,
  save: `export async function saveSupplierRegistry(input){window.savedSupplier=input;return {id:input.id};}`,
  identity: `export const collection=()=>({});export const doc=()=>({id:'new-fixture-supplier'});`,
};
await build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter,Routes,Route} from 'react-router-dom';import Clients from './src/pages/Clients';import Procurement from './src/pages/Procurement';createRoot(document.getElementById('root')).render(<BrowserRouter><Routes><Route path="/tenant/fixture/app/clients" element={<Clients/>}/><Route path="/tenant/fixture/app/procurement" element={<Procurement/>}/></Routes></BrowserRouter>);`,
    resolveDir: process.cwd(), loader: 'tsx',
  },
  bundle: true, format: 'iife', outfile: path.join(output, 'app.js'),
  plugins: [{name:'supplier-fixtures',setup(builder){
    builder.onResolve({filter:/AuthContext$|services\/firestore$|useOperationalInventoryFeature$|supplierRegistryService$/},({path:source})=>({path:source.endsWith('AuthContext')?'auth':source.endsWith('useOperationalInventoryFeature')?'feature':source.endsWith('supplierRegistryService')?'save':'subscriptions',namespace:'fixture'}));
    builder.onResolve({filter:/^firebase\/firestore$/},({importer})=>importer.endsWith('/SupplierEditor.tsx')?{path:'identity',namespace:'fixture'}:undefined);
    builder.onLoad({filter:/.*/,namespace:'fixture'},({path:name})=>({contents:fixtures[name],loader:'js'}));
  }}],
});
const css=(await readdir('dist/assets')).find(name=>name.endsWith('.css'));
assert.ok(css,'Build production CSS first.');
await copyFile(path.join('dist/assets',css),path.join(output,'style.css'));
await writeFile(path.join(output,'index.html'),'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
const server=createServer(async(req,res)=>{
  const name=req.url.split('?')[0].slice(1);
  const asset=['app.js','style.css'].includes(name)?name:'index.html';
  res.setHeader('Content-Type',asset.endsWith('.css')?'text/css':asset.endsWith('.js')?'text/javascript':'text/html');
  res.end(await readFile(path.join(output,asset)));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const engines=process.env.SUPPLIER_BROWSER_ENGINE==='chromium'?[['chromium',chromium]]:[['chromium',chromium],['webkit',webkit]];
try {
  for(const [engineName,engine] of engines){
    const browser=await engine.launch({headless:true,...(engineName==='chromium'&&process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}: {})});
    try {
      for(const width of [360,390,1280]){
        const page=await browser.newPage({viewport:{width,height:844}});
        const errors=[];
        page.on('pageerror',error=>errors.push(error.message));
        // All data comes from capture-only fixtures, and external requests are blocked.
        await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
        await page.goto(`${origin}/tenant/fixture/app/procurement`);
        await page.getByRole('button',{name:'Procurement & Sourcing',exact:true}).click();
        assert.equal(await page.getByRole('button',{name:'Supplier Registry',exact:true}).count(),0);
        await page.getByRole('link',{name:'Open CRM Suppliers'}).click();
        await page.getByRole('button',{name:'Add Supplier',exact:true}).waitFor();
        assert.match(page.url(),/\/clients\?tab=suppliers$/);
        await page.getByRole('button',{name:'Add Supplier',exact:true}).click();
        const dialog=page.getByRole('dialog');
        const terms=page.getByLabel('Payment Terms',{exact:true});
        assert.equal(await terms.inputValue(),'Cash on delivery');
        await page.getByLabel('Supplier Name',{exact:true}).fill('Test Distributor');
        await page.getByLabel('Drugs',{exact:true}).check();
        await page.getByLabel('Operational / Non-Sellable',{exact:true}).check();
        // Verify the actual inherited colours of every formerly white label.
        for(const label of ['Add Supplier','Supply Capabilities','Drugs','Operational / Non-Sellable','Suspend Supplier','WHT Exempt','Cancel']){
          const element=dialog.getByText(label,{exact:true});
          const colour=await element.evaluate(node=>{
            const context=document.createElement('canvas').getContext('2d');
            context.fillStyle=getComputedStyle(node).color;context.fillRect(0,0,1,1);
            return [...context.getImageData(0,0,1,1).data];
          });
          assert.ok(colour.slice(0,3).every(channel=>channel<60)&&colour[3]===255,`${label} must have dark text`);
        }
        const scroller=page.getByTestId('supplier-editor-scroll');
        assert.equal(await scroller.evaluate(node=>node.scrollWidth<=node.clientWidth),true,'No horizontal form overflow');
        for(const field of ['Supplier Name','Licence Expiry','Payment Terms','Address / Location']){
          const control=page.getByLabel(field,{exact:true});
          await control.scrollIntoViewIfNeeded();
          const box=await control.boundingBox();
          assert.ok(box&&box.x>=0&&box.x+box.width<=width,`${field} fits the viewport`);
        }
        const save=page.getByRole('button',{name:'Save Supplier',exact:true});
        const saveBox=await save.boundingBox();
        assert.ok(saveBox&&saveBox.y>=0&&saveBox.y+saveBox.height<=844,'Save remains visible');
        for(const preset of ['Cash in advance','Net 7 days','Net 14 days','Net 30 days','Net 60 days','Net 90 days']){
          await terms.selectOption(preset);
          assert.equal(await terms.inputValue(),preset);
        }
        await terms.selectOption('Net 30 days');
        await page.screenshot({path:path.join(output,`${engineName}-${width}-form.png`)});
        await save.click();
        await dialog.waitFor({state:'detached'});
        const saved=await page.evaluate(()=>window.savedSupplier);
        assert.equal(saved.sourceModule,'clients');
        assert.equal(saved.data.payment_terms,'Net 30 days');
        assert.deepEqual(saved.data.inventoryCapabilities,['DRUGS','NON_SELLABLE_OPERATIONAL']);
        // Open an existing custom agreement and save without changing its terms or ID.
        await page.getByRole('row').filter({hasText:'Existing Supplier'}).getByRole('button').click();
        assert.equal(await terms.inputValue(),'custom');
        assert.equal(await page.getByLabel('Custom Payment Terms',{exact:true}).inputValue(),'50% deposit, balance at delivery');
        await save.click();
        await dialog.waitFor({state:'detached'});
        const updated=await page.evaluate(()=>window.savedSupplier);
        assert.equal(updated.id,'legacy');
        assert.equal(updated.isNew,false);
        assert.equal(updated.data.payment_terms,'50% deposit, balance at delivery');
        // A new custom agreement is entered and submitted as plain text.
        await page.getByRole('button',{name:'Add Supplier',exact:true}).click();
        await page.getByLabel('Supplier Name',{exact:true}).fill('Custom Terms Supplier');
        await terms.selectOption('custom');
        await page.getByLabel('Custom Payment Terms',{exact:true}).fill('End of month');
        await save.click();
        await dialog.waitFor({state:'detached'});
        assert.equal(await page.evaluate(()=>window.savedSupplier.data.payment_terms),'End of month');
        await page.goto(`${origin}/tenant/fixture/app/clients?tab=suppliers&readonly=1`);
        assert.equal(await page.getByRole('button',{name:'Add Supplier',exact:true}).isDisabled(),true);
        assert.deepEqual(errors,[]);
        await page.close();
        console.log(`Supplier CRM/register checks passed in ${engineName} at ${width}px.`);
      }
    } finally {await browser.close();}
  }
} finally {await new Promise(resolve=>server.close(resolve));}
console.log(`Screenshots: ${output}`);
