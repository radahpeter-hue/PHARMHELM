import React, { useState } from 'react';
import { Download, Search } from 'lucide-react';

export interface StockInRegisterRow {
  id: string;
  number: string;
  source: string;
  destination: string;
  sender: string;
  sentAt?: string;
  receiver: string;
  receivedAt?: string;
  createdAt?: string;
  value: number;
  status: string;
  onOpen: () => void;
  onExport?: () => void;
}

// Compare calendar dates, including the entire final day, in the user's timezone.
export function receiptCalendarDate(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function filterStockInRows(rows: StockInRegisterRow[], history: boolean, search: string, start: string, end: string) {
  const term = search.trim().toLowerCase();
  return rows.filter(row => {
    const date = receiptCalendarDate(history ? row.receivedAt : row.sentAt || row.createdAt);
    if ((start && (!date || date < start)) || (end && (!date || date > end))) return false;
    return !term || [row.number, row.source, row.destination, row.sender, row.receiver].some(value => value.toLowerCase().includes(term));
  });
}

const dateTime = (value?: string) => value && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toLocaleString() : 'Pending';
const columns = ['Invoice ID', 'Source', 'Destination', 'Sent By & When', 'Received By & When', 'Total Value', 'Status', 'Actions'];

export function StockInRegister({ rows, history, onHistoryChange, canReceive }: {
  rows: StockInRegisterRow[]; history: boolean; onHistoryChange: (history: boolean) => void; canReceive: boolean;
}) {
  const [search, setSearch] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const invalidRange = Boolean(start && end && start > end);
  const visible = filterStockInRows(rows, history, search, start, end);
  const actions = (row: StockInRegisterRow) => <div className="flex flex-wrap gap-2 lg:justify-end">
    {history && row.onExport && <button onClick={row.onExport} className="flex min-h-11 items-center gap-1 rounded-xl bg-emerald-50 px-3 text-xs font-bold text-emerald-800"><Download size={14}/>Excel</button>}
    <button onClick={row.onOpen} className={`min-h-11 rounded-xl px-3 text-xs font-bold ${history || !canReceive ? 'bg-zinc-100 text-zinc-800' : 'bg-emerald-600 text-white'}`}>{history || !canReceive ? 'View Details' : 'Receive & Verify'}</button>
  </div>;
  const values = (row: StockInRegisterRow): React.ReactNode[] => [
    row.number, row.source, row.destination,
    <React.Fragment key="sender">{row.sender}<p className="mt-1 text-xs font-normal text-zinc-600">{dateTime(row.sentAt)}</p></React.Fragment>,
    <React.Fragment key="receiver">{row.receiver}<p className="mt-1 text-xs font-normal text-zinc-600">{dateTime(row.receivedAt)}</p></React.Fragment>,
    `UGX ${row.value.toLocaleString()}`,
    <span key="status" className={`inline-block rounded-md px-2 py-1 text-xs font-bold ${['received', 'fully_accepted'].includes(row.status) ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>{row.status.replace(/_/g, ' ')}</span>, actions(row)
  ];
  return <section className="min-w-0 space-y-4 text-zinc-900" aria-label="Stock In register">
    <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
      <div className="grid w-full grid-cols-2 rounded-xl bg-zinc-100 p-1 sm:w-fit" role="group" aria-label="Reception view">
        {[false, true].map(value => <button key={String(value)} aria-pressed={history === value} onClick={() => onHistoryChange(value)} className={`min-h-11 rounded-lg px-3 text-xs font-bold ${history === value ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-600'}`}>{value ? 'Reception History' : 'Pending Reception'}</button>)}
      </div>
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="flex min-h-11 min-w-0 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 sm:flex-1"><Search size={14}/><input aria-label="Search receptions" type="search" placeholder="Search ID, source, dest, sender..." value={search} onChange={event => setSearch(event.target.value)} className="min-w-0 w-full bg-transparent py-3 text-xs text-zinc-900 outline-none"/></label>
        <div className="grid min-w-0 grid-cols-2 gap-2">
          <label className="min-w-0 text-xs font-semibold text-zinc-700">From date<input aria-label="From date" type="date" value={start} onChange={event => setStart(event.target.value)} className="mt-1 block min-h-11 w-full min-w-0 rounded-xl border border-zinc-200 bg-white px-2 text-xs text-zinc-900"/></label>
          <label className="min-w-0 text-xs font-semibold text-zinc-700">To date<input aria-label="To date" type="date" value={end} onChange={event => setEnd(event.target.value)} className="mt-1 block min-h-11 w-full min-w-0 rounded-xl border border-zinc-200 bg-white px-2 text-xs text-zinc-900"/></label>
        </div>
        {(start || end || search) && <button onClick={() => { setStart(''); setEnd(''); setSearch(''); }} className="min-h-11 px-3 text-xs font-bold text-zinc-700">Clear filters</button>}
      </div>
    </div>
    <p className="text-xs text-zinc-600">Dates filter by {history ? 'receipt' : 'dispatch'} date.</p>
    {invalidRange && <p role="alert" className="text-sm text-red-700">From date must be on or before To date.</p>}
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <table className="hidden w-full table-fixed text-left lg:table"><thead className="border-b border-zinc-100 bg-zinc-50 text-xs uppercase text-zinc-600"><tr>{columns.map(column => <th key={column} className="px-3 py-4">{column}</th>)}</tr></thead><tbody className="divide-y divide-zinc-100">{!invalidRange && visible.map(row => <tr key={row.id}>{values(row).map((value, index) => <td key={index} className="break-words px-3 py-4 text-xs font-semibold text-zinc-800">{value}</td>)}</tr>)}</tbody></table>
      <div className="divide-y divide-zinc-200 lg:hidden">{!invalidRange && visible.map(row => <article key={row.id} className="p-4"><dl className="grid grid-cols-2 gap-4">{values(row).map((value, index) => <div key={index} className={`min-w-0 ${index === 0 || index === 7 ? 'col-span-2' : ''}`}><dt className="mb-1 text-xs font-semibold text-zinc-600">{columns[index]}</dt><dd className="break-words text-sm font-semibold text-zinc-900">{value}</dd></div>)}</dl></article>)}</div>
      {(invalidRange || visible.length === 0) && <p className="px-4 py-12 text-center text-sm text-zinc-600">{search || start || end ? 'No receptions match these filters.' : history ? 'No reception history found.' : 'No incoming stock found.'}</p>}
    </div>
  </section>;
}
