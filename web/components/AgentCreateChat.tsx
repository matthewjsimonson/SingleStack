"use client";

// Create agent with AI — the HITL chat that stands up a new executive agent. An
// agent IS its cornerstone (identity), so this proposes the agent + its cornerstone
// body, grounded in the company's product/GTM + the existing roster (clean handoffs),
// held to the quality bar (anchored on the cornerstone exemplar), with controlled
// cited recommendations. On Create it inserts the agent (NO system_prompt — identity
// is the cornerstone) + a cornerstone skill instance + the attachment. Mirrors
// SkillCreateChat. Backed by the draft-agent edge fn.
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Markdown } from "@/components/Markdown";

type Rec = { source: "signal" | "theme" | "record" | "capability" | "best_practice"; point: string; evidence: string };
type Draft = { name: string; role: string; category: string; description: string; instructions: string; summary: string } | null;
type Turn = { role: "q" | "a"; text: string; recommendations?: Rec[]; draft?: Draft };

const recColor = (s: Rec["source"]) => (s === "best_practice" ? "var(--vl-text)" : s === "capability" ? "var(--am-text)" : s === "record" ? "var(--ac-text)" : "var(--gn-text, var(--gn-text))");
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

export default function AgentCreateChat({ onCreated, onClose }: { onCreated?: () => void; onClose: () => void }) {
  const supabase = createClient();
  const [chat, setChat] = useState<Turn[]>([]);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [edit, setEdit] = useState({ name: "", role: "", instructions: "" });
  const [preview, setPreview] = useState(false);

  const invoke = async (transcript: { role: string; text: string }[]) => {
    const { data: s } = await supabase.auth.getSession();
    const token = s.session?.access_token;
    const { data, error } = await supabase.functions.invoke("draft-agent", {
      body: { transcript }, headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (error) {
      const resp = (error as { context?: Response }).context;
      if (resp && typeof resp.json === "function") { const b = await resp.clone().json().catch(() => null) as { error?: string } | null; if (b?.error) throw new Error(b.error); }
      throw error;
    }
    if (data?.error) throw new Error(data.error);
    return data as { reply: string; recommendations: Rec[]; draft: Draft };
  };

  async function turn(history: Turn[]) {
    setBusy(true); setError(null);
    try {
      const d = await invoke(history.map((t) => ({ role: t.role, text: t.text })));
      setChat([...history, { role: "q", text: d.reply, recommendations: d.recommendations ?? [], draft: d.draft ?? null }]);
      if (d.draft) setEdit({ name: d.draft.name, role: d.draft.role, instructions: d.draft.instructions });
    } catch (e) { setError(e instanceof Error ? e.message : "The builder stalled."); }
    finally { setBusy(false); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (chat.length === 0) void turn([]); }, []);

  async function send(e: React.FormEvent) {
    e.preventDefault(); if (!answer.trim() || busy) return;
    const history = [...chat, { role: "a" as const, text: answer.trim() }];
    setChat(history); setAnswer("");
    await turn(history);
  }

  const lastDraft = [...chat].reverse().find((t) => t.draft)?.draft ?? null;
  async function create() {
    if (!edit.name.trim() || !lastDraft) return;
    setCreating(true); setError(null); setNotice(null);
    try {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization.");
      const baseKey = slug(edit.name.trim()) || `agent_${Date.now().toString(36)}`;
      // The agent carries NO system_prompt — its identity is the cornerstone below.
      let agentId: string | null = null;
      for (const k of [baseKey, `${baseKey}_${Date.now().toString(36)}`]) {
        const { data, error } = await supabase.from("agents").insert({ org_id: orgId, key: k, name: edit.name.trim(), role: edit.role.trim() || null, model: "claude-opus-4-8", is_active: true }).select("id").single();
        if (!error && data) { agentId = data.id; break; }
        if (error && (error as { code?: string }).code !== "23505") throw error; // not a key collision → real error
      }
      if (!agentId) throw new Error("Could not create the agent (key collision).");
      // The cornerstone instance = the agent's identity.
      const { data: sk, error: skErr } = await supabase.from("skills").insert({
        org_id: orgId, key: `${baseKey}_identity_${Date.now().toString(36)}`, name: edit.name.trim(),
        description: lastDraft.description || null, instructions: edit.instructions, category: lastDraft.category,
        kind: "cornerstone", scope: "agent", agent_id: agentId, source: "tailored", areas: [],
      }).select("id").single();
      if (skErr || !sk) throw skErr ?? new Error("Could not create the cornerstone.");
      const { error: asErr } = await supabase.from("agent_skills").insert({ org_id: orgId, agent_id: agentId, skill_id: sk.id, is_cornerstone: true });
      if (asErr) throw asErr;
      setNotice(`Created ${edit.name.trim()} with its cornerstone identity.`);
      onCreated?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create the agent."); }
    finally { setCreating(false); }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(11,12,14,0.32)", zIndex: 50 }} />
      <aside style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: 640, maxWidth: "96vw", background: "var(--panel)", borderLeft: "1px solid var(--border)", boxShadow: "var(--shadow-md)", zIndex: 51, display: "flex", flexDirection: "column" }}>
        <div className="row-between" style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", alignItems: "center" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 660 }}>✦ Create an agent with AI</div>
            <div className="t-sub t-muted" style={{ fontSize: 12 }}>An agent is its cornerstone — grounded in your product/GTM and the roster, held to the quality bar</div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }} className="stack-3">
          {error && <div className="banner banner-error">{error}</div>}
          {notice && <div className="banner" style={{ background: "var(--am-fill)", color: "var(--am-text)" }}>{notice}</div>}
          {chat.map((t, ti) => (
            <div key={ti}>
              <div className="card card-pad" style={{ background: t.role === "q" ? "var(--panel-2)" : "var(--ac-fill, var(--fill))", marginLeft: t.role === "a" ? 32 : 0, marginRight: t.role === "q" ? 32 : 0 }}>
                <div className="t-mono-xs t-muted" style={{ marginBottom: 3 }}>{t.role === "q" ? "✦ Builder" : "You"}</div>
                {t.role === "q" ? <Markdown className="t-sub" style={{ fontSize: 13, lineHeight: 1.55 }} text={t.text} /> : <div style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{t.text}</div>}
              </div>
              {(t.recommendations?.length ?? 0) > 0 && (
                <div className="stack-2" style={{ marginTop: 6, marginRight: 32 }}>
                  {t.recommendations!.map((r, ri) => (
                    <div key={ri} className="card card-pad" style={{ borderLeft: `3px solid ${recColor(r.source)}` }}>
                      <div className="row gap-2" style={{ alignItems: "baseline", flexWrap: "wrap" }}>
                        <span className="t-mono-xs" style={{ fontWeight: 700, textTransform: "uppercase", color: "var(--tm)" }}>{r.source.replace("_", " ")}</span>
                        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{r.point}</span>
                      </div>
                      <div className="t-mono-xs t-muted" style={{ marginTop: 2 }}>{r.evidence}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {busy && <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>{chat.length === 0 ? "Reading your product/GTM, signals, and roster…" : "Thinking…"}</div>}

          {lastDraft && (
            <div className="card card-pad" style={{ border: "1px solid var(--ac)", marginTop: 4 }}>
              <div className="t-label" style={{ marginBottom: 8 }}>Proposed agent {lastDraft.summary ? <span className="t-muted" style={{ fontWeight: 400 }}>— {lastDraft.summary}</span> : null}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "var(--sp-3)" }}>
                <label className="field"><span className="t-label">Name (role title)</span><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
                <label className="field"><span className="t-label">Role (one line)</span><input className="input" value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })} /></label>
              </div>
              <div className="field">
                <div className="row-between" style={{ alignItems: "center", marginBottom: 4 }}>
                  <span className="t-label">Cornerstone (identity)</span>
                  <div className="row gap-2">
                    <button type="button" className="btn btn-secondary btn-sm" style={!preview ? { background: "var(--fill-2)" } : undefined} onClick={() => setPreview(false)}>Edit</button>
                    <button type="button" className="btn btn-secondary btn-sm" style={preview ? { background: "var(--fill-2)" } : undefined} onClick={() => setPreview(true)}>Preview</button>
                  </div>
                </div>
                {preview
                  ? <div className="card card-pad" style={{ background: "var(--panel-2)", maxHeight: 320, overflowY: "auto" }}><Markdown text={edit.instructions} /></div>
                  : <textarea className="textarea" rows={14} value={edit.instructions} onChange={(e) => setEdit({ ...edit, instructions: e.target.value })} />}
              </div>
              <div className="row gap-2" style={{ marginTop: 4 }}>
                <button className="btn" onClick={create} disabled={creating || !edit.name.trim()}>{creating ? "Creating…" : "Create agent"}</button>
                <span className="t-sub t-muted" style={{ fontSize: 11.5 }}>Creates the agent + its cornerstone. Edit freely first.</span>
              </div>
            </div>
          )}
        </div>

        <form onSubmit={send} style={{ padding: "12px 20px", borderTop: "1px solid var(--border)" }} className="row gap-2">
          <input className="input" style={{ flex: 1 }} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Describe the agent you need — e.g. 'an officer who owns partnerships & ecosystem'…" disabled={busy} />
          <button className="btn" type="submit" disabled={busy || !answer.trim()}>Send</button>
        </form>
      </aside>
    </>
  );
}
