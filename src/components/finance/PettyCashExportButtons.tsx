import React, { useState } from 'react';
import { toast } from 'sonner';
import { exportRecordsToExcel } from '../../utils/excelExport';
import { pettyCashCSV, pettyCashReportRows, type PettyCashExportRow } from '../../utils/pettyCashExport';
export function PettyCashExportButtons({ rows, name, range, branch }: {
  rows: PettyCashExportRow[]; name: string; range: { start: string; end: string }; branch: string;
}) {
  const [busy, setBusy] = useState(false);
  const download = async (format: 'csv' | 'xlsx') => {
    setBusy(true);
    try {
      const filename = `${name}-${branch}-${range.start || 'beginning'}-${range.end || 'latest'}`.replace(/[^a-zA-Z0-9-]/g, '-');
      const report = pettyCashReportRows(rows);
      if (format === 'xlsx') await exportRecordsToExcel(report, name, `${filename}.xlsx`);
      else {
        const url = URL.createObjectURL(new Blob([pettyCashCSV(report)], { type: 'text/csv;charset=utf-8;' }));
        const a = document.createElement('a');
        a.href = url; a.download = `${filename}.csv`; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch { toast.error('Could not download petty cash report.'); }
    finally { setBusy(false); }
  };
  return <div className="flex flex-wrap gap-3 mt-3 text-xs font-semibold text-emerald-700">
    {(['csv', 'xlsx'] as const).map(format => <button key={format} disabled={busy || rows.length === 0}
      className="disabled:opacity-40" onClick={() => download(format)} aria-label={`Download ${name} ${format.toUpperCase()}`}>
      Download {format === 'xlsx' ? 'Excel (.xlsx)' : 'CSV'}
    </button>)}
  </div>;
}
