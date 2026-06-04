"use client";

// Shared "aliveness" primitives for every AI surface, so chat + runs feel alive
// the same way everywhere: a live step checklist while it thinks, and a client-
// side typewriter that reveals the reply at a steady pace no matter how the bytes
// arrive (streamed, gateway-buffered into one blob, or a JSON { reply }).
import { useCallback, useEffect, useRef, useState } from "react";

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

// Call agent-chat with streaming on; feed each text chunk to onChunk. Falls back
// to the JSON { reply } shape if the streaming function isn't deployed yet.
export async function streamAgentChat(opts: {
  agentKey: string;
  // deno-lint-ignore no-explicit-any
  messages: { role: string; content: string }[];
  context?: unknown;
  token?: string;
  onChunk: (s: string) => void;
}): Promise<void> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const resp = await fetch(`${base}/functions/v1/agent-chat`, {
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
    opts.onChunk(String(data?.reply ?? ""));
    return;
  }
  if (!resp.body) return;
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    opts.onChunk(dec.decode(value, { stream: true }));
  }
}
