"use client";

// Roadmap — what's COMING. Releases (versioned) grouped by stage: Planned →
// In development → Released. Each release shows version, target date, the
// product it's for, and how many build items (initiatives) ship in it. This is
// "what the product will be"; the actual building happens in Ship.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { PageHeader, Section, Chip, Banner } from "@/components/ui";

type Release = { id: string; name: string; version: string | null; summary: string | null; stage: string; target_date: string | null; product_id: string | null };
type Rec = { id: string; name: string };

const STAGES = [["planned", "Planned"], ["in_dev", "In development"], ["released", "Released"]] as const;
const STAGE_TONE: Record<string, "default" | "violet" | "green"> = { planned: "default", in_dev: "violet", released: "green" };

export default function RoadmapView() {
  const supabase = createClient();
  const [releases, setReleases] = useState<Release[]>([]);
  const [products, setProducts] = useState<Rec[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", version: "", summary: "", target_date: "", product_id: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data: rel }, { data: prods }, { data: inits }] = await Promise.all([
      supabase.from("releases").select("id, name, version, summary, stage, target_date, product_id").order("target_date", { nullsFirst: false }).order("created_at"),
      supabase.from("product_records").select("id, name"),
      supabase.from("initiatives").select("release_id"),
    ]);
    setReleases(rel ?? []); setProducts(prods ?? []);
    const c: Record<string, number> = {};
    (inits ?? []).forEach((i) => { if (i.release_id) c[i.release_id] = (c[i.release_id] ?? 0) + 1; });
    setCounts(c); setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault(); if (!form.name.trim()) return;
    setBusy(true); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      const { error } = await supabase.from("releases").insert({
        org_id: orgId, name: form.name.trim(), version: form.version.trim() || null, summary: form.summary.trim() || null,
        target_date: form.target_date || null, product_id: form.product_id || null, stage: "planned",
      });
      if (error) throw error;
      setCreating(false); setForm({ name: "", version: "", summary: "", target_date: "", product_id: "" }); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create release."); }
    finally { setBusy(false); }
  }
  async function move(id: string, stage: string) { setError(null); await supabase.from("releases").update({ stage }).eq("id", id); await load(); }
  async function remove(id: string) { setError(null); await supabase.from("releases").delete().eq("id", id); await load(); }

  const productName = (id: string | null) => products.find((p) => p.id === id)?.name ?? null;

  return (
    <div>
      <PageHeader title="Roadmap" meta="What's coming — releases and what the product will be. Build & test happens in Ship." actions={!creating ? <button className="btn" onClick={() => setCreating(true)}>+ New release</button> : undefined} />
      <Banner>{error}</Banner>

      {creating && (
        <form onSubmit={create} className="card card-pad" style={{ marginBottom: "var(--sp-6)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "var(--sp-3)" }}>
            <label className="field"><span className="t-label">Release name</span><input className="input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Pricing & onboarding" /></label>
            <label className="field"><span className="t-label">Version</span><input className="input mono" value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} placeholder="v4.4" /></label>
          </div>
          <label className="field"><span className="t-label">Summary</span><textarea className="textarea" rows={2} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} placeholder="What this release will be." /></label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-3)" }}>
            <label className="field"><span className="t-label">Target date</span><input className="input" type="date" value={form.target_date} onChange={(e) => setForm({ ...form, target_date: e.target.value })} /></label>
            <label className="field"><span className="t-label">Product</span><select className="select" value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })}><option value="">— none —</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          </div>
          <div className="row gap-2"><button className="btn" type="submit" disabled={busy}>{busy ? "Creating…" : "Create"}</button><button className="btn btn-secondary" type="button" onClick={() => setCreating(false)}>Cancel</button></div>
        </form>
      )}

      {loading ? <div className="t-sub t-muted">Loading…</div> : releases.length === 0 && !creating ? (
        <div className="empty"><div className="t-body" style={{ fontWeight: 600, marginBottom: 6 }}>No releases yet</div><div className="t-sub">Plan what's coming — create a release, then build its work in Ship.</div></div>
      ) : STAGES.map(([stage, label]) => {
        const list = releases.filter((r) => r.stage === stage);
        if (list.length === 0) return null;
        return (
          <Section key={stage} label={`${label} · ${list.length}`}>
            <div className="stack-3">
              {list.map((r) => (
                <div key={r.id} className="card card-pad">
                  <div className="row-between" style={{ alignItems: "flex-start", marginBottom: 6 }}>
                    <div className="row gap-2">
                      {r.version && <Chip>{r.version}</Chip>}
                      <span style={{ fontSize: 15, fontWeight: 620 }}>{r.name}</span>
                      <Chip tone={STAGE_TONE[r.stage]}>{label}</Chip>
                    </div>
                    <button className="t-muted" onClick={() => remove(r.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15 }}>×</button>
                  </div>
                  {r.summary && <div className="t-sub" style={{ lineHeight: 1.5, marginBottom: 10 }}>{r.summary}</div>}
                  <div className="row gap-2" style={{ flexWrap: "wrap", marginBottom: 10 }}>
                    {productName(r.product_id) && <Chip tone="accent">{productName(r.product_id)}</Chip>}
                    {r.target_date && <Chip>🎯 {new Date(r.target_date).toLocaleDateString()}</Chip>}
                    <Chip>🔨 {counts[r.id] ?? 0} build item{(counts[r.id] ?? 0) === 1 ? "" : "s"}</Chip>
                  </div>
                  <div className="row gap-2">
                    {stage !== "planned" && <button className="btn btn-secondary btn-sm" onClick={() => move(r.id, stage === "released" ? "in_dev" : "planned")}>←</button>}
                    {stage !== "released" && <button className="btn btn-secondary btn-sm" onClick={() => move(r.id, stage === "planned" ? "in_dev" : "released")}>{stage === "planned" ? "Start dev →" : "Mark released →"}</button>}
                    <a className="btn btn-secondary btn-sm" href="/ship">Build in Ship →</a>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        );
      })}
    </div>
  );
}
