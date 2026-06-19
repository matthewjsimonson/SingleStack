"use client";

// Tailor with AI — the HITL chat that specializes a skill INSTANCE for its agent.
// The tailor (tailor-skill edge fn) has read the agent's cornerstone, the product +
// GTM record (market & personas), recent signals/themes, and frontier capabilities,
// and holds the skill quality bar. Each turn it discusses, surfaces a CONTROLLED set
// of cited recommendations, and — when ready — proposes a full rewritten body. The
// draft is editable; Apply writes through apply_skill_evolution (your edit IS the
// ratification; a provenance-tagged revision is recorded). Mirrors RecordRefine.
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Markdown } from "@/components/Markdown";

type Rec = { source: "signal" | "theme" | "record" | "capability" | "best_practice"; point: string; evidence: string };
type Draft = { instructions: string; summary: string } | null;
type Turn = { role: "q" | "a"; text: string; recommendations?: Rec[]; draft?: Draft };

const recColor = (s: Rec["source"]) => (s === "best_practice" ? "var(--vl-text)" : s === "capability" ? "var(--am-text)" : s === "record" ? "var(--ac-text)" : "var(--gn-text, var(--gn-text))");

export default function SkillTailorChat({ skillId, skillName, onApplied, onClose }: { skillId: string; skillName: string; onApplied?: () => void; onClose: () => void }) {
  const supabase = createClient();
  const [chat, setChat] = useState<Turn[]>([]);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draftEdit, setDraftEdit] = useState<string>(""); // editable proposed body for the latest draft
  const [preview, setPreview] = useState(false);

  const invoke = async (transcript: { role: string; text: string }[]) => {
    const { data: s } = await supabase.auth.getSession();
    const token = s.session?.access_token;
    const { data, error } = await supabase.functions.invoke("tailor-skill", {
      body: { skill_id: skillId, transcript }, headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (error) {
      const resp = (error as { context?: Response }).context;
      if (resp && typeof resp.json === "function") {
        const b = await resp.clone().json().catch(() => null) as { error?: string } | null;
        if (b?.error) throw new Error(b.error);
      }
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
      if (d.draft?.instructions) setDraftEdit(d.draft.instructions);
    } catch (e) { setError(e instanceof Error ? e.message : "The tailor stalled."); }
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

  // The latest draft (if any) + the recommendations that motivated it → drivers.
  const lastDraftTurn = [...chat].reverse().find((t) => t.draft?.instructions);
  async function apply() {
    if (!draftEdit.trim()) return;
    setApplying(true); setError(null); setNotice(null);
    try {
      const recs = lastDraftTurn?.recommendations ?? [];
      const drivers = recs.map((r) => ({ kind: r.source, title: r.evidence }));
      const note = lastDraftTurn?.draft?.summary ?? "Tailored via chat";
      const { error } = await supabase.rpc("apply_skill_evolution", { p_skill: skillId, p_instructions: draftEdit, p_drivers: drivers, p_note: note });
      if (error) throw error;
      setNotice("Tailored and saved — a revision was recorded.");
      onApplied?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not apply."); }
    finally { setApplying(false); }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(11,12,14,0.32)", zIndex: 50 }} />
      <aside style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: 620, maxWidth: "96vw", background: "var(--panel)", borderLeft: "1px solid var(--border)", boxShadow: "var(--shadow-md)", zIndex: 51, display: "flex", flexDirection: "column" }}>
        <div className="row-between" style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", alignItems: "center" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 660 }}>✦ Tailor with AI</div>
            <div className="t-sub t-muted" style={{ fontSize: 12 }}>{skillName} — grounded in this agent&rsquo;s identity, your product/GTM, and live signals</div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }} className="stack-3">
          {error && <div className="banner banner-error">{error}</div>}
          {notice && <div className="banner" style={{ background: "var(--am-fill)", color: "var(--am-text)" }}>{notice}</div>}
          {chat.map((t, ti) => (
            <div key={ti}>
              <div className="card card-pad" style={{ background: t.role === "q" ? "var(--panel-2)" : "var(--ac-fill, var(--fill))", marginLeft: t.role === "a" ? 32 : 0, marginRight: t.role === "q" ? 32 : 0 }}>
                <div className="t-mono-xs t-muted" style={{ marginBottom: 3 }}>{t.role === "q" ? "✦ Tailor" : "You"}</div>
                {t.role === "q" ? <Markdown className="t-sub" style={{ fontSize: 13, lineHeight: 1.55 }} text={t.text} /> : <div style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{t.text}</div>}
              </div>
              {/* Cited, controlled recommendations */}
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
          {busy && <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>{chat.length === 0 ? "Reading the agent, your records, and signals…" : "Thinking…"}</div>}

          {/* The proposed body — editable; your edit is the ratification */}
          {lastDraftTurn?.draft?.instructions && (
            <div className="card card-pad" style={{ border: "1px solid var(--ac)", marginTop: 4 }}>
              <div className="row-between" style={{ alignItems: "center", marginBottom: 6 }}>
                <span className="t-label">Proposed tailored skill {lastDraftTurn.draft.summary ? <span className="t-muted" style={{ fontWeight: 400 }}>— {lastDraftTurn.draft.summary}</span> : null}</span>
                <div className="row gap-2">
                  <button type="button" className="btn btn-secondary btn-sm" style={!preview ? { background: "var(--fill-2)" } : undefined} onClick={() => setPreview(false)}>Edit</button>
                  <button type="button" className="btn btn-secondary btn-sm" style={preview ? { background: "var(--fill-2)" } : undefined} onClick={() => setPreview(true)}>Preview</button>
                </div>
              </div>
              {preview
                ? <div className="card card-pad" style={{ background: "var(--panel-2)", maxHeight: 320, overflowY: "auto" }}><Markdown text={draftEdit} /></div>
                : <textarea className="textarea" rows={14} value={draftEdit} onChange={(e) => setDraftEdit(e.target.value)} />}
              <div className="row gap-2" style={{ marginTop: 8 }}>
                <button className="btn" onClick={apply} disabled={applying || !draftEdit.trim()}>{applying ? "Applying…" : "Apply (records a revision)"}</button>
                <span className="t-sub t-muted" style={{ fontSize: 11.5 }}>Edit freely before applying — your edit is the ratification.</span>
              </div>
            </div>
          )}
        </div>

        <form onSubmit={send} style={{ padding: "12px 20px", borderTop: "1px solid var(--border)" }} className="row gap-2">
          <input className="input" style={{ flex: 1 }} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Steer the tailoring — e.g. 'lean into our PLG motion' or 'tighten the procedure'…" disabled={busy} />
          <button className="btn" type="submit" disabled={busy || !answer.trim()}>Send</button>
        </form>
      </aside>
    </>
  );
}
