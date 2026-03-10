import { useEffect, useState, useMemo, useCallback } from "react";
import { fetchAll, getErpNextAppUrl } from "../lib/erpnext";
import CompanySelect from "../components/CompanySelect";
import {
  FileSpreadsheet,
  RefreshCw,
  Filter,
  ExternalLink,
  TrendingUp,
  TrendingDown,
  Calculator,
  ChevronDown,
  AlertCircle,
} from "lucide-react";

/* ─── Types ─── */

interface SalesInvoiceTax {
  parent: string;
  rate: number;
  tax_amount: number;
  base_tax_amount: number;
  account_head: string;
  description: string;
}

interface InvoiceSummary {
  name: string;
  net_total: number;
  base_net_total: number;
  total_taxes_and_charges: number;
  posting_date: string;
  company: string;
}

interface GLEntry {
  account: string;
  debit: number;
  credit: number;
  voucher_type: string;
  voucher_no: string;
}

interface TaxAccount {
  name: string;
  account_name: string;
}

/* ─── Constants ─── */

const QUARTERS = [
  { label: "Q1 (jan-mrt)", value: 1 },
  { label: "Q2 (apr-jun)", value: 2 },
  { label: "Q3 (jul-sep)", value: 3 },
  { label: "Q4 (okt-dec)", value: 4 },
];

const YEARS = [2022, 2023, 2024, 2025, 2026];

