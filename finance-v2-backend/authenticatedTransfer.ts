import type {Auth} from 'firebase-admin/auth';
import type {Firestore} from 'firebase-admin/firestore';
import {postTrustedFinanceV2Transfer,type TrustedFinanceActor} from '../src/services/financeV2TrustedTransferCore';
import type {FinanceV2TransferInput} from '../src/services/financeV2TransferPolicy';
import {createFinanceV2AdminStore} from './adminStore';

/** Not mounted on production. Requires an authenticated bearer token and an
 * explicit server-controlled feature flag. Never trusts role/tenant from body. */
export async function executeAuthenticatedFinanceV2Transfer(
 auth:Pick<Auth,'verifyIdToken'>, db:Firestore, idToken:string, requested:FinanceV2TransferInput,
 enabled:boolean
){
 if(enabled!==true)throw new Error('Finance V2 backend transfer execution is disabled');
 if(typeof idToken!=='string'||idToken.length<20)throw new Error('Authentication token required');
 const identity=await auth.verifyIdToken(idToken,true);
 if(!identity.uid||identity.uid!==requested.actorUid)throw new Error('Authenticated actor mismatch');
 const snap=await db.doc('staff/'+identity.uid).get();
 if(!snap.exists)throw new Error('Finance staff profile does not exist');
 const staff=snap.data()??{};
 const roles=[staff.role,...(Array.isArray(staff.secondaryRoles)?staff.secondaryRoles:[])];
 const authorised=roles.some(role=>['Finance Head','Finance Officer','Accountant'].includes(role));
 const actor:TrustedFinanceActor={uid:identity.uid,tenantId:String(staff.tenantId??''),
  active:staff.active===true&&staff.status==='active',canPostFinance:authorised};
 if(!actor.active||!actor.canPostFinance||actor.tenantId!==requested.tenantId)throw new Error('Finance actor is not authorised for tenant');
 const tenant=await db.doc('tenants/'+requested.tenantId).get();
 if(!tenant.exists||tenant.data()?.status==='suspended')throw new Error('Tenant unavailable for Finance V2');
 return postTrustedFinanceV2Transfer(createFinanceV2AdminStore(db),actor,requested);
}
