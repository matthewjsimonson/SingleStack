"use client";

// Connect-a-source — the in-product way to bring the world's signals in:
// G2, LinkedIn (posts + jobs), websites, YouTube, CRM, calls, and more, through
// ONE source-type-agnostic flow. Two mandates beyond "ingest more":
//   • Never drown the user — every source carries a focus + include/exclude
//     terms + a per-pull BUDGET, so it yields a focused trickle, not a firehose.
//   • Security is visible — each source shows exactly what it can access
//     (read-only scope) and how it authenticates; secrets never touch the DB.
// Live kinds (website, youtube, web_search, mcp, linkedin, press, reviews,
// social, github) pull for real — now and on cadence; the rest register here
// and light up when their credential connector lands.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAgentRun, AgentStepList } from "@/components/AgentProgress";
import MonitoringStatus from "@/components/MonitoringStatus";
import { getOrgId } from "@/lib/org";
import { Chip, Modal } from "@/components/ui";
import { SOURCE_CATALOG, type SourceDef } from "@/lib/sources";

type Source = {
  id: string; label: string; icon: string; origin: string; kind: string; status: string;
  rules: string | null; competitor_id: string | null; market_lens: string | null;
  focus: string | null; include_terms: string | null; exclude_terms: string | null;
  max_per_pull: number | null; cadence: string; auth_mode: string; access_scope: string | null;
  config: { url?: string } | null; last_pull_at: string | null; last_pull_count: number | null;
  targets: { type?: string; ref: string; label?: string }[] | null; guidance: string | null;
};

