// Tests for the agent activity protocol — the emitter here and the client
// parser in web/lib/agentStream.ts, exercised together so the two halves are
// verified against each other rather than against a restatement of the format.
// Dependency-free (no network imports), matching the other suites here.
import { HANDSHAKE, noProgress, progress } from "./progress.ts";
import {
  type AgentEvent,
  applyEvent,
  coalesce,
  createParser,
  emptyActivity,
} from "../../../web/lib/agentStream.ts";

function assertEquals(actual: unknown, expected: unknown, msg?: string) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg ? msg + ": " : ""}expected ${b}, got ${a}`);
}

/** Collect everything a Progress writes, as decoded text. */
function capture(): { out: () => string; controller: ReadableStreamDefaultController<Uint8Array> } {
  const chunks: Uint8Array[] = [];
  const dec = new TextDecoder();
  const controller = {
    enqueue: (u: Uint8Array) => chunks.push(u),
    close: () => {},
    error: () => {},
  } as unknown as ReadableStreamDefaultController<Uint8Array>;
  return { out: () => chunks.map((c) => dec.decode(c)).join(""), controller };
}

/** Round-trip a wire payload through the client parser. */
function parse(wire: string, chunkSize = 0): AgentEvent[] {
  const events: AgentEvent[] = [];
  const p = createParser((e) => events.push(e));
  if (chunkSize <= 0) p.push(wire);
  else for (let i = 0; i < wire.length; i += chunkSize) p.push(wire.slice(i, i + chunkSize));
  p.end();
  return events;
}

Deno.test("emitter opens with the handshake", () => {
  const { out, controller } = capture();
  progress(controller);
  assertEquals(out(), HANDSHAKE);
});

Deno.test("emitted events round-trip through the client parser", () => {
  const { out, controller } = capture();
  const p = progress(controller);
  p.step("read", "Reading the GTM record");
  p.done("read");
  p.step("signals", "Reviewing signals");
  p.source({ kind: "web_search", label: "web search", count: 22 });
  p.done("signals", "41 signals from the last 14 days");
  p.think("weighing the pricing objection");
  p.answer('{"ok":true}');

  const events = parse(out());
  assertEquals(events.length, 7);
  assertEquals(events[0], { t: "step", id: "read", label: "Reading the GTM record", state: "start" });
  assertEquals(events[1], { t: "step", id: "read", label: "", state: "done" });
  assertEquals(events[3], { t: "source", kind: "web_search", label: "web search", count: 22 });
  assertEquals(events[4].t === "step" && events[4].detail, "41 signals from the last 14 days");
});

Deno.test("parser is chunk-boundary safe", () => {
  const { out, controller } = capture();
  const p = progress(controller);
  p.step("a", "Step A");
  p.done("a", "done it");
  p.answer("result");
  const wire = out();
  // One byte at a time is the worst case a network can hand us.
  assertEquals(parse(wire, 1).length, 3);
  assertEquals(parse(wire, 3).length, 3);
  assertEquals(parse(wire).length, 3);
});

Deno.test("multi-line reasoning survives the wire", () => {
  const { out, controller } = capture();
  const p = progress(controller);
  const messy = "line one\nline two\n\ttabbed \"quoted\" ␞ and a marker";
  p.think(messy);
  const events = parse(out());
  assertEquals(events.length, 1);
  assertEquals(events[0].t === "think" && events[0].text, messy);
});

Deno.test("legacy streams still parse (no handshake)", () => {
  const events = parse("thinking out loud␞the answer");
  assertEquals(events, [
    { t: "think", text: "thinking out loud" },
    { t: "answer", text: "the answer" },
  ]);
});

Deno.test("legacy: a ␞ arriving in a later chunk still splits", () => {
  const events = parse("reasoning␞answered", 4);
  const think = events.filter((e) => e.t === "think").map((e) => (e.t === "think" ? e.text : "")).join("");
  const answer = events.filter((e) => e.t === "answer").map((e) => (e.t === "answer" ? e.text : "")).join("");
  assertEquals(think, "reasoning");
  assertEquals(answer, "answered");
});

Deno.test("a malformed line is dropped, the stream continues", () => {
  const wire = HANDSHAKE + '{"t":"step","id":"a","label":"A","state":"start"}\n' +
    "{not json}\n" + '{"t":"answer","text":"ok"}\n';
  const events = parse(wire);
  assertEquals(events.length, 2);
  assertEquals(events[1], { t: "answer", text: "ok" });
});

Deno.test("applyEvent builds the step list the UI renders", () => {
  let a = emptyActivity();
  for (
    const e of [
      { t: "step", id: "read", label: "Reading the record", state: "start" },
      { t: "step", id: "read", label: "", state: "done", detail: "GTM record" },
      { t: "step", id: "sig", label: "Reviewing signals", state: "start" },
      { t: "source", kind: "web_search", label: "web search", count: 22 },
      { t: "source", kind: "reviews", label: "G2 reviews", count: 14 },
      { t: "think", text: "hmm" },
    ] as AgentEvent[]
  ) a = applyEvent(a, e);

  assertEquals(a.steps.length, 2);
  assertEquals(a.steps[0].state, "done");
  assertEquals(a.steps[0].detail, "GTM record");
  assertEquals(a.steps[1].state, "start");
  assertEquals(a.steps[1].sources.length, 2);   // sources land on the OPEN step
  assertEquals(a.steps[0].sources.length, 0);
  assertEquals(a.thinking, "hmm");
});

Deno.test("applyEvent ignores a close with no matching open", () => {
  const a = applyEvent(emptyActivity(), { t: "step", id: "ghost", label: "", state: "done" });
  assertEquals(a.steps.length, 0); // never invent a step that did not run
});

Deno.test("applyEvent ignores a duplicate open", () => {
  let a = emptyActivity();
  a = applyEvent(a, { t: "step", id: "x", label: "X", state: "start" });
  a = applyEvent(a, { t: "step", id: "x", label: "X again", state: "start" });
  assertEquals(a.steps.length, 1);
  assertEquals(a.steps[0].label, "X");
});

Deno.test("meta carries out-of-band facts (run_id) to the client", () => {
  const { out, controller } = capture();
  const p = progress(controller);
  p.answer("the reply");
  p.meta({ run_id: "abc-123" });

  const events = parse(out());
  assertEquals(events[1], { t: "meta", data: { run_id: "abc-123" } });

  let a = emptyActivity();
  for (const e of events) a = applyEvent(a, e);
  assertEquals(a.meta.run_id, "abc-123");
  assertEquals(a.answer, "the reply"); // meta never pollutes the answer
});

Deno.test("meta merges across events rather than replacing", () => {
  let a = emptyActivity();
  a = applyEvent(a, { t: "meta", data: { run_id: "r1" } });
  a = applyEvent(a, { t: "meta", data: { proposal_id: "p1" } });
  assertEquals(a.meta, { run_id: "r1", proposal_id: "p1" });
});

// ── update coalescing ───────────────────────────────────────────────────────
// A deferring rAF, like a browser: callbacks queue and run at frame boundaries.
function withFakeFrames<T>(body: (runFrame: () => void) => T): T {
  const g = globalThis as unknown as { requestAnimationFrame?: (cb: () => void) => number };
  const prev = g.requestAnimationFrame;
  let queue: (() => void)[] = [];
  g.requestAnimationFrame = (cb: () => void) => { queue.push(cb); return queue.length; };
  try {
    return body(() => { const q = queue; queue = []; for (const cb of q) cb(); });
  } finally {
    g.requestAnimationFrame = prev;
  }
}

Deno.test("coalesce collapses a burst into one delivery per frame", () => {
  withFakeFrames((runFrame) => {
    const got: number[] = [];
    const c = coalesce<number>((v) => got.push(v));
    for (let i = 0; i < 100; i++) c.push(i);
    runFrame();
    assertEquals(got, [99], "only the newest state should reach the renderer");
  });
});

Deno.test("coalesce delivers once per frame across several frames", () => {
  withFakeFrames((runFrame) => {
    const got: number[] = [];
    const c = coalesce<number>((v) => got.push(v));
    c.push(1); c.push(2); runFrame();
    c.push(3); c.push(4); runFrame();
    assertEquals(got, [2, 4]);
  });
});

Deno.test("coalesce.flush delivers the tail that no frame would carry", () => {
  withFakeFrames((runFrame) => {
    const got: number[] = [];
    const c = coalesce<number>((v) => got.push(v));
    c.push(1); runFrame();
    c.push(2);          // the closing events of a run land here
    c.flush();
    assertEquals(got, [1, 2], "the final state must never be dropped");
  });
});

Deno.test("coalesce.flush is idempotent and a later frame is a no-op", () => {
  withFakeFrames((runFrame) => {
    const got: number[] = [];
    const c = coalesce<number>((v) => got.push(v));
    c.push(1);
    c.flush(); c.flush();
    runFrame();
    assertEquals(got, [1], "flushing twice must not double-deliver");
  });
});

Deno.test("coalesce with nothing pending delivers nothing", () => {
  withFakeFrames((runFrame) => {
    const got: number[] = [];
    const c = coalesce<number>((v) => got.push(v));
    c.flush(); runFrame();
    assertEquals(got, []);
  });
});

Deno.test("source attaches to the open step without scanning allocations", () => {
  // Behavioural guard for the backwards scan that replaced map().lastIndexOf().
  let a = emptyActivity();
  a = applyEvent(a, { t: "step", id: "a", label: "A", state: "start" });
  a = applyEvent(a, { t: "step", id: "a", label: "", state: "done" });
  a = applyEvent(a, { t: "step", id: "b", label: "B", state: "start" });
  a = applyEvent(a, { t: "source", kind: "web_search", label: "web" });
  assertEquals(a.steps[0].sources.length, 0);
  assertEquals(a.steps[1].sources.length, 1);

  // With every step closed, the source lands on the most recent one.
  a = applyEvent(a, { t: "step", id: "b", label: "", state: "done" });
  a = applyEvent(a, { t: "source", kind: "manual", label: "manual" });
  assertEquals(a.steps[1].sources.length, 2);
});

Deno.test("noProgress discards without throwing", () => {
  const p = noProgress();
  p.step("a", "A"); p.done("a"); p.source({ kind: "k", label: "l" });
  p.think("t"); p.answer("x"); p.meta({ a: 1 }); p.error("e"); p.fail("a");
});

Deno.test("a closed controller never breaks the caller", () => {
  const controller = {
    enqueue: () => { throw new Error("stream closed"); },
  } as unknown as ReadableStreamDefaultController<Uint8Array>;
  const p = progress(controller); // handshake itself throws
  p.step("a", "A");               // must not propagate
  p.done("a");
  p.error("boom");
});
