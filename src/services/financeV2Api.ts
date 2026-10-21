import {auth} from '../firebase';
import {requestFinanceV2} from './financeV2Transport';
// One shared endpoint for accounts, transfers and EOD. The former EOD setting
// remains a migration fallback only when it names this same service's route.
const oldEod=import.meta.env.VITE_FINANCE_V2_EOD_API_URL;
const base=import.meta.env.VITE_FINANCE_V2_API_BASE_URL || (oldEod?.endsWith('/api/finance-v2/eod') ? oldEod.slice(0,-'/api/finance-v2/eod'.length) : '');
export const financeV2ApiConfigured=Boolean(base);
export async function financeV2Api(action:string,input:unknown){
 if(!base)throw new Error('Finance V2 API is not configured.');
 const user=auth.currentUser;if(!user)throw new Error('Sign in required.');
 return requestFinanceV2(base,action,input,()=>user.getIdToken());
}
