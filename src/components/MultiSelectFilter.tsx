import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";

interface MultiSelectFilterProps {
  label: string;
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  colorMap?: Record<string, string>;
}

export default function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  colorMap,
}: MultiSelectFilterProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const toggle = (option: string) => {
    if (selected.includes(option)) {
      onChange(selected.filter((s) => s !== option));
    } else {
      onChange([...selected, option]);
    }
  };

  const allSelected = selected.length === 0 || selected.length === options.length;
  const displayText = allSelected
    ? `Alle ${label}`
    : selected.length === 1
    ? selected[0]
    : `${selected.length} ${label}`;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm hover:bg-slate-50 transition-colors cursor-pointer min-w-[140px]"
      >
        <span className="flex-1 text-left truncate text-slate-700">{displayText}</span>
        <ChevronDown size={14} className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-56 bg-white border border-slate-200 rounded-lg shadow-lg py-1 max-h-64 overflow-y-auto">
          {/* Select all / clear */}
          <button
            onClick={() => onChange([])}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 text-slate-600 cursor-pointer"
          >
            <div className={`w-4 h-4 rounded border flex items-center justify-center ${allSelected ? "bg-3bm-teal border-3bm-teal" : "border-slate-300"}`}>
              {allSelected && <Check size={12} className="text-white" />}
            </div>
            Alles
          </button>
          <div className="border-t border-slate-100 my-1" />
          {options.map((option) => {
            const isChecked = selected.includes(option);
            const color = colorMap?.[option];
            return (
              <button
                key={option}
                onClick={() => toggle(option)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50 cursor-pointer"
              >
                <div className={`w-4 h-4 rounded border flex items-center justify-center ${isChecked ? "bg-3bm-teal border-3bm-teal" : "border-slate-300"}`}>
                  {isChecked && <Check size={12} className="text-white" />}
                </div>
                {color && (
                  <span className={`w-2.5 h-2.5 rounded-full ${color}`} />
                )}
                <span className="text-slate-700">{option}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
