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
  /**
   * Out-of-band facts the caller needs that are not part of the answer — the
   * `run_id` a client attaches its helpful/not-helpful verdict to, above all.
   * A blocking response could return these alongside the reply; a stream needs
   * somewhere to put them.
   */
  | { t: "meta"; data: Record<string, unknown> }
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
  meta(data: Record<string, unknown>): void;
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
    meta: (data) => write({ t: "meta", data }),
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
    source: () => {}, think: () => {}, answer: () => {},
    meta: () => {}, error: () => {},
  };
}

/**
 * The dispatch every migrated function shares.
 *
 * `run` is the job, written once, narrating through `p`. Called with a live
 * Progress when the client asked to stream and with a discarding one otherwise,
 * so there is never a second implementation to keep in sync. The result is
 * serialized as the answer, and a throw becomes an error event rather than a
 * dead stream — a client waiting on a stream that just closes has no way to
 * tell failure from success.
 */
export function dispatch(
  streaming: boolean,
  cors: Record<string, string>,
  run: (p: Progress) => Promise<unknown>,
  opts: { onFail?: (message: string) => Promise<void> | void } = {},
): Promise<Response> | Response {
  if (streaming) {
    const stream = new ReadableStream({
      async start(controller) {
        const p = progress(controller);
        try {
          p.answer(JSON.stringify(await run(p)));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          try { await opts.onFail?.(msg); } catch { /* reporting must not mask the cause */ }
          p.error(msg);
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: { ...cors, "content-type": "text/plain; charset=utf-8", "cache-control": "no-cache" },
    });
  }
  return (async () => {
    try {
      const out = await run(noProgress());
      return new Response(JSON.stringify(out), { headers: { ...cors, "content-type": "application/json" } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      try { await opts.onFail?.(msg); } catch { /* as above */ }
      const status = (e as { status?: number })?.status ?? 500;
      return new Response(JSON.stringify({ error: msg }), { status, headers: { ...cors, "content-type": "application/json" } });
    }
  })();
}
