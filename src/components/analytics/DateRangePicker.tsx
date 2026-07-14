import React from 'react';
import { Calendar, ChevronDown } from 'lucide-react';
import { cn } from '../../utils/cn';

export type DateRangeOption = 
  | 'Today' 
  | 'Yesterday' 
  | 'This Week' 
  | 'Last Week' 
  | 'This Month' 
  | 'Last Month' 
  | 'This Quarter' 
  | 'Custom Range';

interface DateRangePickerProps {
  selected: DateRangeOption;
  onChange: (option: DateRangeOption) => void;
}

const OPTIONS: DateRangeOption[] = [
  'Today',
  'Yesterday',
  'This Week',
  'Last Week',
  'This Month',
  'Last Month',
  'This Quarter',
  'Custom Range'
];

export const DateRangePicker: React.FC<DateRangePickerProps> = ({ selected, onChange }) => {
  const [isOpen, setIsOpen] = React.useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2 bg-white border border-zinc-200 rounded-xl text-sm font-medium hover:bg-zinc-50 transition-colors shadow-sm"
      >
        <Calendar size={18} className="text-zinc-500" />
        <span>{selected}</span>
        <ChevronDown size={14} className={cn("text-zinc-400 transition-transform", isOpen && "rotate-180")} />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 mt-2 w-48 bg-white border border-zinc-200 rounded-2xl shadow-xl z-40 overflow-hidden">
            <div className="p-2">
              {OPTIONS.map((option) => (
                <button
                  key={option}
                  onClick={() => {
                    onChange(option);
                    setIsOpen(false);
                  }}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-lg text-sm transition-colors",
                    selected === option 
                      ? "bg-zinc-900 text-white font-bold" 
                      : "text-zinc-600 hover:bg-zinc-50"
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
