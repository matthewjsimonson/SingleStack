"use client";

// Inline source management — used on Signals, Competitive (overall + per
// competitor), and Market pages, so you never have to leave for Settings.
// Add internal/external sources scoped to: org, a competitor, or a market lens,
// each with optional dynamic rules (keywords/filters) to get granular. Manual
// today; live connectors (MCP) flip status to connected later.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Chip, Modal } from "@/components/ui";
import { SOURCE_CATALOG, type SourceDef } from "@/lib/sources";

type Source = { id: string; label: string; icon: string; origin: string; kind: string; status: string; rules: string | null; competitor_id: string | null; market_lens: string | null };

type Scope = { competitorId?: string; marketLens?: string }; // empty = org-wide

export default function SourceManager({ scope = {}, title = "Sources" }: {
  scope?: Scope; title?: string;
}) {
  const supabase = createClient();
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // custom add
  const [custom, setCustom] = useState({ label: "", origin: "external", url: "", rules: "" });

  const load = useCallback(async () => {
    let q = supabase.from("sources").select("id, label, icon, origin, kind, status, rules, competitor_id, market_lens");
    if (scope.competitorId) q = q.eq("competitor_id", scope.competitorId);
    else if (scope.marketLens) q = q.eq("market_lens", scope.marketLens);
    else q = q.is("competitor_id", null).is("market_lens", null);
    const { data } = await q.order("created_at");
    setSources(data ?? []);
    setLoading(false);
  }, [supabase, scope.competitorId, scope.marketLens]);

  useEffect(() => { load(); }, [load]);

  async function addFromCatalog(def: SourceDef) {
    setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      const { error } = await supabase.from("sources").insert({
        org_id: orgId, label: def.label, icon: def.icon, origin: def.origin, kind: def.kind,
        status: def.live ? "connected" : "manual", competitor_id: scope.competitorId ?? null, market_lens: scope.marketLens ?? null,
      });
      if (error) throw error; await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not add source."); }
  }

  async function addCustom(e: React.FormEvent) {
    e.preventDefault(); if (!custom.label.trim()) return;
    setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      const { error } = await supabase.from("sources").insert({
        org_id: orgId, label: custom.label.trim(), icon: custom.origin === "internal" ? "📥" : "🌐",
        origin: custom.origin, kind: "manual", status: "manual",
        rules: custom.rules.trim() || null, config: custom.url.trim() ? { url: custom.url.trim() } : null,
        competitor_id: scope.competitorId ?? null, market_lens: scope.marketLens ?? null,
      });
      if (error) throw error;
      setCustom({ label: "", origin: "external", url: "", rules: "" }); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not add source."); }
  }

  async function remove(id: string) { setError(null); await supabase.from("sources").delete().eq("id", id); await load(); }
  async function setRules(id: string, rules: string) { setError(null); await supabase.from("sources").update({ rules }).eq("id", id); await load(); }

  const registered = new Set(sources.map((s) => s.kind));
  const internal = sources.filter((s) => s.origin === "internal");
  const external = sources.filter((s) => s.origin === "external");

  return (
    <>
      {/* Compact summary row — the page shows sources at a glance; setup is in a modal. */}
      <div className="card card-pad row-between" style={{ marginBottom: "var(--sp-5)", gap: 12 }}>
        <div className="row gap-2" style={{ flexWrap: "wrap", minWidth: 0 }}>
          <span className="t-label">{title}</span>
          {sources.length === 0 ? (
            <span className="t-sub t-muted" style={{ fontSize: 12.5 }}>None yet</span>
          ) : (
            sources.map((s) => <span key={s.id} className="chip">{s.icon} {s.label}</span>)
          )}
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => setOpen(true)} style={{ flexShrink: 0 }}>Manage sources</button>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={title}>
        {error && <div className="banner banner-error" style={{ marginBottom: 12 }}>{error}</div>}

        {/* connected list */}
        {loading ? <div className="t-sub t-muted">Loading…</div> : sources.length === 0 ? (
          <div className="t-sub t-muted" style={{ marginBottom: 14 }}>No sources here yet. Add internal & external sources below.</div>
        ) : (
          <div className="stack-3" style={{ marginBottom: 16 }}>
            {[["Internal", internal], ["External", external]].map(([label, list]) => (list as Source[]).length > 0 && (
              <div key={label as string}>
                <div className="t-label" style={{ marginBottom: 6 }}>{label as string}</div>
                <div className="stack-3">
                  {(list as Source[]).map((s) => (
                    <div key={s.id} className="card" style={{ padding: "10px 12px" }}>
                      <div className="row-between">
                        <div className="row gap-2"><span>{s.icon}</span><span style={{ fontSize: 13.5, fontWeight: 600 }}>{s.label}</span><Chip tone={s.status === "connected" ? "green" : "default"}>{s.status === "connected" ? "live" : "manual"}</Chip></div>
                        <button className="t-muted" onClick={() => remove(s.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15 }}>×</button>
                      </div>
                      <input className="input" defaultValue={s.rules ?? ""} placeholder="Dynamic rules — keywords / filters to get the right info"
                        onBlur={(e) => { if (e.target.value !== (s.rules ?? "")) setRules(s.id, e.target.value); }}
                        style={{ marginTop: 8, fontSize: 12.5 }} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* catalog quick-add */}
        <div className="t-label" style={{ marginBottom: 8 }}>Add a source</div>
        <div className="row gap-2" style={{ flexWrap: "wrap", marginBottom: 14 }}>
          {SOURCE_CATALOG.filter((d) => !registered.has(d.kind)).map((d) => (
            <button key={d.kind} className="btn btn-secondary btn-sm" onClick={() => addFromCatalog(d)} title={d.blurb}>
              {d.icon} {d.label}{d.live ? "" : " ·"}
            </button>
          ))}
        </div>

        {/* custom source (e.g. a competitor's site / YouTube / a SharePoint folder) */}
        <form onSubmit={addCustom} className="card" style={{ padding: 12, background: "var(--panel-2)" }}>
          <div className="t-label" style={{ marginBottom: 8 }}>Custom source</div>
          <div className="row gap-2" style={{ marginBottom: 8 }}>
            <input className="input" placeholder="Name (e.g. Competitor YouTube)" value={custom.label} onChange={(e) => setCustom({ ...custom, label: e.target.value })} style={{ flex: 1 }} />
            <select className="select" value={custom.origin} onChange={(e) => setCustom({ ...custom, origin: e.target.value })} style={{ width: 130 }}>
              <option value="external">External</option><option value="internal">Internal</option>
            </select>
          </div>
          <input className="input" placeholder="URL or location (optional)" value={custom.url} onChange={(e) => setCustom({ ...custom, url: e.target.value })} style={{ marginBottom: 8 }} />
          <input className="input" placeholder="Dynamic rules (optional) — what to pull / ignore" value={custom.rules} onChange={(e) => setCustom({ ...custom, rules: e.target.value })} style={{ marginBottom: 8 }} />
          <button className="btn btn-sm" type="submit">+ Add custom source</button>
        </form>
        <div className="t-sub t-muted" style={{ fontSize: 11.5, marginTop: 10 }}>Manual sources let you log here now; live connectors (MCP) pull automatically once connected.</div>
      </Modal>
    </>
  );
}
