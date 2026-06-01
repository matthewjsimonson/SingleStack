"use client";

// Modules → Features: the product's structural layer. Modules belong to a
// product; features belong to a module. Expandable tree with inline create at
// both levels — this is the "slice into structure while keeping the whole in
// view" idea from the prototype, and the structure agents reason over.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Section, Banner } from "@/components/ui";

type Module = { id: string; name: string; description: string | null };
type Feature = { id: string; module_id: string; name: string };

export default function Modules({ productId }: { productId: string }) {
  const supabase = createClient();
  const [modules, setModules] = useState<Module[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [addingModule, setAddingModule] = useState(false);
  const [moduleName, setModuleName] = useState("");
  const [moduleDesc, setModuleDesc] = useState(""); // what the module does
  const [addingFeatureFor, setAddingFeatureFor] = useState<string | null>(null);
  const [featureName, setFeatureName] = useState("");

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
      ? await supabase.from("features").select("id, module_id, name").in("module_id", ids).order("created_at")
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

  async function addFeature(e: React.FormEvent, moduleId: string) {
    e.preventDefault(); setError(null);
    if (!featureName.trim()) return;
    try {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization.");
      const { error } = await supabase.from("features").insert({ org_id: orgId, module_id: moduleId, name: featureName.trim() });
      if (error) throw error;
      setAddingFeatureFor(null); setFeatureName(""); setOpen((o) => ({ ...o, [moduleId]: true })); await load();
    } catch (e) { setError(errText(e, "Could not add feature.")); }
  }

  const featuresOf = (mid: string) => features.filter((f) => f.module_id === mid);

  return (
    <Section label="Modules & features" action={!addingModule ? <button className="btn btn-secondary btn-sm" onClick={() => setAddingModule(true)}>+ Add module</button> : undefined}>
      <Banner>{error}</Banner>

      {addingModule && (
        <form onSubmit={addModule} className="card card-pad" style={{ marginBottom: "var(--sp-3)" }}>
          <label className="field" style={{ marginBottom: 8 }}><span className="t-label">Module name</span>
            <input className="input" autoFocus placeholder="e.g. Signals" value={moduleName} onChange={(e) => setModuleName(e.target.value)} /></label>
          <label className="field" style={{ marginBottom: 8 }}><span className="t-label">What it does</span>
            <textarea className="textarea" rows={2} placeholder="What this module does and why it matters." value={moduleDesc} onChange={(e) => setModuleDesc(e.target.value)} /></label>
          <div className="row gap-2"><button className="btn btn-sm" type="submit">Add</button><button className="btn btn-secondary btn-sm" type="button" onClick={() => { setAddingModule(false); setModuleName(""); setModuleDesc(""); }}>Cancel</button></div>
        </form>
      )}

      {loading ? <div className="t-sub t-muted">Loading…</div>
        : modules.length === 0 && !addingModule ? (
          <div className="t-sub t-muted">No modules yet. Modules group the product&apos;s features.</div>
        ) : (
          <div className="card">
            {modules.map((m, i) => {
              const feats = featuresOf(m.id);
              const isOpen = open[m.id];
              return (
                <div key={m.id} style={{ borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                  <div className="row-between" style={{ padding: "12px 16px", alignItems: "flex-start" }}>
                    <button onClick={() => setOpen((o) => ({ ...o, [m.id]: !o[m.id] }))}
                      style={{ background: "none", border: "none", display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer", padding: 0, textAlign: "left" }}>
                      <span className="t-muted" style={{ fontSize: 10, width: 10, marginTop: 4 }}>{feats.length ? (isOpen ? "▾" : "▸") : "·"}</span>
                      <span>
                        <span className="row gap-2" style={{ alignItems: "center" }}>
                          <span style={{ fontSize: 14, fontWeight: 600 }}>{m.name}</span>
                          <span className="chip">{feats.length} feature{feats.length === 1 ? "" : "s"}</span>
                        </span>
                        {m.description && <span className="t-sub t-muted" style={{ display: "block", fontSize: 12.5, marginTop: 3, lineHeight: 1.5 }}>{m.description}</span>}
                      </span>
                    </button>
                    <button className="btn btn-secondary btn-sm" style={{ flexShrink: 0 }} onClick={() => { setAddingFeatureFor(m.id); setFeatureName(""); setOpen((o) => ({ ...o, [m.id]: true })); }}>+ Feature</button>
                  </div>
                  {isOpen && (
                    <div style={{ padding: "0 16px 12px 34px" }}>
                      {feats.map((f) => (
                        <div key={f.id} className="t-body" style={{ padding: "6px 0", borderTop: "1px solid var(--border)" }}>{f.name}</div>
                      ))}
                      {addingFeatureFor === m.id && (
                        <form onSubmit={(e) => addFeature(e, m.id)} className="row gap-2" style={{ marginTop: 8 }}>
                          <input className="input" autoFocus placeholder="Feature name" value={featureName} onChange={(e) => setFeatureName(e.target.value)} style={{ flex: 1 }} />
                          <button className="btn btn-sm" type="submit">Add</button>
                          <button className="btn btn-secondary btn-sm" type="button" onClick={() => setAddingFeatureFor(null)}>Cancel</button>
                        </form>
                      )}
                      {feats.length === 0 && addingFeatureFor !== m.id && <div className="t-sub t-muted" style={{ padding: "6px 0" }}>No features yet.</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
    </Section>
  );
}
