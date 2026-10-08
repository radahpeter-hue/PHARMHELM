import React, { useMemo, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import type { PosV2RevisionReferenceOption } from '../../services/pos-v2/posSaleRevisionV2ReferenceData';

interface Props {
  label: string;
  placeholder: string;
  options: PosV2RevisionReferenceOption[];
  selectedId: string | null;
  selectedName: string | null;
  required?: boolean;
  disabled?: boolean;
  allowClear?: boolean;
  onChange: (option: PosV2RevisionReferenceOption | null) => void;
}

export const PosV2RevisionReferenceSelector: React.FC<Props> = ({
  label, placeholder, options, selectedId, selectedName, required = false, disabled = false, allowClear = true, onChange
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = options.find(option => option.id === selectedId) || null;
  const historical = Boolean(selectedId && !selected);
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return options;
    return options.filter(option => `${option.name} ${option.id} ${option.secondary} ${option.tertiary || ''}`.toLowerCase().includes(term));
  }, [options, query]);

  const choose = (option: PosV2RevisionReferenceOption | null) => {
    onChange(option);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="space-y-1.5">
      <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400">{label}{required ? ' *' : ''}</span>
      <div className="relative">
        <button
          type="button"
          onClick={() => !disabled && setOpen(current => !current)}
          disabled={disabled}
          className="w-full min-h-[44px] rounded-xl border border-zinc-200 px-3 py-2 text-left bg-white disabled:bg-zinc-100 disabled:text-zinc-400 flex items-center justify-between gap-2"
        >
          <span className="min-w-0">
            <span className="block text-sm font-bold text-zinc-800 truncate">{selected?.name || selectedName || placeholder}</span>
            {selectedId && <span className="block text-[10px] text-zinc-400 truncate">{historical ? 'Historical / unavailable' : selected?.secondary || selected?.tertiary || 'Registered record'}</span>}
          </span>
          <ChevronDown className="w-4 h-4 shrink-0" />
        </button>

        {open && !disabled && (
          <div className="absolute z-40 mt-2 w-full rounded-2xl border border-zinc-200 bg-white shadow-2xl p-2">
            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
              <input
                autoFocus
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder={`Search ${label.toLowerCase()}...`}
                className="w-full rounded-xl border border-zinc-200 py-2.5 pl-9 pr-9 text-sm outline-none focus:ring-2 focus:ring-amber-200"
              />
              <button type="button" onClick={() => setOpen(false)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-400"><X className="w-4 h-4" /></button>
            </div>
            <div className="max-h-56 overflow-y-auto space-y-1">
              {allowClear && (
                <button type="button" onClick={() => choose(null)} className="w-full rounded-xl px-3 py-2 text-left text-xs font-bold text-zinc-500 hover:bg-zinc-50">Clear selection</button>
              )}
              {historical && (
                <div className="rounded-xl bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-800">
                  The current historical reference is unavailable. It remains preserved unless you choose another record.
                </div>
              )}
              {filtered.map(option => (
                <button
                  type="button"
                  key={option.id}
                  disabled={!option.selectable}
                  onClick={() => choose(option)}
                  className="w-full rounded-xl px-3 py-2 text-left hover:bg-zinc-50 disabled:opacity-45 disabled:cursor-not-allowed flex items-start justify-between gap-2"
                >
                  <span className="min-w-0">
                    <span className="block text-xs font-black text-zinc-800 truncate">{option.name}</span>
                    <span className="block text-[10px] text-zinc-400 break-words">{[option.secondary, option.tertiary].filter(Boolean).join(' · ') || 'Registered record'}</span>
                  </span>
                  {selectedId === option.id && <Check className="w-4 h-4 text-emerald-600 shrink-0" />}
                </button>
              ))}
              {filtered.length === 0 && <p className="py-4 text-center text-xs text-zinc-400">No matching records.</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
