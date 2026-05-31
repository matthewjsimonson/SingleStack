"use client";

// Connect-a-source — the in-product way to bring the world's signals in:
// G2, LinkedIn (posts + jobs), websites, YouTube, CRM, calls, and more, through
// ONE source-type-agnostic flow. Two mandates beyond "ingest more":
//   • Never drown the user — every source carries a focus + include/exclude
//     terms + a per-pull BUDGET, so it yields a focused trickle, not a firehose.
//   • Security is visible — each source shows exactly what it can access
//     (read-only scope) and how it authenticates; secrets never touch the DB.
// Manual today (register + log here); live connectors pull automatically when
// the connector runtime ships — no schema/UI change needed to flip them on.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Chip, Modal } from "@/components/ui";
import { SOURCE_CATALOG, type SourceDef } from "@/lib/sources";

type Source = {
  id: string; label: string; icon: string; origin: string; kind: string; status: string;
  rules: string | null; competitor_id: string | null; market_lens: string | null;
  focus: string | null; include_terms: string | null; exclude_terms: string | null;
  max_per_pull: number | null; cadence: string; auth_mode: string; access_scope: string | null;
  config: { url?: string } | null; last_pull_at: string | null; last_pull_count: number | null;
};

type Scope = { competitorId?: string; marketLens?: string };

const AUTH_LABEL: Record<string, string> = { none: "No login (public)", oauth: "Secure login (OAuth)", api_key: "API key", mcp: "MCP connection" };

