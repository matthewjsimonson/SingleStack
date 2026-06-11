"use client";

// Modules → Features: the product's structural layer. Displayed as a TABBED BOX
// (matching the GTM record's messaging UI): one card, a tab strip of modules
// across the top, and the selected module's detail (what-it-does + its features)
// in the body. Keeps the list compact no matter how many modules there are.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Section, Banner, ConfirmDialog } from "@/components/ui";
import ModuleWorkflows from "@/components/ModuleWorkflows";
import ModuleTechnical from "@/components/ModuleTechnical";

type Module = { id: string; name: string; description: string | null };
type Feature = { id: string; module_id: string; name: string; description: string | null };

export default function Modules({ productId }: { productId: string }) {
  const supabase = createClient();
  const [modules, setModules] = useState<Module[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null); // selected tab
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [addingModule, setAddingModule] = useState(false);
  const [moduleName, setModuleName] = useState("");
  const [moduleDesc, setModuleDesc] = useState("");
  const [editModule, setEditModule] = useState<{ id: string; name: string; description: string } | null>(null);
  const [delModule, setDelModule] = useState<Module | null>(null);

  // feature add/edit/delete (within the active module's body)
  const [addingFeature, setAddingFeature] = useState(false);
  const [featName, setFeatName] = useState("");
  const [featDesc, setFeatDesc] = useState("");
  const [editFeat, setEditFeat] = useState<{ id: string; name: string; description: string } | null>(null);
  const [delFeature, setDelFeature] = useState<Feature | null>(null);

  // Surface the real PostgrestError, not a generic "Could not save".
  function errText(e: unknown, fallback: string): string {
    if (e && typeof e === "object") {
      const o = e as { message?: string; code?: string; details?: string; hint?: string };
      const parts = [o.message, o.details, o.hint].filter(Boolean);
      if (parts.length) return `${parts.join(" — ")}${o.code ? ` [${o.code}]` : ""}`;
    }
    return e instanceof Error ? e.message : fallback;
  }

  const load = useCallback(async () => {
    const { data: mods, error: mErr } = await supabase.from("modules").select("id, name, description").eq("product_id", productId).order("created_at");
    if (mErr) { setError(errText(mErr, "Could not load modules.")); setLoading(false); return; }
    const ids = (mods ?? []).map((m) => m.id);
    const { data: feats } = ids.length
      ? await supabase.from("features").select("id, module_id, name, description").in("module_id", ids).order("created_at")
      : { data: [] as Feature[] };
    setModules(mods ?? []);
    setFeatures(feats ?? []);
    // keep a valid active tab
    setActiveId((cur) => (cur && (mods ?? []).some((m) => m.id === cur)) ? cur : (mods?.[0]?.id ?? null));
    setLoading(false);
  }, [supabase, productId]);

  useEffect(() => { load(); }, [load]);

  async function addModule(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (!moduleName.trim()) return;
    try {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization.");
      const { data, error } = await supabase.from("modules").insert({
        org_id: orgId, product_id: productId, name: moduleName.trim(), description: moduleDesc.trim() || null,
      }).select("id").single();
      if (error) throw error;
      setAddingModule(false); setModuleName(""); setModuleDesc("");
      await load();
      if (data?.id) setActiveId(data.id); // jump to the new module's tab
    } catch (e) { setError(errText(e, "Could not add module.")); }
  }

  async function saveModuleEdit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    const m = editModule; if (!m || !m.name.trim()) return;
    const { error } = await supabase.from("modules").update({ name: m.name.trim(), description: m.description.trim() || null }).eq("id", m.id);
    if (error) { setError(errText(error, "Could not update module.")); return; }
    setEditModule(null); await load();
  }

  async function removeModule() {
    const m = delModule; if (!m) return;
    setDelModule(null); setError(null);
    const { error } = await supabase.from("modules").delete().eq("id", m.id); // cascades to features
    if (error) setError(errText(error, "Could not delete module.")); else await load();
  }

  async function addFeature(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (!featName.trim() || !activeId) return;
    try {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization.");
      const { error } = await supabase.from("features").insert({
        org_id: orgId, module_id: activeId, name: featName.trim(), description: featDesc.trim() || null,
      });
      if (error) throw error;
      setAddingFeature(false); setFeatName(""); setFeatDesc(""); await load();
    } catch (e) { setError(errText(e, "Could not add feature.")); }
  }

  async function saveFeatEdit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    const f = editFeat; if (!f || !f.name.trim()) return;
    const { error } = await supabase.from("features").update({ name: f.name.trim(), description: f.description.trim() || null }).eq("id", f.id);
    if (error) { setError(errText(error, "Could not update feature.")); return; }
    setEditFeat(null); await load();
  }

  async function removeFeature() {
    const f = delFeature; if (!f) return;
    setDelFeature(null); setError(null);
    const { error } = await supabase.from("features").delete().eq("id", f.id);
    if (error) setError(errText(error, "Could not delete feature.")); else await load();
  }

  const featuresOf = (mid: string) => features.filter((f) => f.module_id === mid);
  const active = modules.find((m) => m.id === activeId) ?? null;
  const activeFeatures = active ? featuresOf(active.id) : [];

  return (
    <Section label="Modules & features" action={!addingModule ? <button className="btn btn-secondary btn-sm" onClick={() => setAddingModule(true)}>+ Add module</button> : undefined}>
      <Banner>{error}</Banner>

      {delModule && (
        <ConfirmDialog title="Delete module?"
          message={<>Delete <b>{delModule.name}</b>{featuresOf(delModule.id).length > 0 ? <> and its {featuresOf(delModule.id).length} feature{featuresOf(delModule.id).length === 1 ? "" : "s"}</> : null}? This can&rsquo;t be undone.</>}
          confirmLabel="Delete" onConfirm={removeModule} onCancel={() => setDelModule(null)} />
      )}
      {delFeature && (
        <ConfirmDialog title="Delete feature?" message={<>Delete <b>{delFeature.name}</b>? This can&rsquo;t be undone.</>}
          confirmLabel="Delete" onConfirm={removeFeature} onCancel={() => setDelFeature(null)} />
      )}

      {addingModule && (
        <form onSubmit={addModule} className="card card-pad" style={{ marginBottom: "var(--sp-3)" }}>
          <label className="field" style={{ marginBottom: 8 }}><span className="t-label">Module name</span>
            <input className="input" autoFocus placeholder="e.g. Intelligence" value={moduleName} onChange={(e) => setModuleName(e.target.value)} /></label>
          <label className="field" style={{ marginBottom: 8 }}><span className="t-label">What it does</span>
            <textarea className="textarea" rows={2} placeholder="What this module does and why it matters." value={moduleDesc} onChange={(e) => setModuleDesc(e.target.value)} /></label>
          <div className="row gap-2"><button className="btn btn-sm" type="submit">Add</button><button className="btn btn-secondary btn-sm" type="button" onClick={() => { setAddingModule(false); setModuleName(""); setModuleDesc(""); }}>Cancel</button></div>
        </form>
      )}

      {loading ? <div className="t-sub t-muted">Loading…</div>
        : modules.length === 0 && !addingModule ? (
          <div className="t-sub t-muted">No modules yet. Modules group the product&apos;s features — add one to start.</div>
        ) : modules.length > 0 ? (
          <div className="card">
            {/* tab strip — one tab per module */}
            <div className="row" style={{ gap: 4, padding: "8px 8px 0", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
              {modules.map((m) => {
                const on = m.id === activeId;
                const n = featuresOf(m.id).length;
                return (
                  <button key={m.id} onClick={() => { setActiveId(m.id); setAddingFeature(false); setEditFeat(null); setEditModule(null); }}
                    style={{ background: "none", border: "none", borderBottom: on ? "2px solid var(--vl)" : "2px solid transparent", color: on ? "var(--tp)" : "var(--ts)", fontWeight: 600, fontSize: 13, padding: "8px 12px", cursor: "pointer", marginBottom: -1 }}>
                    {m.name} <span className="t-muted" style={{ fontWeight: 500 }}>· {n}</span>
                  </button>
                );
              })}
            </div>

            {/* tab body — the active module's detail + its features */}
            {active && (
              <div className="card-pad">
                {editModule?.id === active.id ? (
                  <form onSubmit={saveModuleEdit} style={{ marginBottom: 14 }}>
                    <label className="field" style={{ marginBottom: 8 }}><span className="t-label">Module name</span>
                      <input className="input" autoFocus value={editModule.name} onChange={(e) => setEditModule({ ...editModule, name: e.target.value })} /></label>
                    <label className="field" style={{ marginBottom: 8 }}><span className="t-label">What it does</span>
                      <textarea className="textarea" rows={2} value={editModule.description} onChange={(e) => setEditModule({ ...editModule, description: e.target.value })} /></label>
                    <div className="row gap-2"><button className="btn btn-sm" type="submit">Save</button><button className="btn btn-secondary btn-sm" type="button" onClick={() => setEditModule(null)}>Cancel</button></div>
                  </form>
                ) : (
                  <div className="row-between" style={{ alignItems: "flex-start", gap: 10, marginBottom: 14 }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="t-h2" style={{ fontSize: 15, fontWeight: 640 }}>{active.name}</div>
                      {active.description
                        ? <div className="t-sub t-muted" style={{ fontSize: 12.5, marginTop: 3, lineHeight: 1.55 }}>{active.description}</div>
                        : <div className="t-muted" style={{ fontSize: 12.5, marginTop: 3 }}>No description yet.</div>}
                    </div>
                    <div className="row gap-2" style={{ flexShrink: 0 }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => setEditModule({ id: active.id, name: active.name, description: active.description ?? "" })}>Edit</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => setDelModule(active)}>Delete</button>
                    </div>
                  </div>
                )}

                {/* features of the active module */}
                <div className="row-between" style={{ marginBottom: 8 }}>
                  <span className="t-label">Features · {activeFeatures.length}</span>
                  {!addingFeature && <button className="btn btn-sm" onClick={() => { setAddingFeature(true); setFeatName(""); setFeatDesc(""); }}>+ Add feature</button>}
                </div>

                {addingFeature && (
                  <form onSubmit={addFeature} className="card card-pad" style={{ marginBottom: 10, background: "var(--panel-2)" }}>
                    <label className="field" style={{ marginBottom: 8 }}><span className="t-label">Feature name</span>
                      <input className="input" autoFocus placeholder="e.g. Honest confidence engine" value={featName} onChange={(e) => setFeatName(e.target.value)} /></label>
                    <label className="field" style={{ marginBottom: 8 }}><span className="t-label">What it does</span>
                      <textarea className="textarea" rows={2} placeholder="What this feature does and why it matters." value={featDesc} onChange={(e) => setFeatDesc(e.target.value)} /></label>
                    <div className="row gap-2"><button className="btn btn-sm" type="submit">Add</button><button className="btn btn-secondary btn-sm" type="button" onClick={() => setAddingFeature(false)}>Cancel</button></div>
                  </form>
                )}

                {activeFeatures.length === 0 && !addingFeature ? (
                  <div className="t-sub t-muted" style={{ padding: "4px 0" }}>No features yet. Add the specific features this module delivers.</div>
                ) : (
                  <div className="card" style={{ overflow: "hidden" }}>
                    {activeFeatures.map((f, i) => (
                      <div key={f.id} style={{ padding: "10px 14px", borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                        {editFeat?.id === f.id ? (
                          <form onSubmit={saveFeatEdit}>
                            <label className="field" style={{ marginBottom: 8 }}><span className="t-label">Feature name</span>
                              <input className="input" autoFocus value={editFeat.name} onChange={(e) => setEditFeat({ ...editFeat, name: e.target.value })} /></label>
                            <label className="field" style={{ marginBottom: 8 }}><span className="t-label">What it does</span>
                              <textarea className="textarea" rows={2} value={editFeat.description} onChange={(e) => setEditFeat({ ...editFeat, description: e.target.value })} /></label>
                            <div className="row gap-2"><button className="btn btn-sm" type="submit">Save</button><button className="btn btn-secondary btn-sm" type="button" onClick={() => setEditFeat(null)}>Cancel</button></div>
                          </form>
                        ) : (
                          <div className="row-between" style={{ alignItems: "flex-start", gap: 10 }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 13.5, fontWeight: 620 }}>{f.name}</div>
                              {f.description && <div className="t-sub t-muted" style={{ fontSize: 12.5, marginTop: 2, lineHeight: 1.5 }}>{f.description}</div>}
                            </div>
                            <div className="row gap-2" style={{ flexShrink: 0 }}>
                              <button className="btn btn-secondary btn-sm" onClick={() => setEditFeat({ id: f.id, name: f.name, description: f.description ?? "" })}>Edit</button>
                              <button onClick={() => setDelFeature(f)} title={`Delete ${f.name}`} aria-label={`Delete feature ${f.name}`}
                                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15, lineHeight: 1, color: "var(--tm)", padding: "0 2px" }}>×</button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* module-level TECHNICAL foundation: how it's built, its signals, its build */}
                <ModuleTechnical moduleId={active.id} productId={productId} featureCount={activeFeatures.length} />

                {/* module-level workflows: agent × skills × trigger for this module */}
                <ModuleWorkflows moduleId={active.id} productId={productId} />
              </div>
            )}
          </div>
        ) : null}
    </Section>
  );
}
