import {useEffect,useState} from 'react';
import {collection,onSnapshot,query,where} from 'firebase/firestore';
import {db} from '../firebase';
import {PAYROLL_BATCHES} from '../domain/finance/payroll';
import type {PayrollBatch} from '../services/payrollFinanceService';

export function usePayrollBatchState(tenantId?:string){
  const [state,setState]=useState<{tenantId:string;rows:PayrollBatch[];loaded:boolean;error:string}>({tenantId:'',rows:[],loaded:false,error:''});
  useEffect(()=>{
    if(!tenantId)return;
    return onSnapshot(query(collection(db,PAYROLL_BATCHES),where('tenantId','==',tenantId)),snapshot=>{
      setState({tenantId,rows:snapshot.docs.map(d=>({...d.data(),id:d.id}) as PayrollBatch),loaded:true,error:''});
    },error=>{console.error('Payroll batches unavailable',error);setState({tenantId,rows:[],loaded:true,error:'Unable to load payroll history. Payroll preparation is blocked until access is restored.'});});
  },[tenantId]);
  const current=state.tenantId===tenantId;
  return {rows:current?state.rows:[],loading:!!tenantId&&(!current||!state.loaded),error:current?state.error:''};
}
export function usePayrollBatches(tenantId?:string){return usePayrollBatchState(tenantId).rows;}
