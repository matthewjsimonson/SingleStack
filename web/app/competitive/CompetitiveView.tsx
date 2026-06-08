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

type Competitor = { id: string; name: string; relationship: string; website: string | null; notes: string | null };
type Capability = { id: string; name: string; category: string | null };
type Score = { id: string; capability_id: string; competitor_id: string | null; score: number };
type Card = { id: string; competitor_id: string | null; kind: string; title: string; detail: string | null };
type Signal = { id: string; title: string; why: string | null; conf_label: string | null; conf_level: number | null; observed_at: string | null; origin: string | null; metadata: { domain?: string; competitor_id?: string; channel?: string } | null; source_id: string | null };

type Tab = "dashboard" | "profile" | "competitors" | "feed";

export default function CompetitiveView() {
  const supabase = createClient();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [scores, setScores] = useState<Score[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [overview, setOverview] = useState<{ name: string; overview: string | null; valueProp: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: comp }, { data: caps }, { data: scs }, { data: cds }, { data: sigs }] = await Promise.all([
      supabase.from("competitors").select("id, name, relationship, website, notes").order("position").order("created_at"),
      supabase.from("capabilities").select("id, name, category").order("position").order("created_at"),
      supabase.from("capability_scores").select("id, capability_id, competitor_id, score"),
      supabase.from("battlecard_items").select("id, competitor_id, kind, title, detail").order("position").order("created_at"),
      supabase.from("signals").select("id, title, why, conf_label, conf_level, observed_at, origin, metadata, source_id").order("observed_at", { ascending: false, nullsFirst: false }),
    ]);
    setCompetitors(comp ?? []); setCapabilities(caps ?? []); setScores(scs ?? []); setCards(cds ?? []); setSignals(sigs ?? []);
    // Our product overview — anchors the "us vs them" framing on battlecards.
    const { data: prod } = await supabase.from("product_records").select("id, name").order("created_at").limit(1).maybeSingle();
    if (prod) {
      const { data: fs } = await supabase.from("record_fields").select("field_key, value").eq("product_id", prod.id).in("field_key", ["overview", "value_prop"]);
      setOverview({ name: prod.name, overview: fs?.find((f) => f.field_key === "overview")?.value ?? null, valueProp: fs?.find((f) => f.field_key === "value_prop")?.value ?? null });
    }
    setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const compSignals = signals.filter((s) => s.metadata?.domain === "competitive");

  return (
    <div>
      <SubTabs<Tab>
        tabs={[{ key: "dashboard", label: "Dashboard" }, { key: "profile", label: "Signal profile" }, { key: "competitors", label: "Competitors" }, { key: "feed", label: "Signal feed" }]}
        active={tab} onChange={setTab}
      />
      <Banner>{error}</Banner>

      {loading ? <div className="t-sub t-muted">Loading…</div>
        : tab === "dashboard" ? <Dashboard competitors={competitors} capabilities={capabilities} scores={scores} compSignals={compSignals} overview={overview} reload={load} setError={setError} />
        : tab === "profile" ? <SignalProfile scope="landscape" />
        : tab === "competitors" ? <Competitors competitors={competitors} cards={cards} overview={overview} capabilities={capabilities} scores={scores} compSignals={compSignals} reload={load} setError={setError} />
        : <Feed signals={signals} competitors={competitors} reload={load} />}
    </div>
  );
}

