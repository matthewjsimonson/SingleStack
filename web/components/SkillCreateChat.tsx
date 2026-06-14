"use client";

// Create skill with AI — the HITL chat that authors a new LIBRARY template
// (generic, reusable; tailored per agent later). Backed by the draft-skill edge
// fn: grounded in the company's product/GTM truth + signals + capabilities, held
// to the skill quality bar (anchored on a gold-standard exemplar), with controlled
// cited recommendations. The draft is editable; Create inserts the template
// (scope='library'). Mirrors SkillTailorChat.
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Markdown } from "@/components/Markdown";

type Rec = { source: "signal" | "theme" | "record" | "capability" | "best_practice"; point: string; evidence: string };
type Draft = { name: string; description: string; category: string; kind: string; areas: string[]; connectors: string[]; instructions: string; summary: string } | null;
type Turn = { role: "q" | "a"; text: string; recommendations?: Rec[]; draft?: Draft };

const recColor = (s: Rec["source"]) => (s === "best_practice" ? "var(--vl-text)" : s === "capability" ? "var(--am-text)" : s === "record" ? "var(--ac-text)" : "var(--gn-text, #15803d)");

export default function SkillCreateChat({ onCreated, onClose }: { onCreated?: () => void; onClose: () => void }) {
  const supabase = createClient();
  const [kind, setKind] = useState<"cornerstone" | "child">("child");
  const [chat, setChat] = useState<Turn[]>([]);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Editable overrides for the latest draft (name/description/instructions).
  const [edit, setEdit] = useState({ name: "", description: "", instructions: "" });
  const [preview, setPreview] = useState(false);

  const invoke = async (transcript: { role: string; text: string }[]) => {
    const { data: s } = await supabase.auth.getSession();
    const token = s.session?.access_token;
    const { data, error } = await supabase.functions.invoke("draft-skill", {
      body: { kind, transcript }, headers: token ? { Authorization: `Bearer ${token}` } : undefined,
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
      if (d.draft) setEdit({ name: d.draft.name, description: d.draft.description, instructions: d.draft.instructions });
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
      const skillKey = edit.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `skill_${Date.now()}`;
      const { error } = await supabase.from("skills").insert({
        org_id: orgId, key: skillKey, name: edit.name.trim(), description: edit.description.trim() || null,
        instructions: edit.instructions, category: lastDraft.category, kind, scope: "library", source: "custom",
        areas: kind === "cornerstone" ? [] : (lastDraft.areas ?? []), connectors: lastDraft.connectors ?? [],
      });
      if (error) throw error;
      setNotice(`Created "${edit.name.trim()}" in your library.`);
      onCreated?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create the skill."); }
    finally { setCreating(false); }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(11,12,14,0.32)", zIndex: 50 }} />
      <aside style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: 640, maxWidth: "96vw", background: "var(--panel)", borderLeft: "1px solid var(--border)", boxShadow: "var(--shadow-md)", zIndex: 51, display: "flex", flexDirection: "column" }}>
        <div className="row-between" style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", alignItems: "center", gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 660 }}>✦ Create a skill with AI</div>
            <div className="t-sub t-muted" style={{ fontSize: 12 }}>A reusable library template, grounded in your product/GTM and held to the quality bar</div>
          </div>
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value as "cornerstone" | "child")} style={{ width: 150 }} title="Cornerstone = a role profile; Child = a task skill">
            <option value="child">Child (task)</option>
            <option value="cornerstone">Cornerstone (role)</option>
          </select>
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
          {busy && <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>{chat.length === 0 ? "Reading your product/GTM and signals…" : "Thinking…"}</div>}

          {lastDraft && (
            <div className="card card-pad" style={{ border: "1px solid var(--ac)", marginTop: 4 }}>
              <div className="row gap-2" style={{ marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span className="t-label">Proposed {kind} skill</span>
                <span className="t-mono-xs t-muted">{lastDraft.category}{lastDraft.areas?.length ? ` · ${lastDraft.areas.join(", ")}` : ""}</span>
              </div>
              <label className="field"><span className="t-label">Name</span><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
              <label className="field"><span className="t-label">Description</span><input className="input" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></label>
              <div className="field">
                <div className="row-between" style={{ alignItems: "center", marginBottom: 4 }}>
                  <span className="t-label">Instructions</span>
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
                <button className="btn" onClick={create} disabled={creating || !edit.name.trim()}>{creating ? "Creating…" : "Create in library"}</button>
                <span className="t-sub t-muted" style={{ fontSize: 11.5 }}>Edit freely before creating.</span>
              </div>
            </div>
          )}
        </div>

        <form onSubmit={send} style={{ padding: "12px 20px", borderTop: "1px solid var(--border)" }} className="row gap-2">
          <input className="input" style={{ flex: 1 }} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Describe the skill you want — e.g. 'a child skill for win/loss analysis from closed deals'…" disabled={busy} />
          <button className="btn" type="submit" disabled={busy || !answer.trim()}>Send</button>
        </form>
      </aside>
    </>
  );
}
