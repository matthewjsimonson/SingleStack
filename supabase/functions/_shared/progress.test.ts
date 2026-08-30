// Tests for the agent activity protocol — the emitter here and the client
// parser in web/lib/agentStream.ts, exercised together so the two halves are
// verified against each other rather than against a restatement of the format.
// Dependency-free (no network imports), matching the other suites here.
import { HANDSHAKE, noProgress, progress } from "./progress.ts";
import {
  type AgentEvent,
  applyEvent,
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

Deno.test("noProgress discards without throwing", () => {
  const p = noProgress();
  p.step("a", "A"); p.done("a"); p.source({ kind: "k", label: "l" });
  p.think("t"); p.answer("x"); p.error("e"); p.fail("a");
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
