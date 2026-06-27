"use client";

// Competitive intel — sub-tabbed module:
//   • Dashboard   — the competitive landscape: direct/adjacent competitors +
//                   a capability matrix heat-map (us vs each competitor).
//   • Battlecards — why we win / lose / objections / traps, per competitor.
//   • Signal feed — tracking topics + the competitive signal stream.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Section, Chip, Banner, Confidence, ConfirmDialog, SubTabs } from "@/components/ui";
import TrackingTopics from "@/components/TrackingTopics";
import SourceManager from "@/components/SourceManager";
import CapabilityCellDrawer, { type Cell } from "@/components/CapabilityCellDrawer";
import CompetitiveGrid from "@/components/CompetitiveGrid";
import SignalProfile from "@/components/SignalProfile";
import CompetitiveSetup from "@/components/CompetitiveSetup";
import ProfileReadiness from "@/components/ProfileReadiness";
import BattlecardItemDrawer, { type CardItem } from "@/components/BattlecardItemDrawer";
import { signalDomain, SIGNAL_DOMAIN } from "@/lib/signals";
import { useProductScope } from "@/lib/ProductContext";
import { standUpCompetitiveAgents } from "@/lib/standUpCompetitive";

type Competitor = { id: string; name: string; relationship: string; website: string | null; linkedin: string | null; notes: string | null; product_id: string | null; setup: { step?: number; finalized_at?: string | null } | null };
type Capability = { id: string; name: string; category: string | null };
type Score = { id: string; capability_id: string; competitor_id: string | null; score: number; scored_by: string | null; evidence_at: string | null };
type Card = { id: string; competitor_id: string | null; kind: string; title: string; detail: string | null; proposed_by: string | null; signal_ids: string[] | null; updated_at: string | null; audience: string | null };
type Signal = { id: string; title: string; why: string | null; conf_label: string | null; conf_level: number | null; observed_at: string | null; origin: string | null; competitor_id: string | null; metadata: { domain?: string; competitor_id?: string; channel?: string } | null; source_id: string | null };
type Theme = { id: string; title: string; summary: string | null; recommendation: string | null; category: string; competitor_id: string | null; conf_level: number | null; state: string };
// The competitor a signal is about — first-class column, with a fallback to the
// legacy metadata link for any pre-Phase-4 rows the backfill couldn't resolve.
const sigComp = (s: Signal) => s.competitor_id ?? s.metadata?.competitor_id ?? null;
// Competitor tiers: direct (full battlecard motion) / adjacent (partial
// overlap) / watching (radar only — signals collected, no active motion).
const REL_TIERS = ["direct", "adjacent", "watching"] as const;
const relTone = (r: string): "accent" | "violet" | "default" => r === "direct" ? "accent" : r === "adjacent" ? "violet" : "default";

type Tab = "dashboard" | "profile" | "competitors" | "feed";

export default function CompetitiveView() {
  const supabase = createClient();
  const { inScope, scopedProductId } = useProductScope(); // competitors are per-line; company-wide rivals show everywhere
  const [tab, setTab] = useState<Tab>("dashboard");
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [scores, setScores] = useState<Score[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [overview, setOverview] = useState<{ name: string; overview: string | null; valueProp: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: comp }, { data: caps }, { data: scs }, { data: cds }, { data: sigs }, { data: ths }] = await Promise.all([
      supabase.from("competitors").select("id, name, relationship, website, linkedin, notes, product_id, setup").order("position").order("created_at"),
      supabase.from("capabilities").select("id, name, category").order("position").order("created_at"),
      supabase.from("capability_scores").select("id, capability_id, competitor_id, score, scored_by, evidence_at"),
      supabase.from("battlecard_items").select("id, competitor_id, kind, title, detail, proposed_by, signal_ids, updated_at, audience").order("position").order("created_at"),
      supabase.from("signals").select("id, title, why, conf_label, conf_level, observed_at, origin, competitor_id, metadata, source_id").order("observed_at", { ascending: false, nullsFirst: false }),
      supabase.from("signal_themes").select("id, title, summary, recommendation, category, competitor_id, conf_level, state").not("competitor_id", "is", null).order("last_evidence_at", { ascending: false, nullsFirst: false }),
    ]);
    setCompetitors(comp ?? []); setCapabilities(caps ?? []); setScores(scs ?? []); setCards(cds ?? []); setSignals(sigs ?? []); setThemes(ths ?? []);
    // Our product overview — anchors the "us vs them" framing on battlecards.
    const { data: prod } = await supabase.from("product_records").select("id, name").order("created_at").limit(1).maybeSingle();
    if (prod) {
      const { data: fs } = await supabase.from("record_fields").select("field_key, value").eq("product_id", prod.id).in("field_key", ["overview", "value_prop"]);
      setOverview({ name: prod.name, overview: fs?.find((f) => f.field_key === "overview")?.value ?? null, valueProp: fs?.find((f) => f.field_key === "value_prop")?.value ?? null });
    }
    setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const compSignals = signals.filter((s) => signalDomain(s) === SIGNAL_DOMAIN.competitive);
  // Scope to the active product line (+ company-wide rivals). The switcher only
  // appears for multi-product orgs, so single-product orgs see every competitor.
  const scopedCompetitors = competitors.filter(inScope);

  return (
    <div>
      <SubTabs<Tab>
        tabs={[{ key: "dashboard", label: "Dashboard" }, { key: "profile", label: "Signal profile" }, { key: "competitors", label: "Competitors" }, { key: "feed", label: "Signal feed" }]}
        active={tab} onChange={setTab}
      />
      <Banner>{error}</Banner>

      {loading ? <div className="t-sub t-muted">Loading…</div>
        : tab === "dashboard" ? <Dashboard competitors={scopedCompetitors} capabilities={capabilities} scores={scores} compSignals={compSignals} themes={themes} overview={overview} reload={load} setError={setError} newProductId={scopedProductId} />
        : tab === "profile" ? <SignalProfile scope="landscape" />
        : tab === "competitors" ? <Competitors competitors={scopedCompetitors} cards={cards} overview={overview} capabilities={capabilities} scores={scores} compSignals={compSignals} themes={themes} newProductId={scopedProductId} reload={load} setError={setError} />
        : <Feed signals={signals} competitors={scopedCompetitors} reload={load} />}
    </div>
  );
}

