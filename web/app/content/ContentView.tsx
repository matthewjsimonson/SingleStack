"use client";

// Content — a typed studio over CONTENT TASKS. Content production is real work,
// so a content piece IS a task (initiative_workstreams) with a content_type
// (social / video / blog / thought-leadership / case-study / white-paper /
// testimonial). It rolls up to its initiative like any task and can tie to a
// release and/or campaign. Video carries the Descript flow (hook → script →
// prompts → produce) in `details`. The board lives here; these same tasks also
// show in Enablement (they're GTM work) and advance their initiative when done.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Chip, Banner } from "@/components/ui";
import PageBar from "@/components/PageBar";

type CType = "social" | "video" | "blog" | "thought_leadership" | "case_study" | "white_paper" | "testimonial";
type VideoFlow = { hook?: string; script?: string; prompts?: string[]; descript_steps?: string[] };
type Task = { id: string; area: string; title: string; stage: string; content_type: string | null; body: string | null; details: VideoFlow | null; initiative_id: string | null; release_id: string | null; campaign_id: string | null; lifecycle_stage: string };
type Init = { id: string; title: string; lifecycle: string };
type Named = { id: string; name: string; version?: string | null };

const TYPES: { key: CType; label: string }[] = [
  { key: "blog", label: "Blog" }, { key: "social", label: "Social" }, { key: "video", label: "Video" },
  { key: "thought_leadership", label: "Thought leadership" }, { key: "case_study", label: "Case study" },
  { key: "white_paper", label: "White paper" }, { key: "testimonial", label: "Testimonial" },
];
const TYPE_LABEL: Record<string, string> = Object.fromEntries(TYPES.map((t) => [t.key, t.label]));
// Content uses the task stage, surfaced in content language.
const STAGE_LABEL: Record<string, { label: string; tone: "default" | "violet" | "green" }> = { backlog: { label: "Draft", tone: "default" }, active: { label: "In progress", tone: "violet" }, done: { label: "Published", tone: "green" } };
const STAGE_NEXT: Record<string, string> = { backlog: "active", active: "done" };

