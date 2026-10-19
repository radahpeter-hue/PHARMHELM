/** Targeted READ ONLY acceptance audit. No writes, staff data or raw IDs. */
import { initializeApp, applicationDefault, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
if(process.env.FIRESTORE_EMULATOR_HOST)throw new Error('Live named database required.');
const tenantId='zehqTDcKyrDAOHKK3stJ',branchId='1agW2eYBOGGqKR9w2V31';
const app=initializeApp({credential:applicationDefault(),projectId:'gen-lang-client-0911422817'},'stage2-receipt-readonly');
const db=getFirestore(app,'ai-studio-f7d8654b-e089-425a-a506-38159afe1e75');
const issues=[];
const report={mode:'READ_ONLY',orderNumber:'ORD-2026-15022',transferNumber:'OT-2026-1DRHF6O',issues};
const scoped=async(c,f,v)=>(await db.collection(c).where(f,'==',v).get()).docs.filter(d=>d.get('tenantId')===tenantId);
const belongs=d=>d.exists&&d.get('tenantId')===tenantId;
try {
 const orders=await scoped('stock_orders','order_number',report.orderNumber);
 if(orders.length!==1)throw new Error('Expected exactly one source order');
 const order=orders[0];report.orderStatus=order.get('status');report.historicalOrderRoute=order.get('operational_delivery_route')||null;
 const transfers=await scoped('operational_transfers','sourceOrderId',order.id);
 if(transfers.length!==1)issues.push('EXPECTED_ONE_TRANSFER');
 const matches=transfers.filter(d=>d.get('transferNumber')===report.transferNumber);
 if(matches.length!==1)throw new Error('Expected exactly one named transfer');
 const transfer=matches[0];report.transferStatus=transfer.get('status');report.historicalTransferRoute=transfer.get('deliveryRoute')||null;
 if(transfer.get('destinationBranchId')!==branchId)issues.push('WRONG_DESTINATION');
 if(transfer.get('status')!=='received')issues.push('TRANSFER_NOT_RECEIVED');
 const lines=await scoped('operational_transfer_lines','transferId',transfer.id);
 report.lineCount=lines.length;
 if(lines.length!==1||Number(transfer.get('expectedLineCount'))!==1)issues.push('LINE_COUNT_MISMATCH');
 const movements=await scoped('operational_inventory_movements','sourceTransactionId',transfer.id);
 report.dispatchMovementCount=movements.filter(m=>m.get('movementType')==='TRANSFER_OUT').length;
 report.receiptMovementCount=movements.filter(m=>m.get('movementType')==='TRANSFER_IN').length;
 if(movements.length!==2||report.dispatchMovementCount!==1||report.receiptMovementCount!==1)issues.push('MISSING_OR_DUPLICATE_TRANSFER_MOVEMENT');
 report.lines=[];
 for(const line of lines) {
  const row=line.data(),accepted=Number(row.quantityAccepted),queried=Number(row.quantityQueried||0);
  const item=await db.collection('operational_inventory').doc(row.destinationItemId).get();
  const master=await db.collection('operational_inventory_masters').doc(row.masterItemId).get();
  const dispatch=movements.filter(m=>m.get('sourceLineId')===line.id&&m.get('movementType')==='TRANSFER_OUT');
  const receipts=movements.filter(m=>m.get('sourceLineId')===line.id&&m.get('movementType')==='TRANSFER_IN');
  if(row.itemName!=='Pens'||row.status!=='received'||Number(row.quantityDispatched)!==24||accepted!==24||queried!==0)issues.push('RECEIPT_QUANTITY_OR_STATUS_MISMATCH');
  if(!belongs(item)||item.get('branchId')!==branchId||item.get('masterItemId')!==row.masterItemId||item.get('inventoryClass')!=='OPERATIONAL')issues.push('INVALID_BRANCH_STOCK_RECORD');
  if(!belongs(master)||master.get('inventoryClass')!=='OPERATIONAL'||!master.get('uniqueId'))issues.push('INVALID_MASTER_IDENTITY');
  if(dispatch.length!==1||dispatch[0]?.id!==row.dispatchMovementId||Number(dispatch[0]?.get('quantityDelta'))!==-24)issues.push('INVALID_DISPATCH_MOVEMENT');
  if(receipts.length!==1||receipts[0]?.id!==row.receiptMovementId||Number(receipts[0]?.get('quantityDelta'))!==accepted||receipts[0]?.get('itemId')!==item.id||receipts[0]?.get('branchId')!==branchId)issues.push('INVALID_RECEIPT_MOVEMENT');
  const receipt=receipts[0];
  if(receipt&&Number(receipt.get('balanceAfter'))-Number(receipt.get('balanceBefore'))!==accepted)issues.push('INVALID_RECEIPT_BALANCE_DELTA');
  // Account for any legitimate later consumption instead of assuming SOH still equals 24.
  const itemMovements=await scoped('operational_inventory_movements','itemId',item.id);
  const ordered=itemMovements.sort((a,b)=>String(a.get('createdAt')).localeCompare(String(b.get('createdAt'))));
  for(let i=0;i<ordered.length;i++) {
   const m=ordered[i],before=Number(m.get('balanceBefore')),after=Number(m.get('balanceAfter')),delta=Number(m.get('quantityDelta'));
   if(![before,after,delta].every(Number.isFinite)||after-before!==delta||(i&&before!==Number(ordered[i-1].get('balanceAfter'))))issues.push('STOCK_MOVEMENT_CHAIN_MISMATCH');
  }
  const last=ordered.at(-1);
  if(!last||Number(item.get('quantityInStock'))!==Number(last.get('balanceAfter'))||item.get('lastMovementId')!==last.id)issues.push('BRANCH_SOH_DOES_NOT_MATCH_LEDGER');
  const direct=transfer.get('deliveryRoute')==='DIRECT_BRANCH'||row.sourceItemId==='SUPPLIER_TRANSIT';
  if(direct&&dispatch.some(m=>m.get('branchId')==='HQ'))issues.push('DIRECT_ROUTE_DEDUCTED_HQ');
  if(!direct) {
   const source=await db.collection('operational_inventory').doc(row.sourceItemId).get();
   const outgoing=dispatch[0];
   if(!belongs(source)||source.get('branchId')!=='HQ'||source.get('masterItemId')!==row.masterItemId||outgoing?.get('itemId')!==source.id||outgoing?.get('branchId')!=='HQ'||Number(outgoing?.get('balanceBefore'))-Number(outgoing?.get('balanceAfter'))!==24)issues.push('INVALID_HISTORICAL_HQ_DEDUCTION');
   const sourceMovements=(await scoped('operational_inventory_movements','itemId',source.id)).sort((a,b)=>String(a.get('createdAt')).localeCompare(String(b.get('createdAt'))));
   for(let i=0;i<sourceMovements.length;i++) {
    const m=sourceMovements[i],before=Number(m.get('balanceBefore')),after=Number(m.get('balanceAfter')),delta=Number(m.get('quantityDelta'));
    if(![before,after,delta].every(Number.isFinite)||after-before!==delta||(i&&before!==Number(sourceMovements[i-1].get('balanceAfter'))))issues.push('HQ_MOVEMENT_CHAIN_MISMATCH');
   }
   const lastSource=sourceMovements.at(-1);
   if(!lastSource||Number(source.get('quantityInStock'))!==Number(lastSource.get('balanceAfter'))||source.get('lastMovementId')!==lastSource.id)issues.push('HQ_SOH_DOES_NOT_MATCH_LEDGER');
   report.hqSource={dispatchBefore:outgoing?.get('balanceBefore'),dispatchAfter:outgoing?.get('balanceAfter'),currentSOH:source.get('quantityInStock'),movementCount:sourceMovements.length};
  }

  report.lines.push({itemName:row.itemName,itemCode:belongs(master)?master.get('uniqueId')||null:null,status:row.status,dispatched:Number(row.quantityDispatched),accepted,queried,branchSOH:Number(item.get('quantityInStock')),receiptBalanceBefore:receipt?.get('balanceBefore'),receiptBalanceAfter:receipt?.get('balanceAfter'),historicalRoute:direct?'DIRECT_BRANCH':'VIA_HQ',itemMovementCount:ordered.length});
 }
 report.accepted=issues.length===0;
 console.log(JSON.stringify(report,null,2));
 if(issues.length)process.exitCode=1;
} finally {await deleteApp(app);}
