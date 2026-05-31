// ============================================================================
// _shared/synthesis.ts — pure, testable building blocks for product-aware
// synthesis. Extracted so this logic is verified by `deno test` (the real
// module, no live model or DB), not eyeballed.
//
// THE PERFORMANCE/RELIABILITY PROBLEM (and why the naive fix is wrong):
// Today synthesize-signals dumps ALL themes + up to 200 signals into ONE prompt.
// That prompt grows linearly with the org forever → rising cost/latency and an
// eventual context-window cliff (reliability failure).
//
// The naive fix — "one model call per product line" — is a trap: it MULTIPLIES
// API calls by the number of lines (worse, not better) and, fatally, a strict
// per-line pass can never see two lines together, which would BREAK cross-product
// (cross-sell) detection.
//
// THE SOUND FIX (implemented here): keep ONE model call, but BOUND its prompt to
// only the themes that the new signals could plausibly affect:
//   • themes on a line that has new candidate signals this run, PLUS
//   • all company-wide themes (they anchor cross-product detection), PLUS
//   • cross-product themes touching any affected line,
//   • capped to a budget (most-recently-active first).
// Same call count, bounded prompt, no cross-line dilution, cross-sell intact.
// `selectRelevantThemes` + `capCandidates` are that logic, pure and tested.
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

// ---- The bounded-prompt core ----------------------------------------------

export type ThemeLike = {
  id: string;
  product_id?: string | null;
  co_product_ids?: string[] | null;
  last_evidence_at?: string | null;
};

// Which EXISTING themes should this run reason over? Only those the new signals
// could plausibly touch — so the prompt stays bounded as the org grows:
//   • themes whose line has new candidate signals this run (incl. company-wide
//     candidates → company-wide themes),
//   • ALL company-wide themes regardless (they anchor cross-product detection
//     and "applies to everything" reconciliation),
//   • cross-product themes that touch any affected line.
// Then cap to `budget`, keeping the most-recently-active (last_evidence_at desc;
// nulls last). Pure + deterministic.
export function selectRelevantThemes<T extends ThemeLike>(
  themes: T[],
  candidateLines: Set<LineId>,   // distinct lines present in this run's new signals (null = company-wide)
  budget = 60,
): T[] {
  const affected = new Set<string>();
  for (const l of candidateLines) if (l) affected.add(l);
  const companyWideInPlay = candidateLines.has(null);

  const relevant = themes.filter((t) => {
    const primary = t.product_id ?? null;
    const co = t.co_product_ids ?? [];
    if (primary === null) return true;                       // company-wide themes always
    if (affected.has(primary)) return true;                  // theme's line got new signals
    if (co.some((c) => affected.has(c))) return true;        // cross-product theme touching an affected line
    if (companyWideInPlay && co.length > 0) return true;     // company-wide signals can extend cross-sell themes
    return false;
  });

  if (relevant.length <= budget) return relevant;
  return [...relevant]
    .sort((a, b) => tsDesc(a.last_evidence_at, b.last_evidence_at))
    .slice(0, budget);
}

// Cap candidate signals to a per-run budget, newest first (observed_at desc,
// nulls last). Bounds the other half of the prompt. Pure.
export function capCandidates<T extends { observed_at?: string | null }>(signals: T[], budget = 120): T[] {
  if (signals.length <= budget) return signals;
  return [...signals].sort((a, b) => tsDesc(a.observed_at, b.observed_at)).slice(0, budget);
}

// Descending timestamp comparator with nulls sorted last.
function tsDesc(a?: string | null, b?: string | null): number {
  const av = a ? Date.parse(a) : -Infinity;
  const bv = b ? Date.parse(b) : -Infinity;
  return bv - av;
}

// Distinct product lines present in a set of candidate signals (null included
// when any candidate is company-wide). Drives selectRelevantThemes.
export function linesPresent<T extends { product_id?: string | null }>(signals: T[]): Set<LineId> {
  const s = new Set<LineId>();
  for (const sig of signals) s.add(sig.product_id ?? null);
  return s;
}