export default function ContentView() {
  const supabase = createClient();
  const [filter, setFilter] = useState<CType | "all">("all");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [inits, setInits] = useState<Init[]>([]);
  const [releases, setReleases] = useState<Named[]>([]);
  const [campaigns, setCampaigns] = useState<Named[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<{ title: string; content_type: CType; area: string; initiative_id: string; release_id: string; campaign_id: string }>({ title: "", content_type: "blog", area: "gtm", initiative_id: "", release_id: "", campaign_id: "" });
  const [busy, setBusy] = useState(false);
  const [openVideo, setOpenVideo] = useState<Task | null>(null);

  const load = useCallback(async () => {
    const [{ data: w }, { data: i }, { data: rel }, { data: camp }] = await Promise.all([
      supabase.from("initiative_workstreams").select("id, area, title, stage, content_type, body, details, initiative_id, release_id, campaign_id, lifecycle_stage").not("content_type", "is", null).order("created_at", { ascending: false }),
      supabase.from("initiatives").select("id, title, lifecycle").is("parent_id", null).order("created_at", { ascending: false }),
      supabase.from("releases").select("id, name, version").order("created_at"),
      supabase.from("campaigns").select("id, name").order("created_at"),
    ]);
    setTasks((w ?? []) as Task[]); setInits((i ?? []) as Init[]); setReleases((rel ?? []) as Named[]); setCampaigns((camp ?? []) as Named[]); setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault(); if (!form.title.trim()) return;
    setBusy(true); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      const ini = inits.find((x) => x.id === form.initiative_id);
      const details = form.content_type === "video" ? { hook: "", script: "", prompts: [], descript_steps: [] } : null;
      const { data, error } = await supabase.from("initiative_workstreams").insert({
        org_id: orgId, area: form.area, title: form.title.trim(), content_type: form.content_type,
        initiative_id: form.initiative_id || null, release_id: form.release_id || null, campaign_id: form.campaign_id || null,
        lifecycle_stage: ini?.lifecycle ?? "launch", details,
      }).select("id, area, title, stage, content_type, body, details, initiative_id, release_id, campaign_id, lifecycle_stage").single();
      if (error) throw error;
      setCreating(false); setForm({ ...form, title: "", initiative_id: "", release_id: "", campaign_id: "" }); await load();
      if (form.content_type === "video" && data) setOpenVideo(data as Task);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create."); }
    finally { setBusy(false); }
  }
  async function patch(id: string, fields: Record<string, unknown>) { setError(null); await supabase.from("initiative_workstreams").update(fields).eq("id", id); await load(); }
  async function remove(id: string) { setError(null); await supabase.from("initiative_workstreams").delete().eq("id", id); await load(); }

  const list = filter === "all" ? tasks : tasks.filter((t) => t.content_type === filter);
  const iniOf = (id: string | null) => inits.find((x) => x.id === id);
  const relOf = (id: string | null) => releases.find((x) => x.id === id);
  const campOf = (id: string | null) => campaigns.find((x) => x.id === id);

  return (
    <div>
      <PageBar actions={!creating ? <button className="btn btn-sm" onClick={() => setCreating(true)}>+ New content</button> : undefined} />
      <Banner>{error}</Banner>

      {/* type filter */}
      <div className="row gap-2" style={{ flexWrap: "wrap", marginBottom: "var(--sp-4)" }}>
        <button className={`chip-btn${filter === "all" ? " is-on" : ""}`} onClick={() => setFilter("all")} style={chipBtn(filter === "all")}>All · {tasks.length}</button>
        {TYPES.map((t) => { const n = tasks.filter((x) => x.content_type === t.key).length; return (
          <button key={t.key} className="chip-btn" onClick={() => setFilter(t.key)} style={chipBtn(filter === t.key)}>{t.label}{n ? ` · ${n}` : ""}</button>
        ); })}
      </div>

      {creating && (
        <form onSubmit={create} className="card card-pad" style={{ marginBottom: "var(--sp-5)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: "var(--sp-3)" }}>
            <label className="field"><span className="t-label">Title</span><input className="input" autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Launch blog — orchestration v1" /></label>
            <label className="field"><span className="t-label">Type</span><select className="select" value={form.content_type} onChange={(e) => setForm({ ...form, content_type: e.target.value as CType })}>{TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></label>
            <label className="field"><span className="t-label">Side</span><select className="select" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })}><option value="gtm">GTM</option><option value="build">Product</option></select></label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--sp-3)" }}>
            <label className="field"><span className="t-label">Initiative (optional)</span><select className="select" value={form.initiative_id} onChange={(e) => setForm({ ...form, initiative_id: e.target.value })}><option value="">— standalone —</option>{inits.map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}</select></label>
            <label className="field"><span className="t-label">Release (optional)</span><select className="select" value={form.release_id} onChange={(e) => setForm({ ...form, release_id: e.target.value })}><option value="">— none —</option>{releases.map((r) => <option key={r.id} value={r.id}>{r.version ? `${r.version} · ${r.name}` : r.name}</option>)}</select></label>
            <label className="field"><span className="t-label">Campaign (optional)</span><select className="select" value={form.campaign_id} onChange={(e) => setForm({ ...form, campaign_id: e.target.value })}><option value="">— none —</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          </div>
          <div className="row gap-2"><button className="btn" type="submit" disabled={busy}>{busy ? "Creating…" : "Create"}</button><button className="btn btn-secondary" type="button" onClick={() => setCreating(false)}>Cancel</button></div>
        </form>
      )}

      {loading ? <div className="t-sub t-muted">Loading…</div> : list.length === 0 && !creating ? (
        <div className="empty"><div className="t-body" style={{ fontWeight: 600, marginBottom: 6 }}>No content yet</div><div className="t-sub">Create a piece — link it to an initiative and finishing it advances that initiative. Tie it to a release or campaign to ship it together.</div></div>
      ) : (
        <div className="grid-cards">
          {list.map((p) => {
            const st = STAGE_LABEL[p.stage] ?? STAGE_LABEL.backlog;
            const ini = iniOf(p.initiative_id); const rel = relOf(p.release_id); const camp = campOf(p.campaign_id);
            return (
              <div key={p.id} className="card card-pad">
                <div className="row-between" style={{ alignItems: "flex-start", marginBottom: 8 }}>
                  <span style={{ fontSize: 14.5, fontWeight: 620, lineHeight: 1.3 }}>{p.title}</span>
                  <button className="t-muted" onClick={() => remove(p.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15 }}>×</button>
                </div>
                <div className="row gap-2" style={{ marginBottom: 10, flexWrap: "wrap" }}>
                  <Chip tone="violet">{p.content_type === "video" ? "🎬 " : ""}{TYPE_LABEL[p.content_type ?? ""] ?? p.content_type}</Chip>
                  <Chip tone={st.tone}>{st.label}</Chip>
                  {p.area === "build" && <Chip tone="accent">Product</Chip>}
                </div>
                {(ini || rel || camp) && (
                  <div className="row gap-2" style={{ marginBottom: 10, flexWrap: "wrap" }}>
                    {ini && <a href={`/initiatives/${ini.id}`} className="t-sub" style={{ fontSize: 11, color: "var(--tm)", textDecoration: "none" }}>↑ {ini.title}</a>}
                    {rel && <Chip>📦 {rel.version ?? rel.name}</Chip>}
                    {camp && <Chip>📣 {camp.name}</Chip>}
                  </div>
                )}
                <div className="row gap-2">
                  {p.content_type === "video" ? <button className="btn btn-secondary btn-sm" onClick={() => setOpenVideo(p)}>Open studio →</button> : <PieceEditor piece={p} reload={load} />}
                  {STAGE_NEXT[p.stage] && <button className="btn btn-secondary btn-sm" onClick={() => patch(p.id, { stage: STAGE_NEXT[p.stage] })}>{p.stage === "backlog" ? "Start →" : "Publish →"}</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {openVideo && <VideoStudio piece={openVideo} onClose={() => setOpenVideo(null)} reload={load} />}
    </div>
  );
}

function chipBtn(on: boolean): React.CSSProperties {
  return { padding: "5px 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
    border: `1px solid ${on ? "var(--ac)" : "var(--border)"}`, background: on ? "var(--ac-fill)" : "var(--panel)", color: on ? "var(--ac-text)" : "var(--tm)" };
}

// Inline editor for written content (body).
function PieceEditor({ piece, reload }: { piece: { id: string; body: string | null }; reload: () => void }) {
  const supabase = createClient();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(piece.body ?? "");
  async function save() { await supabase.from("initiative_workstreams").update({ body }).eq("id", piece.id); setEditing(false); reload(); }
  if (!editing) return <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(true); setBody(piece.body ?? ""); }}>{piece.body ? "Edit" : "Write"}</button>;
  return (
    <div style={{ width: "100%" }}>
      <textarea className="textarea" rows={4} autoFocus value={body} onChange={(e) => setBody(e.target.value)} style={{ marginBottom: 8 }} />
      <div className="row gap-2"><button className="btn btn-sm" onClick={save}>Save</button><button className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}>Cancel</button></div>
    </div>
  );
}

// Video studio — the Descript flow: hook → script → prompts → produce. Stored in `details`.
function VideoStudio({ piece, onClose, reload }: { piece: Task; onClose: () => void; reload: () => void }) {
  const supabase = createClient();
  const [flow, setFlow] = useState<VideoFlow>(piece.details ?? { hook: "", script: "", prompts: [], descript_steps: [] });
  const [saving, setSaving] = useState(false);
  const [newPrompt, setNewPrompt] = useState("");

  async function save() {
    setSaving(true);
    await supabase.from("initiative_workstreams").update({ details: flow }).eq("id", piece.id);
    setSaving(false); reload();
  }
  const addPrompt = () => { if (!newPrompt.trim()) return; setFlow({ ...flow, prompts: [...(flow.prompts ?? []), newPrompt.trim()] }); setNewPrompt(""); };
  const removePrompt = (i: number) => setFlow({ ...flow, prompts: (flow.prompts ?? []).filter((_, x) => x !== i) });

  const STARTER_STEPS = ["Import script to Descript", "Record/generate voiceover", "Add B-roll & screen capture", "Auto-caption & trim filler words", "Export & publish"];

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(11,12,14,0.32)", zIndex: 40 }} />
      <aside style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: 560, maxWidth: "94vw", background: "var(--panel)", borderLeft: "1px solid var(--border)", boxShadow: "var(--shadow-md)", zIndex: 41, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--border)" }} className="row-between">
          <div className="row gap-2"><Chip tone="violet">🎬 Video studio</Chip><span style={{ fontSize: 15, fontWeight: 640 }}>{piece.title}</span></div>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
          <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 14 }}>Build the video from your product & GTM info, then run the Descript flow. (AI drafting of the hook/script from the linked initiative arrives with the agent runtime.)</div>

          <label className="field"><span className="t-label">Hook</span><textarea className="textarea" rows={2} value={flow.hook ?? ""} onChange={(e) => setFlow({ ...flow, hook: e.target.value })} placeholder="The opening that earns the next 5 seconds." /></label>
          <label className="field"><span className="t-label">Script</span><textarea className="textarea" rows={6} value={flow.script ?? ""} onChange={(e) => setFlow({ ...flow, script: e.target.value })} placeholder="The full script / talk track." /></label>

          <div className="field">
            <span className="t-label">Shot / prompt list</span>
            <div className="stack-3" style={{ marginTop: 6, marginBottom: 8 }}>
              {(flow.prompts ?? []).map((p, i) => (
                <div key={i} className="card" style={{ padding: "8px 12px" }}>
                  <div className="row-between"><span className="t-sub" style={{ fontSize: 13 }}>{i + 1}. {p}</span><button className="t-muted" onClick={() => removePrompt(i)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14 }}>×</button></div>
                </div>
              ))}
            </div>
            <div className="row gap-2"><input className="input" value={newPrompt} onChange={(e) => setNewPrompt(e.target.value)} placeholder="Add a shot or prompt" style={{ flex: 1 }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPrompt(); } }} /><button className="btn btn-sm" onClick={addPrompt}>Add</button></div>
          </div>

          <div className="field">
            <span className="t-label">Descript flow</span>
            <div className="stack-3" style={{ marginTop: 6 }}>
              {(flow.descript_steps && flow.descript_steps.length ? flow.descript_steps : STARTER_STEPS).map((s, i) => (
                <div key={i} className="card" style={{ padding: "9px 12px" }}>
                  <div className="row gap-2"><span style={{ width: 20, height: 20, borderRadius: 999, background: "var(--vl-fill)", color: "var(--vl-text)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{i + 1}</span><span className="t-sub" style={{ fontSize: 13 }}>{s}</span></div>
                </div>
              ))}
            </div>
            {(!flow.descript_steps || !flow.descript_steps.length) && <button className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={() => setFlow({ ...flow, descript_steps: STARTER_STEPS })}>Use this flow</button>}
          </div>
        </div>
        <div style={{ padding: "12px 18px", borderTop: "1px solid var(--border)" }} className="row gap-2">
          <button className="btn" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
          <a className="btn btn-secondary" href="https://www.descript.com" target="_blank" rel="noreferrer">Open Descript ↗</a>
        </div>
      </aside>
    </>
  );
}
