"use client";

// Assign — the last step. Route produced GTM items (initiative_workstreams,
// area='gtm') to CAMPAIGNS, split by campaign_kind: External (pipeline) vs
// Internal (GTM org). Assigning sets workstreams.campaign_id. New campaigns can
// be spun up inline with a name + kind.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Chip, Banner, Section, Empty } from "@/components/ui";
import { PLAYBOOK_BY_KEY } from "@/lib/gtmPlaybooks";

type Item = { id: string; title: string; stage: string; content_type: string | null; campaign_id: string | null };
type Campaign = { id: string; name: string; campaign_kind: string | null; status: string };

const KINDS: { id: "external" | "internal"; label: string; blurb: string }[] = [
  { id: "external", label: "External · Pipeline", blurb: "Demand pushes that drive pipeline." },
  { id: "internal", label: "Internal · GTM org", blurb: "Field enablement and internal readiness." },
];
const STAGE_TONE: Record<string, "default" | "violet" | "green"> = { backlog: "default", active: "violet", done: "green" };

export default function AssignBoard() {
  const supabase = createClient();
  const [items, setItems] = useState<Item[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<{ name: string; kind: "external" | "internal" }>({ name: "", kind: "external" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data: w }, { data: c }] = await Promise.all([
      supabase.from("initiative_workstreams").select("id, title, stage, content_type, campaign_id").eq("area", "gtm").order("created_at", { ascending: false }),
      supabase.from("campaigns").select("id, name, campaign_kind, status").order("created_at", { ascending: false }),
    ]);
    setItems((w ?? []) as Item[]); setCampaigns((c ?? []) as Campaign[]); setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  async function assign(itemId: string, campaignId: string | null) {
    setError(null);
    const { error } = await supabase.from("initiative_workstreams").update({ campaign_id: campaignId }).eq("id", itemId);
    if (error) { setError(error.message); return; }
    await load();
  }

  async function createCampaign(e: React.FormEvent) {
    e.preventDefault(); if (!form.name.trim()) return;
    setBusy(true); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      const { error } = await supabase.from("campaigns").insert({ org_id: orgId, name: form.name.trim(), campaign_kind: form.kind, status: "planning" });
      if (error) throw error;
      setCreating(false); setForm({ name: "", kind: "external" }); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create the campaign."); }
    finally { setBusy(false); }
  }

  const typeLabel = (ct: string | null) => (ct && PLAYBOOK_BY_KEY[ct]?.name) || ct || "Item";
  const unassigned = items.filter((i) => !i.campaign_id);
  const itemsFor = (cid: string) => items.filter((i) => i.campaign_id === cid);

  return (
    <div>
      <Banner>{error}</Banner>

      <div className="row-between" style={{ marginBottom: "var(--sp-4)", alignItems: "center" }}>
        <span className="t-label">Route items to campaigns</span>
        {!creating && <button className="btn btn-sm" onClick={() => setCreating(true)}>+ New campaign</button>}
      </div>

      {creating && (
        <form onSubmit={createCampaign} className="card card-pad" style={{ marginBottom: "var(--sp-5)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "var(--sp-3)" }}>
            <label className="field"><span className="t-label">Name</span><input className="input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Q3 launch push" /></label>
            <label className="field"><span className="t-label">Kind</span>
              <select className="select" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as "external" | "internal" })}>
                <option value="external">External · Pipeline</option>
                <option value="internal">Internal · GTM org</option>
              </select>
            </label>
          </div>
          <div className="row gap-2"><button className="btn" type="submit" disabled={busy}>{busy ? "Creating…" : "Create"}</button><button className="btn btn-secondary" type="button" onClick={() => setCreating(false)}>Cancel</button></div>
        </form>
      )}

      {loading ? <div className="t-sub t-muted">Loading…</div> : (
        <>
          <Section label={`Unassigned · ${unassigned.length}`}>
            {unassigned.length === 0 ? (
              <Empty title="Everything is routed" hint="Produce items in Tailor, then assign them to a campaign here." />
            ) : (
              <div className="stack-3">
                {unassigned.map((it) => (
                  <div key={it.id} className="card card-pad row-between" style={{ alignItems: "center", gap: 12 }}>
                    <div className="row gap-2" style={{ alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600 }}>{it.title}</span>
                      <Chip>{typeLabel(it.content_type)}</Chip>
                      <Chip tone={STAGE_TONE[it.stage] ?? "default"}>{it.stage}</Chip>
                    </div>
                    <select className="select" style={{ maxWidth: 240 }} value="" onChange={(e) => e.target.value && assign(it.id, e.target.value)}>
                      <option value="">Assign to…</option>
                      {KINDS.map((k) => {
                        const opts = campaigns.filter((c) => (c.campaign_kind ?? "external") === k.id);
                        if (opts.length === 0) return null;
                        return <optgroup key={k.id} label={k.label}>{opts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>;
                      })}
                    </select>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-4)" }}>
            {KINDS.map((k) => {
              const cols = campaigns.filter((c) => (c.campaign_kind ?? "external") === k.id);
              return (
                <div key={k.id}>
                  <Section label={k.label}>
                    <div className="t-sub t-muted" style={{ fontSize: 12, marginBottom: 8 }}>{k.blurb}</div>
                    {cols.length === 0 ? (
                      <Empty title="No campaigns" hint={`Create a ${k.id} campaign to route items into it.`} />
                    ) : (
                      <div className="stack-3">
                        {cols.map((c) => {
                          const assigned = itemsFor(c.id);
                          return (
                            <div key={c.id} className="card card-pad">
                              <div className="row-between" style={{ alignItems: "center", marginBottom: assigned.length ? 10 : 0 }}>
                                <span style={{ fontSize: 14, fontWeight: 640 }}>{c.name}</span>
                                <Chip>{c.status}</Chip>
                              </div>
                              {assigned.length === 0 ? (
                                <div className="t-sub t-muted" style={{ fontSize: 12 }}>No items yet.</div>
                              ) : (
                                <div className="stack-3">
                                  {assigned.map((it) => (
                                    <div key={it.id} className="row-between" style={{ alignItems: "center", gap: 8, padding: "6px 0", borderTop: "1px solid var(--border)" }}>
                                      <div className="row gap-2" style={{ alignItems: "center", flexWrap: "wrap" }}>
                                        <span className="t-sub" style={{ fontSize: 13 }}>{it.title}</span>
                                        <Chip tone={STAGE_TONE[it.stage] ?? "default"}>{it.stage}</Chip>
                                      </div>
                                      <button className="btn btn-secondary btn-sm" onClick={() => assign(it.id, null)}>Unassign</button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </Section>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
