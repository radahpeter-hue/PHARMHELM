// Read-only, scoped to the Martin Pharma test tenant. No credentials or PII are logged.
import {api, runQuery, firestoreBase} from './firebase-rest-utils.mjs';
const tenantId = 'zehqTDcKyrDAOHKK3stJ';
const decode = v => v.stringValue ?? (v.integerValue !== undefined ? Number(v.integerValue) : v.doubleValue ?? v.booleanValue ?? (v.arrayValue ? (v.arrayValue.values || []).map(decode) : null));
const data = d => ({id:d.name.split('/').pop(),...Object.fromEntries(Object.entries(d.fields||{}).map(([k,v])=>[k,decode(v)]))});
for (const collectionId of ['operational_inventory','operational_inventory_masters','stock_orders','stock_order_lines','staff']) {
  const docs = (await runQuery({from:[{collectionId}],where:{fieldFilter:{field:{fieldPath:'tenantId'},op:'EQUAL',value:{stringValue:tenantId}}}})).map(data);
  const fields = collectionId === 'staff' ? ['id','role','assigned_branches','branch_id','default_branch_id','branchId','roleRealmId'] : ['id','inventoryClass','category','masterItemId','branchId','hqLocationItemId','requesting_branch_id','order_id','product_id','qty_ordered','unit_cost_ugx','line_total_ugx','status','order_number'];
  const rows = collectionId === 'staff' ? docs.filter(d=>String(d.role).toLowerCase()==='branch manager') : docs;
  console.log(JSON.stringify({collectionId,rows:rows.map(d=>Object.fromEntries(fields.filter(k=>k in d).map(k=>[k,d[k]])))},null,2));
}
