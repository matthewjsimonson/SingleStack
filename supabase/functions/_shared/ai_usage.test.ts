// Tests for the spend ledger — the arithmetic, and the drift guard that keeps
// it in one place.
//
// Seven functions once imported PRICING and rewrote the cost expression by hand,
// every one of them omitting the cache terms. They agreed with each other and
// disagreed with costOf(), so the agent surface over-reported its own cost while
// being absent from the dashboard entirely. Typechecks and 54 tests passed the
// whole time — nothing was wrong with any single copy. The last test here is the
// one that would have failed.
// Dependency-free (no network imports), matching the other suites here.
import { addUsage, costOf, emptyUsage, PRICING } from "./ai_usage.ts";

function assertEquals(actual: unknown, expected: unknown, msg?: string) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg ? msg + ": " : ""}expected ${b}, got ${a}`);
}
function assertClose(actual: number, expected: number, msg?: string) {
  if (Math.abs(actual - expected) > 1e-9) throw new Error(`${msg ? msg + ": " : ""}expected ~${expected}, got ${actual}`);
}

// ── the accumulator ─────────────────────────────────────────────────────────

Deno.test("emptyUsage starts at zero on all four counters", () => {
  assertEquals(emptyUsage(), {
    input_tokens: 0, output_tokens: 0,
    cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
  });
});

Deno.test("addUsage folds all four counters, not just input/output", () => {
  let t = emptyUsage();
  t = addUsage(t, { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 900, cache_creation_input_tokens: 50 });
  t = addUsage(t, { input_tokens: 200, output_tokens: 20, cache_read_input_tokens: 800, cache_creation_input_tokens: 0 });
  assertEquals(t, {
    input_tokens: 300, output_tokens: 30,
    cache_read_input_tokens: 1700, cache_creation_input_tokens: 50,
  });
});

Deno.test("addUsage treats absent counters as zero, not NaN", () => {
  // The SDK reports missing cache counters as null; a tool loop folds one of
  // these on every step, so a single NaN would poison the whole run's cost.
  let t = emptyUsage();
  t = addUsage(t, { input_tokens: 5, output_tokens: 1 });                       // undefined
  t = addUsage(t, { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: null });
  t = addUsage(t, null);
  t = addUsage(t, undefined);
  assertEquals(t.input_tokens, 10);
  assertEquals(t.cache_read_input_tokens, 0);
  assertEquals(Number.isNaN(t.output_tokens), false);
});

// ── the arithmetic ──────────────────────────────────────────────────────────

Deno.test("costOf prices cached reads at a tenth of input", () => {
  // 1M cached reads on opus-5 ($5/M input) → $0.50, not $5.00. This is the
  // difference the seven hand-written formulas silently got wrong.
  const cached = costOf("claude-opus-5", { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 })!;
  assertClose(cached, 0.5);
});

Deno.test("costOf charges the cache-write premium", () => {
  // Writes are 1.25x input: 1M on opus-5 → $6.25.
  const written = costOf("claude-opus-5", { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000 })!;
  assertClose(written, 6.25);
});

Deno.test("the omitted cache terms were the whole error", () => {
  // A realistic cached turn: a small fresh prefix, a large cached one.
  const u = { input_tokens: 1_000, output_tokens: 500, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 0 };
  const correct = costOf("claude-opus-5", u)!;
  // What the seven inline formulas computed — input+output only, cache ignored.
  const p = PRICING["claude-opus-5"];
  const oldWay = (u.input_tokens * p.input + u.output_tokens * p.output) / 1_000_000;
  if (correct <= oldWay) throw new Error("cached reads must add cost, not vanish");
  assertClose(correct, oldWay + (40_000 * 5 * 0.1) / 1_000_000);
});

Deno.test("an unknown model logs tokens but prices nothing", () => {
  assertEquals(costOf("some-future-model", { input_tokens: 10, output_tokens: 10 }), null);
});

Deno.test("every priced model has non-zero input and output rates", () => {
  for (const [id, p] of Object.entries(PRICING)) {
    if (!(p.input > 0) || !(p.output > 0)) throw new Error(`${id} has a zero/absent rate: ${JSON.stringify(p)}`);
  }
});

// ── the drift guard ─────────────────────────────────────────────────────────

/**
 * Every function's `index.ts`, comments stripped.
 *
 * Stripping matters in BOTH directions, and the second one is easy to miss: a
 * comment that merely *mentions* logUsage() would satisfy a raw-source check
 * for it, so a function could lose the call and still pass. (A `//` inside a
 * string over-strips, which can only cause a missed detection, never a false
 * accusation.)
 */
async function functionSources(): Promise<{ name: string; code: string }[]> {
  const fnDir = new URL("../", import.meta.url);
  const out: { name: string; code: string }[] = [];
  for await (const entry of Deno.readDir(fnDir)) {
    if (!entry.isDirectory || entry.name === "_shared") continue;
    let src: string;
    try { src = await Deno.readTextFile(new URL(`${entry.name}/index.ts`, fnDir)); } catch { continue; }
    out.push({ name: entry.name, code: src.split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n") });
  }
  return out;
}

Deno.test("cost arithmetic exists only in _shared/ai_usage.ts", async () => {
  const offenders: string[] = [];
  for (const { name, code } of await functionSources()) {
    if (/\bPRICING\b/.test(code)) offenders.push(`${name}: imports/indexes PRICING directly`);
    if (/\bprice\.(input|output)\b/.test(code)) offenders.push(`${name}: reimplements the cost expression`);
  }
  if (offenders.length) {
    throw new Error(
      "Cost arithmetic must live only in _shared/ai_usage.ts — use costOf(model, usage).\n  " +
      offenders.join("\n  "),
    );
  }
});

Deno.test("every function that calls the model writes to the spend ledger", async () => {
  // agent_runs is per-run observability; ai_usage is what the cost dashboard
  // reads. Seven functions wrote only the former, so the dashboard was blind to
  // the entire agent surface — including agent-run, the most expensive path.
  const missing = (await functionSources())
    .filter(({ code }) => /anthropic\.messages\./.test(code) && !/\blogUsage\b/.test(code))
    .map(({ name }) => name);
  assertEquals(missing, [], "these call the model but never log spend");
});