export default function SourceManager({ scope = {}, title = "Sources" }: { scope?: Scope; title?: string }) {
  const supabase = createClient();
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // connect flow: pick a type, then configure it
  const [picked, setPicked] = useState<SourceDef | null>(null);
  const [cfg, setCfg] = useState({ label: "", url: "", focus: "" as "" | "product" | "gtm" | "both", include: "", exclude: "", maxPerPull: "", cadence: "manual" });

  const load = useCallback(async () => {
    let q = supabase.from("sources").select("id, label, icon, origin, kind, status, rules, competitor_id, market_lens, focus, include_terms, exclude_terms, max_per_pull, cadence, auth_mode, access_scope, config, last_pull_at, last_pull_count");
    if (scope.competitorId) q = q.eq("competitor_id", scope.competitorId);
    else if (scope.marketLens) q = q.eq("market_lens", scope.marketLens);
    else q = q.is("competitor_id", null).is("market_lens", null);
    const { data } = await q.order("created_at");
    setSources((data ?? []) as Source[]);
    setLoading(false);
  }, [supabase, scope.competitorId, scope.marketLens]);
  useEffect(() => { load(); }, [load]);

  function pick(def: SourceDef) {
    setPicked(def);
    setCfg({ label: def.label, url: "", focus: def.defaultFocus ?? "", include: "", exclude: "", maxPerPull: String(def.defaultMaxPerPull), cadence: "manual" });
  }

  async function connect() {
    if (!picked) return;
    setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      if (picked.needsUrl && !cfg.url.trim()) throw new Error("This source needs a URL or handle.");
      const max = parseInt(cfg.maxPerPull, 10);
      const { error } = await supabase.from("sources").insert({
        org_id: orgId, label: cfg.label.trim() || picked.label, icon: picked.icon,
        origin: picked.origin, kind: picked.kind,
        status: picked.live ? "connected" : "manual",
        auth_mode: picked.authMode, access_scope: picked.accessScope,
        focus: cfg.focus || null, include_terms: cfg.include.trim() || null, exclude_terms: cfg.exclude.trim() || null,
        max_per_pull: isNaN(max) ? picked.defaultMaxPerPull : Math.min(100, Math.max(1, max)),
        cadence: cfg.cadence,
        config: cfg.url.trim() ? { url: cfg.url.trim() } : null,   // never secrets — only the public locator
        competitor_id: scope.competitorId ?? null, market_lens: scope.marketLens ?? null,
      });
      if (error) throw error;
      setPicked(null); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not connect source."); }
  }

  async function remove(id: string) { setError(null); await supabase.from("sources").delete().eq("id", id); await load(); }

  const internal = sources.filter((s) => s.origin === "internal");
  const external = sources.filter((s) => s.origin === "external");

  return (
    <>
      <div className="card card-pad row-between" style={{ marginBottom: "var(--sp-5)", gap: 12 }}>
        <div className="row gap-2" style={{ flexWrap: "wrap", minWidth: 0 }}>
          <span className="t-label">{title}</span>
          {sources.length === 0 ? <span className="t-sub t-muted" style={{ fontSize: 12.5 }}>None yet</span>
            : sources.map((s) => <span key={s.id} className="chip">{s.icon} {s.label}</span>)}
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => setOpen(true)} style={{ flexShrink: 0 }}>Connect sources</button>
      </div>

      <Modal open={open} onClose={() => { setOpen(false); setPicked(null); }} title={picked ? `Connect ${picked.label}` : "Connect a source"}>
        {error && <div className="banner banner-error" style={{ marginBottom: 12 }}>{error}</div>}

        {/* STEP 2 — configure the picked source (tailoring + budget + security) */}
        {picked ? (
          <div style={{ display: "grid", gap: 10 }}>
            <div className="card" style={{ padding: "10px 12px", background: "var(--panel-2)" }}>
              <div className="t-sub" style={{ fontSize: 12.5 }}>{picked.icon} {picked.blurb}</div>
              <div className="t-mono-xs" style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span>🔒 {AUTH_LABEL[picked.authMode]}</span>
                <span>· {picked.accessScope}</span>
              </div>
            </div>

            <label className="field"><span className="t-label">Name</span>
              <input className="input" value={cfg.label} onChange={(e) => setCfg({ ...cfg, label: e.target.value })} /></label>

            {picked.needsUrl && (
              <label className="field"><span className="t-label">URL / handle</span>
                <input className="input" value={cfg.url} placeholder={picked.urlHint} onChange={(e) => setCfg({ ...cfg, url: e.target.value })} /></label>
            )}

            {/* Tailoring — keep it on-target, control bias */}
            <div className="t-label" style={{ marginTop: 4 }}>Tailoring — keep it focused</div>
            <div className="row gap-2">
              <label className="field" style={{ flex: 1 }}><span className="t-label">Feeds</span>
                <select className="select" value={cfg.focus} onChange={(e) => setCfg({ ...cfg, focus: e.target.value as typeof cfg.focus })}>
                  <option value="">Either lens</option><option value="product">Product</option><option value="gtm">GTM</option><option value="both">Both</option>
                </select></label>
              <label className="field" style={{ flex: 1 }}><span className="t-label">Pull cadence</span>
                <select className="select" value={cfg.cadence} onChange={(e) => setCfg({ ...cfg, cadence: e.target.value })}>
                  <option value="manual">Manual</option><option value="daily">Daily</option><option value="weekly">Weekly</option>
                </select></label>
            </div>
            <label className="field"><span className="t-label">Only pull (include)</span>
              <input className="input" value={cfg.include} placeholder="e.g. pricing, positioning, AI features" onChange={(e) => setCfg({ ...cfg, include: e.target.value })} /></label>
            <label className="field"><span className="t-label">Ignore (exclude — controls noise & bias)</span>
              <input className="input" value={cfg.exclude} placeholder="e.g. job spam, unrelated products" onChange={(e) => setCfg({ ...cfg, exclude: e.target.value })} /></label>
            <label className="field"><span className="t-label">Max new signals per pull (the budget — so it never floods you)</span>
              <input className="input" type="number" min={1} max={100} value={cfg.maxPerPull} onChange={(e) => setCfg({ ...cfg, maxPerPull: e.target.value })} /></label>

            <div className="row gap-2" style={{ marginTop: 4 }}>
              <button className="btn btn-sm" onClick={connect}>{picked.live ? "Connect" : "Add source"}</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setPicked(null)}>Back</button>
            </div>
            {!picked.live && <div className="t-sub t-muted" style={{ fontSize: 11.5 }}>Manual for now — you can log signals against it today; it pulls automatically once live connectors ship.</div>}
          </div>
        ) : (
          // STEP 1 — connected list + the type picker
          <>
            {loading ? <div className="t-sub t-muted">Loading…</div> : sources.length > 0 && (
              <div className="stack-3" style={{ marginBottom: 16 }}>
                {[["Internal", internal], ["External", external]].map(([label, list]) => (list as Source[]).length > 0 && (
                  <div key={label as string}>
                    <div className="t-label" style={{ marginBottom: 6 }}>{label as string}</div>
                    <div className="stack-3">
                      {(list as Source[]).map((s) => (
                        <div key={s.id} className="card" style={{ padding: "10px 12px" }}>
                          <div className="row-between">
                            <div className="row gap-2" style={{ flexWrap: "wrap" }}>
                              <span>{s.icon}</span><span style={{ fontSize: 13.5, fontWeight: 600 }}>{s.label}</span>
                              <Chip tone={s.status === "connected" ? "green" : "default"}>{s.status === "connected" ? "live" : "manual"}</Chip>
                              {s.focus && <Chip tone={s.focus === "gtm" ? "violet" : "accent"}>{s.focus}</Chip>}
                            </div>
                            <button className="t-muted" onClick={() => remove(s.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15 }}>×</button>
                          </div>
                          <div className="t-mono-xs" style={{ marginTop: 5, color: "var(--tm)" }}>
                            🔒 {s.access_scope ?? AUTH_LABEL[s.auth_mode] ?? "read-only"}
                            {s.max_per_pull ? ` · ≤${s.max_per_pull}/pull` : ""}{s.cadence !== "manual" ? ` · ${s.cadence}` : ""}
                            {s.last_pull_at ? ` · last pull ${new Date(s.last_pull_at).toLocaleDateString()} (${s.last_pull_count ?? 0})` : ""}
                          </div>
                          {(s.include_terms || s.exclude_terms) && (
                            <div className="t-sub t-muted" style={{ fontSize: 11.5, marginTop: 3 }}>
                              {s.include_terms ? `only: ${s.include_terms}` : ""}{s.include_terms && s.exclude_terms ? " · " : ""}{s.exclude_terms ? `ignore: ${s.exclude_terms}` : ""}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="t-label" style={{ marginBottom: 8 }}>Connect a new source</div>
            <div className="row gap-2" style={{ flexWrap: "wrap" }}>
              {SOURCE_CATALOG.filter((d) => d.kind !== "manual").map((d) => (
                <button key={d.kind} className="btn btn-secondary btn-sm" onClick={() => pick(d)} title={`${d.blurb}\n🔒 ${d.accessScope}`}>
                  {d.icon} {d.label}
                </button>
              ))}
            </div>
            <div className="t-sub t-muted" style={{ fontSize: 11.5, marginTop: 10 }}>
              Every source is read-only and shows exactly what it can access. You set a per-pull budget and what to ignore, so signals stay a focused trickle — never a firehose.
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
