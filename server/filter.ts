/**
 * ERPNext-compatible in-memory filter engine.
 * Applies filter arrays like [["field","op","value"], ...] to cached documents.
 */

type Doc = Record<string, unknown>;

/** Check if a single document matches all filters */
export function matchesFilters(doc: Doc, filters: unknown[][]): boolean {
  for (const filter of filters) {
    const [field, op, value] = filter as [string, string, unknown];
    const docVal = doc[field];
    switch (op) {
      case "=":
        if (docVal != value) return false;
        break;
      case "!=":
        if (docVal == value) return false;
        break;
      case ">":
        if (!(docVal as number | string > (value as number | string))) return false;
        break;
      case "<":
        if (!(docVal as number | string < (value as number | string))) return false;
        break;
      case ">=":
        if (!((docVal as number | string) >= (value as number | string))) return false;
        break;
      case "<=":
        if (!((docVal as number | string) <= (value as number | string))) return false;
        break;
      case "in":
        if (!Array.isArray(value) || !value.includes(docVal)) return false;
        break;
      case "not in":
        if (Array.isArray(value) && value.includes(docVal)) return false;
        break;
      case "like": {
        const pattern = String(value).replace(/%/g, ".*");
        if (!new RegExp(`^${pattern}$`, "i").test(String(docVal ?? ""))) return false;
        break;
      }
      case "is":
        if (value === "set" && (docVal === null || docVal === undefined || docVal === "")) return false;
        if (value === "not set" && docVal !== null && docVal !== undefined && docVal !== "") return false;
        break;
    }
  }
  return true;
}

/** Sort documents by ERPNext-style order_by string, e.g. "posting_date desc" */
export function applyOrderBy(docs: Doc[], orderBy: string): Doc[] {
  if (!orderBy) return docs;
  const parts = orderBy.trim().split(/\s+/);
  const field = parts[0];
  const desc = parts[1]?.toLowerCase() === "desc";
  return [...docs].sort((a, b) => {
    const va = a[field] ?? "";
    const vb = b[field] ?? "";
    if (va < vb) return desc ? 1 : -1;
    if (va > vb) return desc ? -1 : 1;
    return 0;
  });
}

/** Select only requested fields from documents */
export function selectFields(docs: Doc[], fields: string[]): Doc[] {
  if (fields.length === 0 || (fields.length === 1 && fields[0] === "*")) return docs;
  // Handle "field as alias" syntax
  const mappings = fields.map((f) => {
    const m = f.match(/^(.+?)\s+as\s+(.+)$/i);
    return m ? { source: m[1].trim(), alias: m[2].trim() } : { source: f, alias: f };
  });
  return docs.map((doc) => {
    const result: Doc = {};
    for (const { source, alias } of mappings) {
      if (source in doc) result[alias] = doc[source];
    }
    return result;
  });
}