// ---------- Dashboard: capability heat-map + metrics ----------
function Dashboard({ competitors, capabilities, scores, compSignals, themes, overview, reload, setError, newProductId }: {
  competitors: Competitor[]; capabilities: Capability[]; scores: Score[]; compSignals: Signal[]; themes: Theme[]; overview: { name: string; overview: string | null; valueProp: string | null } | null; reload: () => void; setError: (s: string | null) => void; newProductId?: string | null;
}) {
  const supabase = createClient();
  const [addingCap, setAddingCap] = useState(false);
  const [capName, setCapName] = useState("");
  const [openCell, setOpenCell] = useState<Cell | null>(null);
  const [openMetric, setOpenMetric] = useState<"gaps" | "moves" | null>(null);
  const [matrixView, setMatrixView] = useState<"matrix" | "grid">("matrix");

  // Guided setup: the front door. Auto-opens for an empty module; always
  // reachable from the header so you can expand the board later.
  const empty = competitors.length === 0 && capabilities.length === 0;
  const [setupOpen, setSetupOpen] = useState(empty);
  useEffect(() => { if (empty) setSetupOpen(true); }, [empty]);

  // Evidence drawer: click a player on the grid → the work behind its position
  // (per-cell provenance, GTM themes, recent signals) in a side panel.
  const [openComp, setOpenComp] = useState<string | null>(null);

  // Purge the unevidenced: deletes every score that was NOT derived from
  // evidence through the gate (hand-set + demo seed). Evidence-scored cells
  // (✦) survive. This is how a polluted matrix becomes an honest one.
  const [confirmClear, setConfirmClear] = useState(false);
  const handSetCount = scores.filter((sc) => !sc.scored_by).length;
  async function clearHandSet() {
    setConfirmClear(false); setError(null);
    const { error } = await supabase.from("capability_scores").delete().is("scored_by", null);
    if (error) setError(error.message); else reload();
  }

  const direct = competitors.filter((c) => c.relationship === "direct");
  const scoreOf = (capId: string, compId: string | null) => scores.find((s) => s.capability_id === capId && s.competitor_id === compId)?.score ?? 0;
  // Grouping — keeps the matrix readable as the tracked set grows: filter to a
  // tier (direct / adjacent / watching) and order columns by tier or by overall
  // capability coverage.
  const [relFilter, setRelFilter] = useState<string>("all");
  const [orderBy, setOrderBy] = useState<"tier" | "capability">("tier");
  const covOf = (compId: string) => capabilities.length ? capabilities.reduce((a, c) => a + scoreOf(c.id, compId), 0) / (capabilities.length * 3) : 0;
  const tierRank = (r: string) => REL_TIERS.indexOf(r as typeof REL_TIERS[number]) === -1 ? 99 : REL_TIERS.indexOf(r as typeof REL_TIERS[number]);
  const matrixCompetitors = competitors
    .filter((c) => relFilter === "all" || c.relationship === relFilter)
    .sort((a, b) => orderBy === "capability" ? covOf(b.id) - covOf(a.id) : tierRank(a.relationship) - tierRank(b.relationship));
  // Provenance + currency of a cell: ✦ = evidence-derived (ratified through the
  // gate); stale = newer signals on this competitor than the score's evidence.
  const provOf = (capId: string, compId: string | null) => scores.find((s) => s.capability_id === capId && s.competitor_id === compId);
  const staleCell = (capId: string, compId: string | null) => {
    if (!compId) return false;
    const p = provOf(capId, compId);
    if (!p?.scored_by || !p.evidence_at) return false;
    return compSignals.some((sg) => sigComp(sg) === compId && sg.observed_at && sg.observed_at > p.evidence_at!);
  };

  async function addCapability(e: React.FormEvent) {
    e.preventDefault(); if (!capName.trim()) return;
    const orgId = await getOrgId(); if (!orgId) return;
    const { error } = await supabase.from("capabilities").insert({ org_id: orgId, name: capName.trim() });
    if (error) setError(error.message); else { setAddingCap(false); setCapName(""); reload(); }
  }
  const compById = (id: string | null) => competitors.find((c) => c.id === id) ?? null;
  const heat = (s: number) => ["var(--fill)", "#FCE4C7", "#CDEBD6", "#9FD9B4"][s] || "var(--fill)";
  const heatText = (s: number) => ["—", "Partial", "Good", "Strong"][s] || "—";

  // Metrics: where competitors out-cover us (gaps) and where we lead (edges).
  const usScore = (capId: string) => scoreOf(capId, null);
  const gaps = capabilities.filter((cap) => competitors.some((c) => scoreOf(cap.id, c.id) > usScore(cap.id))).length;
  const edges = capabilities.filter((cap) => usScore(cap.id) >= 3 && competitors.every((c) => scoreOf(cap.id, c.id) < 3)).length;
  const recent = compSignals.filter((s) => s.observed_at && Date.now() - new Date(s.observed_at).getTime() < 30 * 86400_000).length;
  const gapList = capabilities.filter((cap) => competitors.some((c) => scoreOf(cap.id, c.id) > usScore(cap.id)));
  const METRICS: [number, string, boolean, string][] = [
    [competitors.length, "Tracked", false, ""],
    [direct.length, "Direct", false, ""],
    [edges, "We lead", false, ""],
    [gaps, "Gaps to close", gaps > 0, "gaps"],
    [recent, "Moves · 30d", recent > 0, "moves"],
  ];

  if (setupOpen) {
    return <CompetitiveSetup productId={newProductId} onDone={() => { setSetupOpen(false); reload(); }} />;
  }

  return (
    <div>
      {/* The living gauge — records + matrix + signal flow, auto-updating. */}
      <div style={{ marginBottom: "var(--sp-4)" }}><ProfileReadiness compact /></div>
      {/* Capability matrix / momentum grid — the differentiator, up top */}
      <Section label="Capability landscape" action={
        <div className="row gap-2">
          <div className="row" style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
            {(["matrix", "grid"] as const).map((v) => (
              <button key={v} onClick={() => setMatrixView(v)} className="btn-sm" style={{ border: "none", background: matrixView === v ? "var(--ac)" : "var(--panel)", color: matrixView === v ? "#fff" : "var(--ts)", fontWeight: 600, padding: "6px 12px", cursor: "pointer" }}>{v === "matrix" ? "Matrix" : "Grid"}</button>
            ))}
          </div>
          {!addingCap && <button className="btn btn-secondary btn-sm" onClick={() => setAddingCap(true)}>+ Capability</button>}
          <button className="btn btn-secondary btn-sm" onClick={() => setSetupOpen(true)} title="Guided, AI-assisted setup — find rivals, design the matrix, stand up monitoring">✦ Guided setup</button>
          {handSetCount > 0 && (
            <button className="btn btn-secondary btn-sm" onClick={() => setConfirmClear(true)}
              title="Delete every score that was NOT derived from evidence (hand-set + demo data). ✦ evidence-scored cells survive.">
              ⌫ Clear hand-set scores · {handSetCount}
            </button>
          )}
        </div>
      }>
        {confirmClear && (
          <ConfirmDialog
            title="Clear hand-set scores?"
            message={<>Deletes <b>{handSetCount}</b> score{handSetCount === 1 ? "" : "s"} that did NOT come through the evidence gate — hand-typed ratings and demo data alike. ✦ evidence-scored cells survive untouched. Competitor cells refill as agents score from signals (you ratify each); &ldquo;Us&rdquo; you re-rate yourself — that call is yours to make.</>}
            confirmLabel="Clear them" onConfirm={clearHandSet} onCancel={() => setConfirmClear(false)}
          />
        )}
        <div className="row-between" style={{ marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
          <span className="row" style={{ gap: 2 }}>
            {[["all", "All"], ...REL_TIERS.map((t) => [t, t.charAt(0).toUpperCase() + t.slice(1)])].map(([k, label]) => {
              const n = k === "all" ? competitors.length : competitors.filter((c) => c.relationship === k).length;
              if (k !== "all" && n === 0) return null;
              return (
                <button key={k} onClick={() => setRelFilter(k as string)} className="t-mono-xs"
                  style={{ padding: "3px 9px", borderRadius: 6, border: "none", cursor: "pointer", background: relFilter === k ? "var(--ac)" : "var(--fill)", color: relFilter === k ? "#fff" : "var(--tm)", fontWeight: 600 }}>
                  {label} · {n}
                </button>
              );
            })}
          </span>
          {matrixView === "matrix" && (
            <span className="row gap-2" style={{ alignItems: "center" }}>
              <span className="t-mono-xs t-muted">order by</span>
              <span className="row" style={{ gap: 2 }}>
                {([["tier", "Tier"], ["capability", "Capability"]] as const).map(([k, label]) => (
                  <button key={k} onClick={() => setOrderBy(k)} className="t-mono-xs"
                    style={{ padding: "3px 9px", borderRadius: 6, border: "none", cursor: "pointer", background: orderBy === k ? "var(--ac)" : "var(--fill)", color: orderBy === k ? "#fff" : "var(--tm)", fontWeight: 600 }}>
                    {label}
                  </button>
                ))}
              </span>
            </span>
          )}
        </div>
        <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>{matrixView === "matrix" ? "Functionality vectors × competitors (you vs each). Click any cell for the agent's read — reasons, sources, implications — then set the rating yourself." : "Coverage × momentum quadrant — where each player sits, you vs them (G2-style). Top-right leads."}</div>
        {matrixView === "grid" ? (
          capabilities.length === 0 ? <div className="t-sub t-muted">Add capabilities to plot the grid.</div>
          : <CompetitiveGrid competitors={matrixCompetitors} capabilities={capabilities} scores={scores} compSignals={compSignals} onOpenCompetitor={setOpenComp} />
        ) : (<>
        {addingCap && (
          <form onSubmit={addCapability} className="card card-pad" style={{ marginBottom: "var(--sp-3)" }}>
            <div className="row gap-2"><input className="input" autoFocus placeholder="Capability (e.g. Explainability)" value={capName} onChange={(e) => setCapName(e.target.value)} style={{ flex: 1 }} /><button className="btn btn-sm" type="submit">Add</button><button className="btn btn-secondary btn-sm" type="button" onClick={() => setAddingCap(false)}>Cancel</button></div>
          </form>
        )}
        {capabilities.length === 0 ? <div className="t-sub t-muted">No capabilities yet. Add the features/areas you want to compare.</div> : (
          <div className="card" style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "10px 14px", fontWeight: 600, color: "var(--tm)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>Capability</th>
                  <th style={{ padding: "10px 8px", fontWeight: 700, fontSize: 12, position: "sticky" }}>Us</th>
                  {matrixCompetitors.map((c) => <th key={c.id} style={{ padding: "10px 8px", fontWeight: 600, fontSize: 12, color: "var(--ts)" }}>
                    <span title={`${c.relationship}${orderBy === "capability" ? ` · coverage ${Math.round(covOf(c.id) * 100)}%` : ""}`}>{c.name}</span>
                    <div className="t-mono-xs" style={{ fontWeight: 600, color: c.relationship === "direct" ? "var(--ac-text, var(--ac))" : c.relationship === "adjacent" ? "var(--vl)" : "var(--tm)", marginTop: 1 }}>{orderBy === "capability" ? `${Math.round(covOf(c.id) * 100)}%` : c.relationship}</div>
                  </th>)}
                </tr>
              </thead>
              <tbody>
                {capabilities.map((cap) => (
                  <tr key={cap.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "8px 14px", fontWeight: 600 }}>{cap.name}</td>
                    {[null, ...matrixCompetitors.map((c) => c.id)].map((compId) => {
                      const s = scoreOf(cap.id, compId);
                      const who = compId === null ? "Us" : compById(compId)?.name ?? "Competitor";
                      return (
                        <td key={compId ?? "us"} style={{ padding: "6px 8px", textAlign: "center" }}>
                          <button onClick={() => setOpenCell({ capabilityId: cap.id, capabilityName: cap.name, competitorId: compId, who, score: s, competitorNotes: compById(compId)?.notes ?? null, productValueProp: overview?.valueProp ?? overview?.overview ?? null })}
                            title={`${heatText(s)}${provOf(cap.id, compId)?.scored_by ? ` — ✦ scored from evidence by ${provOf(cap.id, compId)?.scored_by}` : " — set by hand"}${staleCell(cap.id, compId) ? " · new evidence since scored" : ""} — open for context`}
                            style={{ width: "100%", minWidth: 64, padding: "8px 6px", borderRadius: 6, border: compId === null ? "1px solid var(--ac)" : "1px solid var(--border)", background: heat(s), cursor: "pointer", fontSize: 11, fontWeight: 600, color: "var(--tp)", position: "relative" }}>
                            {heatText(s)}{provOf(cap.id, compId)?.scored_by ? " ✦" : ""}
                            {staleCell(cap.id, compId) && <span title="New evidence since this was scored" style={{ position: "absolute", top: 3, right: 4, width: 6, height: 6, borderRadius: 3, background: "var(--am-text)" }} />}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </>)}
      </Section>

      {/* Metrics — click Gaps / Moves to drill in */}
      <div className="card card-pad" style={{ margin: "var(--sp-5) 0", display: "grid", gridTemplateColumns: `repeat(${METRICS.length}, 1fr)`, gap: "var(--sp-4)" }}>
        {METRICS.map(([n, label, warn, key]) => {
          const clickable = key === "gaps" || key === "moves";
          return (
            <button key={label} onClick={() => clickable && setOpenMetric(key as "gaps" | "moves")} disabled={!clickable}
              className="stat" style={{ background: "none", border: "none", textAlign: "left", padding: 0, cursor: clickable ? "pointer" : "default" }}>
              <span className="stat-num" style={{ color: warn ? "var(--am-text)" : undefined }}>{n}</span>
              <span className="stat-label" style={{ color: clickable ? "var(--ac-text)" : undefined }}>{label}{clickable ? " →" : ""}</span>
            </button>
          );
        })}
      </div>

      {/* Gaps / Moves drill-in drawer */}
      {openMetric && (
        <>
          <div onClick={() => setOpenMetric(null)} style={{ position: "fixed", inset: 0, background: "rgba(11,12,14,0.32)", zIndex: 40 }} />
          <aside style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: 460, maxWidth: "94vw", background: "var(--panel)", borderLeft: "1px solid var(--border)", boxShadow: "var(--shadow-md)", zIndex: 41, display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }} className="row-between">
              <span className="t-h2" style={{ fontSize: 15 }}>{openMetric === "gaps" ? "Gaps to close" : "Recent moves (30d)"}</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setOpenMetric(null)}>Close</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }} className="stack-3">
              {openMetric === "gaps" ? (
                gapList.length === 0 ? <div className="t-sub t-muted">No gaps — you match or lead on every tracked capability.</div> : (<>
                  <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Capabilities where a competitor out-covers us today. Close these or reframe around your edges.</div>
                  {gapList.map((cap) => {
                    const leaders = competitors.filter((c) => scoreOf(cap.id, c.id) > usScore(cap.id));
                    return (
                      <div key={cap.id} className="card card-pad">
                        <div className="row-between" style={{ marginBottom: 4 }}><span style={{ fontSize: 13.5, fontWeight: 620 }}>{cap.name}</span><span className="t-mono-xs">us: {heatText(usScore(cap.id))}</span></div>
                        <div className="t-sub" style={{ fontSize: 12.5 }}>Ahead of us: {leaders.map((c) => `${c.name} (${heatText(scoreOf(cap.id, c.id))})`).join(", ")}</div>
                        <button className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={() => { setMatrixView("matrix"); setOpenMetric(null); }}>Open in matrix →</button>
                      </div>
                    );
                  })}
                </>)
              ) : (
                compSignals.length === 0 ? <div className="t-sub t-muted">No recent competitive moves.</div> : (<>
                  <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Competitor activity in the last 30 days — what changed and why it matters.</div>
                  {compSignals.map((s) => (
                    <div key={s.id} className="card card-pad">
                      <div style={{ fontSize: 13.5, fontWeight: 620, marginBottom: 3 }}>{s.title}</div>
                      {s.why && <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>{s.why}</div>}
                    </div>
                  ))}
                </>)
              )}
            </div>
          </aside>
        </>
      )}

      {/* Org-wide competitive sources (cross-competitor). Competitors are added &
          managed on the Competitors tab. */}
      <SourceManager title="Competitive sources (all competitors)" />

      {openComp && (() => {
        const c = competitors.find((x) => x.id === openComp);
        if (!c) return null;
        const cells = scores.filter((sc) => sc.competitor_id === c.id && (sc.score > 0 || sc.scored_by));
        const evidenced = cells.filter((sc) => sc.scored_by).length;
        const gtmThemes = themes.filter((t) => t.competitor_id === c.id && t.category === "gtm" && t.state !== "fading");
        const recent = compSignals.filter((sg) => sigComp(sg) === c.id).slice(0, 5);
        const capName = (id: string) => capabilities.find((k) => k.id === id)?.name ?? "Capability";
        const LV = ["—", "Partial", "Good", "Strong"];
        return (
          <>
            <div onClick={() => setOpenComp(null)} style={{ position: "fixed", inset: 0, background: "rgba(11,12,14,0.32)", zIndex: 40 }} />
            <aside style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: 460, maxWidth: "94vw", background: "var(--panel)", borderLeft: "1px solid var(--border)", boxShadow: "var(--shadow-md)", zIndex: 41, display: "flex", flexDirection: "column" }}>
              <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }} className="row-between">
                <span className="t-h2" style={{ fontSize: 15 }}>{c.name} — the work behind the position</span>
                <button className="btn btn-secondary btn-sm" onClick={() => setOpenComp(null)}>Close</button>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }} className="stack-3">
                <div>
                  <div className="t-label" style={{ marginBottom: 6 }}>Capabilities <span className="t-sub t-muted" style={{ textTransform: "none", letterSpacing: 0 }}>— {evidenced} of {cells.length || 0} rated cells evidence-scored</span></div>
                  <div className="stack-2">
                    {cells.map((sc, i) => (
                      <div key={i} className="card card-pad" style={{ background: "var(--panel-2)", padding: "8px 10px" }}>
                        <div className="row-between" style={{ gap: 8 }}>
                          <span style={{ fontSize: 12.5, fontWeight: 620 }}>{capName(sc.capability_id)}</span>
                          <Chip tone={sc.scored_by ? "accent" : "default"}>{LV[sc.score]}{sc.scored_by ? " ✦" : ""}</Chip>
                        </div>
                        <div className="t-mono-xs t-muted" style={{ marginTop: 2 }}>{sc.scored_by ? `✦ ${sc.scored_by}${sc.evidence_at ? ` · ${new Date(sc.evidence_at).toLocaleDateString()}` : ""}` : "set by hand — ✦ Score from evidence to substantiate"}</div>
                      </div>
                    ))}
                    {cells.length === 0 && <div className="t-sub t-muted" style={{ fontSize: 12 }}>No rated cells yet — pull their sources, then ✦ Score from evidence on their Product board.</div>}
                  </div>
                </div>
                <div>
                  <div className="t-label" style={{ marginBottom: 6 }}>GTM themes · {gtmThemes.length}</div>
                  <div className="stack-2">
                    {gtmThemes.map((t) => (
                      <div key={t.id} className="card card-pad" style={{ background: "var(--panel-2)", padding: "8px 10px" }}>
                        <div className="row-between" style={{ gap: 8 }}>
                          <span style={{ fontSize: 12.5, fontWeight: 620 }}>{t.title}</span>
                          <Confidence label={null} level={t.conf_level} />
                        </div>
                      </div>
                    ))}
                    {gtmThemes.length === 0 && <div className="t-sub t-muted" style={{ fontSize: 12 }}>No GTM themes yet — their press/LinkedIn monitors feed this.</div>}
                  </div>
                </div>
                <div>
                  <div className="t-label" style={{ marginBottom: 6 }}>Recent signals</div>
                  <div className="stack-2">
                    {recent.map((sg) => (
                      <div key={sg.id} className="card card-pad" style={{ background: "var(--panel-2)", padding: "8px 10px", borderLeft: "2px solid var(--vl)", fontSize: 12 }}>{sg.title}</div>
                    ))}
                    {recent.length === 0 && <div className="t-sub t-muted" style={{ fontSize: 12 }}>None yet.</div>}
                  </div>
                </div>
              </div>
            </aside>
          </>
        );
      })()}
      <CapabilityCellDrawer key={openCell ? `${openCell.capabilityId}:${openCell.competitorId}` : "none"} cell={openCell} onClose={() => setOpenCell(null)} onChanged={reload} />
    </div>
  );
}

