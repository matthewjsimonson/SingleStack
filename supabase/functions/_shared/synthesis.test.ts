// Deno tests for the pure synthesis building blocks — `deno test`.
import { inferScope, partitionByLine, passOrder, COMPANY_WIDE, type LineId } from "./synthesis.ts";

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
