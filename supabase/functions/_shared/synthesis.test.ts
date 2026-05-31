// Deno tests for the pure synthesis building blocks — `deno test`.
import {
  inferScope, partitionByLine, passOrder, COMPANY_WIDE,
  selectRelevantThemes, capCandidates, linesPresent, type LineId,
} from "./synthesis.ts";

function assert(c: boolean, m: string) { if (!c) throw new Error(m); }
const pos = new Map<string, LineId>([["s1", "A"], ["s2", "A"], ["s3", "B"], ["s4", null], ["s5", "C"]]);

Deno.test("inferScope: one line", () => {
  const r = inferScope(["s1", "s2"], pos);
  assert(r.product_id === "A" && r.co_product_ids.length === 0, JSON.stringify(r));
});
Deno.test("inferScope: company-wide when no/null lines", () => {
  assert(inferScope(["s4"], pos).product_id === null, "single null → company-wide");
  assert(inferScope([], pos).product_id === null, "empty → company-wide");
});
Deno.test("inferScope: cross-product (≥2 lines), nulls ignored", () => {
  const r = inferScope(["s1", "s3", "s4"], pos); // A, B, null
  assert(r.product_id === "A" && JSON.stringify(r.co_product_ids) === JSON.stringify(["B"]), JSON.stringify(r));
});
Deno.test("inferScope: invariants hold (primary∉co, co⇒primary)", () => {
  for (const ids of [["s1"], ["s1", "s3"], ["s1", "s3", "s5"], ["s4"], []]) {
    const r = inferScope(ids, pos);
    assert(!r.co_product_ids.includes(r.product_id as string), "primary must not be in co");
    assert(r.co_product_ids.length === 0 || r.product_id !== null, "co requires a primary");
  }
});

Deno.test("partitionByLine: buckets by line, null → company-wide", () => {
  const parts = partitionByLine([
    { id: "1", product_id: "A" }, { id: "2", product_id: "A" },
    { id: "3", product_id: "B" }, { id: "4", product_id: null }, { id: "5" },
  ]);
  assert(parts.get("A")!.length === 2, "A has 2");
  assert(parts.get("B")!.length === 1, "B has 1");
  assert(parts.get(COMPANY_WIDE)!.length === 2, "company-wide has 2 (null + undefined)");
});

Deno.test("passOrder: lines sorted, company-wide last", () => {
  const order = passOrder(["B", COMPANY_WIDE, "A"]);
  assert(JSON.stringify(order) === JSON.stringify(["A", "B", COMPANY_WIDE]), order.join(","));
});

// ---- bounded-prompt selection ----------------------------------------------
const themes = [
  { id: "tA", product_id: "A", last_evidence_at: "2026-05-01" },
  { id: "tB", product_id: "B", last_evidence_at: "2026-05-02" },
  { id: "tC", product_id: "C", last_evidence_at: "2026-05-03" },
  { id: "tCW", product_id: null, last_evidence_at: "2026-04-01" },
  { id: "tX_AB", product_id: "A", co_product_ids: ["B"], last_evidence_at: "2026-05-04" }, // cross-product A+B
];

Deno.test("selectRelevantThemes: only affected lines + always company-wide", () => {
  // New signals only on line A → include tA, the cross-product tX_AB (touches A), and tCW; exclude tB, tC.
  const ids = selectRelevantThemes(themes, new Set<LineId>(["A"])).map((t) => t.id).sort();
  assert(JSON.stringify(ids) === JSON.stringify(["tA", "tCW", "tX_AB"]), ids.join(","));
});

Deno.test("selectRelevantThemes: cross-product theme pulled in via its co leg", () => {
  // New signals only on line B → tB, tX_AB (co contains B), tCW; not tA/tC.
  const ids = selectRelevantThemes(themes, new Set<LineId>(["B"])).map((t) => t.id).sort();
  assert(JSON.stringify(ids) === JSON.stringify(["tB", "tCW", "tX_AB"]), ids.join(","));
});

Deno.test("selectRelevantThemes: company-wide candidates can extend cross-sell themes", () => {
  const ids = selectRelevantThemes(themes, new Set<LineId>([null])).map((t) => t.id).sort();
  // company-wide themes always + cross-product themes (co.length>0) → tCW, tX_AB
  assert(ids.includes("tCW") && ids.includes("tX_AB"), ids.join(","));
  assert(!ids.includes("tA") && !ids.includes("tB"), "single-line themes excluded: " + ids.join(","));
});

Deno.test("selectRelevantThemes: budget keeps most-recently-active", () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, product_id: "A", last_evidence_at: `2026-05-${String(i + 1).padStart(2, "0")}` }));
  const got = selectRelevantThemes(many, new Set<LineId>(["A"]), 3).map((t) => t.id);
  assert(JSON.stringify(got) === JSON.stringify(["t9", "t8", "t7"]), got.join(",")); // newest 3
});

Deno.test("capCandidates: caps to newest-N by observed_at, nulls last", () => {
  const sigs = [
    { id: "old", observed_at: "2026-01-01" },
    { id: "new", observed_at: "2026-05-01" },
    { id: "mid", observed_at: "2026-03-01" },
    { id: "nul", observed_at: null },
  ];
  const got = capCandidates(sigs, 2).map((s) => s.id);
  assert(JSON.stringify(got) === JSON.stringify(["new", "mid"]), got.join(","));
  assert(capCandidates(sigs, 99).length === 4, "no cap when under budget");
});

Deno.test("linesPresent: distinct lines incl. null for company-wide", () => {
  const lp = linesPresent([{ product_id: "A" }, { product_id: "A" }, { product_id: null }, {}]);
  assert(lp.has("A") && lp.has(null) && lp.size === 2, [...lp].join(","));
});
