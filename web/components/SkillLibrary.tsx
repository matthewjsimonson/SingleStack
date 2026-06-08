"use client";

// Skills library — the org-wide catalog of reusable agent skills, the way the
// MCP/source library works: browse, SEARCH, filter, create/edit in an overlay,
// and see which agents use each. Skills are still attached to agents on the
// agent's Skills map; this is where they live and are curated as a library.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Section, Chip, Banner, Empty, Modal, ConfirmDialog } from "@/components/ui";
import { Markdown } from "@/components/Markdown";

type Skill = { id: string; key: string; name: string; description: string | null; category: string | null; instructions: string | null; source: string | null; created_at: string };
type Usage = Record<string, { count: number; agents: string[] }>; // skill_id -> who uses it

const CATS = ["all", "product", "gtm", "research", "general"] as const;
type Cat = typeof CATS[number];
const catTone = (c: string | null) => (c === "product" ? "accent" : c === "gtm" ? "violet" : c === "research" ? "green" : "default");
const BLANK = { name: "", description: "", instructions: "", category: "general" };

export default function SkillLibrary() {
  const supabase = createClient();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [usage, setUsage] = useState<Usage>({});
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [cat, setCat] = useState<Cat>("all");

  // Editor overlay (create or edit)
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null); // null = creating
  const [form, setForm] = useState(BLANK);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [delId, setDelId] = useState<string | null>(null);
  const [attachFor, setAttachFor] = useState<Skill | null>(null);

  const load = useCallback(async () => {
    const [{ data: sk }, { data: as }, { data: ag }] = await Promise.all([
      supabase.from("skills").select("id, key, name, description, category, instructions, source, created_at").order("name"),
      supabase.from("agent_skills").select("skill_id, agent_id"),
      supabase.from("agents").select("id, name").order("name"),
    ]);
    setSkills((sk ?? []) as Skill[]);
    setAgents((ag ?? []) as { id: string; name: string }[]);
    const nameById = new Map((ag ?? []).map((a) => [a.id, a.name]));
    const u: Usage = {};
    for (const r of (as ?? []) as { skill_id: string; agent_id: string }[]) {
      const e = (u[r.skill_id] ??= { count: 0, agents: [] });
      e.count++; const n = nameById.get(r.agent_id); if (n) e.agents.push(n);
    }
    setUsage(u); setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  function openCreate() { setEditId(null); setForm(BLANK); setPreview(false); setOpen(true); setError(null); }
  function openEdit(s: Skill) { setEditId(s.id); setForm({ name: s.name, description: s.description ?? "", instructions: s.instructions ?? "", category: s.category ?? "general" }); setPreview(false); setOpen(true); setError(null); }

  async function save() {
    if (!form.name.trim()) { setError("Give the skill a name."); return; }
    setBusy(true); setError(null);
    try {
      if (editId) {
        const { error } = await supabase.from("skills").update({ name: form.name.trim(), description: form.description.trim() || null, instructions: form.instructions.trim() || null, category: form.category }).eq("id", editId);
        if (error) throw error;
      } else {
        const orgId = await getOrgId();
        if (!orgId) throw new Error("Could not resolve your organization.");
        const key = form.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `skill_${Date.now()}`;
        const { error } = await supabase.from("skills").insert({ org_id: orgId, key, name: form.name.trim(), description: form.description.trim() || null, instructions: form.instructions.trim() || null, category: form.category, source: "custom" });
        if (error) throw error;
      }
      setOpen(false); load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save the skill."); }
    finally { setBusy(false); }
  }

  async function doDelete() {
    const id = delId; if (!id) return;
    setDelId(null); setError(null);
    const { error } = await supabase.from("skills").delete().eq("id", id);
    if (error) setError(error.message); else { setOpen(false); load(); }
  }

  async function attach(skillId: string, agentId: string) {
    setError(null);
    const orgId = await getOrgId(); if (!orgId) return;
    const { error } = await supabase.from("agent_skills").insert({ org_id: orgId, agent_id: agentId, skill_id: skillId });
    if (error && (error as { code?: string }).code !== "23505") { setError(error.message); return; }
    setAttachFor(null); load();
  }

  const filtered = skills.filter((s) => {
    if (cat !== "all" && (s.category ?? "general") !== cat) return false;
    if (!q.trim()) return true;
    const hay = `${s.name} ${s.description ?? ""} ${s.instructions ?? ""}`.toLowerCase();
    return hay.includes(q.trim().toLowerCase());
  });

  return (
    <div>
      <div style={{ marginBottom: "var(--sp-3)" }}>
        <h1 className="t-page">Skills library</h1>
        <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Reusable playbooks your agents apply. Author and curate them here; attach them to agents on each agent&rsquo;s Skills map.</div>
      </div>

      <Banner>{error}</Banner>

      {/* Search + filters + new */}
      <div className="row gap-2" style={{ marginBottom: "var(--sp-4)", flexWrap: "wrap", alignItems: "center" }}>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search skills…" style={{ flex: "1 1 240px", maxWidth: 360 }} />
        <div className="row" style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
          {CATS.map((c) => (
            <button key={c} onClick={() => setCat(c)} className="btn-sm" style={{ border: "none", background: cat === c ? "var(--ac)" : "var(--panel)", color: cat === c ? "#fff" : "var(--ts)", fontWeight: 600, padding: "6px 12px", cursor: "pointer", textTransform: "capitalize" }}>{c}</button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn btn-sm" onClick={openCreate} style={{ background: "var(--ac)", color: "#fff" }}>+ New skill</button>
      </div>

      {loading ? <div className="t-sub t-muted">Loading…</div>
        : skills.length === 0 ? <Empty title="No skills yet" hint="Author a reusable playbook your agents can apply." action={<button className="btn" onClick={openCreate}>+ New skill</button>} />
        : filtered.length === 0 ? <div className="t-sub t-muted">No skills match “{q}”{cat !== "all" ? ` in ${cat}` : ""}.</div>
        : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "var(--sp-4)" }}>
            {filtered.map((s) => {
              const u = usage[s.id];
              return (
                <div key={s.id} className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 8, minHeight: 140 }}>
                  <div className="row-between" style={{ gap: 8, alignItems: "flex-start" }}>
                    <button onClick={() => openEdit(s)} style={{ background: "none", border: "none", textAlign: "left", padding: 0, cursor: "pointer", fontSize: 14.5, fontWeight: 640, color: "var(--tp)", minWidth: 0 }}>{s.name}</button>
                    <Chip tone={catTone(s.category)}>{s.category ?? "general"}</Chip>
                  </div>
                  <div className="t-sub t-muted" style={{ fontSize: 12, lineHeight: 1.4, flex: 1 }}>{s.description || "No description."}</div>
                  <div className="row-between" style={{ alignItems: "center", gap: 6 }}>
                    <span className="t-mono-xs t-muted" title={u?.agents.join(", ")}>{u?.count ? `used by ${u.count} agent${u.count === 1 ? "" : "s"}` : "unused"}{s.source === "template" ? " · template" : ""}</span>
                    <div className="row gap-2">
                      <button className="btn btn-secondary btn-sm" onClick={() => setAttachFor(s)}>Attach</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => openEdit(s)}>Edit</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

      {/* Create / edit overlay */}
      <Modal open={open} onClose={() => setOpen(false)} title={editId ? "Edit skill" : "New skill"} width={680}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "var(--sp-3)" }}>
          <label className="field"><span className="t-label">Name</span><input className="input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Competitive teardown" /></label>
          <label className="field"><span className="t-label">Category</span>
            <select className="select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="general">General</option><option value="product">Product</option><option value="gtm">GTM</option><option value="research">Research</option>
            </select></label>
        </div>
        <label className="field"><span className="t-label">What it does</span><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="A one-liner" /></label>
        <div className="field">
          <div className="row-between" style={{ alignItems: "center", marginBottom: 4 }}>
            <span className="t-label">Instructions (playbook)</span>
            <div className="row gap-2">
              <button type="button" className="btn btn-secondary btn-sm" style={!preview ? { background: "var(--fill-2)" } : undefined} onClick={() => setPreview(false)}>Edit</button>
              <button type="button" className="btn btn-secondary btn-sm" style={preview ? { background: "var(--fill-2)" } : undefined} onClick={() => setPreview(true)}>Preview</button>
            </div>
          </div>
          {preview
            ? <div className="card card-pad" style={{ background: "var(--panel-2)", minHeight: 140 }}>{form.instructions.trim() ? <Markdown text={form.instructions} /> : <span className="t-sub t-muted">Nothing to preview yet.</span>}</div>
            : <textarea className="textarea" rows={12} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} placeholder="How an agent applies this skill — markdown supported. Tailor it to your company and goals." />}
        </div>
        <div className="row-between" style={{ alignItems: "center", marginTop: 4 }}>
          <div className="row gap-2">
            <button className="btn" onClick={save} disabled={busy}>{busy ? "Saving…" : editId ? "Save" : "Create skill"}</button>
            <button className="btn btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
          </div>
          {editId && <button className="btn btn-secondary btn-sm" onClick={() => setDelId(editId)} style={{ color: "var(--rd-text)" }}>Delete</button>}
        </div>
      </Modal>

      {/* Attach-to-agent overlay */}
      <Modal open={!!attachFor} onClose={() => setAttachFor(null)} title={attachFor ? `Attach “${attachFor.name}”` : ""} width={460}>
        <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>Add this skill as a child skill on an agent. Tailor it per-agent on that agent&rsquo;s Skills map.</div>
        {agents.length === 0 ? <div className="t-sub t-muted">No agents yet.</div> : (
          <div className="stack-2">
            {agents.map((a) => {
              const has = attachFor ? (usage[attachFor.id]?.agents.includes(a.name) ?? false) : false;
              return (
                <div key={a.id} className="card card-pad row-between" style={{ alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{a.name}</span>
                  {has ? <Chip tone="green">attached</Chip> : <button className="btn btn-sm" onClick={() => attachFor && attach(attachFor.id, a.id)}>+ Attach</button>}
                </div>
              );
            })}
          </div>
        )}
      </Modal>

      {delId && <ConfirmDialog title="Delete skill?" message="This removes the skill from the library and detaches it from every agent. This can't be undone." confirmLabel="Delete" onConfirm={doDelete} onCancel={() => setDelId(null)} />}

      <div style={{ marginTop: "var(--sp-6)" }}>
        <Section label="Tip">
          <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>To draft a skill with AI or set an agent&rsquo;s cornerstone, open an agent and use its Skills map — it grounds drafts in that agent&rsquo;s identity and your product truth.</div>
        </Section>
      </div>
    </div>
  );
}
