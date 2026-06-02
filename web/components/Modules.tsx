"use client";

// Modules → Features: the product's structural layer. Modules belong to a
// product; features belong to a module. The main list stays clean (module name,
// what-it-does, feature count); clicking a module opens a detail MODAL where you
// manage its features — so you can get specific without the list turning into a
// wall of nested boxes.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Section, Banner, Modal, ConfirmDialog } from "@/components/ui";

type Module = { id: string; name: string; description: string | null };
type Feature = { id: string; module_id: string; name: string; description: string | null };

export default function Modules({ productId }: { productId: string }) {
  const supabase = createClient();
  const [modules, setModules] = useState<Module[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [addingModule, setAddingModule] = useState(false);
  const [moduleName, setModuleName] = useState("");
  const [moduleDesc, setModuleDesc] = useState(""); // what the module does
  const [openModuleId, setOpenModuleId] = useState<string | null>(null); // detail modal
  const [editModule, setEditModule] = useState<{ id: string; name: string; description: string } | null>(null); // inline module edit
  // staged deletions → confirmed via in-app dialog (not a browser popup)
  const [delModule, setDelModule] = useState<Module | null>(null);

  // Surface the real PostgrestError (message+details+hint+code), not a generic
  // "Could not save" — the object Supabase throws isn't an Error instance.
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
    setLoading(false);
  }, [supabase, productId]);

  useEffect(() => { load(); }, [load]);

  async function addModule(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (!moduleName.trim()) return;
    try {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization.");
      const { error } = await supabase.from("modules").insert({
        org_id: orgId, product_id: productId,
        name: moduleName.trim(), description: moduleDesc.trim() || null,
      });
      if (error) throw error;
      setAddingModule(false); setModuleName(""); setModuleDesc(""); await load();
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
    // FK is ON DELETE CASCADE → this also removes the module's features.
    const { error } = await supabase.from("modules").delete().eq("id", m.id);
    if (error) { setError(errText(error, "Could not delete module.")); return; }
    if (openModuleId === m.id) setOpenModuleId(null);
    await load();
  }

  const featuresOf = (mid: string) => features.filter((f) => f.module_id === mid);
  const openModule = modules.find((m) => m.id === openModuleId) ?? null;

  return (
    <Section label="Modules & features" action={!addingModule ? <button className="btn btn-secondary btn-sm" onClick={() => setAddingModule(true)}>+ Add module</button> : undefined}>
      <Banner>{error}</Banner>

      {delModule && (
        <ConfirmDialog
          title="Delete module?"
          message={<>Delete <b>{delModule.name}</b>{featuresOf(delModule.id).length > 0 ? <> and its {featuresOf(delModule.id).length} feature{featuresOf(delModule.id).length === 1 ? "" : "s"}</> : null}? This can&rsquo;t be undone.</>}
          confirmLabel="Delete"
          onConfirm={removeModule}
          onCancel={() => setDelModule(null)}
        />
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
          <div className="t-sub t-muted">No modules yet. Modules group the product&apos;s features — click one to add features.</div>
        ) : (
          <div className="stack-3">
            {modules.map((m) => {
              const n = featuresOf(m.id).length;
              if (editModule?.id === m.id) {
                return (
                  <form key={m.id} onSubmit={saveModuleEdit} className="card card-pad">
                    <label className="field" style={{ marginBottom: 8 }}><span className="t-label">Module name</span>
                      <input className="input" autoFocus value={editModule.name} onChange={(e) => setEditModule({ ...editModule, name: e.target.value })} /></label>
                    <label className="field" style={{ marginBottom: 8 }}><span className="t-label">What it does</span>
                      <textarea className="textarea" rows={2} value={editModule.description} onChange={(e) => setEditModule({ ...editModule, description: e.target.value })} /></label>
                    <div className="row gap-2"><button className="btn btn-sm" type="submit">Save</button><button className="btn btn-secondary btn-sm" type="button" onClick={() => setEditModule(null)}>Cancel</button></div>
                  </form>
                );
              }
              return (
                <div key={m.id} className="card card-pad row-between" style={{ alignItems: "flex-start", gap: 12 }}>
                  <button onClick={() => setOpenModuleId(m.id)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", flex: 1, minWidth: 0 }}>
                    <span className="row gap-2" style={{ alignItems: "center" }}>
                      <span style={{ fontSize: 14.5, fontWeight: 640 }}>{m.name}</span>
                      <span className="chip">{n} feature{n === 1 ? "" : "s"}</span>
                    </span>
                    {m.description && <span className="t-sub t-muted" style={{ display: "block", fontSize: 12.5, marginTop: 3, lineHeight: 1.5 }}>{m.description}</span>}
                    <span className="t-sub" style={{ display: "block", fontSize: 11.5, marginTop: 5, color: "var(--ac-text)", fontWeight: 600 }}>Open to manage features →</span>
                  </button>
                  <div className="row gap-2" style={{ flexShrink: 0, alignItems: "center" }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => setEditModule({ id: m.id, name: m.name, description: m.description ?? "" })}>Edit</button>
                    <button onClick={() => setDelModule(m)} title={`Delete ${m.name}`} aria-label={`Delete module ${m.name}`}
                      style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, lineHeight: 1, color: "var(--tm)", padding: "0 2px" }}>×</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

      {/* Module detail — manage features in a focused modal so the list stays clean */}
      {openModule && (
        <ModuleDetail
          module={openModule}
          features={featuresOf(openModule.id)}
          onClose={() => setOpenModuleId(null)}
          reload={load}
          errText={errText}
          setError={setError}
        />
      )}
    </Section>
  );
}

// ---- The per-module feature manager (in a modal) ---------------------------
function ModuleDetail({ module, features, onClose, reload, errText, setError }: {
  module: Module;
  features: Feature[];
  onClose: () => void;
  reload: () => Promise<void>;
  errText: (e: unknown, fallback: string) => string;
  setError: (s: string | null) => void;
}) {
  const supabase = createClient();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [delFeature, setDelFeature] = useState<Feature | null>(null);
  const [editFeat, setEditFeat] = useState<{ id: string; name: string; description: string } | null>(null);

  async function saveFeatureEdit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    const f = editFeat; if (!f || !f.name.trim()) return;
    const { error } = await supabase.from("features").update({ name: f.name.trim(), description: f.description.trim() || null }).eq("id", f.id);
    if (error) { setError(errText(error, "Could not update feature.")); return; }
    setEditFeat(null); await reload();
  }

  async function addFeature(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (!name.trim()) return;
    setBusy(true);
    try {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization.");
      const { error } = await supabase.from("features").insert({
        org_id: orgId, module_id: module.id,
        name: name.trim(), description: desc.trim() || null,
      });
      if (error) throw error;
      setAdding(false); setName(""); setDesc(""); await reload();
    } catch (e) { setError(errText(e, "Could not add feature.")); }
    finally { setBusy(false); }
  }

  async function removeFeature() {
    const f = delFeature; if (!f) return;
    setDelFeature(null); setError(null);
    const { error } = await supabase.from("features").delete().eq("id", f.id);
    if (error) setError(errText(error, "Could not delete feature.")); else await reload();
  }

  return (
    <Modal open onClose={onClose} title={module.name} width={620}>
      {delFeature && (
        <ConfirmDialog
          title="Delete feature?"
          message={<>Delete <b>{delFeature.name}</b>? This can&rsquo;t be undone.</>}
          confirmLabel="Delete"
          onConfirm={removeFeature}
          onCancel={() => setDelFeature(null)}
        />
      )}

      {module.description && <p className="t-sub t-muted" style={{ marginTop: 0, marginBottom: 16, lineHeight: 1.55 }}>{module.description}</p>}

      <div className="row-between" style={{ marginBottom: 10 }}>
        <span className="t-label">Features · {features.length}</span>
        {!adding && <button className="btn btn-sm" onClick={() => { setAdding(true); setName(""); setDesc(""); }}>+ Add feature</button>}
      </div>

      {adding && (
        <form onSubmit={addFeature} className="card card-pad" style={{ marginBottom: 12 }}>
          <label className="field" style={{ marginBottom: 8 }}><span className="t-label">Feature name</span>
            <input className="input" autoFocus placeholder="e.g. Honest confidence engine" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field" style={{ marginBottom: 8 }}><span className="t-label">What it does</span>
            <textarea className="textarea" rows={2} placeholder="What this feature does and why it matters." value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
          <div className="row gap-2"><button className="btn btn-sm" type="submit" disabled={busy}>{busy ? "Adding…" : "Add"}</button><button className="btn btn-secondary btn-sm" type="button" onClick={() => setAdding(false)}>Cancel</button></div>
        </form>
      )}

      {features.length === 0 && !adding ? (
        <div className="t-sub t-muted" style={{ padding: "8px 0" }}>No features yet. Add the specific features this module delivers.</div>
      ) : (
        <div className="card" style={{ overflow: "hidden" }}>
          {features.map((f, i) => (
            <div key={f.id} style={{ padding: "10px 14px", borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
              {editFeat?.id === f.id ? (
                <form onSubmit={saveFeatureEdit}>
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
                  <div className="row gap-2" style={{ flexShrink: 0, alignItems: "center" }}>
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
    </Modal>
  );
}
