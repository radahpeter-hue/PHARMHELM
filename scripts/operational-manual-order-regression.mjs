import { readFileSync, rmSync } from 'node:fs';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, collection, query, where, serverTimestamp } from 'firebase/firestore';
import { build } from 'esbuild';
const tenantId = 'tenant-a', branchId = 'branch-a', itemId = 'pens';
const env = await initializeTestEnvironment({ projectId: 'pharmhelm-operational-inventory-v2-rules', firestore: { rules: readFileSync(process.env.OPERATIONAL_RULES_PATH || 'firestore.rules', 'utf8') } });
try {
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'system_settings', tenantId), {tenantId,featureToggles:{enableOperationalInventory:true}});
    await setDoc(doc(db, 'staff', 'manager'), {tenantId,role:'branch manager',assigned_branches:[branchId],secondaryRoles:[]});
    await setDoc(doc(db, 'role_realms_of_operation', `${tenantId}_branch_manager`), {tenantId,roleName:'branch manager',roleType:'standard',permissions:{}});
    await setDoc(doc(db, 'operational_inventory_masters', itemId), {tenantId,inventoryClass:'OPERATIONAL'});
    await setDoc(doc(db, 'operational_inventory', itemId), {tenantId,branchId,masterItemId:itemId,inventoryClass:'OPERATIONAL'});
  });
  const db = env.authenticatedContext('manager',{tenantId,role:'branch manager'}).firestore();
  await assertSucceeds(setDoc(doc(db,'stock_orders','manual'), {tenantId,inventoryClass:'OPERATIONAL',order_type:'monthly',category:'non_sellable',generation_method:'manual',status:'submitted',is_emergency:false,submitted_by:'manager',total_order_value_ugx:12000,submitted_at:new Date().toISOString(),order_number:'ORD-TEST',requesting_branch_id:branchId,requesting_branch_name:'Masaka',createdAt:serverTimestamp(),updatedAt:serverTimestamp()}));
  await assertSucceeds(setDoc(doc(db,'stock_order_lines','manual-line'), {tenantId,inventoryClass:'OPERATIONAL',masterItemId:itemId,product_id:itemId,product_name:'Pens',qty_ordered:1,unit_cost_ugx:12000,line_total_ugx:12000,isOperational:true,order_id:'manual',line_status:'ordered',createdAt:serverTimestamp(),updatedAt:serverTimestamp()}));
  await build({stdin:{contents:"export {persistNewManualStockOrder} from './src/services/manualStockOrderService';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',packages:'external',outfile:'.operational-manual-order-emulator.mjs'});
  const {persistNewManualStockOrder} = await import('../.operational-manual-order-emulator.mjs');
  const order={tenantId,inventoryClass:'OPERATIONAL',category:'non_sellable',requesting_branch_id:branchId,status:'submitted'};
  const line={tenantId,inventoryClass:'OPERATIONAL',masterItemId:itemId,product_id:itemId,qty_ordered:1,unit_cost_ugx:12000,line_total_ugx:12000};
  await assertSucceeds(persistNewManualStockOrder('atomic-manual',order,[line],db));
  await assertSucceeds(persistNewManualStockOrder('atomic-manual',order,[line],db));
  const lines=await getDocs(query(collection(db,'stock_order_lines'),where('tenantId','==',tenantId),where('order_id','==','atomic-manual')));
  assert.equal(lines.size,1);
  await assertFails(persistNewManualStockOrder('wrong-branch',{...order,requesting_branch_id:'branch-b'},[line],db));
  await env.withSecurityRulesDisabled(async ctx=>assert.equal((await getDoc(doc(ctx.firestore(),'stock_orders','wrong-branch'))).exists(),false));
  await assertFails(persistNewManualStockOrder('mixing',{...order,inventoryClass:'SELLABLE',category:'sellable_non_cosmetic'},[{...line,inventoryClass:'SELLABLE'}],db));
  await env.withSecurityRulesDisabled(async ctx=>assert.equal((await getDoc(doc(ctx.firestore(),'stock_orders','mixing'))).exists(),false));
  console.log('Manual branch Operational order regression passed.');
} finally { await env.cleanup(); rmSync('.operational-manual-order-emulator.mjs', {force:true}); }
