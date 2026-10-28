import { eligibleExpenseStaff } from '../src/utils/branchExpensePolicy';
import {test} from 'node:test';import assert from 'node:assert/strict';
import {operationalStaff,staffMatchesId} from '../src/utils/operationalStaff';
import {staffRegistrationConflict} from '../src/utils/staffIdentityAudit';
const current={id:'uid',uid:'uid',tenantId:'t',full_name:'Alex',email:'alex@example.com',phone_number:'0772123456',staff_code:'STF-000001'};
test('every operational list excludes explicit aliases while retaining historical ID lookup',()=>{
 const rows=operationalStaff([current,{...current,id:'old',uid:'old',duplicate_of:'uid',staff_code:undefined}]);
 assert.equal(rows.length,1);assert.equal(rows[0].id,'uid');assert.equal(staffMatchesId(rows[0],'old'),true);
 assert.equal(operationalStaff([{...current,id:'other',tenantId:'other',canonical_staff_id:'uid'},current]).length,1);
});
test('registration rejects repeat identity/contact/source conversion but permits different people sharing names',()=>{
 assert.ok(staffRegistrationConflict({...current,uid:''},[current]));
 assert.ok(staffRegistrationConflict({full_name:'ALEX',phone:'0772123456'},[current]));
 assert.equal(staffRegistrationConflict({full_name:'Alex',email:'different@example.com',phone_number:'0777654321'},[current]),undefined);
 assert.ok(staffRegistrationConflict({source_application_id:'app'},[{...current,source_application_id:'app'}]));
 assert.ok(staffRegistrationConflict({source_trainee_id:'trainee'},[{...current,source_trainee_id:'trainee'}]));
});

test('a stale active flag cannot make a retired duplicate an eligible expense recipient',()=>{assert.equal(eligibleExpenseStaff([{...current,duplicate_of:'canonical',active:true,status:'active'}] as any,'t').length,0);});
