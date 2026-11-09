import React, {useState} from 'react';
import {Download} from 'lucide-react';
import {toast} from 'sonner';
import {exportRecordsToExcel} from '../../utils/excelExport';
import {pettyCashCSV,type PettyCashExportRow} from '../../utils/pettyCashExport';

export function TreasuryLedgerExports({rows,disabled=false,filename='treasury-ledger'}:{
  rows: () => PettyCashExportRow[]; filename?: string; disabled?: boolean;
}) {
  const [busy,setBusy]=useState(false);

  async function download(format:'csv'|'xlsx') {
    const records=rows();
    if(!records.length)return;
    setBusy(true);
    try {
      if(format==='xlsx') {
        await exportRecordsToExcel(records,'Ledger',filename+'.xlsx',{readable:true});
        return;
      }
      const url=URL.createObjectURL(new Blob([pettyCashCSV(records)],{type:'text/csv;charset=utf-8'}));
      const link=document.createElement('a');
      link.href=url;
      link.download=filename+'.csv';
      link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    } catch {
      toast.error('Could not download the ledger.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="flex flex-wrap gap-2 self-end">
    {(['xlsx','csv'] as const).map(format=><button key={format} type="button" disabled={busy||disabled}
      onClick={()=>void download(format)} className="flex min-h-11 items-center gap-2 rounded-xl border border-emerald-700 px-3 text-sm font-semibold text-emerald-800 disabled:opacity-50">
      <Download size={16}/>Export {format==='xlsx'?'Excel':'CSV'}
    </button>)}
  </div>;
}