function getQuarterDates(quarter: number, year: number) {
  const startMonth = (quarter - 1) * 3;
  const endMonth = startMonth + 2;
  const startDate = `${year}-${String(startMonth + 1).padStart(2, "0")}-01`;
  const lastDay = new Date(year, endMonth + 1, 0).getDate();
  const endDate = `${year}-${String(endMonth + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { startDate, endDate };
}

function euro(value: number): string {
  return `\u20AC ${value.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function getCurrentQuarter(): number {
  return Math.floor(new Date().getMonth() / 3) + 1;
}

/* ─── Component ─── */

export default function BTW() {
  const [company, setCompany] = useState(localStorage.getItem("erpnext_default_company") || "");
  const [quarter, setQuarter] = useState(getCurrentQuarter());
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);

  // Raw data from ERPNext
  const [salesInvoices, setSalesInvoices] = useState<InvoiceSummary[]>([]);
  const [salesTaxes, setSalesTaxes] = useState<SalesInvoiceTax[]>([]);
  const [purchaseInvoices, setPurchaseInvoices] = useState<InvoiceSummary[]>([]);
  // GL Entries on tax accounts – the source of truth for voorbelasting
  const [inputVatEntries, setInputVatEntries] = useState<GLEntry[]>([]);
  const [taxAccounts, setTaxAccounts] = useState<TaxAccount[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { startDate, endDate } = getQuarterDates(quarter, year);

      // Build filters for the period
      const siFilters: unknown[][] = [
        ["docstatus", "=", 1],
        ["posting_date", ">=", startDate],
        ["posting_date", "<=", endDate],
      ];
      const piFilters: unknown[][] = [
        ["docstatus", "=", 1],
        ["posting_date", ">=", startDate],
        ["posting_date", "<=", endDate],
      ];
      if (company) {
        siFilters.push(["company", "=", company]);
        piFilters.push(["company", "=", company]);
      }

      // 1) Always fetch invoices (basic doctypes, should always work)
      const [siList, piList] = await Promise.all([
        fetchAll<InvoiceSummary>(
          "Sales Invoice",
          ["name", "net_total", "base_net_total", "total_taxes_and_charges", "posting_date", "company"],
          siFilters,
          "posting_date asc"
        ),
        fetchAll<InvoiceSummary>(
          "Purchase Invoice",
          ["name", "net_total", "base_net_total", "total_taxes_and_charges", "posting_date", "company"],
          piFilters,
          "posting_date asc"
        ),
      ]);

      setSalesInvoices(siList);
      setPurchaseInvoices(piList);

      // 2) Try to fetch Sales Taxes and Charges for per-rate breakdown
      //    Falls back gracefully if API user has no permission (403)
      const siNames = siList.map((i) => i.name);
      let siTaxList: SalesInvoiceTax[] = [];
      if (siNames.length > 0) {
        try {
          siTaxList = await fetchAll<SalesInvoiceTax>(
            "Sales Taxes and Charges",
            ["parent", "rate", "tax_amount", "base_tax_amount", "account_head", "description"],
            [["parent", "in", siNames]],
          );
        } catch {
          console.warn("Sales Taxes and Charges niet toegankelijk (403) — fallback naar total_taxes_and_charges");
        }
      }
      setSalesTaxes(siTaxList);

      // 3) Try to fetch GL Entry + Account for detailed voorbelasting
      //    Falls back to total_taxes_and_charges from Purchase Invoices
      let glEntries: GLEntry[] = [];
      let taxAcctList: TaxAccount[] = [];
      try {
        const taxAcctFilters: unknown[][] = [["account_type", "=", "Tax"]];
        if (company) taxAcctFilters.push(["company", "=", company]);

        [taxAcctList, glEntries] = await Promise.all([
          fetchAll<TaxAccount>("Account", ["name", "account_name"], taxAcctFilters),
          fetchAll<GLEntry>(
            "GL Entry",
            ["account", "debit", "credit", "voucher_type", "voucher_no"],
            [
              ["posting_date", ">=", startDate],
              ["posting_date", "<=", endDate],
              ["is_cancelled", "=", 0],
              ["voucher_type", "=", "Purchase Invoice"],
              ...(company ? [["company", "=", company]] : []),
            ],
          ),
        ]);
      } catch {
        console.warn("GL Entry/Account niet toegankelijk (403) — fallback naar total_taxes_and_charges");
      }
      setTaxAccounts(taxAcctList);
      setInputVatEntries(glEntries);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Onbekende fout");
    } finally {
      setLoading(false);
    }
  }, [company, quarter, year]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  /* ─── Compute BTW aangifte ─── */
  const vatData = useMemo(() => {
    // ── OUTPUT VAT (Sales Invoices) ── group by tax rate for rubrieken
    const outputByRate = new Map<number, { base: number; vat: number }>();

    if (salesTaxes.length > 0) {
      // Detailed breakdown from Sales Taxes and Charges
      for (const tax of salesTaxes) {
        const rate = Math.round(tax.rate);
        const existing = outputByRate.get(rate) || { base: 0, vat: 0 };
        existing.vat += tax.base_tax_amount || tax.tax_amount;
        outputByRate.set(rate, existing);
      }

      // Calculate base amounts from invoice net_totals, allocated per tax line
      const invoiceTaxMap = new Map<string, SalesInvoiceTax[]>();
      for (const tax of salesTaxes) {
        if (!invoiceTaxMap.has(tax.parent)) invoiceTaxMap.set(tax.parent, []);
        invoiceTaxMap.get(tax.parent)!.push(tax);
      }
      for (const inv of salesInvoices) {
        const taxes = invoiceTaxMap.get(inv.name) || [];
        if (taxes.length === 0) {
          const existing = outputByRate.get(0) || { base: 0, vat: 0 };
          existing.base += inv.base_net_total || inv.net_total;
          outputByRate.set(0, existing);
        } else if (taxes.length === 1) {
          const rate = Math.round(taxes[0].rate);
          const existing = outputByRate.get(rate) || { base: 0, vat: 0 };
          existing.base += inv.base_net_total || inv.net_total;
          outputByRate.set(rate, existing);
        } else {
          const totalTax = taxes.reduce((s, t) => s + Math.abs(t.base_tax_amount || t.tax_amount), 0);
          for (const tax of taxes) {
            const rate = Math.round(tax.rate);
            const proportion = totalTax > 0 ? Math.abs(tax.base_tax_amount || tax.tax_amount) / totalTax : 1 / taxes.length;
            const existing = outputByRate.get(rate) || { base: 0, vat: 0 };
            existing.base += (inv.base_net_total || inv.net_total) * proportion;
            outputByRate.set(rate, existing);
          }
        }
      }
    } else {
      // Fallback: no per-rate breakdown, use total_taxes_and_charges from Sales Invoices
      const totalBase = salesInvoices.reduce((s, i) => s + (i.base_net_total || i.net_total), 0);
      const totalVat = salesInvoices.reduce((s, i) => s + (i.total_taxes_and_charges || 0), 0);
      // Put everything under 21% as best guess
      if (totalVat > 0 || totalBase > 0) {
        outputByRate.set(21, { base: totalBase, vat: totalVat });
      }
    }

    // ── INPUT VAT (Voorbelasting) ──
    // Prefer GL Entries on tax accounts; fall back to total_taxes_and_charges from Purchase Invoices
    let totalInputVat = 0;
    const inputByAccount = new Map<string, number>();
    const hasGLData = inputVatEntries.length > 0 && taxAccounts.length > 0;

    if (hasGLData) {
      const taxAcctSet = new Set(taxAccounts.map((a) => a.name));
      for (const entry of inputVatEntries) {
        if (!taxAcctSet.has(entry.account)) continue;
        const amount = entry.debit - entry.credit;
        totalInputVat += amount;
        inputByAccount.set(entry.account, (inputByAccount.get(entry.account) || 0) + amount);
      }
    } else {
      // Fallback: use total_taxes_and_charges from Purchase Invoices
      totalInputVat = purchaseInvoices.reduce((s, i) => s + (i.total_taxes_and_charges || 0), 0);
    }

    const totalInputBase = purchaseInvoices.reduce((s, i) => s + (i.base_net_total || i.net_total), 0);

    // Map to Dutch rubrieken
    const r21 = outputByRate.get(21) || { base: 0, vat: 0 };
    const r9 = outputByRate.get(9) || { base: 0, vat: 0 };
    const r6 = outputByRate.get(6) || { base: 0, vat: 0 };
    const r0 = outputByRate.get(0) || { base: 0, vat: 0 };

    let overigBase = 0;
    let overigVat = 0;
    for (const [rate, data] of outputByRate.entries()) {
      if (rate !== 21 && rate !== 9 && rate !== 6 && rate !== 0) {
        overigBase += data.base;
        overigVat += data.vat;
      }
    }

    const totalOutputVat = r21.vat + r9.vat + r6.vat + r0.vat + overigVat;
    const balance = totalOutputVat - totalInputVat;

    return {
      rubriek1a: { base: r21.base, vat: r21.vat },
      rubriek1b: { base: r9.base, vat: r9.vat },
      rubriek1c: { base: r6.base, vat: r6.vat },
      rubriek1e: { base: r0.base + overigBase, vat: r0.vat + overigVat },
      rubriek5b: { base: totalInputBase, vat: totalInputVat },
      totalOutputVat,
      totalInputVat,
      balance,
      // Debug info
      outputByRate: Array.from(outputByRate.entries()).sort((a, b) => b[0] - a[0]),
      inputByAccount: Array.from(inputByAccount.entries()),
      salesCount: salesInvoices.length,
      purchaseCount: purchaseInvoices.length,
      salesTaxCount: salesTaxes.length,
      glEntryCount: inputVatEntries.length,
    };
  }, [salesInvoices, salesTaxes, purchaseInvoices, inputVatEntries, taxAccounts]);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-100 rounded-lg">
            <FileSpreadsheet className="text-indigo-600" size={24} />
          </div>
          <h2 className="text-2xl font-bold text-slate-800">BTW-aangifte</h2>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`${getErpNextAppUrl()}/general-ledger?company=${encodeURIComponent(company)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            <ExternalLink size={14} /> ERPNext
          </a>
          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-3bm-teal text-white rounded-lg hover:bg-3bm-teal-dark disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Vernieuwen
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 flex items-center gap-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Filters */}
      <div className="mb-6 flex items-center gap-3 flex-wrap">
        <Filter size={16} className="text-slate-400" />
        <CompanySelect value={company} onChange={setCompany} />
        <select
          value={quarter}
          onChange={(e) => setQuarter(Number(e.target.value))}
          className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal"
        >
          {QUARTERS.map((q) => (
            <option key={q.value} value={q.value}>{q.label}</option>
          ))}
        </select>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-3bm-teal"
        >
          {YEARS.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <span className="text-sm text-slate-400">
          Periode: {getQuarterDates(quarter, year).startDate} t/m {getQuarterDates(quarter, year).endDate}
        </span>
      </div>

      {/* Source info */}
      {!loading && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-700 flex items-center gap-2">
          <AlertCircle size={14} />
          Output BTW: {vatData.salesCount} verkoopfacturen ({vatData.salesTaxCount > 0 ? `${vatData.salesTaxCount} belastingregels` : "totaal BTW"}) | Voorbelasting: {vatData.glEntryCount > 0 ? `${vatData.glEntryCount} GL entries uit` : ""} {vatData.purchaseCount} inkoopfacturen{vatData.glEntryCount === 0 ? " (totaal BTW)" : ""}{taxAccounts.length > 0 ? ` | ${taxAccounts.length} BTW-rekeningen` : ""}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-red-100 rounded-lg">
              <TrendingUp className="text-red-600" size={20} />
            </div>
            <p className="text-sm text-slate-500">BTW verschuldigd (output)</p>
          </div>
          <p className="text-2xl font-bold text-slate-800">
            {loading ? "..." : euro(vatData.totalOutputVat)}
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-green-100 rounded-lg">
              <TrendingDown className="text-green-600" size={20} />
            </div>
            <p className="text-sm text-slate-500">Voorbelasting (input)</p>
          </div>
          <p className="text-2xl font-bold text-slate-800">
            {loading ? "..." : euro(vatData.totalInputVat)}
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-indigo-100 rounded-lg">
              <Calculator className="text-indigo-600" size={20} />
            </div>
            <p className="text-sm text-slate-500">
              {vatData.balance >= 0 ? "Te betalen" : "Te ontvangen"}
            </p>
          </div>
          <p className={`text-2xl font-bold ${vatData.balance >= 0 ? "text-red-600" : "text-green-600"}`}>
            {loading ? "..." : euro(Math.abs(vatData.balance))}
          </p>
        </div>
      </div>

      {/* BTW Aangifte Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50">
          <h3 className="text-sm font-semibold text-slate-700">
            BTW-aangifte overzicht - Q{quarter} {year}
          </h3>
        </div>
        {loading ? (
          <div className="px-4 py-12 text-center text-slate-400">Laden...</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600">Rubriek</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-600">Omschrijving</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-600">Omzet / grondslag</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-600">BTW bedrag</th>
              </tr>
            </thead>
            <tbody>
              {/* 1a - 21% */}
              <tr className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-5 py-3 text-sm font-medium text-slate-700">1a</td>
                <td className="px-5 py-3 text-sm text-slate-600">Leveringen/diensten belast met hoog tarief (21%)</td>
                <td className="px-5 py-3 text-sm text-slate-700 text-right">{euro(vatData.rubriek1a.base)}</td>
                <td className="px-5 py-3 text-sm font-semibold text-slate-800 text-right">{euro(vatData.rubriek1a.vat)}</td>
              </tr>
              {/* 1b - 9% */}
              <tr className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-5 py-3 text-sm font-medium text-slate-700">1b</td>
                <td className="px-5 py-3 text-sm text-slate-600">Leveringen/diensten belast met laag tarief (9%)</td>
                <td className="px-5 py-3 text-sm text-slate-700 text-right">{euro(vatData.rubriek1b.base)}</td>
                <td className="px-5 py-3 text-sm font-semibold text-slate-800 text-right">{euro(vatData.rubriek1b.vat)}</td>
              </tr>
              {/* 1c - 6% (oud tarief, alleen tonen als er data is) */}
              {vatData.rubriek1c.vat !== 0 && (
                <tr className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-5 py-3 text-sm font-medium text-slate-700">1c</td>
                  <td className="px-5 py-3 text-sm text-slate-600">Leveringen/diensten belast met 6% (oud tarief)</td>
                  <td className="px-5 py-3 text-sm text-slate-700 text-right">{euro(vatData.rubriek1c.base)}</td>
                  <td className="px-5 py-3 text-sm font-semibold text-slate-800 text-right">{euro(vatData.rubriek1c.vat)}</td>
                </tr>
              )}
              {/* 1e - 0% / overig */}
              <tr className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-5 py-3 text-sm font-medium text-slate-700">1e</td>
                <td className="px-5 py-3 text-sm text-slate-600">Leveringen belast met 0% / verlegd / overig</td>
                <td className="px-5 py-3 text-sm text-slate-700 text-right">{euro(vatData.rubriek1e.base)}</td>
                <td className="px-5 py-3 text-sm font-semibold text-slate-800 text-right">{euro(vatData.rubriek1e.vat)}</td>
              </tr>

              {/* Subtotal output */}
              <tr className="border-b border-slate-200 bg-slate-50">
                <td colSpan={3} className="px-5 py-3 text-sm font-semibold text-slate-700">
                  Totaal verschuldigde BTW (rubriek 1a t/m 1e)
                </td>
                <td className="px-5 py-3 text-sm font-bold text-slate-800 text-right">
                  {euro(vatData.totalOutputVat)}
                </td>
              </tr>

              {/* 5b - Voorbelasting */}
              <tr className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-5 py-3 text-sm font-medium text-slate-700">5b</td>
                <td className="px-5 py-3 text-sm text-slate-600">Voorbelasting (BTW op inkopen)</td>
                <td className="px-5 py-3 text-sm text-slate-700 text-right">{euro(vatData.rubriek5b.base)}</td>
                <td className="px-5 py-3 text-sm font-semibold text-green-700 text-right">{euro(vatData.rubriek5b.vat)}</td>
              </tr>

              {/* Subtotal input */}
              <tr className="border-b border-slate-200 bg-slate-50">
                <td colSpan={3} className="px-5 py-3 text-sm font-semibold text-slate-700">
                  Totaal voorbelasting (rubriek 5b)
                </td>
                <td className="px-5 py-3 text-sm font-bold text-green-700 text-right">
                  {euro(vatData.totalInputVat)}
                </td>
              </tr>

              {/* Balance */}
              <tr className="bg-indigo-50">
                <td colSpan={3} className="px-5 py-4 text-base font-bold text-slate-800">
                  {vatData.balance >= 0
                    ? "Te betalen aan de Belastingdienst"
                    : "Te ontvangen van de Belastingdienst"}
                </td>
                <td className={`px-5 py-4 text-base font-bold text-right ${vatData.balance >= 0 ? "text-red-600" : "text-green-600"}`}>
                  {euro(Math.abs(vatData.balance))}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {/* No data message */}
      {!loading && salesInvoices.length === 0 && purchaseInvoices.length === 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center text-slate-400">
          Geen facturen gevonden voor Q{quarter} {year}
        </div>
      )}

      {/* Debug Panel */}
      {!loading && (
        <div className="mt-6 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <button
            onClick={() => setDebugOpen((o) => !o)}
            className="w-full px-5 py-3 text-left text-sm font-medium text-slate-500 hover:bg-slate-50 flex items-center justify-between cursor-pointer"
          >
            <span>Debug: BTW-tarieven detail</span>
            <ChevronDown size={14} className={`transition-transform ${debugOpen ? "rotate-180" : ""}`} />
          </button>
          {debugOpen && (
            <div className="px-5 py-3 border-t border-slate-100 text-xs space-y-3">
              <div>
                <p className="font-semibold text-slate-600 mb-1">Output BTW per tarief (uit Sales Taxes and Charges):</p>
                {vatData.outputByRate.length === 0 ? (
                  <p className="text-slate-400">Geen output BTW gevonden</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200">
                        <th className="text-left py-1 text-slate-500">Tarief</th>
                        <th className="text-right py-1 text-slate-500">Grondslag</th>
                        <th className="text-right py-1 text-slate-500">BTW</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vatData.outputByRate.map(([rate, data]) => (
                        <tr key={rate} className="border-b border-slate-50">
                          <td className="py-1 text-slate-700">{rate}%</td>
                          <td className="py-1 text-slate-600 text-right">{euro(data.base)}</td>
                          <td className="py-1 text-slate-700 text-right font-medium">{euro(data.vat)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div>
                <p className="font-semibold text-slate-600 mb-1">Voorbelasting per GL-rekening (uit GL Entry):</p>
                {vatData.inputByAccount.length === 0 ? (
                  <p className="text-slate-400">Geen voorbelasting GL entries gevonden</p>
                ) : (
                  <div className="space-y-1">
                    {vatData.inputByAccount.map(([account, amount]) => (
                      <div key={account} className="flex justify-between text-slate-600">
                        <span>{account}</span>
                        <span className="font-medium">{euro(amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <p className="font-semibold text-slate-600 mb-1">BTW-rekeningen (account_type = Tax):</p>
                {taxAccounts.length === 0 ? (
                  <p className="text-slate-400">Geen BTW-rekeningen gevonden</p>
                ) : (
                  <div className="space-y-1">
                    {taxAccounts.map((a) => (
                      <div key={a.name} className="text-slate-600">{a.name} ({a.account_name})</div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <p className="font-semibold text-slate-600 mb-1">Unieke belastingregels (Sales Taxes and Charges):</p>
                {salesTaxes.length === 0 ? (
                  <p className="text-slate-400">Geen</p>
                ) : (
                  (() => {
                    const accounts = new Map<string, { count: number; total: number; rate: number }>();
                    for (const t of salesTaxes) {
                      const key = t.account_head;
                      const ex = accounts.get(key) || { count: 0, total: 0, rate: t.rate };
                      ex.count++;
                      ex.total += t.base_tax_amount || t.tax_amount;
                      accounts.set(key, ex);
                    }
                    return (
                      <div className="space-y-1">
                        {Array.from(accounts.entries()).map(([acct, info]) => (
                          <div key={acct} className="flex justify-between text-slate-600">
                            <span>{acct} ({info.rate}%, {info.count}x)</span>
                            <span className="font-medium">{euro(info.total)}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