// ---------- Dashboard: capability heat-map + metrics ----------
function Dashboard({ competitors, capabilities, scores, compSignals, overview, reload, setError }: {
  competitors: Competitor[]; capabilities: Capability[]; scores: Score[]; compSignals: Signal[]; overview: { name: string; overview: string | null; valueProp: string | null } | null; reload: () => void; setError: (s: string | null) => void;
}) {
  const supabase = createClient();
  const [addingCap, setAddingCap] = useState(false);
  const [capName, setCapName] = useState("");
  const [openCell, setOpenCell] = useState<Cell | null>(null);
  const [openMetric, setOpenMetric] = useState<"gaps" | "moves" | null>(null);
  const [matrixView, setMatrixView] = useState<"matrix" | "grid">("matrix");

  const direct = competitors.filter((c) => c.relationship === "direct");
  const scoreOf = (capId: string, compId: string | null) => scores.find((s) => s.capability_id === capId && s.competitor_id === compId)?.score ?? 0;

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

  return (
    <div>
      {/* Capability matrix / momentum grid — the differentiator, up top */}
      <Section label="Capability landscape" action={
        <div className="row gap-2">
          <div className="row" style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
            {(["matrix", "grid"] as const).map((v) => (
              <button key={v} onClick={() => setMatrixView(v)} className="btn-sm" style={{ border: "none", background: matrixView === v ? "var(--ac)" : "var(--panel)", color: matrixView === v ? "#fff" : "var(--ts)", fontWeight: 600, padding: "6px 12px", cursor: "pointer" }}>{v === "matrix" ? "Matrix" : "Grid"}</button>
            ))}
          </div>
          {!addingCap && <button className="btn btn-secondary btn-sm" onClick={() => setAddingCap(true)}>+ Capability</button>}
        </div>
      }>
        <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>{matrixView === "matrix" ? "Functionality vectors × competitors (you vs each). Click any cell for the agent's read — reasons, sources, implications — then set the rating yourself." : "Coverage × momentum quadrant — where each player sits, you vs them (G2-style). Top-right leads."}</div>
        {matrixView === "grid" ? (
          capabilities.length === 0 ? <div className="t-sub t-muted">Add capabilities to plot the grid.</div>
          : <CompetitiveGrid competitors={competitors} capabilities={capabilities} scores={scores} compSignals={compSignals} />
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
                  {competitors.map((c) => <th key={c.id} style={{ padding: "10px 8px", fontWeight: 600, fontSize: 12, color: "var(--ts)" }}>{c.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {capabilities.map((cap) => (
                  <tr key={cap.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "8px 14px", fontWeight: 600 }}>{cap.name}</td>
                    {[null, ...competitors.map((c) => c.id)].map((compId) => {
                      const s = scoreOf(cap.id, compId);
                      const who = compId === null ? "Us" : compById(compId)?.name ?? "Competitor";
                      return (
                        <td key={compId ?? "us"} style={{ padding: "6px 8px", textAlign: "center" }}>
                          <button onClick={() => setOpenCell({ capabilityId: cap.id, capabilityName: cap.name, competitorId: compId, who, score: s, competitorNotes: compById(compId)?.notes ?? null, productValueProp: overview?.valueProp ?? overview?.overview ?? null })} title={`${heatText(s)} — open for context`}
                            style={{ width: "100%", minWidth: 64, padding: "8px 6px", borderRadius: 6, border: compId === null ? "1px solid var(--ac)" : "1px solid var(--border)", background: heat(s), cursor: "pointer", fontSize: 11, fontWeight: 600, color: "var(--tp)" }}>
                            {heatText(s)}
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

      <CapabilityCellDrawer key={openCell ? `${openCell.capabilityId}:${openCell.competitorId}` : "none"} cell={openCell} onClose={() => setOpenCell(null)} onChanged={reload} />
    </div>
  );
}

// ---------- Battlecards ----------
type CdTab = "overview" | "profile" | "gtm" | "product" | "signals";

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
function Competitors({ competitors, cards, overview, capabilities, scores, compSignals, reload, setError }: {
  competitors: Competitor[]; cards: Card[]; overview: { name: string; overview: string | null; valueProp: string | null } | null;
  capabilities: Capability[]; scores: Score[]; compSignals: Signal[]; reload: () => void; setError: (s: string | null) => void;
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
    const { error } = await supabase.from("competitors").insert({ org_id: orgId, name: comp.name.trim(), relationship: comp.relationship });
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
  // Real competitor↔signal link (metadata.competitor_id), not a name match.
  const sigsFor = (compId: string | null) => (compId ? compSignals.filter((s) => s.metadata?.competitor_id === compId) : []);
  const edge = (compId: string) => capabilities.reduce((a, c) => { const u = scoreOf(c.id, null), t = scoreOf(c.id, compId); return { we: a.we + (u > t ? 1 : 0), they: a.they + (t > u ? 1 : 0) }; }, { we: 0, they: 0 });
  async function saveNotes() { if (!scope) return; setError(null); await supabase.from("competitors").update({ notes: notes.trim() || null }).eq("id", scope); setEditNotes(false); reload(); }

  async function add(kind: string) {
    if (!form.title.trim() || !scope) return;
    const orgId = await getOrgId(); if (!orgId) return;
    const { error } = await supabase.from("battlecard_items").insert({ org_id: orgId, competitor_id: scope, kind, title: form.title.trim(), detail: form.detail.trim() || null });
    if (error) setError(error.message); else { setAdding(null); setForm({ title: "", detail: "" }); reload(); }
  }
  async function remove(id: string) { setError(null); await supabase.from("battlecard_items").delete().eq("id", id); reload(); }


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
                <option value="direct">Direct</option><option value="adjacent">Adjacent</option>
              </select>
              <button className="btn btn-sm" type="submit">Add</button>
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => setAddingComp(false)}>Cancel</button>
            </div>
          </form>
        )}
        {competitors.length === 0 && !addingComp ? (
          <div className="t-sub t-muted">No competitors yet. Add direct and adjacent competitors — each gets an overview, battlecard, product board, and signal feed here.</div>
        ) : (
          <div className="grid-cards">
            {competitors.map((c) => {
              const e = edge(c.id);
              return (
                <div key={c.id} className="card card-link card-pad" style={{ textAlign: "left", cursor: "pointer", position: "relative" }} onClick={() => { setScope(c.id); setCdTab("overview"); }}>
                  <div className="row-between" style={{ marginBottom: 8, gap: 6 }}>
                    <span style={{ fontSize: 15, fontWeight: 620 }}>{c.name}</span>
                    <span className="row gap-2" style={{ alignItems: "center" }}>
                      <Chip tone={c.relationship === "direct" ? "accent" : "violet"}>{c.relationship}</Chip>
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
        <div className="row gap-2"><span className="t-h2" style={{ fontSize: 15 }}>{selected?.name}</span>{selected && <Chip tone={selected.relationship === "direct" ? "accent" : "violet"}>{selected.relationship}</Chip>}</div>
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        <div className="row" style={{ gap: 4, padding: "8px 8px 0", borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
          {([["overview", "Overview"], ["profile", "Signal profile"], ["gtm", "GTM battlecard"], ["product", "Product board"], ["signals", `Signals${sigsFor(scope).length ? ` · ${sigsFor(scope).length}` : ""}`]] as [CdTab, string][]).map(([k, label]) => {
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
          <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>Best-practice sections — fill the ones that help a rep win against {selected?.name}.</div>
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
                    <div key={c.id} className="card card-pad" style={{ borderLeft: `2px solid ${TONE_BORDER[tone] ?? "var(--border-strong)"}` }}>
                      <div className="row-between"><span style={{ fontSize: 13.5, fontWeight: 620 }}>{c.title}</span><button className="t-muted" onClick={() => remove(c.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15 }} aria-label="Remove">×</button></div>
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
        <Section label="Product board — capability by capability, us vs them">
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
                    const cell = (compId: string | null, sc: number, who: string) => (
                      <button onClick={() => setOpenCell({ capabilityId: cap.id, capabilityName: cap.name, competitorId: compId, who, score: sc, competitorNotes: selected?.notes ?? null, productValueProp: overview?.valueProp ?? overview?.overview ?? null })}
                        title={`${heatText(sc)} — open for the officer's read`} style={{ minWidth: 58, padding: "5px 10px", borderRadius: 6, border: "1px solid var(--border)", background: heat(sc), fontSize: 11, fontWeight: 600, cursor: "pointer" }}>{heatText(sc)}</button>
                    );
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
      ) : (
        <Section label={`Signals on ${selected?.name}`}>
          {sigsFor(scope).length === 0 ? <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No signals tagged to {selected?.name} yet. Log competitive intel in the Signal feed and tag it to them.</div> : (
            <div className="stack-3">
              {sigsFor(scope).map((s) => (
                <div key={s.id} className="card card-pad signal-card" style={{ borderLeft: "3px solid var(--vl)" }}>
                  <div className="row-between" style={{ gap: 12, alignItems: "flex-start", marginBottom: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 620 }}>{s.title}</span>
                    <Confidence label={s.conf_label} level={s.conf_level} />
                  </div>
                  {s.why && <div className="t-sub t-muted" style={{ fontSize: 12.5, lineHeight: 1.45 }}>{s.why}</div>}
                </div>
              ))}
            </div>
          )}
        </Section>
      )}
        </div>
      </div>
      <CapabilityCellDrawer key={openCell ? `${openCell.capabilityId}:${openCell.competitorId}` : "none"} cell={openCell} onClose={() => setOpenCell(null)} onChanged={reload} />
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
  const [logging, setLogging] = useState(false);
  const [form, setForm] = useState({ title: "", why: "", origin: "internal", competitor_id: "", channel: "", conf: "0.7" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const compName = (id?: string) => competitors.find((c) => c.id === id)?.name;
  const all = signals.filter((s) => s.metadata?.domain === "competitive");
  const feed = all.filter((s) => (originTab === "internal" ? s.origin === "internal" : s.origin !== "internal"))
    .filter((s) => compFilter === "all" || s.metadata?.competitor_id === compFilter);
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
                  {s.metadata?.competitor_id && <Chip>{compName(s.metadata.competitor_id) ?? "competitor"}</Chip>}
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
