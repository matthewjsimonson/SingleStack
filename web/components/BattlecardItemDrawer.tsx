"use client";

// Side panel for ONE battlecard card — each card covers one aspect of the
// landscape vs a vendor. Shows the full detail + the evidence under it, lets
// you edit by hand, ask the analyst to re-examine it against fresh evidence
// (workflow step 1, through the same review gate), or chat with any of your
// agents WITH THE CARD AS CONTEXT (agent-chat, like ThemeDrawer).
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Chip, Banner, Confidence } from "@/components/ui";

export type CardItem = { id: string; competitor_id: string | null; kind: string; title: string; detail: string | null; proposed_by: string | null; signal_ids?: string[] | null; updated_at?: string | null; audience?: string | null };
type Sig = { id: string; title: string; why: string | null; conf_label: string | null; conf_level: number | null };
type Agent = { id: string; key: string; name: string };
type Msg = { role: "user" | "assistant"; content: string };

export default function BattlecardItemDrawer({ item, competitorName, workflowId, onClose, onChanged }: {
  item: CardItem | null; competitorName: string; workflowId: string | null; onClose: () => void; onChanged: () => void;
}) {
  const supabase = createClient();
  const [evidence, setEvidence] = useState<Sig[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentKey, setAgentKey] = useState("");
  const [chat, setChat] = useState<Msg[]>([]);
  const [chatQ, setChatQ] = useState("");
  const [busy, setBusy] = useState<"chat" | "refresh" | "save" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: "", detail: "" });

  useEffect(() => {
    setChat([]); setNote(null); setError(null); setEditing(false);
    if (!item) return;
    (async () => {
      const ids = item.signal_ids ?? [];
      const [{ data: sigs }, { data: ags }] = await Promise.all([
        ids.length ? supabase.from("signals").select("id, title, why, conf_label, conf_level").in("id", ids) : Promise.resolve({ data: [] as Sig[] }),
        supabase.from("agents").select("id, key, name").eq("is_active", true).order("name"),
      ]);
      setEvidence(sigs ?? []); setAgents(ags ?? []);
      setAgentKey((cur) => cur || ags?.[0]?.key || "");
    })();
  }, [item, supabase]);

  if (!item) return null;

  async function saveEdit() {
    if (!item || !draft.title.trim()) return;
    setBusy("save"); setError(null);
    const { error } = await supabase.from("battlecard_items").update({
      title: draft.title.trim(), detail: draft.detail.trim() || null, updated_at: new Date().toISOString(),
    }).eq("id", item.id);
    setBusy(null);
    if (error) setError(error.message); else { setEditing(false); onChanged(); }
  }

  async function reexamine() {
    if (!item || !workflowId) return;
    setBusy("refresh"); setError(null); setNote(null);
    try {
      const { data, error } = await supabase.functions.invoke("battlecard-analyst", {
        body: { competitor_id: item.competitor_id, workflow_id: workflowId, item_ids: [item.id] },
      });
      if (error) throw error;
      setNote((data as { message?: string })?.message ?? "Done.");
      onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : "Re-examination failed."); }
    finally { setBusy(null); }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const q = chatQ.trim();
    if (!q || !item || !agentKey || busy) return;
    setBusy("chat"); setError(null); setChatQ("");
    const next: Msg[] = [...chat, { role: "user", content: q }];
    setChat(next);
    try {
      // The card IS the context: prefix it so the agent reasons about this card
      // specifically, while agent-chat's own grounding keeps the wider awareness.
      const cardCtx = `We are discussing one battlecard card vs ${competitorName}: [${item.kind}] "${item.title}"${item.detail ? ` — ${item.detail}` : ""}. Evidence: ${evidence.map((s) => s.title).join("; ") || "none cited"}.`;
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke("agent-chat", {
        body: { agent_key: agentKey, messages: [{ role: "user", content: `${cardCtx}\n\n${q}` }, ...next.slice(0, -1)].slice(-8), context: { area: "competitive" } },
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined,
      });
      if (error) throw error;
      const reply = (data as { reply?: string; content?: string })?.reply ?? (data as { content?: string })?.content ?? "(no reply)";
      setChat([...next, { role: "assistant", content: reply }]);
    } catch (e) { setError(e instanceof Error ? e.message : "Chat failed."); }
    finally { setBusy(null); }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(11,12,14,0.32)", zIndex: 40 }} />
      <aside style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: 480, maxWidth: "94vw", background: "var(--panel)", borderLeft: "1px solid var(--border)", boxShadow: "var(--shadow-md)", zIndex: 41, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }} className="row-between">
          <span className="row gap-2" style={{ alignItems: "center", minWidth: 0 }}>
            <Chip tone="accent">{item.kind}</Chip>
            <span className="t-h2" style={{ fontSize: 14.5 }}>{competitorName}</span>
          </span>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }} className="stack-3">
          <Banner>{error}</Banner>
          {note && <div className="card card-pad" style={{ background: "var(--panel-2)", fontSize: 12.5 }}>{note}</div>}

          {/* the card */}
          <div className="card card-pad">
            {editing ? (
              <>
                <input className="input" autoFocus value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} style={{ marginBottom: 8 }} />
                <textarea className="textarea" rows={4} value={draft.detail} onChange={(e) => setDraft({ ...draft, detail: e.target.value })} style={{ marginBottom: 8 }} />
                <div className="row gap-2">
                  <button className="btn btn-sm" disabled={busy === "save"} onClick={saveEdit}>{busy === "save" ? "Saving…" : "Save"}</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}>Cancel</button>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 15, fontWeight: 640, marginBottom: 4 }}>{item.title}</div>
                {item.detail && <div className="t-sub" style={{ fontSize: 13, lineHeight: 1.55 }}>{item.detail}</div>}
                <div className="row gap-2" style={{ marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
                  {item.proposed_by && <Chip tone="violet">✦ {item.proposed_by}</Chip>}
                  {item.updated_at && <span className="t-mono-xs t-muted">updated {new Date(item.updated_at).toLocaleDateString()}</span>}
                </div>
                <div className="row gap-2" style={{ marginTop: 10, flexWrap: "wrap" }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => { setDraft({ title: item.title, detail: item.detail ?? "" }); setEditing(true); }}>Edit by hand</button>
                  <button className="btn btn-secondary btn-sm" disabled={busy === "save"} onClick={async () => {
                    const to = item.audience === "field" ? "internal" : "field";
                    const { error } = await supabase.from("battlecard_items").update({ audience: to }).eq("id", item.id);
                    if (error) setError(error.message); else { setNote(to === "field" ? "Published — sellers now see this card in the Sell desk." : "Made internal — raw truth only (GTM/product)."); onChanged(); }
                  }} title="internal = raw truth for GTM/product; field = the massaged version sellers see">
                    {item.audience === "field" ? "Make internal" : "Publish to field"}
                  </button>
                  <button className="btn btn-secondary btn-sm" disabled={!workflowId || busy === "refresh"} onClick={reexamine}
                    title={workflowId ? "Step 1 of your workflow re-examines this card against fresh evidence — changes go through review" : "Attach a workflow (agent × analyst skill) first"}>
                    {busy === "refresh" ? "Re-examining…" : "✦ Re-examine with analyst"}
                  </button>
                </div>
              </>
            )}
          </div>

          {/* the evidence under it */}
          <div>
            <div className="t-label" style={{ marginBottom: 6 }}>Evidence · {evidence.length}</div>
            {evidence.length === 0 ? <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No signals cited — human-entered or pre-provenance.</div> : (
              <div className="stack-2">
                {evidence.map((s) => (
                  <div key={s.id} className="card card-pad" style={{ borderLeft: "3px solid var(--vl)" }}>
                    <div className="row-between" style={{ gap: 10, alignItems: "flex-start" }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600 }}>{s.title}</span>
                      <Confidence label={s.conf_label} level={s.conf_level} />
                    </div>
                    {s.why && <div className="t-sub t-muted" style={{ fontSize: 12, marginTop: 2 }}>{s.why}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* chat with your agents, card as context */}
          <div>
            <div className="row-between" style={{ marginBottom: 6 }}>
              <span className="t-label">Chat about this card</span>
              <select className="select" value={agentKey} onChange={(e) => setAgentKey(e.target.value)} style={{ maxWidth: 180 }}>
                {agents.map((a) => <option key={a.id} value={a.key}>{a.name}</option>)}
              </select>
            </div>
            <div className="stack-2" style={{ marginBottom: 8 }}>
              {chat.map((m, i) => (
                <div key={i} className="card card-pad" style={{ background: m.role === "user" ? "var(--panel-2)" : "var(--panel)", fontSize: 12.5, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                  <span className="t-mono-xs t-muted" style={{ display: "block", marginBottom: 2 }}>{m.role === "user" ? "You" : agents.find((a) => a.key === agentKey)?.name ?? "Agent"}</span>
                  {m.content}
                </div>
              ))}
              {busy === "chat" && <div className="t-sub t-muted" style={{ fontSize: 12 }}>Thinking…</div>}
            </div>
            <form onSubmit={send} className="row gap-2">
              <input className="input" value={chatQ} onChange={(e) => setChatQ(e.target.value)} placeholder={`Ask about this ${item.kind} card…`} style={{ flex: 1 }} />
              <button className="btn btn-sm" type="submit" disabled={!agentKey || busy === "chat"}>Send</button>
            </form>
          </div>
        </div>
      </aside>
    </>
  );
}
