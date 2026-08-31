// ============================================================================
// agentStream — the client half of the agent activity protocol.
//
// Reads a function's response stream and turns it into typed events the UI can
// render as a step list. Handles both protocols:
//
//   • NDJSON (current) — stream opens with "␟1\n", then one JSON event per line.
//   • Legacy           — raw thinking text, an ANSWER_MARK (␞), then the answer.
//
// Detection is by handshake, so a function that has not migrated yet still
// renders exactly as it did before. See supabase/functions/_shared/progress.ts
// for the emitting side.
// ============================================================================

export const PROTOCOL_MARK = "␟";
export const ANSWER_MARK = "␞";

export type StepState = "start" | "done" | "fail";

export type AgentEvent =
  | { t: "step"; id: string; label: string; state: StepState; detail?: string }
  | { t: "source"; kind: string; label: string; count?: number; url?: string }
  | { t: "think"; text: string }
  | { t: "answer"; text: string }
  | { t: "meta"; data: Record<string, unknown> }
  | { t: "error"; message: string };

/** A step as the UI shows it: label, live state, result, and what it read. */
export type ActivityStep = {
  id: string;
  label: string;
  state: StepState;
  detail?: string;
  sources: { kind: string; label: string; count?: number; url?: string }[];
};

export type Activity = {
  steps: ActivityStep[];
  thinking: string;
  answer: string;
  /** Out-of-band facts from the run — `run_id`, and anything added later. */
  meta: Record<string, unknown>;
  error?: string;
};

export const emptyActivity = (): Activity => ({ steps: [], thinking: "", answer: "", meta: {} });

/**
 * Fold one event into an activity. Returns a new object so React sees a change.
 *
 * `done`/`fail` carry no label — they close the step opened under the same id.
 * An unmatched close is ignored rather than inventing a step, so a malformed
 * stream degrades to "missing a line" instead of "shows a step that never ran".
 */
export function applyEvent(a: Activity, e: AgentEvent): Activity {
  switch (e.t) {
    case "step": {
      if (e.state === "start") {
        if (a.steps.some((s) => s.id === e.id)) return a; // duplicate open
        return { ...a, steps: [...a.steps, { id: e.id, label: e.label, state: "start", sources: [] }] };
      }
      const i = a.steps.findIndex((s) => s.id === e.id);
      if (i === -1) return a;
      const steps = a.steps.slice();
      steps[i] = { ...steps[i], state: e.state, ...(e.detail ? { detail: e.detail } : {}) };
      return { ...a, steps };
    }
    case "source": {
      // Attach to the step still open; if none is, to the most recent one.
      // Scanned backwards rather than via map().lastIndexOf(), which allocated
      // an array of every step's state on each source event.
      let i = -1;
      for (let k = a.steps.length - 1; k >= 0; k--) {
        if (a.steps[k].state === "start") { i = k; break; }
      }
      if (i === -1) i = a.steps.length - 1;
      if (i === -1) return a;
      const steps = a.steps.slice();
      const { kind, label, count, url } = e;
      steps[i] = { ...steps[i], sources: [...steps[i].sources, { kind, label, count, url }] };
      return { ...a, steps };
    }
    case "think":  return { ...a, thinking: a.thinking + e.text };
    case "answer": return { ...a, answer: a.answer + e.text };
    case "meta":   return { ...a, meta: { ...a.meta, ...e.data } };
    case "error":  return { ...a, error: e.message };
  }
}

/**
 * Incremental parser. Feed it decoded chunks; it calls back with each event.
 *
 * The protocol is decided by the first bytes and never revisited, so a legacy
 * payload that happens to contain a "␟" later on is not misread as a handshake.
 */
export function createParser(onEvent: (e: AgentEvent) => void) {
  let mode: "unknown" | "ndjson" | "legacy" = "unknown";
  let buf = "";
  let inAnswer = false; // legacy only

  const legacy = (s: string) => {
    if (inAnswer) { if (s) onEvent({ t: "answer", text: s }); return; }
    const i = s.indexOf(ANSWER_MARK);
    if (i === -1) { if (s) onEvent({ t: "think", text: s }); return; }
    const before = s.slice(0, i);
    const after = s.slice(i + ANSWER_MARK.length);
    if (before) onEvent({ t: "think", text: before });
    inAnswer = true;
    if (after) onEvent({ t: "answer", text: after });
  };

  return {
    push(chunk: string) {
      if (!chunk) return;
      if (mode === "unknown") {
        buf += chunk;
        // Wait for enough bytes to tell the protocols apart.
        if (!buf.startsWith(PROTOCOL_MARK)) {
          if (buf.length < PROTOCOL_MARK.length) return; // still ambiguous
          mode = "legacy";
          const pending = buf; buf = "";
          legacy(pending);
          return;
        }
        const nl = buf.indexOf("\n");
        if (nl === -1) return; // handshake line not complete yet
        mode = "ndjson";
        buf = buf.slice(nl + 1);
        // fall through to drain whatever followed the handshake
      } else if (mode === "legacy") {
        legacy(chunk);
        return;
      } else {
        buf += chunk;
      }

      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        try {
          onEvent(JSON.parse(line) as AgentEvent);
        } catch {
          // A truncated or malformed line is dropped rather than killing the
          // run — the next line usually carries the state we need anyway.
        }
      }
    },
    /** Flush a trailing line with no newline (stream ended mid-write). */
    end() {
      if (mode === "ndjson" && buf.trim()) {
        try { onEvent(JSON.parse(buf) as AgentEvent); } catch { /* ignore */ }
      }
      buf = "";
    },
  };
}

/**
 * Coalesce activity updates to one per animation frame.
 *
 * Every protocol event folds into a new Activity, and a reasoning trace is
 * thousands of deltas — so notifying per event means thousands of React
 * renders of a growing step list for one reply. The screen can only show 60 a
 * second; this delivers the newest state at that rate and drops the rest.
 *
 * `flush()` is not optional: the last events of a run (the final answer, the
 * closing step) usually land inside the final frame window, and without an
 * explicit flush they would be dropped.
 */
export function coalesce<T>(deliver: (v: T) => void): { push: (v: T) => void; flush: () => void } {
  let pending: T | undefined;
  let queued = false;
  // Reached through globalThis so this module also type-checks and runs where
  // there is no DOM — Deno (the test/bench runner) and Next's server render.
  const g = globalThis as unknown as { requestAnimationFrame?: (cb: () => void) => number };
  const raf = (cb: () => void) =>
    typeof g.requestAnimationFrame === "function"
      ? g.requestAnimationFrame(cb)
      : (setTimeout(cb, 16) as unknown as number);

  const fire = () => {
    queued = false;
    if (pending === undefined) return;
    const v = pending;
    pending = undefined;
    deliver(v);
  };

  return {
    push(v: T) {
      pending = v;
      if (queued) return;
      queued = true;
      raf(fire);
    },
    flush() {
      // Deliver synchronously; a queued frame afterwards becomes a no-op.
      fire();
    },
  };
}
