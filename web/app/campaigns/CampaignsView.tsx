"use client";

// Campaigns — coordinated go-to-market pushes, grouped by status (Planning →
// Active → Complete). Each ties to a GTM record, with objective and channels.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { PageHeader, Section, Chip, Banner } from "@/components/ui";

type Campaign = { id: string; name: string; objective: string | null; status: string; channels: string | null; gtm_record_id: string | null; start_date: string | null; end_date: string | null };
type Rec = { id: string; name: string };

const STAGES = [["planning", "Planning"], ["active", "Active"], ["complete", "Complete"]] as const;
const TONE: Record<string, "default" | "violet" | "green"> = { planning: "default", active: "violet", complete: "green" };

export default function CampaignsView() {
  const supabase = createClient();
  const [items, setItems] = useState<Campaign[]>([]);
  const [gtm, setGtm] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", objective: "", channels: "", gtm_record_id: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data: cs }, { data: gtms }] = await Promise.all([
      supabase.from("campaigns").select("id, name, objective, status, channels, gtm_record_id, start_date, end_date").order("created_at", { ascending: false }),
      supabase.from("gtm_records").select("id, name"),
    ]);
    setItems(cs ?? []); setGtm(gtms ?? []); setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault(); if (!form.name.trim()) return;
    setBusy(true); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      const { error } = await supabase.from("campaigns").insert({ org_id: orgId, name: form.name.trim(), objective: form.objective.trim() || null, channels: form.channels.trim() || null, gtm_record_id: form.gtm_record_id || null, status: "planning" });
      if (error) throw error;
      setCreating(false); setForm({ name: "", objective: "", channels: "", gtm_record_id: "" }); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create."); }
    finally { setBusy(false); }
  }
  async function move(id: string, status: string) { setError(null); await supabase.from("campaigns").update({ status }).eq("id", id); await load(); }
  async function remove(id: string) { setError(null); await supabase.from("campaigns").delete().eq("id", id); await load(); }

  const gtmName = (id: string | null) => gtm.find((g) => g.id === id)?.name ?? null;

  return (
    <div>
      <PageHeader title="Campaigns" meta="Coordinated go-to-market pushes — tied to GTM records, powered by your content." actions={!creating ? <button className="btn" onClick={() => setCreating(true)}>+ New campaign</button> : undefined} />
      <Banner>{error}</Banner>

      {creating && (
        <form onSubmit={create} className="card card-pad" style={{ marginBottom: "var(--sp-6)" }}>
          <label className="field"><span className="t-label">Name</span><input className="input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Q3 explainable-AI push" /></label>
          <label className="field"><span className="t-label">Objective</span><textarea className="textarea" rows={2} value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })} /></label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-3)" }}>
            <label className="field"><span className="t-label">Channels</span><input className="input" value={form.channels} onChange={(e) => setForm({ ...form, channels: e.target.value })} placeholder="LinkedIn, email, webinar" /></label>
            <label className="field"><span className="t-label">GTM record</span><select className="select" value={form.gtm_record_id} onChange={(e) => setForm({ ...form, gtm_record_id: e.target.value })}><option value="">— none —</option>{gtm.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
          </div>
          <div className="row gap-2"><button className="btn" type="submit" disabled={busy}>{busy ? "Creating…" : "Create"}</button><button className="btn btn-secondary" type="button" onClick={() => setCreating(false)}>Cancel</button></div>
        </form>
      )}

      {loading ? <div className="t-sub t-muted">Loading…</div> : items.length === 0 && !creating ? (
        <div className="empty"><div className="t-body" style={{ fontWeight: 600, marginBottom: 6 }}>No campaigns yet</div><div className="t-sub">Plan a coordinated push tied to a GTM record.</div></div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--sp-4)" }}>
          {STAGES.map(([stage, label]) => {
            const col = items.filter((c) => c.status === stage);
            return (
              <div key={stage}>
                <div className="section-head"><span className="t-label">{label}</span><span className="chip">{col.length}</span></div>
                <div className="stack-3">
                  {col.length === 0 && <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Empty</div>}
                  {col.map((c) => (
                    <div key={c.id} className="card card-pad">
                      <div className="row-between" style={{ alignItems: "flex-start", marginBottom: 6 }}><span style={{ fontSize: 14, fontWeight: 620 }}>{c.name}</span><button className="t-muted" onClick={() => remove(c.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15 }}>×</button></div>
                      {c.objective && <div className="t-sub t-muted" style={{ fontSize: 12, lineHeight: 1.45, marginBottom: 8 }}>{c.objective}</div>}
                      <div className="row gap-2" style={{ flexWrap: "wrap", marginBottom: 8 }}>
                        {gtmName(c.gtm_record_id) && <Chip tone="violet">{gtmName(c.gtm_record_id)}</Chip>}
                        {c.channels && <Chip>{c.channels}</Chip>}
                      </div>
                      <div className="row gap-2">
                        {stage !== "planning" && <button className="btn btn-secondary btn-sm" onClick={() => move(c.id, stage === "complete" ? "active" : "planning")}>←</button>}
                        {stage !== "complete" && <button className="btn btn-secondary btn-sm" onClick={() => move(c.id, stage === "planning" ? "active" : "complete")}>{stage === "planning" ? "Launch →" : "Complete →"}</button>}
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
