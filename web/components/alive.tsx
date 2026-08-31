"use client";

// Shared "aliveness" primitives for every AI surface, so chat + runs feel alive
// the same way everywhere: a live step checklist while it thinks, and a client-
// side typewriter that reveals the reply at a steady pace no matter how the bytes
// arrive (streamed, gateway-buffered into one blob, or a JSON { reply }).
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Markdown } from "./Markdown";
import AgentActivity from "./AgentActivity";
import { applyEvent, createParser, emptyActivity, type Activity } from "@/lib/agentStream";

export const CHAT_PHASES = ["Reading your question", "Pulling the context", "Thinking it through", "Writing the reply"];
export const RUN_PHASES = ["Reading the context", "Weighing the evidence", "Forming the take", "Structuring the output"];

export const PulseDots = () => (
  <span style={{ marginLeft: 1 }}><span className="pulse-dot">.</span><span className="pulse-dot">.</span><span className="pulse-dot">.</span></span>
);

// A live checklist: done steps tick green, the current one is lit + pulsing.
export function StepList({ phases, active }: { phases: string[]; active: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {phases.map((label, i) => {
        const state = i < active ? "done" : i === active ? "active" : "todo";
        return (
          <div key={label} className="row gap-2" style={{ alignItems: "center", opacity: state === "todo" ? 0.4 : 1, transition: "opacity .3s" }}>
            <span style={{ width: 15, height: 15, borderRadius: "50%", flexShrink: 0, display: "grid", placeItems: "center", fontSize: 9, fontWeight: 700,
              background: state === "done" ? "var(--gn)" : state === "active" ? "var(--ac)" : "var(--fill-2)", color: state === "todo" ? "var(--tm)" : "#fff", border: state === "todo" ? "1px solid var(--border)" : "none" }}>
              {state === "done" ? "✓" : ""}
            </span>
            <span className="t-sub" style={{ fontSize: 12.5, fontWeight: state === "active" ? 600 : 400 }}>{label}{state === "active" ? <PulseDots /> : ""}</span>
          </div>
        );
      })}
    </div>
  );
}

// Advance through steps while `active`, stopping on the last one (it stays lit
// with the pulse until the real work lands).
export function useStepPhase(active: boolean, count: number, ms = 850) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (!active) { setPhase(0); return; }
    const id = setInterval(() => setPhase((p) => Math.min(p + 1, count - 1)), ms);
    return () => clearInterval(id);
  }, [active, count, ms]);
  return phase;
}

// Reveal text at a readable pace, DECOUPLED from delivery. `begin()` to start,
// `push()` each chunk (or the whole thing once), `finish()` when the fetch ends.
export function useTypewriter() {
  const [display, setDisplay] = useState("");
  const [typing, setTyping] = useState(false);
  const target = useRef("");
  const done = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => { if (timer.current) { clearInterval(timer.current); timer.current = null; } setTyping(false); }, []);
  const begin = useCallback(() => {
    target.current = ""; done.current = false; setDisplay(""); setTyping(true);
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => {
      setDisplay((cur) => {
        const full = target.current;
        if (cur.length < full.length) {
          const step = Math.max(2, Math.ceil((full.length - cur.length) / 18)); // ease toward the end
          return full.slice(0, cur.length + step);
        }
        if (done.current) stop();
        return cur;
      });
    }, 18);
  }, [stop]);
  const push = useCallback((chunk: string) => { target.current += chunk; }, []);
  const finish = useCallback(() => { done.current = true; }, []);
  const reset = useCallback(() => { stop(); setDisplay(""); target.current = ""; done.current = false; }, [stop]);
  useEffect(() => () => stop(), [stop]);

  return { display, typing, begin, push, finish, reset };
}


