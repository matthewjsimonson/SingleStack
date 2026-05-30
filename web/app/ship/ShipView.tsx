"use client";

// Ship — the BUILD & TEST pipeline. Work items (features, modules, products,
// enhancements, bug fixes) move through: Spec → Prototype → Build → Test →
// Shipped. Signals can drive an item; a prototype URL captures AI-assisted
// vibecoding; items can attach to a roadmap release. This is where building
// actually happens (Roadmap is what's coming).
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { PageHeader, Chip, Banner } from "@/components/ui";

type Item = { id: string; title: string; description: string | null; kind: string | null; build_stage: string | null; priority: string | null; product_id: string | null; release_id: string | null; prototype_url: string | null };
type Rec = { id: string; name: string };
type Release = { id: string; name: string; version: string | null };
type Signal = { id: string; title: string };

const STAGES = [["spec", "Spec"], ["prototype", "Prototype"], ["build", "Build"], ["test", "Test"], ["shipped", "Shipped"]] as const;
const KINDS = ["feature", "module", "product", "enhancement", "bugfix"];
const KIND_TONE: Record<string, "default" | "accent" | "violet" | "amber" | "green"> = { feature: "accent", module: "violet", product: "green", enhancement: "default", bugfix: "amber" };

export default function ShipView() {
  const supabase = createClient();
  const [items, setItems] = useState<Item[]>([]);
  const [products, setProducts] = useState<Rec[]>([]);
  const [releases, setReleases] = useState<Release[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", kind: "feature", priority: "medium", product_id: "", release_id: "", signalIds: [] as string[] });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data: its }, { data: prods }, { data: rel }, { data: sigs }] = await Promise.all([
      supabase.from("initiatives").select("id, title, description, kind, build_stage, priority, product_id, release_id, prototype_url").eq("lane", "ship").order("position").order("created_at"),
      supabase.from("product_records").select("id, name"),
      supabase.from("releases").select("id, name, version").order("created_at"),
      supabase.from("signals").select("id, title").order("observed_at", { ascending: false, nullsFirst: false }).limit(30),
    ]);
    setItems(its ?? []); setProducts(prods ?? []); setReleases(rel ?? []); setSignals(sigs ?? []); setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault(); if (!form.title.trim()) return;
    setBusy(true); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      const { data, error } = await supabase.from("initiatives").insert({
        org_id: orgId, lane: "ship", title: form.title.trim(), description: form.description.trim() || null,
        kind: form.kind, priority: form.priority, build_stage: "spec", stage: "active",
        product_id: form.product_id || null, release_id: form.release_id || null,
      }).select("id").single();
      if (error) throw error;
      if (form.signalIds.length) await supabase.from("initiative_signals").insert(form.signalIds.map((sid) => ({ org_id: orgId, initiative_id: data.id, signal_id: sid })));
      setCreating(false); setForm({ title: "", description: "", kind: "feature", priority: "medium", product_id: "", release_id: "", signalIds: [] }); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create."); }
    finally { setBusy(false); }
  }
  async function moveStage(id: string, dir: 1 | -1) {
    const it = items.find((x) => x.id === id); if (!it) return;
    const idx = STAGES.findIndex(([s]) => s === (it.build_stage ?? "spec"));
    const next = STAGES[Math.min(STAGES.length - 1, Math.max(0, idx + dir))][0];
    setError(null); await supabase.from("initiatives").update({ build_stage: next }).eq("id", id); await load();
  }
  async function setPrototypeUrl(id: string, url: string) { setError(null); await supabase.from("initiatives").update({ prototype_url: url || null }).eq("id", id); await load(); }
  async function remove(id: string) { setError(null); await supabase.from("initiatives").delete().eq("id", id); await load(); }

  const productName = (id: string | null) => products.find((p) => p.id === id)?.name ?? null;
  const releaseName = (id: string | null) => { const r = releases.find((x) => x.id === id); return r ? (r.version || r.name) : null; };

  return (
    <div>
      <PageHeader title="Ship" meta="Build & test — spec, prototype (AI vibecoding), build, test, ship. Driven by signals, tied to releases." actions={!creating ? <button className="btn" onClick={() => setCreating(true)}>+ New build item</button> : undefined} />
      <Banner>{error}</Banner>

      {creating && (
        <form onSubmit={create} className="card card-pad" style={{ marginBottom: "var(--sp-6)" }}>
          <label className="field"><span className="t-label">Title</span><input className="input" autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Usage-based pricing UI" /></label>
          <label className="field"><span className="t-label">Description</span><textarea className="textarea" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--sp-3)" }}>
            <label className="field"><span className="t-label">Type</span><select className="select" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
            <label className="field"><span className="t-label">Priority</span><select className="select" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
            <label className="field"><span className="t-label">Release</span><select className="select" value={form.release_id} onChange={(e) => setForm({ ...form, release_id: e.target.value })}><option value="">— none —</option>{releases.map((r) => <option key={r.id} value={r.id}>{r.version || r.name}</option>)}</select></label>
          </div>
          <label className="field"><span className="t-label">Product</span><select className="select" value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })}><option value="">— none —</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          {signals.length > 0 && (
            <div className="field"><span className="t-label">Driven by signals (optional)</span>
              <div className="row gap-2" style={{ flexWrap: "wrap", marginTop: 6 }}>
                {signals.slice(0, 12).map((s) => { const on = form.signalIds.includes(s.id); return <button type="button" key={s.id} className="chip" onClick={() => setForm({ ...form, signalIds: on ? form.signalIds.filter((x) => x !== s.id) : [...form.signalIds, s.id] })} style={{ cursor: "pointer", background: on ? "var(--ac)" : "var(--fill)", color: on ? "#fff" : "var(--ts)" }}>{s.title.slice(0, 40)}</button>; })}
              </div>
            </div>
          )}
          <div className="row gap-2"><button className="btn" type="submit" disabled={busy}>{busy ? "Creating…" : "Create"}</button><button className="btn btn-secondary" type="button" onClick={() => setCreating(false)}>Cancel</button></div>
        </form>
      )}

      {loading ? <div className="t-sub t-muted">Loading…</div> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "var(--sp-3)" }}>
          {STAGES.map(([stage, label]) => {
            const col = items.filter((i) => (i.build_stage ?? "spec") === stage);
            return (
              <div key={stage}>
                <div className="section-head"><span className="t-label">{label}</span><span className="chip">{col.length}</span></div>
                <div className="stack-3">
                  {col.length === 0 && <div className="t-sub t-muted" style={{ fontSize: 12 }}>—</div>}
                  {col.map((it) => (
                    <div key={it.id} className="card card-pad" style={{ padding: 12 }}>
                      <div className="row-between" style={{ alignItems: "flex-start", marginBottom: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 620, lineHeight: 1.3 }}>{it.title}</span>
                        <button className="t-muted" onClick={() => remove(it.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, flexShrink: 0 }}>×</button>
                      </div>
                      <div className="row gap-2" style={{ flexWrap: "wrap", marginBottom: 8 }}>
                        {it.kind && <Chip tone={KIND_TONE[it.kind] ?? "default"}>{it.kind}</Chip>}
                        {releaseName(it.release_id) && <Chip>{releaseName(it.release_id)}</Chip>}
                      </div>
                      {productName(it.product_id) && <div className="t-sub t-muted" style={{ fontSize: 11, marginBottom: 6 }}>{productName(it.product_id)}</div>}
                      {(stage === "prototype" || it.prototype_url) && (
                        <input className="input" defaultValue={it.prototype_url ?? ""} placeholder="Prototype URL"
                          onBlur={(e) => { if (e.target.value !== (it.prototype_url ?? "")) setPrototypeUrl(it.id, e.target.value); }}
                          style={{ fontSize: 11.5, padding: "6px 8px", marginBottom: 8 }} />
                      )}
                      <div className="row gap-2">
                        {stage !== "spec" && <button className="btn btn-secondary btn-sm" style={{ padding: "3px 8px" }} onClick={() => moveStage(it.id, -1)}>←</button>}
                        {stage !== "shipped" && <button className="btn btn-secondary btn-sm" style={{ padding: "3px 8px" }} onClick={() => moveStage(it.id, 1)}>→</button>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
