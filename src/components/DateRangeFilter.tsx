import React from "react";
import { X } from "lucide-react";

interface DateRangeFilterProps {
  fromDate: string;
  toDate: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
}

const DateRangeFilter: React.FC<DateRangeFilterProps> = ({
  fromDate,
  toDate,
  onFromChange,
  onToChange,
}) => {
  const hasValue = fromDate || toDate;

  return (
    <div className="flex items-center gap-2">
      <input
        type="date"
        value={fromDate}
        onChange={(e) => onFromChange(e.target.value)}
        className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal"
        placeholder="Van"
        title="Vanaf datum"
      />
      <span className="text-slate-400 text-sm">t/m</span>
      <input
        type="date"
        value={toDate}
        onChange={(e) => onToChange(e.target.value)}
        className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal"
        placeholder="Tot"
        title="Tot en met datum"
      />
      {hasValue && (
        <button
          onClick={() => {
            onFromChange("");
            onToChange("");
          }}
          className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          title="Wis datumfilter"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
};

export default DateRangeFilter;
