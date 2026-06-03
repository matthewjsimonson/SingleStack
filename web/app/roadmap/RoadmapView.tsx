"use client";

// Roadmap — the OUTPUT people want to see. A release bundles shipped product
// work; its changelog is populated by completed BUILD tasks tagged to it
// (change_type: feature / feature-update / module-update / bug-fix /
// enhancement). You don't do work here — you do it in Ship and tag the task to
// a release; finishing it lands it in the changelog. Roadmap = Planned → In
// development → Released, the rollup of that.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { useProductScope } from "@/lib/ProductContext";
import { fireWorkflows } from "@/lib/triggers";
import { Section, Chip, Banner } from "@/components/ui";
import PageBar from "@/components/PageBar";

type Release = { id: string; name: string; version: string | null; summary: string | null; stage: string; target_date: string | null; product_id: string | null };
type Task = { id: string; title: string; stage: string; change_type: string | null; release_id: string | null };
type Rec = { id: string; name: string };

const STAGES = [["planned", "Planned"], ["in_dev", "In development"], ["released", "Released"]] as const;
const STAGE_TONE: Record<string, "default" | "violet" | "green"> = { planned: "default", in_dev: "violet", released: "green" };
// What a build task ships as — drives the changelog grouping.
const CHANGE: Record<string, { label: string; tone: "accent" | "violet" | "green" | "amber" | "default"; icon: string }> = {
  feature:        { label: "New feature",    tone: "accent",  icon: "◆" },
  feature_update: { label: "Feature update", tone: "violet",  icon: "↑" },
  module_update:  { label: "Module update",  tone: "violet",  icon: "▢" },
  enhancement:    { label: "Enhancement",    tone: "green",   icon: "+" },
  bug_fix:        { label: "Bug fix",        tone: "amber",   icon: "✕" },
};
const CHANGE_ORDER = ["feature", "feature_update", "module_update", "enhancement", "bug_fix"];

export default function RoadmapView() {
  const supabase = createClient();
  const { matches } = useProductScope(); // scope releases to the active product line
  const [releases, setReleases] = useState<Release[]>([]);
  const [products, setProducts] = useState<Rec[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", version: "", summary: "", target_date: "", product_id: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data: rel }, { data: prods }, { data: w }] = await Promise.all([
      supabase.from("releases").select("id, name, version, summary, stage, target_date, product_id").order("target_date", { nullsFirst: false }).order("created_at"),
      supabase.from("product_records").select("id, name"),
      supabase.from("initiative_workstreams").select("id, title, stage, change_type, release_id").eq("area", "build").not("release_id", "is", null),
    ]);
    setReleases(rel ?? []); setProducts(prods ?? []); setTasks((w ?? []) as Task[]); setLoading(false);
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
  async function move(id: string, stage: string) {
    setError(null);
    try {
      await supabase.from("releases").update({ stage }).eq("id", id);
      // Marking a release shipped is a real event — fire any on_release workflows
      // (propose-only: they enqueue runs for a human to ratify in Agents).
      if (stage === "released") {
        const orgId = await getOrgId();
        const rel = releases.find((r) => r.id === id);
        if (orgId && rel) await fireWorkflows(supabase, orgId, "on_release", { label: rel.version ? `${rel.version} · ${rel.name}` : rel.name, releaseId: id });
      }
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update release."); }
  }
  async function remove(id: string) { setError(null); await supabase.from("releases").delete().eq("id", id); await load(); }

  const productName = (id: string | null) => products.find((p) => p.id === id)?.name ?? null;
  const tasksFor = (rid: string) => tasks.filter((t) => t.release_id === rid);

  return (
    <div>
      <PageBar actions={!creating ? <button className="btn btn-sm" onClick={() => setCreating(true)}>+ New release</button> : undefined} />
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

      {loading ? <div className="t-sub t-muted">Loading…</div> : releases.filter(matches).length === 0 && !creating ? (
        <div className="empty"><div className="t-body" style={{ fontWeight: 600, marginBottom: 6 }}>No releases yet</div><div className="t-sub">Plan what's coming — create a release, then tag its build tasks to it in Ship.</div></div>
      ) : STAGES.map(([stage, label]) => {
        const list = releases.filter((r) => r.stage === stage && matches(r));
        if (list.length === 0) return null;
        return (
          <Section key={stage} label={`${label} · ${list.length}`}>
            <div className="stack-3">
              {list.map((r) => {
                const rt = tasksFor(r.id);
                const doneN = rt.filter((t) => t.stage === "done").length;
                const groups = CHANGE_ORDER.map((ct) => [ct, rt.filter((t) => (t.change_type ?? "feature") === ct)] as const).filter(([, l]) => l.length > 0);
                return (
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
                    <div className="row gap-2" style={{ flexWrap: "wrap", marginBottom: rt.length ? 12 : 10 }}>
                      {productName(r.product_id) && <Chip tone="accent">{productName(r.product_id)}</Chip>}
                      {r.target_date && <Chip>🎯 {new Date(r.target_date).toLocaleDateString()}</Chip>}
                      <Chip tone={rt.length && doneN === rt.length ? "green" : "default"}>📦 {rt.length ? `${doneN}/${rt.length} shipped` : "no tasks tagged yet"}</Chip>
                    </div>

                    {/* changelog — completed (and pending) build work tied to this release */}
                    {groups.length > 0 && (
                      <div className="stack-3" style={{ marginBottom: 12, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                        {groups.map(([ct, l]) => {
                          const c = CHANGE[ct] ?? CHANGE.feature;
                          return (
                            <div key={ct}>
                              <div className="row gap-2" style={{ marginBottom: 4 }}><Chip tone={c.tone}>{c.icon} {c.label}</Chip></div>
                              <div className="stack-3" style={{ paddingLeft: 2 }}>
                                {l.map((t) => (
                                  <div key={t.id} className="row gap-2" style={{ fontSize: 13, alignItems: "baseline" }}>
                                    <span style={{ color: t.stage === "done" ? "var(--gn-text)" : "var(--tm)", fontWeight: 700, width: 14 }}>{t.stage === "done" ? "✓" : "○"}</span>
                                    <span style={{ color: t.stage === "done" ? "var(--tp)" : "var(--tm)" }}>{t.title}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div className="row gap-2">
                      {stage !== "planned" && <button className="btn btn-secondary btn-sm" onClick={() => move(r.id, stage === "released" ? "in_dev" : "planned")}>←</button>}
                      {stage !== "released" && <button className="btn btn-secondary btn-sm" onClick={() => move(r.id, stage === "planned" ? "in_dev" : "released")}>{stage === "planned" ? "Start dev →" : "Mark released →"}</button>}
                      <a className="btn btn-secondary btn-sm" href="/ship">Build in Ship →</a>
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        );
      })}
    </div>
  );
}
