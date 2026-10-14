import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generatedSupplierCode,supplierRegistryFields,supplierEligibleForStream} from '../src/services/supplierRegistryPolicy';
test('supplier eligibility separates streams, supports both and excludes suspended suppliers',()=>{
  const operational={inventoryCapabilities:['NON_SELLABLE_OPERATIONAL']};
  assert.equal(supplierEligibleForStream(operational,'OPERATIONAL'),true);
  assert.equal(supplierEligibleForStream(operational,'SELLABLE'),false);
  assert.equal(supplierEligibleForStream({...operational,inventoryCapabilities:['NON_SELLABLE_OPERATIONAL','DRUGS']},'SELLABLE'),true);
  assert.equal(supplierEligibleForStream({...operational,is_suspended:true},'OPERATIONAL'),false);
  assert.equal(supplierEligibleForStream({},'SELLABLE'),true);
  assert.equal(supplierEligibleForStream({},'OPERATIONAL'),false);
});
test('supplier codes are generated deterministically from a unique record identity',()=>{
  assert.equal(generatedSupplierCode('uniqueRecord'),'SUP-uniqueRecord');
  assert.notEqual(generatedSupplierCode('uniqueRecord'),generatedSupplierCode('otherRecord'));
  assert.throws(()=>generatedSupplierCode('tenant/supplier'));
});
test('supplier field policy normalizes capabilities without accepting editable codes or tenancy',()=>{
  const fields=supplierRegistryFields({supplier_name:'  Office Supplies  ',supplier_id:'manual',tenantId:'other',inventoryCapabilities:['NON_SELLABLE_OPERATIONAL','DRUGS','DRUGS']});
  assert.equal(fields.supplier_name,'Office Supplies');
  assert.deepEqual(fields.inventoryCapabilities,['DRUGS','NON_SELLABLE_OPERATIONAL']);
  assert.equal('supplier_id' in fields,false);
  assert.equal('tenantId' in fields,false);
  assert.throws(()=>supplierRegistryFields({supplier_name:'',inventoryCapabilities:[]}));
  assert.throws(()=>supplierRegistryFields({supplier_name:'Vendor',inventoryCapabilities:['INVALID']}));
});
test('Procurement and CRM use one supplier editor and the same live register',()=>{
  for(const page of ['Procurement','Clients']) {
    const source=readFileSync(new URL(`../src/pages/${page}.tsx`,import.meta.url),'utf8');
    assert.match(source,/SupplierEditor/);
    assert.match(source,/'supplier_registry'/);
    assert.doesNotMatch(source,/Supplier ID \/ Code/);
  }
});
test('supplier modal bounds mobile height, scrolls its body and keeps controls outside that body',()=>{
  const source=readFileSync(new URL('../src/components/procurement/SupplierEditor.tsx',import.meta.url),'utf8');
  assert.match(source,/100dvh/);
  assert.match(source,/min-h-0 min-w-0 flex-1 overflow-y-auto/);
  assert.match(source,/<\/fieldset>[\s\S]*<footer className="flex shrink-0/);
  assert.match(source,/safe-area-inset-bottom/);
  assert.match(source,/hasPermission\(sourceModule,'operate'\)/);
  assert.match(source,/aria-label="Supplier ID" readOnly/);
});
