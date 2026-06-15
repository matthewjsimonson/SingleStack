"use client";

// Create a WORKFLOW with AI — the HITL chat that authors an ordered, area-aligned
// step-chain. Backed by the draft-workflow edge fn: grounded in the area's tasks +
// the org's real agents and their child skills, it proposes steps (one agent applying
// one child skill per task), preferring agents CONNECTED to the area so the workflow
// actually counts toward coverage. The draft is reviewable; Create inserts the
// workflow (target_type = the area's circle). Clones SkillCreateChat.
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Markdown } from "@/components/Markdown";
import type { Area } from "@/lib/ecosystem";

type Rec = { source: "task" | "agent" | "skill" | "record" | "best_practice"; point: string; evidence: string };
type Step = { agent_id: string; skill_id: string | null; signals: "none" | "internal" | "external" | "both"; instruction: string };
type Draft = { name: string; description: string; target_type: string; steps: Step[]; summary: string } | null;
type Turn = { role: "q" | "a"; text: string; recommendations?: Rec[]; draft?: Draft };

const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `s_${Date.now()}_${Math.random().toString(36).slice(2)}`);

export default function WorkflowCreateChat({ area, onCreated, onClose }: { area: Area; onCreated?: () => void; onClose: () => void }) {
  const supabase = createClient();
  const [chat, setChat] = useState<Turn[]>([]);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [edit, setEdit] = useState({ name: "", description: "" });
  const [names, setNames] = useState<{ agents: Map<string, string>; skills: Map<string, string> }>({ agents: new Map(), skills: new Map() });

  useEffect(() => {
    (async () => {
      const [{ data: ag }, { data: sk }] = await Promise.all([
        supabase.from("agents").select("id, name"),
        supabase.from("skills").select("id, name"),
      ]);
      setNames({ agents: new Map((ag ?? []).map((a) => [a.id, a.name])), skills: new Map((sk ?? []).map((s) => [s.id, s.name ?? "skill"])) });
    })();
  }, [supabase]);

  const invoke = async (transcript: { role: string; text: string }[]) => {
    const { data: s } = await supabase.auth.getSession();
    const token = s.session?.access_token;
    const { data, error } = await supabase.functions.invoke("draft-workflow", {
      body: { transcript, area: { key: area.key, label: area.label, circle: area.circle, connAreas: area.connAreas, tasks: area.tasks, blurb: area.blurb } },
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
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
      if (d.draft) setEdit({ name: d.draft.name, description: d.draft.description });
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
    if (!edit.name.trim() || !lastDraft || lastDraft.steps.length === 0) return;
    setCreating(true); setError(null); setNotice(null);
    try {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization.");
      const steps = lastDraft.steps.map((s) => ({ id: uid(), agent_id: s.agent_id, skill_id: s.skill_id ?? null, signals: s.signals, instruction: s.instruction }));
      const { error } = await supabase.from("workflows").insert({
        org_id: orgId, name: edit.name.trim(), description: edit.description.trim() || null,
        agent_id: steps[0]?.agent_id ?? null, trigger: "manual", target_type: area.circle, steps, is_active: true,
      });
      if (error) throw error;
      setNotice(`Created "${edit.name.trim()}" — aligned to ${area.label}.`);
      onCreated?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create the workflow."); }
    finally { setCreating(false); }
  }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(11,12,14,0.32)", zIndex: 70 }} />
      <aside style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: 640, maxWidth: "96vw", background: "var(--panel)", borderLeft: "1px solid var(--border)", boxShadow: "var(--shadow-md)", zIndex: 71, display: "flex", flexDirection: "column" }}>
        <div className="row-between" style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", alignItems: "center", gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 660 }}>✦ Create a workflow with AI</div>
            <div className="t-sub t-muted" style={{ fontSize: 12 }}>Aligned to <b>{area.label}</b> — drafted from the area&apos;s tasks and your real agents &amp; skills</div>
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
                    <div key={ri} className="card card-pad" style={{ borderLeft: "3px solid var(--ac-text)" }}>
                      <div className="row gap-2" style={{ alignItems: "baseline", flexWrap: "wrap" }}>
                        <span className="t-mono-xs" style={{ fontWeight: 700, textTransform: "uppercase", color: "var(--tm)" }}>{r.source}</span>
                        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{r.point}</span>
                      </div>
                      <div className="t-mono-xs t-muted" style={{ marginTop: 2 }}>{r.evidence}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {busy && <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>{chat.length === 0 ? "Reading the area's tasks and your roster…" : "Thinking…"}</div>}

          {lastDraft && lastDraft.steps.length > 0 && (
            <div className="card card-pad" style={{ border: "1px solid var(--ac)", marginTop: 4 }}>
              <div className="row gap-2" style={{ marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span className="t-label">Proposed workflow</span>
                <span className="t-mono-xs t-muted">{lastDraft.steps.length} step{lastDraft.steps.length === 1 ? "" : "s"} · {area.circle}</span>
              </div>
              <label className="field"><span className="t-label">Name</span><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
              <label className="field"><span className="t-label">Description</span><input className="input" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></label>
              <div className="field">
                <span className="t-label">Steps (ordered)</span>
                <div className="stack-2" style={{ marginTop: 4 }}>
                  {lastDraft.steps.map((s, si) => (
                    <div key={si} className="card card-pad" style={{ background: "var(--panel-2)" }}>
                      <div className="row gap-2" style={{ alignItems: "center", flexWrap: "wrap", marginBottom: 2 }}>
                        <span style={{ width: 18, height: 18, borderRadius: 999, display: "grid", placeItems: "center", fontSize: 10, fontWeight: 700, background: "var(--ac-fill)", color: "var(--ac-text)", flexShrink: 0 }}>{si + 1}</span>
                        <span style={{ fontSize: 12.5, fontWeight: 640 }}>{names.agents.get(s.agent_id) ?? "Unknown agent"}</span>
                        <span className="t-mono-xs t-muted">· {s.skill_id ? (names.skills.get(s.skill_id) ?? "skill") : "no skill"}</span>
                        {s.signals !== "none" && <span className="chip" style={{ fontSize: 9, background: "var(--fill-2)" }}>{s.signals} signals</span>}
                      </div>
                      <div className="t-sub t-muted" style={{ fontSize: 12, lineHeight: 1.4, paddingLeft: 26 }}>{s.instruction}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="row gap-2" style={{ marginTop: 4 }}>
                <button className="btn" onClick={create} disabled={creating || !edit.name.trim()}>{creating ? "Creating…" : "Create workflow"}</button>
                <span className="t-sub t-muted" style={{ fontSize: 11.5 }}>Refine steps later in Workflows.</span>
              </div>
            </div>
          )}
        </div>

        <form onSubmit={send} style={{ padding: "12px 20px", borderTop: "1px solid var(--border)" }} className="row gap-2">
          <input className="input" style={{ flex: 1 }} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder={`What outcome should this workflow drive for ${area.label}?`} disabled={busy} />
          <button className="btn" type="submit" disabled={busy || !answer.trim()}>Send</button>
        </form>
      </aside>
    </>
  );
}
