import { readFileSync, rmSync } from 'node:fs';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, deleteDoc, collection, query, where, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
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
  await build({stdin:{contents:"export {persistNewManualStockOrder,persistManualStockOrderDraft,loadManualStockOrderDraft} from './src/services/manualStockOrderService';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',packages:'external',outfile:'.operational-manual-order-emulator.mjs'});
  const {persistNewManualStockOrder,persistManualStockOrderDraft,loadManualStockOrderDraft} = await import('../.operational-manual-order-emulator.mjs');
  const order={tenantId,inventoryClass:'OPERATIONAL',category:'non_sellable',requesting_branch_id:branchId,status:'submitted'};
  const line={tenantId,inventoryClass:'OPERATIONAL',masterItemId:itemId,product_id:itemId,qty_ordered:1,unit_cost_ugx:12000,line_total_ugx:12000};
  await assertSucceeds(persistNewManualStockOrder('manual_00000000000000000001',order,[line],db));
  await assertSucceeds(persistNewManualStockOrder('manual_00000000000000000001',order,[line],db));
  const lines=await getDocs(query(collection(db,'stock_order_lines'),where('tenantId','==',tenantId),where('order_id','==','manual_00000000000000000001')));
  assert.equal(lines.size,1);
  const bookLine={...line,product_id:'books'};
  await assertSucceeds(persistNewManualStockOrder('manual_00000000000000000002',{...order,status:'draft'},[line,bookLine],db));
  const draftRevision = (await loadManualStockOrderDraft('manual_00000000000000000002', db)).revision;
  await assertSucceeds(persistManualStockOrderDraft('manual_00000000000000000002',order,[{...line,qty_ordered:2,line_total_ugx:24000}],draftRevision,db));
  assert.equal((await getDoc(doc(db,'stock_order_lines','manual_00000000000000000002_pens'))).data().qty_ordered,2);
  const draftLines=await getDocs(query(collection(db,'stock_order_lines'),where('tenantId','==',tenantId),where('order_id','==','manual_00000000000000000002')));
  assert.equal(draftLines.size,1);
  await assertFails(deleteDoc(doc(db,'stock_order_lines','manual_00000000000000000002_pens')));
  await assertFails(persistNewManualStockOrder('manual_00000000000000000003',{...order,requesting_branch_id:'branch-b'},[line],db));
  await env.withSecurityRulesDisabled(async ctx=>assert.equal((await getDoc(doc(ctx.firestore(),'stock_orders','manual_00000000000000000003'))).exists(),false));
  await assertFails(persistNewManualStockOrder('manual_00000000000000000004',{...order,inventoryClass:'SELLABLE',category:'sellable_non_cosmetic'},[{...line,inventoryClass:'SELLABLE'}],db));
  await env.withSecurityRulesDisabled(async ctx=>assert.equal((await getDoc(doc(ctx.firestore(),'stock_orders','manual_00000000000000000004'))).exists(),false));
  // A sellable auto-generated order intentionally lands in Draft Orders.
  // Loading it, editing quantities and submitting must retain its identity,
  // delete only omitted draft lines, and become visible to Procurement.
  const buyerDb = env.authenticatedContext('buyer',{tenantId,role:'Procurement Head'}).firestore();
  const viewerDb = env.authenticatedContext('viewer',{tenantId,role:'HR Support Personnel'}).firestore();
  const autoId = 'manual_00000000000000000005';
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
  await assertFails(persistManualStockOrderDraft(autoId,newHeader,[revisedA],null,viewerDb));
  await env.withSecurityRulesDisabled(async ctx => {
    const header = (await getDoc(doc(ctx.firestore(),'stock_orders',autoId))).data();
    assert.equal(header.status,'draft');
  });
  await assertSucceeds(persistManualStockOrderDraft(autoId,newHeader,[revisedA],(await loadManualStockOrderDraft(autoId, buyerDb)).revision,buyerDb));
  const updated = (await getDoc(doc(buyerDb,'stock_orders',autoId))).data();
  assert.equal(updated.status,'submitted');
  assert.equal(updated.order_number,'ORD-MASAKA-AUTO');
  assert.equal(updated.autoGenerateRunId,'RUN-MASAKA');
  const remaining = await getDocs(query(collection(buyerDb,'stock_order_lines'),
    where('tenantId','==',tenantId),where('order_id','==',autoId)));
  assert.equal(remaining.size,1);
  assert.equal(remaining.docs[0].data().qty_ordered,5);
  await assertFails(deleteDoc(doc(buyerDb,'stock_order_lines',remaining.docs[0].id)));
  const largeSellableId = 'manual_00000000000000000006';
  const largeOperationalId = 'manual_00000000000000000007';
  const sellable = Array.from({length:210}, (_, i) => ({...medicineA, product_id:`large-sellable-${i}`}));
  const operational = Array.from({length:210}, (_, i) => ({...line, product_id:`large-operational-${i}`}));
  await env.withSecurityRulesDisabled(async ctx => {
    const seed = ctx.firestore();
    const batch = writeBatch(seed);
    for (const item of sellable.slice(0, -1)) {
      batch.set(doc(seed, 'products', item.product_id), {tenantId, inventoryClass: 'SELLABLE', category: 'drug/medicine'});
    }
    for (const item of operational) {
      batch.set(doc(seed, 'operational_inventory', item.product_id), {tenantId, inventoryClass:'OPERATIONAL', branchId, masterItemId:itemId});
    }
    await batch.commit();
  });
  const request = {...newHeader, total_order_value_ugx:210000, order_number:'ORD-LARGE-SELLABLE'};
  const sellableRef = doc(db, 'stock_orders', largeSellableId);
  // The last product is absent. Earlier slices must commit without publishing a partial order.
  await assertFails(persistNewManualStockOrder(largeSellableId, request, sellable, db));
  const interrupted = (await getDoc(sellableRef)).data();
  assert.equal(interrupted.status, 'draft');
  assert.equal(interrupted.manualOrderSave.next, 208);
  await assertFails(updateDoc(sellableRef, {status:'submitted'}));
  const restored = await loadManualStockOrderDraft(largeSellableId, db);
  assert.equal(restored.pending, true);
  assert.equal(restored.lines.length, 210);
  assert.equal(restored.lines.at(-1).product_id, sellable.at(-1).product_id);
  await assert.rejects(persistManualStockOrderDraft(largeSellableId, request, restored.lines, 'outdated', db), /draft changed/);
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), 'products', sellable.at(-1).product_id),
      {tenantId, inventoryClass:'SELLABLE', category:'drug/medicine'});
  });
  await assertSucceeds(persistNewManualStockOrder(largeSellableId, request, sellable, db));
  await assertSucceeds(persistNewManualStockOrder(largeSellableId, request, sellable, db));
  assert.equal((await getDoc(doc(buyerDb, 'stock_orders', largeSellableId))).data().status, 'submitted');
  const checkLines = async (orderId, expected) => {
    const saved = await getDocs(query(collection(buyerDb, 'stock_order_lines'),
      where('tenantId','==',tenantId), where('order_id','==',orderId)));
    assert.equal(saved.size, expected);
    return saved.docs.reduce((sum, snapshot) => sum + snapshot.data().line_total_ugx, 0);
  };
  assert.equal(await checkLines(largeSellableId, 210), request.total_order_value_ugx);

  const operationalRequest = {...order, status:'draft', order_number:'ORD-LARGE-OPS', total_order_value_ugx:210*12000};
  await assertSucceeds(persistNewManualStockOrder(largeOperationalId, operationalRequest, operational, db));
  const largeDraft = await loadManualStockOrderDraft(largeOperationalId, db);
  assert.equal(largeDraft.pending, false);
  assert.equal(largeDraft.lines.length, 210);
  const kept = largeDraft.lines.slice(0, 205);
  const finalRequest = {...operationalRequest, status:'submitted', total_order_value_ugx:205*12000};
  await assertSucceeds(persistManualStockOrderDraft(largeOperationalId, finalRequest, kept, largeDraft.revision, db));
  assert.equal(await checkLines(largeOperationalId, 205), finalRequest.total_order_value_ugx);
  assert.equal((await getDoc(doc(buyerDb, 'stock_orders', largeOperationalId))).data().status, 'submitted');
  console.log('Large Sellable and Operational orders, interruption recovery and stale draft protection passed.');
  console.log('Auto-generated Masaka draft to Procurement handoff and authorization passed.');
    console.log('Manual branch Operational order regression passed.');
} finally { await env.cleanup(); rmSync('.operational-manual-order-emulator.mjs', {force:true}); }
