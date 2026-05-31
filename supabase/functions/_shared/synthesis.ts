// ============================================================================
// _shared/synthesis.ts — pure, testable building blocks for product-aware
// synthesis. Extracted so the (next) per-product multi-pass refactor sits on
// TESTED logic and can be verified with `deno test` — no live model or DB.
//
// The performance win we're setting up: today synthesize-signals runs ONE
// org-wide pass over every signal+theme. At scale that's a single ever-growing
// prompt AND it lets one line's signals dilute another's themes. The target is a
// pass PER product line (smaller, scoped prompts) + an org pass + cross-product
// detection. `partitionByLine` is the seam that makes that a tested transform
// instead of a risky rewrite.
// ============================================================================

export type LineId = string | null;

// Derive a new theme's SCOPE from its supporting signals' product lines:
//   0 distinct lines → company-wide; 1 → that line; ≥2 → CROSS-PRODUCT.
// (This is the single source of truth; synthesize-signals imports it.)
export function inferScope(
  sigIds: string[],
  productOfSignal: Map<string, LineId>,
): { product_id: string | null; co_product_ids: string[] } {
  const lines = [...new Set(sigIds.map((id) => productOfSignal.get(id) ?? null).filter((p): p is string => !!p))];
  if (lines.length === 0) return { product_id: null, co_product_ids: [] };   // company-wide
  if (lines.length === 1) return { product_id: lines[0], co_product_ids: [] }; // one line
  return { product_id: lines[0], co_product_ids: lines.slice(1) };            // cross-product
}

export const COMPANY_WIDE = "__company" as const;

export type Scoped = { id: string; product_id?: string | null };

// Partition rows into per-line buckets (null line → COMPANY_WIDE). The seam for
// the per-product synthesis pass: iterate partitions, run a scoped pass on each,
// instead of one org-wide pass over everything. Deterministic + pure → testable.
export function partitionByLine<T extends Scoped>(rows: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const key = r.product_id ?? COMPANY_WIDE;
    const bucket = m.get(key);
    if (bucket) bucket.push(r); else m.set(key, [r]);
  }
  return m;
}

// Stable iteration order for passes: each product line, then company-wide last.
export function passOrder(keys: Iterable<string>): string[] {
  const k = [...keys];
  return k.filter((x) => x !== COMPANY_WIDE).sort().concat(k.includes(COMPANY_WIDE) ? [COMPANY_WIDE] : []);
}
