import { useCompanies } from "../lib/DataContext";

interface CompanySelectProps {
  value: string;
  onChange: (value: string) => void;
  includeAll?: boolean;
  className?: string;
}

export default function CompanySelect({
  value,
  onChange,
  includeAll = true,
  className = "px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal",
}: CompanySelectProps) {
  const companies = useCompanies();

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className}
    >
      {includeAll && <option value="">Alle bedrijven</option>}
      {companies.map((c) => (
        <option key={c.name} value={c.name}>
          {c.company_name || c.name}
        </option>
      ))}
    </select>
  );
}
