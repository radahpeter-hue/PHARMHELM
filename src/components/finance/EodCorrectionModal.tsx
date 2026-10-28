import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { correctEod, EOD_CHANNELS } from '../../services/eodCorrectionService';
import { toast } from 'sonner';
export function EodCorrectionModal({ record, onClose, onSaved }: {record: any; onClose: () => void; onSaved: () => void}) {
  const { profile } = useAuth();
  const [values, setValues] = useState<Record<string, number>>(() => Object.fromEntries(EOD_CHANNELS.map(c => [c, record[`${c}_actual`] || 0])));
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false);
  return <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Correct EOD reconciliation">
    <form className="bg-white rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto space-y-3" onSubmit={async e => {
      e.preventDefault(); if (!profile || busy) return; setBusy(true);
      try { await correctEod(record.id, profile, values, reason); toast.success('EOD correction saved.'); onSaved(); onClose(); }
      catch (error) { toast.error(error instanceof Error ? error.message : 'Correction failed.'); }
      finally { setBusy(false); }
    }}>
      <h3 className="font-bold text-lg">Correct EOD — {record.reconciliation_date}</h3>
      <p className="text-xs text-zinc-500">IT Head only. Corrections close 14 days after the reconciliation date, at Kampala midnight. Expected amounts and the original date remain fixed.</p>
      {EOD_CHANNELS.map(channel => <label key={channel} className="block text-sm capitalize">{channel.replaceAll('_',' ')} declared (UGX)
        <input required type="number" min="0" step="any" className="block border rounded-lg p-2 w-full" value={values[channel]} onChange={e => setValues({...values,[channel]:Number(e.target.value)})} />
      </label>)}
      <label className="block text-sm">Correction reason<textarea required maxLength={1000} className="block border rounded-lg p-2 w-full" value={reason} onChange={e => setReason(e.target.value)} /></label>
      <div className="flex gap-4"><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button disabled={busy || !reason.trim()} className="px-4 py-2 rounded-lg bg-emerald-600 text-white">{busy ? 'Saving…' : 'Save correction'}</button></div>
    </form>
  </div>;
}
