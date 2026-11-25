import {useEffect,useState} from 'react';
import {collection,onSnapshot,query,where} from 'firebase/firestore';
import {db} from '../firebase';
import {PAYROLL_BATCHES} from '../domain/finance/payroll';
import type {PayrollBatch} from '../services/payrollFinanceService';

export function usePayrollBatches(tenantId?:string){
  const [state,setState]=useState<{tenantId:string;rows:PayrollBatch[]}>({tenantId:'',rows:[]});
  useEffect(()=>{
    if(!tenantId)return;
    return onSnapshot(query(collection(db,PAYROLL_BATCHES),where('tenantId','==',tenantId)),snapshot=>{
      setState({tenantId,rows:snapshot.docs.map(d=>({...d.data(),id:d.id}) as PayrollBatch)});
    },error=>{console.error('Payroll batches unavailable',error);setState({tenantId,rows:[]});});
  },[tenantId]);
  return state.tenantId===tenantId?state.rows:[];
}