// Call agent-chat with streaming on. The stream is the model's REAL reasoning,
// then the answer separator, so onThinking() gets the live work and
// onChunk() gets the answer. Falls back to JSON { reply } if the streaming
// function isn't deployed yet (then there's no reasoning trace).
export async function streamAgentChat(opts: {
  agentKey: string;
  messages: { role: string; content: string }[];
  context?: unknown;
  token?: string;
  onChunk: (s: string) => void;
  onThinking?: (s: string) => void;
  onActivity?: (a: Activity) => void;   // typed step list, when the function speaks it
  fnName?: string;          // which function to hit (default "agent-chat")
  fallbackFnName?: string;  // retried once if the primary fails BEFORE any output (e.g. not deployed)
}): Promise<void> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  let emitted = false; // once true, we're committed — no fallback mid-stream
  const onChunk = (s: string) => { emitted = true; opts.onChunk(s); };
  const onThinking = (s: string) => { emitted = true; opts.onThinking?.(s); };

  async function once(fnName: string): Promise<void> {
    const resp = await fetch(`${base}/functions/v1/${fnName}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      body: JSON.stringify({ agent_key: opts.agentKey, messages: opts.messages, context: opts.context, stream: true }),
    });
    if (!resp.ok) throw new Error((await resp.text().catch(() => "")) || `Chat failed (${resp.status}).`);
    if ((resp.headers.get("content-type") ?? "").includes("application/json")) {
      const data = await resp.json();
      if (data?.error) throw new Error(data.error);
      onChunk(String(data?.reply ?? ""));
      return;
    }
    if (!resp.body) return;
    const reader = resp.body.getReader();
    const dec = new TextDecoder();

    // One parser for both protocols — see lib/agentStream. A function that has
    // not migrated still arrives as think/answer events via the legacy path.
    let activity = emptyActivity();
    let streamError: string | undefined;
    const parser = createParser((e) => {
      if (e.t === "think") onThinking(e.text);
      else if (e.t === "answer") onChunk(e.text);
      else if (e.t === "error") streamError = e.message;
      // A step the user has already seen counts as output: falling back after
      // one would restart the run underneath visible progress.
      else emitted = true;
      activity = applyEvent(activity, e);
      opts.onActivity?.(activity);
    });

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(dec.decode(value, { stream: true }));
    }
    parser.end();
    if (streamError) throw new Error(streamError);
  }

  try {
    await once(opts.fnName ?? "agent-chat");
  } catch (e) {
    if (opts.fallbackFnName && !emitted) { await once(opts.fallbackFnName); return; } // graceful degrade
    throw e;
  }
}

// Like streamAgentChat, but for STRUCTURED functions (run-workflow / agent-propose).
//
// Speaks BOTH stream protocols via the shared parser in lib/agentStream:
//   • activity (current) — typed step/source/think/answer events
//   • legacy             — raw reasoning, an ANSWER_MARK, then the JSON result
// onActivity() receives the folded activity so a caller can render the step
// list; onThinking() still receives raw reasoning deltas for callers that only
// want the trace. The parsed result is returned either way.
export async function streamStructured<T = unknown>(opts: {
  fnName: string;
  body: Record<string, unknown>;
  token?: string;
  onThinking?: (s: string) => void;
  onActivity?: (a: Activity) => void;
}): Promise<T> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const resp = await fetch(`${base}/functions/v1/${opts.fnName}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: JSON.stringify({ ...opts.body, stream: true }),
  });
  if (!resp.ok) throw new Error((await resp.text().catch(() => "")) || `${opts.fnName} failed (${resp.status}).`);
  if ((resp.headers.get("content-type") ?? "").includes("application/json")) {
    const data = await resp.json();
    if (data?.error) throw new Error(data.error);
    return data as T; // non-streaming fallback (no reasoning trace)
  }
  if (!resp.body) throw new Error("no response body");
  const reader = resp.body.getReader();
  const dec = new TextDecoder();

  let activity = emptyActivity();
  let resultBuf = "";
  let streamError: string | undefined;
  const parser = createParser((e) => {
    if (e.t === "answer") resultBuf += e.text;
    if (e.t === "error") streamError = e.message;
    if (e.t === "think") opts.onThinking?.(e.text);
    activity = applyEvent(activity, e);
    opts.onActivity?.(activity);
  });

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(dec.decode(value, { stream: true }));
  }
  parser.end();

  if (streamError) throw new Error(streamError);
  const parsed = JSON.parse(resultBuf || "{}");
  if (parsed?.error) throw new Error(parsed.error);
  return parsed as T;
}

// Bundles the reasoning trace + the typewriter answer for a single AI reply.
export function useAliveReply() {
  const tw = useTypewriter();
  const [thinking, setThinking] = useState("");
  const [activity, setActivity] = useState<Activity>(emptyActivity());
  const begin = useCallback(() => { setThinking(""); setActivity(emptyActivity()); tw.begin(); }, [tw]);
  const onThinking = useCallback((s: string) => setThinking((p) => p + s), []);
  const onActivity = useCallback((a: Activity) => setActivity(a), []);
  const reset = useCallback(() => { setThinking(""); setActivity(emptyActivity()); tw.reset(); }, [tw]);
  return { thinking, activity, display: tw.display, typing: tw.typing, begin, onThinking, onActivity, onChunk: tw.push, finish: tw.finish, reset };
}

// Renders an in-flight AI reply: the live reasoning trace while it works, then a
// collapsible "reasoning" + the answer typing out.
export function LiveReply({ officer, thinking, display, typing, busy, activity }: {
  officer?: string; thinking: string; display: string; typing: boolean; busy: boolean;
  activity?: Activity;
}) {
  const traceRef = useRef<HTMLDivElement>(null);
  const [showReason, setShowReason] = useState(false);
  useEffect(() => { traceRef.current?.scrollTo({ top: traceRef.current.scrollHeight }); }, [thinking]);
  const traceStyle: CSSProperties = { fontSize: 11.5, lineHeight: 1.5, fontStyle: "italic", whiteSpace: "pre-wrap", borderLeft: "2px solid var(--border)", paddingLeft: 10, color: "var(--tm)" };
  const working = busy && display === "";
  return (
    <div>
      {working ? (
        <div>
          <div className="t-label" style={{ color: "var(--ac)", marginBottom: 8 }}>{officer ?? "Agent"} is working<PulseDots /></div>
          {/* The step list when the function speaks the activity protocol; the
              raw trace is the fallback for one that has not migrated yet. */}
          {activity && (activity.steps.length > 0 || activity.thinking)
            ? <AgentActivity activity={activity} busy={busy} who={officer} />
            : thinking
              ? <div ref={traceRef} style={{ ...traceStyle, maxHeight: 120, overflowY: "auto" }}>{thinking}</div>
              : <div className="t-sub t-muted" style={{ fontSize: 12 }}>Thinking it through<PulseDots /></div>}
        </div>
      ) : (
        <>
          {thinking && (
            <div style={{ marginBottom: 7 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowReason((v) => !v)}>{showReason ? "Hide reasoning" : "Show reasoning"}</button>
              {showReason && <div style={{ ...traceStyle, marginTop: 7 }}>{thinking}</div>}
            </div>
          )}
          <div style={{ lineHeight: 1.55 }}><Markdown text={display} />{typing && <span className="pulse-dot" style={{ fontWeight: 700 }}>▍</span>}</div>
        </>
      )}
    </div>
  );
}
