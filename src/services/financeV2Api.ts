import {auth} from '../firebase';
export async function financeV2Api(action:string,input:unknown){
 const base=import.meta.env.VITE_FINANCE_V2_API_BASE_URL;
 if(!base)throw new Error('Finance V2 API is not configured.');
 const user=auth.currentUser;if(!user)throw new Error('Sign in required.');
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),30000);
 try{
 const response=await fetch(`${base.replace(/\/$/,'')}/api/finance-v2/${action}`,{method:'POST',headers:{Authorization:`Bearer ${await user.getIdToken()}`,'Content-Type':'application/json'},body:JSON.stringify(input),signal:controller.signal});
 const result=await response.json();if(!response.ok)throw new Error(result.error||'Request rejected');return result;
 }finally{clearTimeout(timer);}
}
