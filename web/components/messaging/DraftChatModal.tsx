"use client";

// Draft-with-AI for ONE messaging element — a popup chat (Modal, not a drawer).
// The chosen officer streams a synthesized update for THIS element, grounded in
// the element label + current value + its theme/release brief. The human can
// converse to refine; "Use this draft" loads the latest agent message into the
// TipTap editor for human review (it does NOT auto-save).
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui";
import { Markdown } from "@/components/Markdown";
import { LiveReply, useAliveReply, streamAgentChat, useRunAbort, isAbortError } from "@/components/alive";
import { EXEC_BY_KEY } from "@/lib/team";
import type { RosterAgent } from "./AgentPickerModal";

type Msg = { role: "user" | "assistant"; content: string };

export default function DraftChatModal({
  open,
  onClose,
  elementLabel,
  currentValue,
  brief,
  agentKey,
  roster,
  onAgentChange,
  onUseDraft,
  onBusyChange,
  seedMessage,
}: {
  open: boolean;
  onClose: () => void;
  elementLabel: string;
  currentValue: string;
  brief: string;                       // the themes/releases driving this element
  agentKey: string | null;
  roster: RosterAgent[];
  onAgentChange: (key: string) => void;
  onUseDraft: (markdown: string) => void;
  onBusyChange?: (busy: boolean) => void;
  // Optional first user turn to open the conversation with. When absent, falls
  // back to the generic "shape the messaging for X" opener (unchanged behavior).
  seedMessage?: string | null;
}) {
  const supabase = createClient();
  const beginRun = useRunAbort();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reply = useAliveReply();
  const liveRef = useRef<HTMLDivElement>(null);

  const agent = agentKey ? EXEC_BY_KEY[agentKey] : undefined;
  const agentName = agent?.name ?? roster.find((r) => r.key === agentKey)?.name ?? "Officer";

  // Reset the conversation each time the modal opens for a (possibly different) element.
  useEffect(() => { if (open) { setMessages([]); setInput(""); setError(null); reply.reset(); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open, elementLabel]);

  // Commit the typed-out reply as a message once it finishes.
  useEffect(() => {
    if (!busy && !reply.typing && reply.display) {
      setMessages((prev) => [...prev, { role: "assistant", content: reply.display }]);
      reply.reset();
    }
  }, [busy, reply.typing, reply.display, reply.reset]);

  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);

  const context = {
    page: "messaging",
    label: `Messaging element: ${elementLabel}`,
    element_label: elementLabel,
    current_value: currentValue,
    brief,
    task: "You are a senior messaging expert pairing with me on this. Respond in clean, natural prose. Do NOT use markdown tables, do NOT use decorative symbols (no asterisk-bullets dumps, no ✦/◆/▲), and do NOT invent jargon section headers. Give your take, then ask me one sharp question about where to push.",
  };

  async function send(text: string) {
    if (!agentKey || !text.trim() || busy) return;
    const next = [...messages, { role: "user" as const, content: text.trim() }];
    setMessages(next); setInput(""); setBusy(true); setError(null);
    reply.begin();
    requestAnimationFrame(() => liveRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
    try {
      const { data: s } = await supabase.auth.getSession();
      await streamAgentChat({ signal: beginRun(),
        agentKey, messages: next, context, token: s.session?.access_token,
        onChunk: reply.onChunk, onThinking: reply.onThinking, onActivity: reply.onActivity, fnName: "agent-chat",
      });
      reply.finish();
    } catch (e) { if (isAbortError(e)) return;
      reply.reset();
      setError(e instanceof Error ? e.message : "The officer stalled.");
    } finally { setBusy(false); }
  }

  // Kick off the first synthesis automatically when the modal opens.
  useEffect(() => {
    if (open && agentKey && messages.length === 0 && !busy && !reply.typing) {
      void send(seedMessage?.trim()
        || `Let's shape the messaging for "${elementLabel}". Give me your first take in a few tight sentences, then ask me where to push.`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, agentKey]);

  const lastDraft = [...messages].reverse().find((m) => m.role === "assistant")?.content ?? null;

  return (
    <Modal open={open} onClose={onClose} width={900} title={
      <div className="row gap-2" style={{ alignItems: "center", flexWrap: "wrap" }}>
        <span>Draft with AI</span>
        <span className="t-sub t-muted" style={{ fontSize: 12, fontWeight: 400 }}>· {elementLabel}</span>
        {/* agent switcher in the header */}
        <select className="select" value={agentKey ?? ""} onChange={(e) => onAgentChange(e.target.value)} style={{ marginLeft: 8, maxWidth: 220, fontSize: 12.5 }}>
          {roster.map((r) => {
            const ex = EXEC_BY_KEY[r.key ?? ""];
            return <option key={r.id} value={r.key ?? ""}>{ex?.name ?? r.name ?? r.role ?? "Agent"}</option>;
          })}
          {roster.length === 0 && agentKey && <option value={agentKey}>{agentName}</option>}
        </select>
      </div>
    }>
      {error && <div className="banner banner-error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="stack-3" style={{ maxHeight: "64vh", overflowY: "auto", marginBottom: 14 }}>
        {messages.map((m, i) => (
          <div key={i}>
            <div className="card card-pad" style={{ background: m.role === "assistant" ? "var(--panel-2)" : "var(--ac-fill, var(--fill))", marginLeft: m.role === "user" ? 32 : 0, marginRight: m.role === "assistant" ? 32 : 0 }}>
              <div className="t-mono-xs t-muted" style={{ marginBottom: 3 }}>{m.role === "assistant" ? agentName : "You"}</div>
              {m.role === "assistant"
                ? <Markdown className="t-sub" style={{ fontSize: 13, lineHeight: 1.55 }} text={m.content} />
                : <div style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{m.content}</div>}
            </div>
            {m.role === "assistant" && i === messages.length - 1 && !busy && !reply.typing && (
              <div className="row gap-2" style={{ marginTop: 6, marginRight: 32 }}>
                <button className="btn btn-accent btn-sm" onClick={() => onUseDraft(m.content)}>Use this draft</button>
                <span className="t-sub t-muted" style={{ fontSize: 11.5, alignSelf: "center" }}>Loads into the editor for review — you Save.</span>
              </div>
            )}
          </div>
        ))}
        {(busy || reply.typing) && (
          <div ref={liveRef} className="card card-pad" style={{ background: "var(--panel-2)", marginRight: 32 }}>
            <LiveReply officer={agentName.split(" ").slice(-1)[0]} thinking={reply.thinking} activity={reply.activity} display={reply.display} typing={reply.typing} busy={busy} />
          </div>
        )}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="row gap-2">
        <input className="input" style={{ flex: 1 }} value={input} onChange={(e) => setInput(e.target.value)} placeholder={`Refine the draft with ${agentName.split(" ").slice(-1)[0]}…`} disabled={busy || !agentKey} />
        <button className="btn btn-sm" type="submit" disabled={busy || !input.trim()}>Send</button>
      </form>
    </Modal>
  );
}
