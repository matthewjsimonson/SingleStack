"use client";

// Slide-out drawer for an executive agent: a live status panel (tiles) + a real
// chat that talks to the agent-chat Edge Function (grounded in the org's data),
// with a one-click "Daily briefing" action.
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Exec } from "@/lib/team";
import { Chip } from "@/components/ui";
import { LiveReply, useAliveReply, streamAgentChat } from "@/components/alive";
import WorkflowRunDrawer from "@/components/WorkflowRunDrawer";

type WF = { id: string; name: string; description: string | null; steps: unknown[] | null };

type Msg = { role: "user" | "assistant"; content: string };
export type AgentContext = {
  area?: "products" | "gtm" | "signals" | "records";
  record_id?: string;
  record_type?: "product" | "gtm";
  record_name?: string;
  module?: string;
};

export default function AgentDrawer({
  exec,
  open,
  onClose,
  context,
}: {
  exec: Exec | null;
  open: boolean;
  onClose: () => void;
  context?: AgentContext | null;
}) {
  const supabase = createClient();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState(0);
  const [pending, setPending] = useState(0);
  const [mode, setMode] = useState<"chat" | "workflows">("chat");
  const [workflows, setWorkflows] = useState<WF[]>([]);
  const [runWf, setRunWf] = useState<{ id: string; name: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);   // the in-progress reply bubble, to bring into view
  const reply = useAliveReply();

  // When the reply has fully typed out, commit it as a message and clear the live bubble.
  useEffect(() => {
    if (!busy && !reply.typing && reply.display) {
      setMessages((prev) => [...prev, { role: "assistant", content: reply.display }]);
      reply.reset();
    }
  }, [busy, reply.typing, reply.display, reply.reset]);

  // reset + load light status whenever a different agent opens
  useEffect(() => {
    if (!open || !exec) return;
    setMessages([]); setInput(""); setError(null); setMode("chat");
    (async () => {
      const [{ data: ag }, { data: wf }] = await Promise.all([
        supabase.from("agents").select("id").eq("key", exec.key).maybeSingle(),
        supabase.from("workflows").select("id, name, description, steps").eq("is_active", true).order("created_at"),
      ]);
      if (ag) {
        const { count: rc } = await supabase.from("agent_runs").select("id", { count: "exact", head: true }).eq("agent_id", ag.id);
        setRuns(rc ?? 0);
      } else setRuns(0);
      const { count: pc } = await supabase.from("proposals").select("id", { count: "exact", head: true }).eq("status", "pending");
      setPending(pc ?? 0);
      setWorkflows((wf ?? []) as WF[]);
    })();
  }, [open, exec, supabase]);

  // No scroll-to-bottom — on a new turn we bring the START of the reply into view
  // (below) so you read top-down instead of being yanked to the end.

  async function send(text: string) {
    if (!exec || !text.trim()) return;
    const next = [...messages, { role: "user" as const, content: text.trim() }];
    setMessages(next); setInput(""); setBusy(true); setError(null);
    reply.begin();
    requestAnimationFrame(() => liveRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
    try {
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      await streamAgentChat({ agentKey: exec.key, messages: next, context: context ?? undefined, token, onChunk: reply.onChunk, onThinking: reply.onThinking });
      reply.finish();
    } catch (e) {
      reply.reset();
      setError(e instanceof Error ? e.message : "Chat failed.");
    } finally { setBusy(false); }
  }

  if (!exec) return null;

  return (
    <>
      {/* scrim */}
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(11,12,14,0.32)", opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none", transition: "opacity 0.18s ease", zIndex: 40 }} />
      {/* panel */}
      <aside style={{
        position: "fixed", top: 0, right: 0, height: "100vh", width: 440, maxWidth: "92vw",
        background: "var(--panel)", borderLeft: "1px solid var(--border)", boxShadow: "var(--shadow-md)",
        transform: open ? "translateX(0)" : "translateX(100%)", transition: "transform 0.22s cubic-bezier(0.4,0,0.2,1)",
        zIndex: 41, display: "flex", flexDirection: "column",
      }}>
        {/* header */}
        <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 38, height: 38, borderRadius: 10, background: exec.accent, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 14, flexShrink: 0 }}>{exec.short}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 660 }}>{exec.name}</div>
            <div className="t-sub t-muted" style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{exec.role}</div>
          </div>
          <button onClick={onClose} className="btn btn-secondary btn-sm">Close</button>
        </div>

        {/* context strip — shows what the agent is grounded in right now */}
        {context?.record_name && (
          <div style={{ padding: "8px 18px", borderBottom: "1px solid var(--border)", background: "var(--panel-2)", display: "flex", alignItems: "center", gap: 8 }}>
            <span className="t-label" style={{ color: "var(--tm)" }}>Grounded in</span>
            <span className="chip chip-accent" style={{ fontSize: 11.5 }}>
              {context.record_type === "gtm" ? "GTM" : "Product"}: {context.record_name}{context.module ? ` · ${context.module}` : ""}
            </span>
          </div>
        )}

        {/* status tiles */}
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div className="card card-pad" style={{ padding: 12 }}><div className="stat"><span className="stat-num" style={{ fontSize: 18 }}>{runs}</span><span className="stat-label">Runs</span></div></div>
          <div className="card card-pad" style={{ padding: 12 }}><div className="stat"><span className="stat-num" style={{ fontSize: 18, color: pending > 0 ? "var(--vl-text)" : undefined }}>{pending}</span><span className="stat-label">Pending</span></div></div>
        </div>

        {/* mode toggle — Chat vs your agentic Workflows */}
        <div style={{ padding: "10px 18px 0", display: "flex", gap: 6 }}>
          {(["chat", "workflows"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} style={{
              flex: 1, padding: "6px 10px", fontSize: 12.5, fontWeight: 620, cursor: "pointer", borderRadius: 8,
              border: "1px solid " + (mode === m ? "var(--ac)" : "var(--border)"),
              background: mode === m ? "var(--ac-fill)" : "transparent", color: mode === m ? "var(--ac-text)" : "var(--ts)",
            }}>{m === "chat" ? "Chat" : `Workflows${workflows.length ? ` · ${workflows.length}` : ""}`}</button>
          ))}
        </div>

        {mode === "chat" ? (
          <>
            {/* chat */}
            <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
              {messages.length === 0 && (
                <div className="t-sub t-muted" style={{ textAlign: "center", padding: "24px 0" }}>
                  Chat with {exec.name.split(" ").slice(-1)}, or get a daily briefing.
                </div>
              )}
              <div className="stack-3">
                {messages.map((m, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                    <div style={{
                      maxWidth: "85%", padding: "9px 12px", borderRadius: 12, fontSize: 13.5, lineHeight: 1.55, whiteSpace: "pre-wrap",
                      background: m.role === "user" ? "var(--tp)" : "var(--fill)",
                      color: m.role === "user" ? "#fff" : "var(--tp)",
                      borderBottomRightRadius: m.role === "user" ? 4 : 12,
                      borderBottomLeftRadius: m.role === "user" ? 12 : 4,
                    }}>{m.content}</div>
                  </div>
                ))}
                {/* live reply — real reasoning trace while it works, then the answer types out */}
                {(busy || reply.typing) && (
                  <div ref={liveRef} style={{ display: "flex", justifyContent: "flex-start" }}>
                    <div style={{ maxWidth: "92%", padding: "10px 12px", borderRadius: 12, borderBottomLeftRadius: 4, background: "var(--fill)", color: "var(--tp)", fontSize: 13.5 }}>
                      <LiveReply officer={exec.name.split(" ").slice(-1)[0]} thinking={reply.thinking} display={reply.display} typing={reply.typing} busy={busy} />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* error + actions + input */}
            <div style={{ padding: "12px 18px 16px", borderTop: "1px solid var(--border)" }}>
              {error && <div className="banner banner-error" style={{ marginBottom: 10 }}>{error}</div>}
              <div className="row gap-2" style={{ marginBottom: 10, flexWrap: "wrap" }}>
                <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => send("Give me a daily briefing: what needs my attention and the 2–3 most important next steps.")}>Daily briefing</button>
              </div>
              <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="row gap-2">
                <input className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder={`Ask ${exec.short}…`} disabled={busy} style={{ flex: 1 }} />
                <button className="btn btn-sm" type="submit" disabled={busy || !input.trim()}>Send</button>
              </form>
            </div>
          </>
        ) : (
          /* workflows — launch a saved agentic task; it runs in a side panel */
          <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
            <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
              Launch an agentic workflow — a multi-step task that runs its officers in order. Author them in <a href="/agents?tab=workflows" style={{ color: "var(--ac-text)", fontWeight: 600 }}>Agents → Workflows</a>.
            </div>
            {workflows.length === 0 ? (
              <div className="t-sub t-muted" style={{ fontSize: 13 }}>No workflows yet.</div>
            ) : (
              <div className="stack-3">
                {workflows.map((w) => {
                  const n = w.steps?.length ?? 0;
                  return (
                    <div key={w.id} className="card card-pad row-between" style={{ gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="row gap-2" style={{ alignItems: "center" }}><span style={{ fontSize: 14, fontWeight: 620 }}>{w.name}</span><Chip tone="violet">{n} step{n === 1 ? "" : "s"}</Chip></div>
                        {w.description && <div className="t-sub t-muted" style={{ fontSize: 12.5, marginTop: 2 }}>{w.description}</div>}
                      </div>
                      <button className="btn btn-sm" disabled={n === 0} onClick={() => setRunWf({ id: w.id, name: w.name })} style={{ background: "var(--ac)", color: "#fff", flexShrink: 0 }}>▸ Run</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </aside>

      <WorkflowRunDrawer open={!!runWf} onClose={() => setRunWf(null)} workflow={runWf} />
    </>
  );
}