const LIVE_PULL_KINDS = new Set(["website", "youtube", "web_search", "mcp"]); // run for real today (mcp pulls via its connection)

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
  const [cfg, setCfg] = useState({ label: "", url: "", focus: "" as "" | "product" | "gtm" | "both", include: "", exclude: "", maxPerPull: "", cadence: "manual", targets: "", guidance: "", mcpUrl: "", mcpToken: "", mcpOrigin: "external" as "internal" | "external" });
  // per-source pull state: id -> running | result message
  const [pulling, setPulling] = useState<Record<string, boolean>>({});
  // The brain at work during a pull: the pipeline stages walk while the runner
  // fetches→screens→distills→gates, and the result shows the REAL numbers.
  const pullRun = useAgentRun("pullSource");
  const [pullingId, setPullingId] = useState<string | null>(null);
  const [pullMsg, setPullMsg] = useState<Record<string, string>>({});
  // Source Recipe Builder — describe a signal in plain English, Claude drafts it.
  const [describe, setDescribe] = useState("");
  const [building, setBuilding] = useState(false);
  const [recipeNote, setRecipeNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    let q = supabase.from("sources").select("id, label, icon, origin, kind, status, rules, competitor_id, market_lens, focus, include_terms, exclude_terms, max_per_pull, cadence, auth_mode, access_scope, config, last_pull_at, last_pull_count, targets, guidance");
    if (scope.competitorId) q = q.eq("competitor_id", scope.competitorId);
    else if (scope.marketLens) q = q.eq("market_lens", scope.marketLens);
    else q = q.is("competitor_id", null).is("market_lens", null);
    const { data } = await q.order("created_at");
    setSources((data ?? []) as Source[]);
    setLoading(false);
  }, [supabase, scope.competitorId, scope.marketLens]);
  useEffect(() => { load(); }, [load]);

  function pick(def: SourceDef) {
    setPicked(def); setRecipeNote(null);
    setCfg({ label: def.label, url: "", focus: def.defaultFocus ?? "", include: "", exclude: "", maxPerPull: String(def.defaultMaxPerPull), cadence: "manual", targets: "", guidance: "", mcpUrl: "", mcpToken: "", mcpOrigin: def.origin });
  }

  // Parse the "what to look at" textarea — one URL/ref per line — into the
  // structured pointing-context array the runner consumes.
  function parseTargets(raw: string): { type: string; ref: string }[] {
    return raw.split("\n").map((l) => l.trim()).filter(Boolean).map((ref) => ({ type: "url", ref }));
  }

  // Source Recipe Builder — turn a plain-English description into a pre-filled
  // connect form. Claude picks the kind + drafts targets/guidance/budget; the
  // user reviews and confirms. They never touch config syntax (or build a server).
  async function buildRecipe() {
    if (describe.trim().length < 4) return;
    setBuilding(true); setError(null); setRecipeNote(null);
    try {
      const { data, error } = await supabase.functions.invoke("source-recipe", { body: { description: describe.trim() } });
      if (error) throw new Error((data as { error?: string })?.error || error.message);
      const d = data as { recipe: { kind: string; label: string; url: string | null; targets: { ref: string }[]; guidance: string; include_terms: string; exclude_terms: string; focus: "product" | "gtm" | "both"; cadence: string; max_per_pull: number }; rationale: string; runs_now: boolean; followup?: string | null };
      const def = SOURCE_CATALOG.find((s) => s.kind === d.recipe.kind) ?? SOURCE_CATALOG[0];
      setPicked(def);
      setCfg({
        label: d.recipe.label || def.label, url: d.recipe.url ?? "", focus: d.recipe.focus ?? def.defaultFocus ?? "",
        include: d.recipe.include_terms ?? "", exclude: d.recipe.exclude_terms ?? "",
        maxPerPull: String(d.recipe.max_per_pull ?? def.defaultMaxPerPull), cadence: d.recipe.cadence ?? "manual",
        targets: (d.recipe.targets ?? []).map((t) => t.ref).join("\n"), guidance: d.recipe.guidance ?? "",
        mcpUrl: "", mcpToken: "", mcpOrigin: def.origin,
      });
      setRecipeNote(`${d.rationale}${d.followup ? ` — ${d.followup}` : d.runs_now ? " · pulls today" : " · pulls once its connector lands"}`);
      setDescribe("");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not build a recipe."); }
    finally { setBuilding(false); }
  }

  // Pull now — invoke the connector runner for a live-kind source, show result.
  async function pullNow(s: Source) {
    setPulling((p) => ({ ...p, [s.id]: true })); setPullingId(s.id);
    setPullMsg((m) => ({ ...m, [s.id]: "" }));
    try {
      await pullRun.go(async () => {
        const { data, error } = await supabase.functions.invoke("connector-runner", { body: { source_id: s.id } });
        if (error) throw new Error((data as { error?: string })?.error || error.message);
        const d = data as { created: number; fetched: number; dropped: number; quarantined?: number; floor?: number };
        // The pipeline, with its real numbers — exactly what happened to the bytes.
        setPullMsg((m) => ({ ...m, [s.id]: [
          `fetched ${d.fetched} doc${d.fetched === 1 ? "" : "s"}`,
          d.quarantined ? `⚠ ${d.quarantined} quarantined (injection screen)` : "screened clean",
          `${(d.created ?? 0) + (d.dropped ?? 0)} candidates distilled`,
          d.dropped ? `${d.dropped} dropped below ${Math.round((d.floor ?? 0.55) * 100)}% relevance` : null,
          `→ ${d.created} signal${d.created === 1 ? "" : "s"} landed, tagged & feeding synthesis`,
        ].filter(Boolean).join(" · ") }));
      });
      await load();
    } catch (e) {
      setPullMsg((m) => ({ ...m, [s.id]: e instanceof Error ? e.message : "Pull failed." }));
    } finally { setPulling((p) => ({ ...p, [s.id]: false })); setPullingId(null); }
  }

  // Pull control: cadence editable in place; pause stops scheduled pulls
  // without losing the source (the scheduler only pulls status='connected').
  async function setCadence(s: Source, cadence: string) {
    setError(null);
    const { error } = await supabase.from("sources").update({ cadence }).eq("id", s.id);
    if (error) setError(error.message); else await load();
  }
  async function togglePause(s: Source) {
    setError(null);
    const next = s.status === "paused" ? "connected" : "paused";
    const { error } = await supabase.from("sources").update({ status: next }).eq("id", s.id);
    if (error) setError(error.message); else await load();
  }

  async function connect() {
    if (!picked) return;
    setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      if (picked.needsUrl && !cfg.url.trim()) throw new Error("This source needs a URL or handle.");
      const max = parseInt(cfg.maxPerPull, 10);
      // MCP sources need a connection (server URL + a vault-stored token) the
      // runner reaches. Create it first, store the secret via the org-checked
      // RPC (never in config), then attach the source to it.
      let connectionId: string | null = null;
      if (picked.authMode === "mcp") {
        if (!cfg.mcpUrl.trim()) throw new Error("An MCP source needs the server URL.");
        const { data: conn, error: connErr } = await supabase.from("connections").insert({
          org_id: orgId, agent_id: null, kind: "mcp", label: cfg.label.trim() || picked.label,
          mcp_url: cfg.mcpUrl.trim(), status: "connected",
          targets: parseTargets(cfg.targets), guidance: cfg.guidance.trim() || null,
        }).select("id").single();
        if (connErr || !conn) throw connErr ?? new Error("Could not create the MCP connection.");
        connectionId = conn.id;
        if (cfg.mcpToken.trim()) {
          const { error: secErr } = await supabase.rpc("set_connection_secret", { p_connection: conn.id, p_token: cfg.mcpToken.trim() });
          if (secErr) { await supabase.from("connections").delete().eq("id", conn.id); throw secErr; }
        }
      }
      const origin = picked.authMode === "mcp" ? cfg.mcpOrigin : picked.origin;
      const { error } = await supabase.from("sources").insert({
        org_id: orgId, label: cfg.label.trim() || picked.label, icon: picked.icon,
        origin, kind: picked.kind,
        status: picked.live ? "connected" : "manual",
        auth_mode: picked.authMode, access_scope: picked.accessScope,
        focus: cfg.focus || null, include_terms: cfg.include.trim() || null, exclude_terms: cfg.exclude.trim() || null,
        max_per_pull: isNaN(max) ? picked.defaultMaxPerPull : Math.min(100, Math.max(1, max)),
        cadence: cfg.cadence,
        targets: parseTargets(cfg.targets), guidance: cfg.guidance.trim() || null,  // pointing context: where to look
        config: cfg.url.trim() ? { url: cfg.url.trim() } : null,   // never secrets — only the public locator
        connection_id: connectionId,
        competitor_id: scope.competitorId ?? null, market_lens: scope.marketLens ?? null,
      });
      if (error) { if (connectionId) await supabase.from("connections").delete().eq("id", connectionId); throw error; }
      setPicked(null); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not connect source."); }
  }

  async function remove(id: string) { setError(null); await supabase.from("sources").delete().eq("id", id); await load(); }

  const internal = sources.filter((s) => s.origin === "internal");
  const external = sources.filter((s) => s.origin === "external");

  return (
    <>
      <div style={{ marginBottom: "var(--sp-3)" }}><MonitoringStatus competitorId={scope.competitorId} compact /></div>
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
            {recipeNote && <div className="banner" style={{ marginBottom: 2, fontSize: 12.5 }}>{recipeNote}</div>}
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

            {picked.authMode === "mcp" && (
              <div className="card" style={{ padding: "10px 12px", background: "var(--panel-2)", display: "grid", gap: 8 }}>
                <div className="t-label">MCP connection</div>
                <label className="field"><span className="t-label">Server URL</span>
                  <input className="input" value={cfg.mcpUrl} placeholder="https://mcp.yourvendor.com" onChange={(e) => setCfg({ ...cfg, mcpUrl: e.target.value })} /></label>
                <label className="field"><span className="t-label">Token <span className="t-muted" style={{ fontWeight: 400 }}>— stored encrypted in the vault, never in config</span></span>
                  <input className="input" type="password" value={cfg.mcpToken} placeholder="Bearer token (optional for public servers)" onChange={(e) => setCfg({ ...cfg, mcpToken: e.target.value })} /></label>
                <label className="field"><span className="t-label">This system is</span>
                  <select className="select" value={cfg.mcpOrigin} onChange={(e) => setCfg({ ...cfg, mcpOrigin: e.target.value as "internal" | "external" })}>
                    <option value="internal">Internal (our own system — CRM, support, analytics)</option>
                    <option value="external">External (market/competitive — reviews, research)</option>
                  </select></label>
                <div className="t-sub t-muted" style={{ fontSize: 11.5 }}>Point it at specifics below (Targets) — e.g. a CRM opportunity list & the account/opp data to read. The aim is what makes the pull useful, not a firehose.</div>
              </div>
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

            {/* Pointing context — where to look. The difference between a
                connection and a USEFUL one (esp. for MCP: which reports/accounts). */}
            <div className="t-label" style={{ marginTop: 4 }}>Where to look — point it at specifics</div>
            <label className="field"><span className="t-label">Targets (one URL or reference per line)</span>
              <textarea className="input" rows={3} value={cfg.targets} placeholder={picked.kind === "website" || picked.kind === "youtube" ? "https://competitor.com/pricing\nhttps://competitor.com/blog" : "e.g. report: Win/loss by competitor\naccount: Acme Corp"} onChange={(e) => setCfg({ ...cfg, targets: e.target.value })} /></label>
            <label className="field"><span className="t-label">Guidance (plain words — what to prioritize / ignore)</span>
              <input className="input" value={cfg.guidance} placeholder="e.g. focus on enterprise pricing & SSO; ignore careers" onChange={(e) => setCfg({ ...cfg, guidance: e.target.value })} /></label>

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
                              <Chip tone={s.status === "connected" ? "green" : s.status === "paused" ? "amber" : "default"}>{s.status === "connected" ? "live" : s.status === "paused" ? "paused" : "manual"}</Chip>
                              {s.focus && <Chip tone={s.focus === "gtm" ? "violet" : "accent"}>{s.focus}</Chip>}
                            </div>
                            <div className="row gap-2" style={{ alignItems: "center" }}>
                              {LIVE_PULL_KINDS.has(s.kind) && (
                                <select className="select" value={s.cadence} onChange={(e) => setCadence(s, e.target.value)} title="Pull cadence — manual = only when you press Pull now"
                                  style={{ padding: "2px 6px", fontSize: 11.5, height: "auto", width: "auto" }}>
                                  <option value="manual">manual</option><option value="daily">daily</option><option value="weekly">weekly</option>
                                </select>
                              )}
                              {LIVE_PULL_KINDS.has(s.kind) && s.cadence !== "manual" && (
                                <button className="btn btn-secondary btn-sm" onClick={() => togglePause(s)} style={{ padding: "2px 8px", fontSize: 11.5 }}
                                  title={s.status === "paused" ? "Resume scheduled pulls" : "Pause scheduled pulls — the source and its signals stay"}>
                                  {s.status === "paused" ? "▶ Resume" : "⏸ Pause"}
                                </button>
                              )}
                              {LIVE_PULL_KINDS.has(s.kind) && (
                                <button className="btn btn-sm" disabled={pulling[s.id]} onClick={() => pullNow(s)} style={{ padding: "2px 10px", fontSize: 12 }}>
                                  {pulling[s.id] ? "Pulling…" : "Pull now"}
                                </button>
                              )}
                              <button className="t-muted" onClick={() => remove(s.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15 }}>×</button>
                            </div>
                          </div>
                          <div className="t-mono-xs" style={{ marginTop: 5, color: "var(--tm)" }}>
                            🔒 {s.access_scope ?? AUTH_LABEL[s.auth_mode] ?? "read-only"}
                            {s.max_per_pull ? ` · ≤${s.max_per_pull}/pull` : ""}{s.cadence !== "manual" ? ` · ${s.cadence}` : ""}
                            {s.last_pull_at ? ` · last pull ${new Date(s.last_pull_at).toLocaleDateString()} (${s.last_pull_count ?? 0})` : ""}
                          </div>
                          {(s.include_terms || s.exclude_terms || (s.targets?.length ?? 0) > 0 || s.guidance) && (
                            <div className="t-sub t-muted" style={{ fontSize: 11.5, marginTop: 3 }}>
                              {s.include_terms ? `only: ${s.include_terms}` : ""}{s.include_terms && s.exclude_terms ? " · " : ""}{s.exclude_terms ? `ignore: ${s.exclude_terms}` : ""}
                              {(s.targets?.length ?? 0) > 0 ? `${s.include_terms || s.exclude_terms ? " · " : ""}${s.targets!.length} target${s.targets!.length === 1 ? "" : "s"}` : ""}
                              {s.guidance ? ` · “${s.guidance}”` : ""}
                            </div>
                          )}
                          {pullingId === s.id && pullRun.active && (
                            <div className="card card-pad" style={{ marginTop: 6, background: "var(--panel-2)", padding: "8px 10px" }}><AgentStepList run={pullRun} /></div>
                          )}
                          {pullMsg[s.id] && <div className="t-sub" style={{ fontSize: 11.5, marginTop: 4, color: "var(--accent)" }}>{pullMsg[s.id]}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Source Recipe Builder — describe it, Claude drafts the source. No
                config syntax, no server-building. The non-technical path in. */}
            <div className="card" style={{ padding: 12, marginBottom: 14, background: "var(--panel-2)" }}>
              <div className="t-label" style={{ marginBottom: 6 }}>Describe a signal you want</div>
              <textarea className="input" rows={2} value={describe} placeholder="e.g. Tell me when Acme changes their pricing page or starts hiring senior sales reps"
                onChange={(e) => setDescribe(e.target.value)} style={{ marginBottom: 8 }} />
              <button className="btn btn-sm" disabled={building || describe.trim().length < 4} onClick={buildRecipe}>
                {building ? "Drafting…" : "Draft it for me"}
              </button>
              <span className="t-sub t-muted" style={{ fontSize: 11.5, marginLeft: 10 }}>Claude picks the source type and tailors it — you review before adding.</span>
            </div>

            <div className="t-label" style={{ marginBottom: 8 }}>…or pick a source type</div>
            <div className="row gap-2" style={{ flexWrap: "wrap" }}>
              {/* Only kinds that genuinely pull today — aspirational connectors
                  don't render as if they worked. */}
              {SOURCE_CATALOG.filter((d) => d.kind !== "manual" && d.live).map((d) => (
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