// ---------- Battlecards ----------
type CdTab = "overview" | "profile" | "themes" | "gtm" | "product" | "signals";

// Best-practice battlecard sections — the set is the suggestion; fill the ones
// that help a rep win against each competitor.
const KINDS: [string, string, string][] = [
  ["win", "Why we win", "gn"],
  ["lose", "Why we lose", "am"],
  ["strength", "Their strengths", "vl"],
  ["objection", "Objection handling", "bd"],
  ["trap", "Landmines to set", "vl"],
  ["pricing", "Pricing & packaging", "bd"],
  ["proof", "Proof points", "gn"],
  ["discovery", "Discovery questions", "bd"],
];
const TONE_BORDER: Record<string, string> = { gn: "var(--gn)", am: "var(--am-text)", vl: "var(--vl)", bd: "var(--border-strong)" };
function Competitors({ competitors, cards, overview, capabilities, scores, compSignals, themes, newProductId, reload, setError }: {
  competitors: Competitor[]; cards: Card[]; overview: { name: string; overview: string | null; valueProp: string | null } | null;
  capabilities: Capability[]; scores: Score[]; compSignals: Signal[]; themes: Theme[]; newProductId: string | null; reload: () => void; setError: (s: string | null) => void;
}) {
  const supabase = createClient();
  const [scope, setScope] = useState<string | null>(null); // selected competitor id; null = tile grid
  const [cdTab, setCdTab] = useState<CdTab>("overview");
  const [adding, setAdding] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", detail: "" });
  const [openCell, setOpenCell] = useState<Cell | null>(null);
  const [editNotes, setEditNotes] = useState(false);
  const [notes, setNotes] = useState("");
  // Add / remove competitors lives here now (moved off the Dashboard).
  const [addingComp, setAddingComp] = useState(false);
  const [comp, setComp] = useState({ name: "", relationship: "direct" });
  const [pendingDelete, setPendingDelete] = useState<Competitor | null>(null);

  async function addCompetitor(e: React.FormEvent) {
    e.preventDefault(); if (!comp.name.trim()) return;
    const orgId = await getOrgId(); if (!orgId) return;
    // Inherit the active line so a competitor added inside a product belongs to
    // it; null when viewing all/company = a company-wide rival shown everywhere.
    const { error } = await supabase.from("competitors").insert({ org_id: orgId, name: comp.name.trim(), relationship: comp.relationship, product_id: newProductId });
    if (error) setError(error.message); else { setAddingComp(false); setComp({ name: "", relationship: "direct" }); reload(); }
  }
  async function doRemoveComp() {
    const c = pendingDelete; if (!c) return;
    setError(null); setPendingDelete(null);
    const { error } = await supabase.from("competitors").delete().eq("id", c.id);
    if (error) setError(error.message); else { if (scope === c.id) setScope(null); reload(); }
  }

  const cardsFor = (kind: string) => cards.filter((c) => c.kind === kind && c.competitor_id === scope);
  const countFor = (compId: string) => cards.filter((c) => c.competitor_id === compId).length;
  const selected = competitors.find((c) => c.id === scope);
  const scoreOf = (capId: string, compId: string | null) => scores.find((s) => s.capability_id === capId && s.competitor_id === compId)?.score ?? 0;
  const heat = (s: number) => ["var(--fill)", "#FCE4C7", "#CDEBD6", "#9FD9B4"][s] || "var(--fill)";
  const heatText = (s: number) => ["—", "Partial", "Good", "Strong"][s] || "—";
  // Real competitor↔signal link (first-class column, legacy metadata fallback).
  const sigsFor = (compId: string | null) => (compId ? compSignals.filter((s) => sigComp(s) === compId) : []);
  const themesFor = (compId: string | null, cat: string) => (compId ? themes.filter((t) => t.competitor_id === compId && t.category === cat) : []);
  const edge = (compId: string) => capabilities.reduce((a, c) => { const u = scoreOf(c.id, null), t = scoreOf(c.id, compId); return { we: a.we + (u > t ? 1 : 0), they: a.they + (t > u ? 1 : 0) }; }, { we: 0, they: 0 });
  async function saveNotes() { if (!scope) return; setError(null); await supabase.from("competitors").update({ notes: notes.trim() || null }).eq("id", scope); setEditNotes(false); reload(); }

  async function add(kind: string) {
    if (!form.title.trim() || !scope) return;
    const orgId = await getOrgId(); if (!orgId) return;
    const { error } = await supabase.from("battlecard_items").insert({ org_id: orgId, competitor_id: scope, kind, title: form.title.trim(), detail: form.detail.trim() || null });
    if (error) setError(error.message); else { setAdding(null); setForm({ title: "", detail: "" }); reload(); }
  }
  async function remove(id: string) { setError(null); await supabase.from("battlecard_items").delete().eq("id", id); reload(); }

  // The battlecard agent pair runs the USER'S workflow — agents and their
  // skills (cornerstone + child) are built by the user; the functions are only
  // execution substrates + gates. Contract: step 1 = analyst (→ battlecard
  // items via the intelligence review queue), step 2 = messenger (→ the GTM
  // record's Battlecard section via the proposal gate). Context is pulled from
  // THIS page (the competitor's themes, matrix, signals, items) with awareness
  // of the rest (product value prop, GTM voice).
  type Wf = { id: string; name: string; steps: { agent_id?: string; skill_id?: string | null }[] };
  const [workflows, setWorkflows] = useState<Wf[]>([]);
  const [wfId, setWfId] = useState<string>("");
  // Per-competitor signal logging — the form lives ON the competitor (the Feed
  // form stays for cross-competitor logging). Inserts carry the first-class
  // competitor_id + the metadata mirror, exactly like the Feed.
  const [logOpen, setLogOpen] = useState(false);
  const [logForm, setLogForm] = useState({ origin: "internal", channel: "", title: "", why: "", conf: "0.7" });
  const [logBusy, setLogBusy] = useState(false);
  // Manage signals HERE, on the competitor — edit or remove without a detour
  // through the full feed/workflow.
  const [sigEdit, setSigEdit] = useState<{ id: string; title: string; why: string; conf: string } | null>(null);
  async function saveSignal() {
    if (!sigEdit?.title.trim()) return;
    setError(null);
    const lvl = parseFloat(sigEdit.conf);
    const { error } = await supabase.from("signals").update({
      title: sigEdit.title.trim(), why: sigEdit.why.trim() || null,
      conf_level: isNaN(lvl) ? null : lvl, conf_label: isNaN(lvl) ? null : lvl >= 0.75 ? "High" : lvl >= 0.5 ? "Medium" : "Low",
    }).eq("id", sigEdit.id);
    if (error) setError(error.message); else { setSigEdit(null); reload(); }
  }
  async function removeSignal(id: string) {
    setError(null);
    const { error } = await supabase.from("signals").delete().eq("id", id);
    if (error) setError(error.message); else reload();
  }
  // Stand up the analyst+messenger+scorer chain from right here.
  const [standBusy, setStandBusy] = useState(false);
  async function standUpHere() {
    setStandBusy(true); setError(null);
    try {
      const res = await standUpCompetitiveAgents(supabase);
      if (!res.ok) throw new Error(res.message);
      setAgentNote(res.message);
      const { data } = await supabase.from("workflows").select("id, name, steps").eq("is_active", true).order("created_at");
      const ws = ((data ?? []) as Wf[]).filter((w) => Array.isArray(w.steps) && w.steps.length > 0);
      setWorkflows(ws); setWfId((cur) => cur || ws.find((w) => w.name === "Competitive battlecard pair")?.id || ws[0]?.id || "");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not stand up the agents."); }
    finally { setStandBusy(false); }
  }
  async function logSignal(e: React.FormEvent) {
    e.preventDefault(); if (!logForm.title.trim() || !scope) return;
    setLogBusy(true); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      const lvl = parseFloat(logForm.conf);
      const { error } = await supabase.from("signals").insert({
        org_id: orgId, scope: "org", title: logForm.title.trim(), why: logForm.why.trim() || null,
        conf_level: isNaN(lvl) ? null : lvl, conf_label: isNaN(lvl) ? null : lvl >= 0.75 ? "High" : lvl >= 0.5 ? "Medium" : "Low",
        observed_at: new Date().toISOString(), origin: logForm.origin,
        competitor_id: scope,
        metadata: { domain: "competitive", competitor_id: scope, channel: logForm.channel || undefined },
      });
      if (error) throw error;
      setLogOpen(false); setLogForm({ origin: logForm.origin, channel: "", title: "", why: "", conf: "0.7" }); reload();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not log the signal."); }
    finally { setLogBusy(false); }
  }

  const [agentBusy, setAgentBusy] = useState<"analyst" | "messaging" | null>(null);
  const [agentNote, setAgentNote] = useState<string | null>(null);
  const [scoreBusy, setScoreBusy] = useState(false);
  const [scoreNote, setScoreNote] = useState<string | null>(null);
  const [openCard, setOpenCard] = useState<CardItem | null>(null);
  // Update alert: a watch on this competitor's battlecard evidence, surfaced on
  // the homepage command center.
  const [watching, setWatching] = useState(false);
  useEffect(() => {
    if (!scope) return;
    supabase.from("update_alerts").select("id").eq("kind", "battlecard_refresh").eq("competitor_id", scope).eq("is_active", true).maybeSingle()
      .then(({ data }) => setWatching(!!data));
  }, [supabase, scope]);
  async function toggleWatch() {
    if (!scope) return;
    setError(null);
    if (watching) {
      const { error } = await supabase.from("update_alerts").delete().eq("kind", "battlecard_refresh").eq("competitor_id", scope);
      if (error) setError(error.message); else setWatching(false);
    } else {
      const orgId = await getOrgId(); if (!orgId) return;
      const { error } = await supabase.from("update_alerts").insert({ org_id: orgId, kind: "battlecard_refresh", competitor_id: scope });
      if (error) setError(error.message); else setWatching(true);
    }
  }
  useEffect(() => {
    supabase.from("workflows").select("id, name, steps").eq("is_active", true).order("created_at").then(({ data }) => {
      const ws = ((data ?? []) as Wf[]).filter((w) => Array.isArray(w.steps) && w.steps.length > 0);
      setWorkflows(ws);
      setWfId((cur) => cur || ws[0]?.id || "");
    });
  }, [supabase]);
  const wf = workflows.find((w) => w.id === wfId) ?? null;
  const stepReady = (i: number) => !!(wf?.steps?.[i]?.agent_id && wf?.steps?.[i]?.skill_id);
  async function runAgent(which: "analyst" | "messaging") {
    if (!scope || !wfId || agentBusy) return;
    setAgentBusy(which); setAgentNote(null); setError(null);
    try {
      const fn = which === "analyst" ? "battlecard-analyst" : "battlecard-messaging";
      const { data, error } = await supabase.functions.invoke(fn, { body: { competitor_id: scope, workflow_id: wfId } });
      if (error) throw error;
      setAgentNote((data as { message?: string })?.message ?? "Done.");
      reload();
    } catch (e) { setError(e instanceof Error ? e.message : `The ${which} step failed.`); }
    finally { setAgentBusy(null); }
  }
  // Matrix currency watch: alert on the homepage when new evidence lands after
  // this rival's cells were scored (the matrix twin of the battlecard watch).
  const [watchingMatrix, setWatchingMatrix] = useState(false);
  useEffect(() => {
    if (!scope) return;
    supabase.from("update_alerts").select("id").eq("kind", "matrix_refresh").eq("competitor_id", scope).eq("is_active", true).maybeSingle()
      .then(({ data }) => setWatchingMatrix(!!data));
  }, [supabase, scope]);
  async function toggleWatchMatrix() {
    if (!scope) return;
    setError(null);
    if (watchingMatrix) {
      const { error } = await supabase.from("update_alerts").delete().eq("kind", "matrix_refresh").eq("competitor_id", scope);
      if (error) setError(error.message); else setWatchingMatrix(false);
    } else {
      const orgId = await getOrgId(); if (!orgId) return;
      const { error } = await supabase.from("update_alerts").insert({ org_id: orgId, kind: "matrix_refresh", competitor_id: scope });
      if (error) setError(error.message); else setWatchingMatrix(true);
    }
  }

  // Evidence-derived scoring: the agent proposes matrix scores for this rival
  // from its signals/themes; each lands in the review gate (Signals → Review).
  async function runScore() {
    if (!scope || !wfId || scoreBusy) return;
    setScoreBusy(true); setScoreNote(null); setError(null);
    try {
      const { data, error } = await supabase.functions.invoke("score-capabilities", { body: { competitor_id: scope, workflow_id: wfId } });
      if (error) throw error;
      setScoreNote((data as { message?: string })?.message ?? "Done.");
    } catch (e) { setError(e instanceof Error ? e.message : "Scoring failed."); }
    finally { setScoreBusy(false); }
  }


  // Tile grid — pick a competitor to drill in. Add / remove competitors here.
  if (!scope) {
    return (
      <Section label="Competitors" action={!addingComp ? <button className="btn btn-secondary btn-sm" onClick={() => setAddingComp(true)}>+ Competitor</button> : undefined}>
        {pendingDelete && (
          <ConfirmDialog
            title="Remove competitor?"
            message={<>Remove <b>{pendingDelete.name}</b> from competitive intel? This deletes its capability scores and battlecards, and can&rsquo;t be undone.</>}
            confirmLabel="Remove" onConfirm={doRemoveComp} onCancel={() => setPendingDelete(null)}
          />
        )}
        {addingComp && (
          <form onSubmit={addCompetitor} className="card card-pad" style={{ marginBottom: "var(--sp-3)" }}>
            <div className="row gap-2">
              <input className="input" autoFocus placeholder="Competitor name" value={comp.name} onChange={(e) => setComp({ ...comp, name: e.target.value })} style={{ flex: 1 }} />
              <select className="select" value={comp.relationship} onChange={(e) => setComp({ ...comp, relationship: e.target.value })} style={{ width: 140 }}>
                <option value="direct">Direct</option><option value="adjacent">Adjacent</option><option value="watching">Watching</option>
              </select>
              <button className="btn btn-sm" type="submit">Add</button>
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => setAddingComp(false)}>Cancel</button>
            </div>
          </form>
        )}
        {competitors.length === 0 && !addingComp ? (
          <div className="t-sub t-muted">No competitors yet. Add direct and adjacent competitors — each gets an overview, battlecard, product board, and signal feed here.</div>
        ) : (
          <div className="stack-3">
            {REL_TIERS.map((tier) => {
              const group = competitors.filter((c) => c.relationship === tier);
              if (!group.length) return null;
              return (
            <div key={tier}>
            <div className="t-label" style={{ color: "var(--tm)", marginBottom: 8 }}>{tier === "direct" ? "Direct — head-on rivals" : tier === "adjacent" ? "Adjacent — partial overlap" : "Watching — on the radar"} · {group.length}</div>
          <div className="grid-cards">
            {group.map((c) => {
              const e = edge(c.id);
              return (
                <div key={c.id} className="card card-link card-pad" style={{ textAlign: "left", cursor: "pointer", position: "relative" }} onClick={() => { setScope(c.id); setCdTab("overview"); }}>
                  <div className="row-between" style={{ marginBottom: 8, gap: 6 }}>
                    <span style={{ fontSize: 15, fontWeight: 620 }}>{c.name}</span>
                    <span className="row gap-2" style={{ alignItems: "center" }}>
                      <Chip tone={relTone(c.relationship)}>{c.relationship}</Chip>
                      <button onClick={(ev) => { ev.stopPropagation(); setPendingDelete(c); }} title={`Remove ${c.name}`} aria-label={`Remove ${c.name}`}
                        style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, lineHeight: 1, color: "var(--tm)", padding: "0 2px" }}>×</button>
                    </span>
                  </div>
                  <div className="row gap-2" style={{ flexWrap: "wrap" }}>
                    <span className="t-mono-xs" style={{ color: "var(--gn-text)" }}>we lead {e.we}</span>
                    <span className="t-mono-xs" style={{ color: "var(--am-text)" }}>they lead {e.they}</span>
                    <span className="t-mono-xs" style={{ color: "var(--tm)" }}>{countFor(c.id)} card{countFor(c.id) === 1 ? "" : "s"}</span>
                  </div>
                </div>
              );
            })}
          </div>
            </div>
              );
            })}
          </div>
        )}
      </Section>
    );
  }

  return (
    <div>
      <div className="row-between" style={{ marginBottom: "var(--sp-5)" }}>
        <button className="t-sub" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontWeight: 600, background: "none", border: "none", cursor: "pointer" }} onClick={() => { setScope(null); setAdding(null); }}>
          <span style={{ fontSize: 15 }}>‹</span> All competitors
        </button>
        <div className="row gap-2"><span className="t-h2" style={{ fontSize: 15 }}>{selected?.name}</span>{selected && <Chip tone={relTone(selected.relationship)}>{selected.relationship}</Chip>}</div>
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        <div className="row" style={{ gap: 4, padding: "8px 8px 0", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
          {([["overview", "Overview"], ["profile", "Signal profile"], ["themes", `Themes${scope && themes.filter((t) => t.competitor_id === scope).length ? ` · ${themes.filter((t) => t.competitor_id === scope).length}` : ""}`], ["gtm", "GTM battlecard"], ["product", "Product board"], ["signals", `Signals${sigsFor(scope).length ? ` · ${sigsFor(scope).length}` : ""}`]] as [CdTab, string][]).map(([k, label]) => {
            const on = cdTab === k;
            return <button key={k} onClick={() => setCdTab(k)} style={{ background: "none", border: "none", borderBottom: on ? "2px solid var(--ac)" : "2px solid transparent", color: on ? "var(--tp)" : "var(--ts)", fontWeight: on ? 680 : 600, fontSize: 13, padding: "8px 14px", cursor: "pointer", marginBottom: -1 }}>{label}</button>;
          })}
        </div>
        <div style={{ padding: "var(--sp-4)" }}>

      {cdTab === "overview" ? (() => {
        const theirStrong = capabilities.filter((c) => scope && scoreOf(c.id, scope) >= 2);
        const weLead = capabilities.filter((c) => scope && scoreOf(c.id, null) > scoreOf(c.id, scope));
        const theyLead = capabilities.filter((c) => scope && scoreOf(c.id, scope) > scoreOf(c.id, null));
        return (
          <div className="stack-3">
            {/* Identity — carried over from discovery (website + LinkedIn). The
                per-competitor Finalize flow reuses these to stand up monitoring. */}
            {(selected?.website || selected?.linkedin) && (
              <div className="row gap-2" style={{ flexWrap: "wrap", alignItems: "center" }}>
                {selected?.website && <a className="chip" href={selected.website.startsWith("http") ? selected.website : `https://${selected.website}`} target="_blank" rel="noreferrer">🌐 {selected.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}</a>}
                {selected?.linkedin && <a className="chip" href={selected.linkedin.startsWith("http") ? selected.linkedin : `https://${selected.linkedin}`} target="_blank" rel="noreferrer">📣 LinkedIn</a>}
              </div>
            )}
            {/* deep overview — editable */}
            <div className="card card-pad" style={{ background: "var(--panel-2)" }}>
              <div className="row-between" style={{ marginBottom: editNotes ? 8 : 4 }}>
                <span className="t-label" style={{ color: "var(--tm)" }}>Overview</span>
                {!editNotes && <button className="btn btn-secondary btn-sm" onClick={() => { setNotes(selected?.notes ?? ""); setEditNotes(true); }}>Edit</button>}
              </div>
              {editNotes ? (
                <>
                  <textarea className="textarea" rows={4} autoFocus value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Who they are, how they position, where they're strong and weak, recent moves." style={{ marginBottom: 8 }} />
                  <div className="row gap-2"><button className="btn btn-sm" onClick={saveNotes}>Save</button><button className="btn btn-secondary btn-sm" onClick={() => setEditNotes(false)}>Cancel</button></div>
                </>
              ) : (
                <div className="t-body" style={{ fontSize: 13, lineHeight: 1.6 }}>{selected?.notes || <span className="t-muted">No overview yet. Add who they are and how they position.</span>}</div>
              )}
            </div>

            {/* us vs them */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-4)" }}>
              <div className="card card-pad" style={{ borderTop: "2px solid var(--vl)" }}>
                <div className="t-label" style={{ color: "var(--tm)", marginBottom: 6 }}>Them · {selected?.name}</div>
                <div className="t-label" style={{ color: "var(--tm)", fontSize: 10.5, marginBottom: 4 }}>Strong on</div>
                <div className="row gap-2" style={{ flexWrap: "wrap" }}>
                  {theirStrong.length ? theirStrong.map((c) => <Chip key={c.id} tone="violet">{c.name}</Chip>) : <span className="t-sub t-muted" style={{ fontSize: 12 }}>—</span>}
                </div>
              </div>
              <div className="card card-pad" style={{ borderTop: "2px solid var(--ac)" }}>
                <div className="t-label" style={{ color: "var(--tm)", marginBottom: 6 }}>Us · {overview?.name ?? "Our product"}</div>
                <div className="t-sub" style={{ fontSize: 12.5, lineHeight: 1.5, marginBottom: 8 }}>{overview?.valueProp || overview?.overview || <span className="t-muted">Add a value proposition on your product record.</span>}</div>
                <div className="t-label" style={{ color: "var(--tm)", fontSize: 10.5, marginBottom: 4 }}>We lead on</div>
                <div className="row gap-2" style={{ flexWrap: "wrap", marginBottom: 8 }}>
                  {weLead.length ? weLead.map((c) => <Chip key={c.id} tone="green">{c.name}</Chip>) : <span className="t-sub t-muted" style={{ fontSize: 12 }}>—</span>}
                </div>
                <span className="t-mono-xs" style={{ color: theyLead.length ? "var(--am-text)" : "var(--gn-text)" }}>{theyLead.length ? `${theyLead.length} gap${theyLead.length === 1 ? "" : "s"} to close` : "ahead or even everywhere"}</span>
              </div>
            </div>

          </div>
        );
      })() : cdTab === "gtm" ? (
        <>
          <div className="row-between" style={{ marginBottom: 12, gap: 10, flexWrap: "wrap" }}>
            <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Best-practice sections — fill the ones that help a rep win against {selected?.name}.</div>
            <div className="row gap-2" style={{ flexShrink: 0, alignItems: "center" }}>
              {workflows.length > 0 && (
                <select className="select" value={wfId} onChange={(e) => setWfId(e.target.value)} style={{ maxWidth: 220 }} title="The workflow whose steps power the battlecard pair: step 1 = analyst, step 2 = messenger">
                  {workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              )}
              <button className="btn btn-secondary btn-sm" disabled={!!agentBusy || !stepReady(0)} onClick={() => runAgent("analyst")}
                title={stepReady(0) ? "Step 1 (your agent × analyst skill): proposes items from this competitor's themes + matrix, citing signals" : "Needs a workflow with step 1 = agent × analyst skill"}>
                {agentBusy === "analyst" ? "Analyzing…" : "✦ Run analyst step"}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={toggleWatch}
                title={watching ? "Stop alerting when new evidence lands for this battlecard" : "Alert me on the homepage when new evidence lands for this battlecard"}>
                {watching ? "🔔 Watching" : "🔕 Watch updates"}
              </button>
              <button className="btn btn-secondary btn-sm" disabled={!!agentBusy || !stepReady(1)} onClick={() => runAgent("messaging")}
                title={stepReady(1) ? "Step 2 (your agent × messenger skill): drafts the GTM Battlecard section from the ratified items" : "Needs a workflow with step 2 = agent × messenger skill"}>
                {agentBusy === "messaging" ? "Drafting…" : "✦ Run messenger step"}
              </button>
            </div>
          </div>
          {(!wf || !stepReady(0)) && (
            <div className="card card-pad" style={{ marginBottom: 12, background: "var(--panel-2)", fontSize: 12.5 }}>
              The battlecard pair runs <b>your</b> agents and skills — cornerstone identity + the analyst and messenger play skills, chained in a workflow. One click stands the whole chain up; everything it ever produces still goes through your review.
              <div style={{ marginTop: 8 }}>
                <button className="btn btn-sm" disabled={standBusy} onClick={standUpHere}>{standBusy ? "Standing up…" : "✦ Stand up analysis + messaging"}</button>
              </div>
            </div>
          )}
          {agentNote && <div className="card card-pad" style={{ marginBottom: 12, background: "var(--panel-2)", fontSize: 12.5 }}>{agentNote}</div>}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-4)" }}>
            {KINDS.map(([kind, label, tone]) => (
              <Section key={kind} label={label} action={adding !== kind ? <button className="btn btn-secondary btn-sm" onClick={() => { setAdding(kind); setForm({ title: "", detail: "" }); }}>+ Add</button> : undefined}>
                {adding === kind && (
                  <div className="card card-pad" style={{ marginBottom: "var(--sp-3)" }}>
                    <input className="input" autoFocus placeholder="Point" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} style={{ marginBottom: 8 }} />
                    <textarea className="textarea" rows={2} placeholder="Detail (optional)" value={form.detail} onChange={(e) => setForm({ ...form, detail: e.target.value })} style={{ marginBottom: 8 }} />
                    <div className="row gap-2"><button className="btn btn-sm" onClick={() => add(kind)}>Add</button><button className="btn btn-secondary btn-sm" onClick={() => setAdding(null)}>Cancel</button></div>
                  </div>
                )}
                <div className="stack-3">
                  {cardsFor(kind).map((c) => (
                    <div key={c.id} className="card card-pad card-link" onClick={() => setOpenCard(c)} title="Open card — detail, evidence, edit, re-examine, chat"
                      style={{ borderLeft: `2px solid ${TONE_BORDER[tone] ?? "var(--border-strong)"}`, cursor: "pointer" }}>
                      <div className="row-between">
                        <span className="row gap-2" style={{ alignItems: "center", minWidth: 0 }}>
                          <span style={{ fontSize: 13.5, fontWeight: 620 }}>{c.title}</span>
                          {c.proposed_by && <Chip tone="violet">✦ {c.proposed_by}</Chip>}
                          {c.audience !== "field" && <Chip tone="amber">internal</Chip>}
                        </span>
                        <button className="t-muted" onClick={(ev) => { ev.stopPropagation(); remove(c.id); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15 }} aria-label="Remove">×</button>
                      </div>
                      {c.detail && <div className="t-sub" style={{ fontSize: 12.5, marginTop: 3 }}>{c.detail}</div>}
                    </div>
                  ))}
                  {cardsFor(kind).length === 0 && adding !== kind && <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>None yet.</div>}
                </div>
              </Section>
            ))}
          </div>
        </>
      ) : cdTab === "product" ? (
        <Section label="Product board — capability by capability, us vs them" action={
          <div className="row gap-2" style={{ alignItems: "center", flexShrink: 0 }}>
            {workflows.length > 0 && (
              <select className="select" value={wfId} onChange={(e) => setWfId(e.target.value)} style={{ maxWidth: 200 }} title="The workflow whose step 1 (agent × skill) does the scoring">
                {workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            )}
            <button className="btn btn-secondary btn-sm" disabled={scoreBusy || !stepReady(0) || capabilities.length === 0} onClick={runScore}
              title={stepReady(0) ? `Step 1 (your agent × skill) scores ${selected?.name ?? "them"} on each capability from their signals — each score cites its evidence and lands in Signals → Review` : "Needs a workflow with step 1 = agent × skill"}>
              {scoreBusy ? "Scoring…" : "✦ Score from evidence"}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={toggleWatchMatrix}
              title={watchingMatrix ? "Stop alerting when new evidence lands after these scores" : "Alert me on the homepage when new evidence lands after these scores"}>
              {watchingMatrix ? "🔔 Watching" : "🔕 Watch matrix"}
            </button>
          </div>
        }>
          {scoreNote && <div className="card card-pad" style={{ marginBottom: 12, background: "var(--panel-2)", fontSize: 12.5 }}>{scoreNote}</div>}
          {(!wf || !stepReady(0)) && (
            <div className="card card-pad" style={{ marginBottom: 12, background: "var(--panel-2)", fontSize: 12.5 }}>
              Scoring runs <b>your</b> agent × the evidence-scoring play skill via a workflow. One click stands it up; every score still cites its evidence and lands in <b>Signals → Review</b> for your verdict.
              <div style={{ marginTop: 8 }}>
                <button className="btn btn-sm" disabled={standBusy} onClick={standUpHere}>{standBusy ? "Standing up…" : "✦ Stand up the scoring workflow"}</button>
              </div>
            </div>
          )}
          {capabilities.length === 0 ? <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No capabilities defined yet. Add them on the Dashboard matrix.</div> : (
            <div className="card" style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
                <thead><tr>
                  <th style={{ textAlign: "left", padding: "10px 14px", fontSize: 11, fontWeight: 600, color: "var(--tm)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Capability</th>
                  <th style={{ padding: "10px 10px", fontSize: 12, fontWeight: 700, color: "var(--ac-text)" }}>Us</th>
                  <th style={{ padding: "10px 10px", fontSize: 12, fontWeight: 600 }}>{selected?.name}</th>
                  <th style={{ padding: "10px 10px", fontSize: 11, fontWeight: 600, color: "var(--tm)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Edge</th>
                </tr></thead>
                <tbody>
                  {capabilities.map((cap) => {
                    const us = scoreOf(cap.id, null), them = scope ? scoreOf(cap.id, scope) : 0;
                    const ed = us - them;
                    const cell = (compId: string | null, sc: number, who: string) => {
                      const p = scores.find((x) => x.capability_id === cap.id && x.competitor_id === compId);
                      const stale = !!(compId && p?.scored_by && p.evidence_at && compSignals.some((sg) => sigComp(sg) === compId && sg.observed_at && sg.observed_at > p.evidence_at!));
                      return (
                        <button onClick={() => setOpenCell({ capabilityId: cap.id, capabilityName: cap.name, competitorId: compId, who, score: sc, competitorNotes: selected?.notes ?? null, productValueProp: overview?.valueProp ?? overview?.overview ?? null })}
                          title={`${heatText(sc)}${p?.scored_by ? ` — ✦ scored from evidence by ${p.scored_by}` : " — set by hand"}${stale ? " · new evidence since scored" : ""}`}
                          style={{ minWidth: 58, padding: "5px 10px", borderRadius: 6, border: "1px solid var(--border)", background: heat(sc), fontSize: 11, fontWeight: 600, cursor: "pointer", position: "relative" }}>
                          {heatText(sc)}{p?.scored_by ? " ✦" : ""}
                          {stale && <span style={{ position: "absolute", top: 2, right: 3, width: 6, height: 6, borderRadius: 3, background: "var(--am-text)" }} />}
                        </button>
                      );
                    };
                    return (
                      <tr key={cap.id} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={{ padding: "8px 14px", fontWeight: 600 }}>{cap.name}</td>
                        <td style={{ padding: "6px 10px", textAlign: "center" }}>{cell(null, us, "Us")}</td>
                        <td style={{ padding: "6px 10px", textAlign: "center" }}>{cell(scope, them, selected?.name ?? "Competitor")}</td>
                        <td style={{ padding: "6px 10px", textAlign: "center", fontWeight: 700, color: ed > 0 ? "var(--gn-text)" : ed < 0 ? "var(--rd-text)" : "var(--tm)" }}>{ed > 0 ? `+${ed}` : ed}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="t-sub t-muted" style={{ fontSize: 11.5, marginTop: 8 }}>Click any cell for the officer&rsquo;s reasoning, sources, and the rating control.</div>
        </Section>
      ) : cdTab === "profile" ? (
        <SignalProfile scope="competitor" competitorId={scope} competitorName={selected?.name} />
      ) : cdTab === "themes" ? (
        <div className="stack-3">
          <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>
            Synthesized from {selected?.name}&rsquo;s signals — grouped by lens. <b>Product</b> moves inform the capability matrix and our technical foundation; <b>GTM</b> moves inform battlecards and our messaging. Run synthesis in the Signal feed to refresh.
          </div>
          {(["product", "gtm"] as const).map((cat) => {
            const list = themesFor(scope, cat);
            return (
              <Section key={cat} label={cat === "product" ? "Product moves" : "GTM moves"}>
                {list.length === 0 ? (
                  <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No {cat === "product" ? "product" : "GTM"} themes yet for {selected?.name}. Log {cat === "product" ? "capability/roadmap" : "pricing/messaging"} signals and run synthesis.</div>
                ) : (
                  <div className="stack-3">
                    {list.map((t) => (
                      <div key={t.id} className="card card-pad" style={{ borderLeft: `3px solid ${cat === "product" ? "var(--ac)" : "var(--vl)"}` }}>
                        <div className="row-between" style={{ gap: 12, alignItems: "flex-start", marginBottom: 4 }}>
                          <span style={{ fontSize: 14, fontWeight: 620 }}>{t.title}</span>
                          <div className="row gap-2" style={{ flexShrink: 0, alignItems: "center" }}>
                            {t.state && <Chip tone={cat === "product" ? "accent" : "violet"}>{t.state}</Chip>}
                            <Confidence label={null} level={t.conf_level} />
                          </div>
                        </div>
                        {t.summary && <div className="t-sub t-muted" style={{ fontSize: 12.5, lineHeight: 1.45 }}>{t.summary}</div>}
                        {t.recommendation && <div className="t-sub" style={{ fontSize: 12.5, marginTop: 6 }}><b>Recommendation:</b> {t.recommendation}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            );
          })}
        </div>
      ) : (
        <div>
          {/* Monitored links — several per competitor, each with instructions
              (guidance), include/exclude, a daily/weekly cadence, and Pull now.
              Harvested signals carry competitor_id → they land in the org feed
              AND right here. */}
          <SourceManager title={`Monitored links — ${selected?.name ?? "competitor"}`} scope={{ competitorId: scope ?? undefined }} />

          <Section label={`Signals on ${selected?.name}`} action={
            <button className="btn btn-sm" onClick={() => setLogOpen((v) => !v)} style={{ background: "var(--ac)", color: "#fff" }}>{logOpen ? "Close" : "+ Log signal"}</button>
          }>
          {logOpen && (
            <form onSubmit={logSignal} className="card card-pad" style={{ marginBottom: "var(--sp-3)", background: "var(--panel-2)" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--sp-3)" }}>
                <label className="field"><span className="t-label">Origin</span>
                  <select className="select" value={logForm.origin} onChange={(e) => setLogForm({ ...logForm, origin: e.target.value, channel: "" })}>
                    <option value="internal">Internal — what we hear</option>
                    <option value="external">External — public</option>
                  </select></label>
                <label className="field"><span className="t-label">Channel</span>
                  <select className="select" value={logForm.channel} onChange={(e) => setLogForm({ ...logForm, channel: e.target.value })}>
                    <option value="">— where from —</option>
                    {(logForm.origin === "internal" ? ["Gong call", "Salesforce opp", "Win/loss", "Support", "Field note"] : ["Website", "Pricing page", "G2 / reviews", "Launch / release", "Job posting", "News"]).map((c) => <option key={c} value={c}>{c}</option>)}
                  </select></label>
                <label className="field"><span className="t-label">Confidence</span>
                  <select className="select" value={logForm.conf} onChange={(e) => setLogForm({ ...logForm, conf: e.target.value })}>
                    <option value="0.9">High</option><option value="0.7">Medium</option><option value="0.4">Low</option>
                  </select></label>
              </div>
              <label className="field"><span className="t-label">What happened</span><input className="input" autoFocus value={logForm.title} onChange={(e) => setLogForm({ ...logForm, title: e.target.value })} placeholder={`e.g. ${selected?.name ?? "They"} shipped SSO on the Team plan`} /></label>
              <label className="field"><span className="t-label">Why it matters <span className="t-muted" style={{ fontWeight: 400 }}>— optional</span></span><input className="input" value={logForm.why} onChange={(e) => setLogForm({ ...logForm, why: e.target.value })} placeholder="So what for our positioning / battlecard?" /></label>
              <div className="row gap-2"><button className="btn btn-sm" type="submit" disabled={logBusy}>{logBusy ? "Logging…" : "Log signal"}</button><button className="btn btn-secondary btn-sm" type="button" onClick={() => setLogOpen(false)}>Cancel</button></div>
            </form>
          )}
          {sigsFor(scope).length === 0 && !logOpen ? <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No signals on {selected?.name} yet. Log one above, or add monitored links — daily/weekly pulls land here automatically.</div> : (
            <div className="stack-3">
              {sigsFor(scope).map((s) => sigEdit?.id === s.id ? (
                <div key={s.id} className="card card-pad" style={{ borderLeft: "3px solid var(--ac)" }}>
                  <label className="field"><span className="t-label">What happened</span>
                    <input className="input" autoFocus value={sigEdit.title} onChange={(e) => setSigEdit({ ...sigEdit, title: e.target.value })} /></label>
                  <label className="field"><span className="t-label">Why it matters</span>
                    <input className="input" value={sigEdit.why} onChange={(e) => setSigEdit({ ...sigEdit, why: e.target.value })} /></label>
                  <div className="row gap-2" style={{ alignItems: "center" }}>
                    <select className="select" value={sigEdit.conf} onChange={(e) => setSigEdit({ ...sigEdit, conf: e.target.value })} style={{ width: 130 }}>
                      <option value="0.9">High</option><option value="0.7">Medium</option><option value="0.4">Low</option>
                    </select>
                    <button className="btn btn-sm" onClick={saveSignal}>Save</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setSigEdit(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div key={s.id} className="card card-pad signal-card" style={{ borderLeft: "3px solid var(--vl)" }}>
                  <div className="row-between" style={{ gap: 12, alignItems: "flex-start", marginBottom: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 620 }}>{s.title}</span>
                    <span className="row gap-2" style={{ alignItems: "center", flexShrink: 0 }}>
                      <Confidence label={s.conf_label} level={s.conf_level} />
                      <button className="t-mono-xs" onClick={() => setSigEdit({ id: s.id, title: s.title, why: s.why ?? "", conf: String(s.conf_level ?? 0.7) })}
                        title="Edit this signal" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ac-text, var(--ac))", fontWeight: 600, padding: 0 }}>✎</button>
                      <button className="t-muted" onClick={() => removeSignal(s.id)} title="Remove this signal"
                        style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, padding: 0 }}>×</button>
                    </span>
                  </div>
                  {s.why && <div className="t-sub t-muted" style={{ fontSize: 12.5, lineHeight: 1.45 }}>{s.why}</div>}
                </div>
              ))}
            </div>
          )}
          </Section>
        </div>
      )}
        </div>
      </div>
      <CapabilityCellDrawer key={openCell ? `${openCell.capabilityId}:${openCell.competitorId}` : "none"} cell={openCell} onClose={() => setOpenCell(null)} onChanged={reload} />
      <BattlecardItemDrawer item={openCard} competitorName={selected?.name ?? "Competitor"} workflowId={wfId || null}
        onClose={() => setOpenCard(null)} onChanged={() => { setOpenCard(null); reload(); }} />
    </div>
  );
}

// ---------- Signal feed — internal vs external, filterable, with capture ----------
// Competitive intel is BOTH internal (what our own teams hear — deals, calls,
// win/loss) and external (public — reviews, launches, pricing). The Signal
// Profile synthesizes across both, so capture them here with origin + competitor.
function Feed({ signals, competitors, reload }: { signals: Signal[]; competitors: Competitor[]; reload: () => void }) {
  const supabase = createClient();
  const [originTab, setOriginTab] = useState<"external" | "internal">("external");
  const [compFilter, setCompFilter] = useState<string>("all");
  // Tier filter: keeps the stream readable as the tracked set grows.
  const [relTier, setRelTier] = useState<string>("all");
  const tierOf = (id: string | null) => competitors.find((c) => c.id === id)?.relationship ?? null;
  const [logging, setLogging] = useState(false);
  const [form, setForm] = useState({ title: "", why: "", origin: "internal", competitor_id: "", channel: "", conf: "0.7" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const compName = (id?: string) => competitors.find((c) => c.id === id)?.name;
  const all = signals.filter((s) => signalDomain(s) === SIGNAL_DOMAIN.competitive);
  const feed = all.filter((s) => (originTab === "internal" ? s.origin === "internal" : s.origin !== "internal"))
    .filter((s) => compFilter === "all" || sigComp(s) === compFilter)
    .filter((s) => relTier === "all" || tierOf(sigComp(s)) === relTier);
  const counts = { internal: all.filter((s) => s.origin === "internal").length, external: all.filter((s) => s.origin !== "internal").length };
  const CHANNELS = form.origin === "internal" ? ["Gong call", "Salesforce opp", "Win/loss", "Support", "Field note"] : ["Website", "Pricing page", "G2 / reviews", "Launch / release", "Job posting", "News"];

  async function log(e: React.FormEvent) {
    e.preventDefault(); if (!form.title.trim()) return;
    setBusy(true); setErr(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      const lvl = parseFloat(form.conf);
      const { error } = await supabase.from("signals").insert({
        org_id: orgId, scope: "org", title: form.title.trim(), why: form.why.trim() || null,
        conf_level: isNaN(lvl) ? null : lvl, conf_label: isNaN(lvl) ? null : lvl >= 0.75 ? "High" : lvl >= 0.5 ? "Medium" : "Low",
        observed_at: new Date().toISOString(), origin: form.origin,
        // First-class link drives synthesis; metadata stays mirrored for the
        // legacy readers (capability cell drawer, synthesize-profile).
        competitor_id: form.competitor_id || null,
        metadata: { domain: "competitive", competitor_id: form.competitor_id || undefined, channel: form.channel || undefined },
      });
      if (error) throw error;
      setLogging(false); setForm({ title: "", why: "", origin: form.origin, competitor_id: "", channel: "", conf: "0.7" }); reload();
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not log the signal."); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <SourceManager title="Competitive sources" />
      <TrackingTopics category="competitive" suggestions={["Competitor pricing & packaging changes", "New competitor launches", "Win/loss themes vs top rivals", "Competitor messaging shifts"]} />

      <Section label="Competitive signals" action={<button className="btn btn-sm" onClick={() => setLogging((v) => !v)} style={{ background: "var(--ac)", color: "#fff" }}>{logging ? "Close" : "+ Log signal"}</button>}>
        <Banner>{err}</Banner>
        {logging && (
          <form onSubmit={log} className="card card-pad" style={{ marginBottom: "var(--sp-3)", background: "var(--panel-2)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--sp-3)" }}>
              <label className="field"><span className="t-label">Origin</span>
                <select className="select" value={form.origin} onChange={(e) => setForm({ ...form, origin: e.target.value, channel: "" })}>
                  <option value="internal">Internal — what we hear</option>
                  <option value="external">External — public</option>
                </select></label>
              <label className="field"><span className="t-label">Competitor</span>
                <select className="select" value={form.competitor_id} onChange={(e) => setForm({ ...form, competitor_id: e.target.value })}>
                  <option value="">— none / general —</option>
                  {competitors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select></label>
              <label className="field"><span className="t-label">Channel</span>
                <select className="select" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
                  <option value="">— where from —</option>
                  {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select></label>
            </div>
            <label className="field"><span className="t-label">What happened</span><input className="input" autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={form.origin === "internal" ? "e.g. Acme undercut us 20% in the Globex deal" : "e.g. Acme shipped SSO/SAML on the Team plan"} /></label>
            <label className="field"><span className="t-label">Why it matters <span className="t-muted" style={{ fontWeight: 400 }}>— optional</span></span><input className="input" value={form.why} onChange={(e) => setForm({ ...form, why: e.target.value })} placeholder="So what for our positioning / strategy?" /></label>
            <div className="row gap-2"><button className="btn btn-sm" type="submit" disabled={busy}>{busy ? "Logging…" : "Log signal"}</button><button className="btn btn-secondary btn-sm" type="button" onClick={() => setLogging(false)}>Cancel</button></div>
          </form>
        )}

        {/* Internal vs external + competitor filter */}
        <div className="row-between" style={{ alignItems: "center", marginBottom: "var(--sp-3)", gap: 8, flexWrap: "wrap" }}>
          <div className="row" style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
            {(["external", "internal"] as const).map((o) => (
              <button key={o} onClick={() => setOriginTab(o)} className="btn-sm" style={{ border: "none", background: originTab === o ? "var(--ac)" : "var(--panel)", color: originTab === o ? "#fff" : "var(--ts)", fontWeight: 600, padding: "6px 14px", cursor: "pointer", textTransform: "capitalize" }}>{o} · {counts[o]}</button>
            ))}
          </div>
          <span className="row" style={{ gap: 2, alignItems: "center" }}>
            {[["all", "All"], ...REL_TIERS.map((t) => [t, t.charAt(0).toUpperCase() + t.slice(1)])].map(([k, label]) => {
              const n = k === "all" ? competitors.length : competitors.filter((c) => c.relationship === k).length;
              if (k !== "all" && n === 0) return null;
              return (
                <button key={k} onClick={() => setRelTier(k as string)} className="t-mono-xs"
                  style={{ padding: "3px 9px", borderRadius: 6, border: "none", cursor: "pointer", background: relTier === k ? "var(--ac)" : "var(--fill)", color: relTier === k ? "#fff" : "var(--tm)", fontWeight: 600 }}>{label}</button>
              );
            })}
          </span>
          <select className="select" value={compFilter} onChange={(e) => setCompFilter(e.target.value)} style={{ maxWidth: 220 }}>
            <option value="all">All competitors</option>
            {competitors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {feed.length === 0 ? (
          <div className="t-sub t-muted">No {originTab} competitive signals{compFilter !== "all" ? ` for ${compName(compFilter)}` : ""} yet. {originTab === "internal" ? "Log what your teams hear in deals and calls." : "Log public moves or add sources above."}</div>
        ) : (
          <div className="stack-3">
            {feed.map((s) => (
              <div key={s.id} className="card card-pad" style={{ borderLeft: `3px solid ${s.origin === "internal" ? "var(--ac)" : "var(--vl)"}` }}>
                <div className="row-between" style={{ gap: 12, alignItems: "flex-start", marginBottom: 5 }}>
                  <span style={{ fontSize: 14.5, fontWeight: 620 }}>{s.title}</span>
                  <Confidence label={s.conf_label} level={s.conf_level} />
                </div>
                {s.why && <p className="t-sub" style={{ lineHeight: 1.5 }}>{s.why}</p>}
                <div className="row gap-2" style={{ marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <Chip tone={s.origin === "internal" ? "accent" : "violet"}>{s.origin === "internal" ? "internal" : "external"}</Chip>
                  {sigComp(s) && <Chip>{compName(sigComp(s) ?? undefined) ?? "competitor"}</Chip>}
                  {s.metadata?.channel && <span className="t-mono-xs t-muted">{s.metadata.channel}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
