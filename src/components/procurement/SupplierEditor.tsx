import React, {useRef, useState} from 'react';
import {collection, doc} from 'firebase/firestore';
import {X} from 'lucide-react';
import {toast} from 'sonner';
import {db} from '../../firebase';
import {useAuth} from '../../contexts/AuthContext';
import {saveSupplierRegistry} from '../../services/supplierRegistryService';
import {SUPPLIER_CAPABILITIES} from '../../services/supplierRegistryPolicy';

const capabilityLabels = ['Drugs', 'Cosmetics', 'Sellable Consumables', 'Devices', 'Operational / Non-Sellable'];
const paymentTerms = ['Cash on delivery', 'Cash in advance', 'Net 7 days', 'Net 14 days', 'Net 30 days', 'Net 60 days', 'Net 90 days'];
const inputClass = 'w-full max-w-full min-w-0 min-h-11 text-zinc-900 placeholder:text-zinc-500 px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 outline-none';

export const SupplierEditor: React.FC<{supplier: any; onClose: () => void; sourceModule: 'clients' | 'procurement'}> = ({supplier,onClose,sourceModule}) => {
  const {profile,hasPermission} = useAuth();
  const requestId = useRef(supplier?.id || doc(collection(db,'supplier_registry')).id);
  const [form,setForm] = useState<Record<string, any>>({supplier_name:'',commercial_category:'Wholesale',nda_licence_status:'valid',inventoryCapabilities:[],...supplier,payment_terms:supplier ? (supplier.payment_terms || '') : 'Cash on delivery'});
  const [customTerms,setCustomTerms] = useState(Boolean(supplier?.payment_terms && !paymentTerms.includes(supplier.payment_terms)));
  const [saving,setSaving] = useState(false);
  const permitted = hasPermission(sourceModule,'operate');
  const field = (name:string,value:any) => setForm(current=>({...current,[name]:value}));
  const submit = async (event:React.FormEvent) => {
    event.preventDefault();
    if (saving || !permitted || !profile?.tenantId) return;
    setSaving(true);
    try {
      await saveSupplierRegistry({id:requestId.current,tenantId:profile.tenantId,actorId:profile.uid,isNew:!supplier,sourceModule,roles:[profile.role,...(profile.secondaryRoles || [])],data:form});
      toast.success(supplier ? 'Supplier updated' : 'Supplier added');
      onClose();
    } catch(error) {toast.error(error instanceof Error ? error.message : 'Failed to save supplier');}
    finally {setSaving(false);}
  };
  const textField = (name:string,label:string,type='text') => <label className="min-w-0 space-y-1" key={name}>
    <span className="text-sm font-medium text-zinc-600">{label}</span>
    <input aria-label={label} type={type} required={name==='supplier_name'} value={form[name] || ''} onChange={event=>field(name,event.target.value)} className={inputClass}/>
  </label>;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4">
    <form role="dialog" aria-modal="true" aria-labelledby="supplier-editor-title" onSubmit={submit} className="flex max-h-[calc(100dvh-1rem)] w-full min-w-0 max-w-2xl flex-col overflow-hidden rounded-2xl bg-white text-zinc-900 shadow-2xl [color-scheme:light] sm:max-h-[calc(100dvh-2rem)]">
      <header className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-4 py-4 sm:px-6">
        <h2 id="supplier-editor-title" className="text-xl font-bold">{supplier ? 'Edit Supplier' : 'Add Supplier'}</h2>
        <button aria-label="Close supplier form" type="button" disabled={saving} onClick={onClose} className="flex min-h-11 min-w-11 items-center justify-center p-2"><X size={20}/></button>
      </header>
      <div data-testid="supplier-editor-scroll" className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-4 sm:p-6 [touch-action:pan-y]">
        <fieldset disabled={saving || !permitted} className="m-0 w-full min-w-0 p-0">
        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
          {textField('supplier_name','Supplier Name')}
          <label className="min-w-0 space-y-1"><span className="text-sm font-medium text-zinc-600">Supplier ID</span><input aria-label="Supplier ID" readOnly value={supplier?.supplier_id || 'Generated automatically on save'} className={inputClass}/></label>
          <label className="space-y-1"><span className="text-sm font-medium text-zinc-600">Category</span><select aria-label="Supplier Category" value={form.commercial_category} onChange={event=>field('commercial_category',event.target.value)} className={inputClass}>
            {[...new Set(['Wholesale','Manufacturer','Distributor','Importer','Local Distributor',form.commercial_category])].map(value=><option key={value} value={value}>{value}</option>)}
          </select></label>
          <div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4 sm:col-span-2">
            <h3 className="font-semibold">Supply Capabilities</h3><p className="text-sm text-zinc-500">Select the types of items this supplier provides.</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {SUPPLIER_CAPABILITIES.map((value,index)=><label key={value} className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5 shrink-0" checked={(form.inventoryCapabilities || []).includes(value)} onChange={()=>field('inventoryCapabilities',(form.inventoryCapabilities || []).includes(value) ? form.inventoryCapabilities.filter((item:string)=>item!==value) : [...(form.inventoryCapabilities || []),value])}/>{capabilityLabels[index]}</label>)}
            </div>
          </div>
          {textField('nda_wholesale_licence_number','NDA Licence Number')}
          {textField('nda_licence_expiry_date','Licence Expiry','date')}
          <label className="space-y-1"><span className="text-sm font-medium text-zinc-600">Licence Status</span><select aria-label="Licence Status" value={form.nda_licence_status} onChange={event=>field('nda_licence_status',event.target.value)} className={inputClass}><option value="valid">Valid</option><option value="expiring_soon">Expiring Soon</option><option value="expired">Expired</option></select></label>
          {textField('tin','Supplier TIN')}
          <div className="min-w-0 space-y-2">
            <label className="block space-y-1">
              <span className="text-sm font-medium text-zinc-600">Payment Terms</span>
              <select aria-label="Payment Terms" value={customTerms ? 'custom' : (form.payment_terms || '')} onChange={event=>{
                const value = event.target.value;
                setCustomTerms(value === 'custom');
                field('payment_terms',value === 'custom' ? '' : value);
              }} className={inputClass}>
                <option value="">Not specified</option>
                {paymentTerms.map(value=><option key={value} value={value}>{value}</option>)}
                <option value="custom">Custom terms</option>
              </select>
            </label>
            {customTerms && <label className="block space-y-1">
              <span className="text-sm font-medium text-zinc-600">Custom Payment Terms</span>
              <input aria-label="Custom Payment Terms" required value={form.payment_terms || ''} onChange={event=>field('payment_terms',event.target.value)} placeholder="Enter agreed payment terms" className={inputClass}/>
            </label>}
          </div>
          <label className="min-w-0 space-y-1 sm:col-span-2"><span className="text-sm font-medium text-zinc-600">Address / Location</span><textarea aria-label="Address / Location" value={form.address || ''} onChange={event=>field('address',event.target.value)} className={inputClass} rows={2}/></label>
          <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={Boolean(form.is_suspended)} onChange={event=>field('is_suspended',event.target.checked)}/>Suspend Supplier</label>
          <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={Boolean(form.whtExempt)} onChange={event=>field('whtExempt',event.target.checked)}/>WHT Exempt</label>
        </div>
        </fieldset>
      </div>
      <footer className="flex shrink-0 gap-3 border-t border-zinc-200 bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:px-6">
        <button type="button" disabled={saving} onClick={onClose} className="flex-1 rounded-xl border border-zinc-200 py-3 font-semibold">Cancel</button>
        <button type="submit" disabled={saving || !permitted} className="flex-1 rounded-xl bg-zinc-900 py-3 font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save Supplier'}</button>
      </footer>
    </form>
  </div>;
};
