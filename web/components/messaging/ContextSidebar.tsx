"use client";

// Right context sidebar (~360px) — pre-loaded with page context (element label,
// theme/release brief, and the highlighted selection). Runs the chosen agent
// (context-aware, streamAgentChat) to propose a rewrite of JUST the selected text.
// Shows the streamed reasoning (collapsible) + the proposed rewrite with a diff
// feel (old selection vs proposed), an "Apply to selection" button (the parent
// replaces the stored selection range), and Dismiss. Works without a selection
// too: general "help with this element" using the full element as context.
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Markdown } from "@/components/Markdown";
import { PulseDots, streamAgentChat } from "@/components/alive";
import { EXEC_BY_KEY } from "@/lib/team";
import type { RosterAgent } from "./AgentPickerModal";
import AgentActivity from "@/components/AgentActivity";
import { emptyActivity, type Activity } from "@/lib/agentStream";

export default function ContextSidebar({
  agent,
  elementLabel,
  elementValue,
  brief,
  selection,            // selected text (null → whole-element help)
  onApply,             // (rewrite) → parent inserts over the stored range
  onClose,
}: {
  agent: RosterAgent;
  elementLabel: string;
  elementValue: string;
  brief: string;
  selection: string | null;
  onApply: (rewrite: string) => void;
  onClose: () => void;
}) {
  const supabase = createClient();
  const ex = agent.key ? EXEC_BY_KEY[agent.key] : undefined;
  const name = ex?.name ?? agent.name ?? agent.role ?? "Agent";
  const accent = ex?.accent ?? "var(--ac)";
  const short = ex?.short ?? name.slice(0, 2).toUpperCase();

  const [thinking, setThinking] = useState("");
  const [activity, setActivity] = useState<Activity>(emptyActivity());
  const [rewrite, setRewrite] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showReason, setShowReason] = useState(false);
  const [extra, setExtra] = useState("");

  async function run(instruction?: string) {
    if (!agent.key) { setError("This agent has no key."); setBusy(false); return; }
    setBusy(true); setError(null); setThinking(""); setRewrite("");
    const ask = selection
      ? `Rewrite ONLY the selected passage of the "${elementLabel}" messaging element. Reply with the rewritten passage as plain text — no preamble, no quotes.${instruction ? `\n\nGuidance: ${instruction}` : ""}`
      : `Help improve the "${elementLabel}" messaging element. ${instruction || "Propose a sharper version of the element."} Reply with the proposed text only.`;
    const context = {
      page: "messaging",
      label: `Messaging element: ${elementLabel}`,
      element_label: elementLabel,
      element_value: elementValue,
      brief,
      selection: selection ?? null,
      task: selection
        ? "Propose a tightened rewrite of just the selected passage; preserve voice and surrounding context."
        : "Propose an improvement to this messaging element.",
    };
    try {
      const { data: s } = await supabase.auth.getSession();
      await streamAgentChat({
        agentKey: agent.key,
        messages: [{ role: "user", content: ask }],
        context, token: s.session?.access_token,
        onChunk: (c) => setRewrite((p) => p + c),
        onThinking: (t) => setThinking((p) => p + t),
        onActivity: setActivity,
        fnName: "agent-chat",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "The agent stalled.");
    } finally { setBusy(false); }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void run(); }, [agent.id, selection]);

  return (
    <aside style={{ position: "sticky", top: 12, alignSelf: "start", borderLeft: `2px solid ${accent}` }}>
      <div className="card" style={{ overflow: "hidden" }}>
        {/* header */}
        <div className="row-between" style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", alignItems: "center", gap: 8 }}>
          <div className="row gap-2" style={{ alignItems: "center", minWidth: 0 }}>
            <span style={{ width: 28, height: 28, borderRadius: 7, background: accent, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 11, flexShrink: 0 }}>{short}</span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 13, fontWeight: 640 }}>{name}</span>
              <span className="t-mono-xs t-muted">{selection ? "Rewrite selection" : "Help with element"}</span>
            </span>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Dismiss</button>
        </div>

        <div style={{ padding: 14 }}>
          {error && <div className="banner banner-error" style={{ marginBottom: 10 }}>{error}</div>}

          {/* selection context (diff feel: the OLD passage) */}
          {selection && (
            <div style={{ marginBottom: 12 }}>
              <div className="t-label" style={{ color: "var(--tm)", marginBottom: 4 }}>Selected</div>
              <div className="t-sub" style={{ fontSize: 12, lineHeight: 1.5, padding: "7px 9px", borderRadius: 6, background: "var(--fill)", borderLeft: "2px solid var(--rd-text, var(--am))", whiteSpace: "pre-wrap" }}>{selection}</div>
            </div>
          )}

          {/* live reasoning while working */}
          {busy && (
            <div style={{ marginBottom: 12 }}>
              <div className="t-label" style={{ color: "var(--ac)", marginBottom: 6 }}>{name.split(" ").slice(-1)[0]} is working<PulseDots /></div>
              <AgentActivity activity={activity} busy={busy} who={name.split(" ").slice(-1)[0]} />
            </div>
          )}

          {/* collapsible reasoning once done */}
          {!busy && thinking && (
            <div style={{ marginBottom: 10 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowReason((v) => !v)}>{showReason ? "Hide reasoning" : "Show reasoning"}</button>
              {showReason && <div style={{ fontSize: 11.5, lineHeight: 1.5, fontStyle: "italic", whiteSpace: "pre-wrap", color: "var(--tm)", borderLeft: "2px solid var(--border)", paddingLeft: 10, marginTop: 7 }}>{thinking}</div>}
            </div>
          )}

          {/* the proposed rewrite (diff feel: the NEW passage) */}
          {rewrite && (
            <div style={{ marginBottom: 12 }}>
              <div className="t-label" style={{ color: "var(--vl-text, var(--vl))", marginBottom: 4 }}>Proposed</div>
              <div className="card card-pad" style={{ borderLeft: "2px solid var(--gn)", background: "var(--fill)" }}>
                <Markdown text={rewrite} style={{ fontSize: 12.5, lineHeight: 1.55 }} />
              </div>
            </div>
          )}

          {/* actions */}
          {!busy && (
            <div className="stack-2">
              {rewrite && (
                <div className="row gap-2">
                  <button className="btn btn-accent btn-sm" onClick={() => onApply(rewrite.trim())}>
                    {selection ? "Apply to selection" : "Apply to element"}
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => run()}>Regenerate</button>
                </div>
              )}
              {/* steer the rewrite */}
              <form onSubmit={(e) => { e.preventDefault(); if (extra.trim()) { const v = extra.trim(); setExtra(""); void run(v); } }} className="row gap-2" style={{ marginTop: 2 }}>
                <input className="input" style={{ flex: 1, fontSize: 12.5 }} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Steer the rewrite…" />
                <button className="btn btn-sm" type="submit" disabled={!extra.trim()}>Go</button>
              </form>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
