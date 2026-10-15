import { readFileSync, rmSync } from 'node:fs';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, deleteDoc, collection, query, where, serverTimestamp } from 'firebase/firestore';
import { build } from 'esbuild';
const tenantId = 'tenant-a', branchId = 'branch-a', itemId = 'pens';
const env = await initializeTestEnvironment({ projectId: 'pharmhelm-operational-inventory-v2-rules', firestore: { rules: readFileSync(process.env.OPERATIONAL_RULES_PATH || 'firestore.rules', 'utf8') } });
try {
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'system_settings', tenantId), {tenantId,featureToggles:{enableOperationalInventory:true}});
    await setDoc(doc(db, 'staff', 'manager'), {tenantId,role:'branch manager',assigned_branches:[branchId],secondaryRoles:[]});
    await setDoc(doc(db, 'staff', 'buyer'), {tenantId,role:'Procurement Head',assigned_branches:[branchId],secondaryRoles:[]});
    await setDoc(doc(db, 'staff', 'viewer'), {tenantId,role:'HR Support Personnel',assigned_branches:[branchId],secondaryRoles:[]});
    await setDoc(doc(db, 'products', 'sellable-a'), {tenantId,inventoryClass:'SELLABLE',category:'drug/medicine',name:'Medicine A'});
    await setDoc(doc(db, 'products', 'sellable-b'), {tenantId,inventoryClass:'SELLABLE',category:'drug/medicine',name:'Medicine B'});
    await setDoc(doc(db, 'role_realms_of_operation', `${tenantId}_branch_manager`), {tenantId,roleName:'branch manager',roleType:'standard',permissions:{}});
    await setDoc(doc(db, 'operational_inventory_masters', itemId), {tenantId,inventoryClass:'OPERATIONAL'});
    await setDoc(doc(db, 'operational_inventory', itemId), {tenantId,branchId,masterItemId:itemId,inventoryClass:'OPERATIONAL'});
    await setDoc(doc(db, 'operational_inventory', 'books'), {tenantId,branchId,masterItemId:itemId,inventoryClass:'OPERATIONAL'});
  });
  const db = env.authenticatedContext('manager',{tenantId,role:'branch manager'}).firestore();
  await assertSucceeds(setDoc(doc(db,'stock_orders','manual'), {tenantId,inventoryClass:'OPERATIONAL',order_type:'monthly',category:'non_sellable',generation_method:'manual',status:'submitted',is_emergency:false,submitted_by:'manager',total_order_value_ugx:12000,submitted_at:new Date().toISOString(),order_number:'ORD-TEST',requesting_branch_id:branchId,requesting_branch_name:'Masaka',createdAt:serverTimestamp(),updatedAt:serverTimestamp()}));
  await assertSucceeds(setDoc(doc(db,'stock_order_lines','manual-line'), {tenantId,inventoryClass:'OPERATIONAL',masterItemId:itemId,product_id:itemId,product_name:'Pens',qty_ordered:1,unit_cost_ugx:12000,line_total_ugx:12000,isOperational:true,order_id:'manual',line_status:'ordered',createdAt:serverTimestamp(),updatedAt:serverTimestamp()}));
  await build({stdin:{contents:"export {persistNewManualStockOrder,persistManualStockOrderDraft} from './src/services/manualStockOrderService';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',packages:'external',outfile:'.operational-manual-order-emulator.mjs'});
  const {persistNewManualStockOrder,persistManualStockOrderDraft} = await import('../.operational-manual-order-emulator.mjs');
  const order={tenantId,inventoryClass:'OPERATIONAL',category:'non_sellable',requesting_branch_id:branchId,status:'submitted'};
  const line={tenantId,inventoryClass:'OPERATIONAL',masterItemId:itemId,product_id:itemId,qty_ordered:1,unit_cost_ugx:12000,line_total_ugx:12000};
  await assertSucceeds(persistNewManualStockOrder('atomic-manual',order,[line],db));
  await assertSucceeds(persistNewManualStockOrder('atomic-manual',order,[line],db));
  const lines=await getDocs(query(collection(db,'stock_order_lines'),where('tenantId','==',tenantId),where('order_id','==','atomic-manual')));
  assert.equal(lines.size,1);
  const bookLine={...line,product_id:'books'};
  await assertSucceeds(persistNewManualStockOrder('draft-manual',{...order,status:'draft'},[line,bookLine],db));
  const previous = [{...line,id:'draft-manual_pens'},{...bookLine,id:'draft-manual_books'}];
  await assertSucceeds(persistManualStockOrderDraft('draft-manual',order,previous,[{...line,qty_ordered:2,line_total_ugx:24000}],db));
  assert.equal((await getDoc(doc(db,'stock_order_lines','draft-manual_pens'))).data().qty_ordered,2);
  const draftLines=await getDocs(query(collection(db,'stock_order_lines'),where('tenantId','==',tenantId),where('order_id','==','draft-manual')));
  assert.equal(draftLines.size,1);
  await assertFails(deleteDoc(doc(db,'stock_order_lines','draft-manual_pens')));
  await assertFails(persistNewManualStockOrder('wrong-branch',{...order,requesting_branch_id:'branch-b'},[line],db));
  await env.withSecurityRulesDisabled(async ctx=>assert.equal((await getDoc(doc(ctx.firestore(),'stock_orders','wrong-branch'))).exists(),false));
  await assertFails(persistNewManualStockOrder('mixing',{...order,inventoryClass:'SELLABLE',category:'sellable_non_cosmetic'},[{...line,inventoryClass:'SELLABLE'}],db));
  await env.withSecurityRulesDisabled(async ctx=>assert.equal((await getDoc(doc(ctx.firestore(),'stock_orders','mixing'))).exists(),false));
  // A sellable auto-generated order intentionally lands in Draft Orders.
  // Loading it, editing quantities and submitting must retain its identity,
  // delete only omitted draft lines, and become visible to Procurement.
  const buyerDb = env.authenticatedContext('buyer',{tenantId,role:'Procurement Head'}).firestore();
  const viewerDb = env.authenticatedContext('viewer',{tenantId,role:'HR Support Personnel'}).firestore();
  const autoId = 'auto_order_masaka_suggested';
  const autoHeader = { tenantId, inventoryClass:'SELLABLE', category:'sellable_non_cosmetic',
    requesting_branch_id:branchId, requesting_branch_name:'Masaka', order_number:'ORD-MASAKA-AUTO',
    generation_method:'auto_generated', order_type:'monthly', status:'draft',
    autoGenerateRunId:'RUN-MASAKA', total_order_value_ugx:3000 };
  const medicineA = {tenantId,inventoryClass:'SELLABLE',product_id:'sellable-a',product_name:'Medicine A',
    qty_ordered:1,unit_cost_ugx:1000,line_total_ugx:1000};
  const medicineB = {tenantId,inventoryClass:'SELLABLE',product_id:'sellable-b',product_name:'Medicine B',
    qty_ordered:2,unit_cost_ugx:1000,line_total_ugx:2000};
  await assertSucceeds(persistNewManualStockOrder(autoId, autoHeader,[medicineA,medicineB],buyerDb));
  const existing = await getDocs(query(collection(buyerDb,'stock_order_lines'),
    where('tenantId','==',tenantId),where('order_id','==',autoId)));
  assert.equal(existing.size,2);
  const newHeader={...autoHeader,status:'submitted',submitted_at:new Date().toISOString(),total_order_value_ugx:5000};
  const revisedA={...medicineA,qty_ordered:5,line_total_ugx:5000};
  await assertFails(persistManualStockOrderDraft(autoId,newHeader,existing.docs.map(d=>({id:d.id,...d.data()})),[revisedA],viewerDb));
  await env.withSecurityRulesDisabled(async ctx => {
    const header = (await getDoc(doc(ctx.firestore(),'stock_orders',autoId))).data();
    assert.equal(header.status,'draft');
  });
  await assertSucceeds(persistManualStockOrderDraft(autoId,newHeader,existing.docs.map(d=>({id:d.id,...d.data()})),[revisedA],buyerDb));
  const updated = (await getDoc(doc(buyerDb,'stock_orders',autoId))).data();
  assert.equal(updated.status,'submitted');
  assert.equal(updated.order_number,'ORD-MASAKA-AUTO');
  assert.equal(updated.autoGenerateRunId,'RUN-MASAKA');
  const remaining = await getDocs(query(collection(buyerDb,'stock_order_lines'),
    where('tenantId','==',tenantId),where('order_id','==',autoId)));
  assert.equal(remaining.size,1);
  assert.equal(remaining.docs[0].data().qty_ordered,5);
  await assertFails(deleteDoc(doc(buyerDb,'stock_order_lines',remaining.docs[0].id)));
  console.log('Auto-generated Masaka draft to Procurement handoff and authorization passed.');
    console.log('Manual branch Operational order regression passed.');
} finally { await env.cleanup(); rmSync('.operational-manual-order-emulator.mjs', {force:true}); }
