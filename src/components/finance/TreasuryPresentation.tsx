import React from 'react';
import type { LucideIcon } from 'lucide-react';

export const treasuryGrid = 'grid grid-cols-1 gap-4 @min-[520px]:grid-cols-2 @min-[790px]:grid-cols-3 @min-[1080px]:grid-cols-4';
const tones = {
  green: 'border-emerald-100 bg-emerald-50 text-emerald-800',
  red: 'border-rose-100 bg-rose-50 text-rose-800',
  amber: 'border-amber-100 bg-amber-50 text-amber-800',
  blue: 'border-sky-100 bg-sky-50 text-sky-800',
};

export function TreasuryKpi({ title, value, icon: Icon, note, tone = 'green' }: {
  title: string; value: string; icon: LucideIcon; note?: string; tone?: keyof typeof tones;
}) {
  return <div className={`flex min-w-0 items-start gap-3 rounded-xl border p-4 ${tones[tone]}`}>
    <Icon size={24} className="mt-1 shrink-0" aria-hidden />
    <div className="min-w-0">
      <p className="text-sm font-semibold text-zinc-800">{title}</p>
      <p className="mt-1 break-words text-xl font-bold tracking-tight tabular-nums text-zinc-950">{value}</p>
      {note && <p className="mt-1 text-xs text-zinc-700">{note}</p>}
    </div>
  </div>;
}

export function treasuryDateTime(businessDate: string, occurredAt: string) {
  const date = new Date(occurredAt);
  if (!Number.isFinite(date.getTime()) || occurredAt === businessDate + 'T00:00:00.000Z') return businessDate;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Kampala', dateStyle: 'medium', timeStyle: 'short',
  }).format(date);
}
