// ============================================================================
// progress — the agent activity protocol.
//
// An agent that works for 30 seconds behind a spinner is indistinguishable from
// one that has hung. This module is how a function narrates itself while it
// works: discrete steps, the sources it touched, its real reasoning, then the
// answer. The client renders those events directly, so what the user sees is
// what actually happened — no timers, no invented stages.
//
// WIRE FORMAT — newline-delimited JSON over the same ReadableStream we already
// use. The first line is a handshake:
//
//     ␟1\n                        ← protocol marker + version
//     {"t":"step","id":…}\n        ← one JSON object per line
//     {"t":"think","text":…}\n
//
// A stream that does NOT open with the handshake is a legacy stream (raw
// thinking text, an ANSWER_MARK, then the answer). The client detects this and
// falls back, so functions can migrate one at a time with no flag day.
//
// JSON.stringify escapes newlines inside strings, so multi-line reasoning is
// safe to carry on a single NDJSON line.
// ============================================================================

/** Protocol marker. U+241F, chosen to sit alongside ANSWER_MARK (U+241E). */
export const PROTOCOL_MARK = "␟";
export const PROTOCOL_VERSION = 1;
export const HANDSHAKE = `${PROTOCOL_MARK}${PROTOCOL_VERSION}\n`;

export type StepState = "start" | "done" | "fail";

export type AgentEvent =
  /** A unit of work, keyed by `id` so `start` and `done` pair up. */
  | { t: "step"; id: string; label: string; state: StepState; detail?: string }
  /** Something the agent read. Attaches to the step that is currently open. */
  | { t: "source"; kind: string; label: string; count?: number; url?: string }
  /** Summarized reasoning delta — requires display:"summarized" on the model call. */
  | { t: "think"; text: string }
  /** Final answer delta (prose) or the serialized result (structured functions). */
  | { t: "answer"; text: string }
  /** The run failed. Terminal; nothing follows but the close. */
  | { t: "error"; message: string };

export interface Progress {
  /** Open a step. `id` pairs it with the matching done/fail. */
  step(id: string, label: string): void;
  /** Close a step. `detail` is the result worth reporting ("41 signals"). */
  done(id: string, detail?: string): void;
  /** Close a step as failed. The run may still continue. */
  fail(id: string, detail?: string): void;
  /** Attribute a source to the open step. */
  source(s: { kind: string; label: string; count?: number; url?: string }): void;
  think(text: string): void;
  answer(text: string): void;
  error(message: string): void;
}

/**
 * A Progress bound to a ReadableStream controller. Every write is guarded: a
 * closed or errored controller must never take down the work that was
 * reporting to it. Losing the narration is survivable; losing the proposal the
 * agent just spent 30 seconds on is not.
 */
export function progress(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder = new TextEncoder(),
): Progress {
  let open = true;
  const write = (e: AgentEvent) => {
    if (!open) return;
    try {
      controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
    } catch {
      open = false; // controller closed under us — stop trying, keep working
    }
  };
  try {
    controller.enqueue(encoder.encode(HANDSHAKE));
  } catch {
    open = false;
  }
  return {
    step: (id, label) => write({ t: "step", id, label, state: "start" }),
    done: (id, detail) => write({ t: "step", id, label: "", state: "done", ...(detail ? { detail } : {}) }),
    fail: (id, detail) => write({ t: "step", id, label: "", state: "fail", ...(detail ? { detail } : {}) }),
    source: (s) => write({ t: "source", ...s }),
    think: (text) => write({ t: "think", text }),
    answer: (text) => write({ t: "answer", text }),
    error: (message) => write({ t: "error", message }),
  };
}

/**
 * A Progress that discards everything. Lets one code path serve both the
 * streaming and the plain-JSON callers without branching at every step.
 */
export function noProgress(): Progress {
  return {
    step: () => {}, done: () => {}, fail: () => {},
    source: () => {}, think: () => {}, answer: () => {}, error: () => {},
  };
}
