"use client";

// Slide-out drawer for an executive agent: a live status panel (tiles) + a real
// chat that talks to the agent-chat Edge Function (grounded in the org's data),
// with a one-click "Daily briefing" action.
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Exec } from "@/lib/team";

type Msg = { role: "user" | "assistant"; content: string };

export default function AgentDrawer({
  exec,
  open,
  onClose,
}: {
  exec: Exec | null;
  open: boolean;
  onClose: () => void;
}) {
  const supabase = createClient();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState(0);
  const [pending, setPending] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // reset + load light status whenever a different agent opens
  useEffect(() => {
    if (!open || !exec) return;
    setMessages([]); setInput(""); setError(null);
    (async () => {
      const [{ data: ag }] = await Promise.all([
        supabase.from("agents").select("id").eq("key", exec.key).maybeSingle(),
      ]);
      if (ag) {
        const { count: rc } = await supabase.from("agent_runs").select("id", { count: "exact", head: true }).eq("agent_id", ag.id);
        setRuns(rc ?? 0);
      } else setRuns(0);
      const { count: pc } = await supabase.from("proposals").select("id", { count: "exact", head: true }).eq("status", "pending");
      setPending(pc ?? 0);
    })();
  }, [open, exec, supabase]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages, busy]);

  async function send(text: string) {
    if (!exec || !text.trim()) return;
    const next = [...messages, { role: "user" as const, content: text.trim() }];
    setMessages(next); setInput(""); setBusy(true); setError(null);
    try {
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      const { data, error } = await supabase.functions.invoke("agent-chat", {
        body: { agent_key: exec.key, messages: next },
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setMessages([...next, { role: "assistant", content: data.reply }]);
    } catch (e) {
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

        {/* status tiles */}
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div className="card card-pad" style={{ padding: 12 }}><div className="stat"><span className="stat-num" style={{ fontSize: 18 }}>{runs}</span><span className="stat-label">Runs</span></div></div>
          <div className="card card-pad" style={{ padding: 12 }}><div className="stat"><span className="stat-num" style={{ fontSize: 18, color: pending > 0 ? "var(--vl-text)" : undefined }}>{pending}</span><span className="stat-label">Pending</span></div></div>
        </div>

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
            {busy && <div className="t-sub t-muted" style={{ fontSize: 13 }}>{exec.short} is thinking…</div>}
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
      </aside>
    </>
  );
}
