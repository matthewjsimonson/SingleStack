"use client";

// Shared board for Build (roadmap/ship) and Go-to-market (content/enablement)
// lanes. A 3-column board (Backlog / Active / Done); create initiatives, move
// stages, tie to a product/GTM record, and map the signals that motivate them
// (intel → work). Client-fetched (session-carrying) so RLS scopes to the org.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { PageHeader, Section, Chip, Banner } from "@/components/ui";

type Initiative = { id: string; title: string; description: string | null; stage: string; priority: string | null; product_id: string | null; gtm_record_id: string | null; target_date: string | null };
type Rec = { id: string; name: string };
type Signal = { id: string; title: string };

const STAGES = [["backlog", "Backlog"], ["active", "Active"], ["done", "Done"]] as const;
const PRIORITY_TONE: Record<string, "default" | "amber" | "violet"> = { low: "default", medium: "violet", high: "amber" };

export default function InitiativeBoard({ lane, title, meta, recordType }: {
  lane: string; title: string; meta: string; recordType: "product" | "gtm";
}) {
  const supabase = createClient();
  const [items, setItems] = useState<Initiative[]>([]);
  const [products, setProducts] = useState<Rec[]>([]);
  const [gtm, setGtm] = useState<Rec[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [links, setLinks] = useState<Record<string, string[]>>({}); // initiative_id -> signal_ids
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", priority: "medium", recordId: "", signalIds: [] as string[] });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data: its }, { data: prods }, { data: gtms }, { data: sigs }, { data: isl }] = await Promise.all([
      supabase.from("initiatives").select("id, title, description, stage, priority, product_id, gtm_record_id, target_date").eq("lane", lane).order("position").order("created_at"),
      supabase.from("product_records").select("id, name"),
      supabase.from("gtm_records").select("id, name"),
      supabase.from("signals").select("id, title").order("observed_at", { ascending: false, nullsFirst: false }).limit(40),
      supabase.from("initiative_signals").select("initiative_id, signal_id"),
    ]);
    setItems(its ?? []); setProducts(prods ?? []); setGtm(gtms ?? []); setSignals(sigs ?? []);
    const l: Record<string, string[]> = {};
    (isl ?? []).forEach((x) => { (l[x.initiative_id] ??= []).push(x.signal_id); });
    setLinks(l);
    setLoading(false);
  }, [supabase, lane]);
  useEffect(() => { load(); }, [load]);

  const records = recordType === "product" ? products : gtm;
  const recName = (it: Initiative) => {
    const id = recordType === "product" ? it.product_id : it.gtm_record_id;
    return records.find((r) => r.id === id)?.name ?? null;
  };

  async function create(e: React.FormEvent) {
    e.preventDefault(); if (!form.title.trim()) return;
    setBusy(true); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      const row: Record<string, unknown> = { org_id: orgId, lane, title: form.title.trim(), description: form.description.trim() || null, priority: form.priority, stage: "backlog" };
      if (form.recordId) row[recordType === "product" ? "product_id" : "gtm_record_id"] = form.recordId;
      const { data, error } = await supabase.from("initiatives").insert(row).select("id").single();
      if (error) throw error;
      if (form.signalIds.length) {
        await supabase.from("initiative_signals").insert(form.signalIds.map((sid) => ({ org_id: orgId, initiative_id: data.id, signal_id: sid })));
      }
      setCreating(false); setForm({ title: "", description: "", priority: "medium", recordId: "", signalIds: [] });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create."); }
    finally { setBusy(false); }
  }

  async function move(id: string, stage: string) { setError(null); await supabase.from("initiatives").update({ stage }).eq("id", id); await load(); }
  async function remove(id: string) { setError(null); await supabase.from("initiatives").delete().eq("id", id); await load(); }

  return (
    <div>
      <PageHeader title={title} meta={meta} actions={!creating ? <button className="btn" onClick={() => setCreating(true)}>+ New initiative</button> : undefined} />
      <Banner>{error}</Banner>

      {creating && (
        <form onSubmit={create} className="card card-pad" style={{ marginBottom: "var(--sp-6)" }}>
          <label className="field"><span className="t-label">Title</span><input className="input" autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Ship usage-based pricing" /></label>
          <label className="field"><span className="t-label">Description</span><textarea className="textarea" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-3)" }}>
            <label className="field"><span className="t-label">Priority</span>
              <select className="select" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
            <label className="field"><span className="t-label">{recordType === "product" ? "Product" : "GTM record"}</span>
              <select className="select" value={form.recordId} onChange={(e) => setForm({ ...form, recordId: e.target.value })}><option value="">— none —</option>{records.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
          </div>
          {signals.length > 0 && (
            <div className="field">
              <span className="t-label">Driven by signals (optional)</span>
              <div className="row gap-2" style={{ flexWrap: "wrap", marginTop: 6 }}>
                {signals.slice(0, 12).map((s) => {
                  const on = form.signalIds.includes(s.id);
                  return <button type="button" key={s.id} className="chip" onClick={() => setForm({ ...form, signalIds: on ? form.signalIds.filter((x) => x !== s.id) : [...form.signalIds, s.id] })} style={{ cursor: "pointer", background: on ? "var(--ac)" : "var(--fill)", color: on ? "#fff" : "var(--ts)" }}>{s.title.slice(0, 40)}</button>;
                })}
              </div>
            </div>
          )}
          <div className="row gap-2"><button className="btn" type="submit" disabled={busy}>{busy ? "Creating…" : "Create"}</button><button className="btn btn-secondary" type="button" onClick={() => setCreating(false)}>Cancel</button></div>
        </form>
      )}

      {loading ? <div className="t-sub t-muted">Loading…</div> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--sp-4)" }}>
          {STAGES.map(([stage, label]) => {
            const col = items.filter((i) => i.stage === stage);
            return (
              <div key={stage}>
                <div className="section-head"><span className="t-label">{label}</span><span className="chip">{col.length}</span></div>
                <div className="stack-3">
                  {col.length === 0 && <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Empty</div>}
                  {col.map((it) => (
                    <div key={it.id} className="card card-pad">
                      <div className="row-between" style={{ alignItems: "flex-start", marginBottom: 6 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 620, lineHeight: 1.35 }}>{it.title}</span>
                        <button className="t-muted" onClick={() => remove(it.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15, flexShrink: 0 }}>×</button>
                      </div>
                      {it.description && <div className="t-sub t-muted" style={{ fontSize: 12, lineHeight: 1.45, marginBottom: 8 }}>{it.description}</div>}
                      <div className="row gap-2" style={{ flexWrap: "wrap", marginBottom: 8 }}>
                        {it.priority && <Chip tone={PRIORITY_TONE[it.priority] ?? "default"}>{it.priority}</Chip>}
                        {recName(it) && <Chip tone={recordType === "product" ? "accent" : "violet"}>{recName(it)}</Chip>}
                        {(links[it.id]?.length ?? 0) > 0 && <Chip>📡 {links[it.id].length}</Chip>}
                      </div>
                      <div className="row gap-2">
                        {stage !== "backlog" && <button className="btn btn-secondary btn-sm" onClick={() => move(it.id, stage === "done" ? "active" : "backlog")}>←</button>}
                        {stage !== "done" && <button className="btn btn-secondary btn-sm" onClick={() => move(it.id, stage === "backlog" ? "active" : "done")}>{stage === "backlog" ? "Start →" : "Done →"}</button>}
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
