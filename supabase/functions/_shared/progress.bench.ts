// Throughput + allocation characteristics of the activity protocol, measured
// rather than assumed. Run: deno run --allow-hrtime _shared/progress.bench.ts
//
// The numbers that matter are the ones a real run produces: a long reasoning
// trace arrives as thousands of small deltas, and every one of them is folded
// into an immutable Activity that React then re-renders from.
import { progress } from "./progress.ts";
import { applyEvent, createParser, emptyActivity } from "../../../web/lib/agentStream.ts";

function capture() {
  const chunks: Uint8Array[] = [];
  const controller = {
    enqueue: (u: Uint8Array) => chunks.push(u),
  } as unknown as ReadableStreamDefaultController<Uint8Array>;
  const dec = new TextDecoder();
  return { out: () => chunks.map((c) => dec.decode(c)).join(""), controller };
}

const ms = (f: () => void) => {
  const t = performance.now();
  f();
  return performance.now() - t;
};

console.log("── emit + parse throughput ──────────────────────────────────");
for (const n of [1_000, 5_000, 20_000]) {
  const { out, controller } = capture();
  const p = progress(controller);
  const emit = ms(() => { for (let i = 0; i < n; i++) p.think("a token of reasoning "); });
  const wire = out();

  let count = 0;
  const parseMs = ms(() => {
    const parser = createParser(() => count++);
    parser.push(wire);
    parser.end();
  });
  console.log(
    `  ${String(n).padStart(6)} events | emit ${emit.toFixed(1).padStart(7)}ms | parse ${parseMs.toFixed(1).padStart(7)}ms | ` +
    `wire ${(wire.length / 1024).toFixed(0).padStart(5)}KB | parsed ${count}`,
  );
}

console.log("\n── applyEvent fold (what React re-renders from) ─────────────");
for (const n of [1_000, 5_000, 20_000]) {
  let a = emptyActivity();
  const fold = ms(() => {
    for (let i = 0; i < n; i++) a = applyEvent(a, { t: "think", text: "a token of reasoning " });
  });
  console.log(
    `  ${String(n).padStart(6)} think deltas | fold ${fold.toFixed(1).padStart(8)}ms | ` +
    `${(fold / n * 1000).toFixed(2).padStart(6)}µs/event | trace ${(a.thinking.length / 1024).toFixed(0)}KB`,
  );
}

console.log("\n── applyEvent with many steps (array copy per event) ────────");
for (const n of [50, 200, 1_000]) {
  let a = emptyActivity();
  const fold = ms(() => {
    for (let i = 0; i < n; i++) {
      a = applyEvent(a, { t: "step", id: `s${i}`, label: `Step ${i}`, state: "start" });
      a = applyEvent(a, { t: "source", kind: "web_search", label: "web", count: i });
      a = applyEvent(a, { t: "step", id: `s${i}`, label: "", state: "done" });
    }
  });
  console.log(`  ${String(n).padStart(6)} steps | fold ${fold.toFixed(1).padStart(8)}ms | ${(fold / n * 1000).toFixed(1).padStart(7)}µs/step`);
}

console.log("\n── worst case: one enormous line ────────────────────────────");
{
  const { out, controller } = capture();
  const p = progress(controller);
  p.think("x".repeat(2_000_000)); // 2MB of reasoning in a single event
  const wire = out();
  let got = 0;
  const t = ms(() => {
    const parser = createParser((e) => { if (e.t === "think") got = e.text.length; });
    // fed in 16KB network-sized chunks
    for (let i = 0; i < wire.length; i += 16_384) parser.push(wire.slice(i, i + 16_384));
    parser.end();
  });
  console.log(`  2MB single event | parse ${t.toFixed(1)}ms | recovered ${(got / 1_000_000).toFixed(2)}MB`);
}

console.log("\n── chunk-size sensitivity (same payload, different splits) ──");
{
  const { out, controller } = capture();
  const p = progress(controller);
  for (let i = 0; i < 5_000; i++) p.think("reasoning ");
  const wire = out();
  for (const size of [1, 64, 1_024, 16_384]) {
    let count = 0;
    const t = ms(() => {
      const parser = createParser(() => count++);
      for (let i = 0; i < wire.length; i += size) parser.push(wire.slice(i, i + size));
      parser.end();
    });
    console.log(`  chunk ${String(size).padStart(6)}B | ${t.toFixed(1).padStart(8)}ms | ${count} events`);
  }
}

console.log("\n── update coalescing: renders a real reply would trigger ────");
{
  const { coalesce } = await import("../../../web/lib/agentStream.ts");
  // A rAF that DEFERS, like a browser: callbacks queue and run at frame
  // boundaries, not inline. Firing inline would measure nothing.
  const g = globalThis as unknown as { requestAnimationFrame?: (cb: () => void) => number };
  const prev = g.requestAnimationFrame;
  let queue: (() => void)[] = [];
  g.requestAnimationFrame = (cb: () => void) => { queue.push(cb); return queue.length; };
  const runFrame = () => { const q = queue; queue = []; for (const cb of q) cb(); };

  // ~2500 events/sec arriving at 60fps ≈ 40 events per frame.
  const PER_FRAME = 40;
  for (const [label, events] of [["short reply", 400], ["long reasoning", 3_000], ["deep agent run", 12_000]] as [string, number][]) {
    let renders = 0;
    const paint = coalesce<number>(() => renders++);
    for (let i = 0; i < events; i++) {
      paint.push(i);
      if (i % PER_FRAME === PER_FRAME - 1) runFrame();
    }
    runFrame();
    paint.flush();
    console.log(
      `  ${label.padEnd(16)} ${String(events).padStart(6)} events | without ${String(events).padStart(6)} renders | ` +
      `with ${String(renders).padStart(5)} | ${(events / renders).toFixed(0)}x fewer`,
    );
  }
  g.requestAnimationFrame = prev;
}
