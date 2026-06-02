"use client";

// Competitive intel — sub-tabbed module:
//   • Dashboard   — the competitive landscape: direct/adjacent competitors +
//                   a capability matrix heat-map (us vs each competitor).
//   • Battlecards — why we win / lose / objections / traps, per competitor.
//   • Signal feed — tracking topics + the competitive signal stream.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { PageHeader, Section, Chip, Banner, Confidence, SubTabs, ConfirmDialog } from "@/components/ui";
import TrackingTopics from "@/components/TrackingTopics";
import SourceManager from "@/components/SourceManager";
import CapabilityCellDrawer, { type Cell } from "@/components/CapabilityCellDrawer";

type Competitor = { id: string; name: string; relationship: string; website: string | null; notes: string | null };
type Capability = { id: string; name: string; category: string | null };
type Score = { id: string; capability_id: string; competitor_id: string | null; score: number };
type Card = { id: string; competitor_id: string | null; kind: string; title: string; detail: string | null };
type Signal = { id: string; title: string; why: string | null; conf_label: string | null; conf_level: number | null; observed_at: string | null; metadata: { domain?: string } | null; source_id: string | null };

type Tab = "dashboard" | "battlecards" | "feed";

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
      supabase.from("signals").select("id, title, why, conf_label, conf_level, observed_at, metadata, source_id").order("observed_at", { ascending: false, nullsFirst: false }),
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
      <PageHeader title="Competitive intel" meta="The competitive landscape — what's moving, how you stack up, and why you win. Feeds your CRO & CCO agents and GTM record." />
      <Banner>{error}</Banner>
      <SubTabs<Tab> tabs={[{ key: "dashboard", label: "Dashboard" }, { key: "battlecards", label: "Battlecards" }, { key: "feed", label: "Signal feed" }]} active={tab} onChange={setTab} />

      {loading ? <div className="t-sub t-muted">Loading…</div>
        : tab === "dashboard" ? <Dashboard competitors={competitors} capabilities={capabilities} scores={scores} compSignals={compSignals} overview={overview} reload={load} setError={setError} />
        : tab === "battlecards" ? <Battlecards competitors={competitors} cards={cards} overview={overview} capabilities={capabilities} scores={scores} compSignals={compSignals} reload={load} setError={setError} />
        : <Feed signals={signals} />}
    </div>
  );
}

// ---------- Dashboard: competitors + capability heat-map ----------
function Dashboard({ competitors, capabilities, scores, compSignals, overview, reload, setError }: {
  competitors: Competitor[]; capabilities: Capability[]; scores: Score[]; compSignals: Signal[]; overview: { name: string; overview: string | null; valueProp: string | null } | null; reload: () => void; setError: (s: string | null) => void;
}) {
  const supabase = createClient();
  const [addingComp, setAddingComp] = useState(false);
  const [comp, setComp] = useState({ name: "", relationship: "direct" });
  const [addingCap, setAddingCap] = useState(false);
  const [capName, setCapName] = useState("");
  const [openCell, setOpenCell] = useState<Cell | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Competitor | null>(null); // staged for in-app confirm

  const direct = competitors.filter((c) => c.relationship === "direct");
  const adjacent = competitors.filter((c) => c.relationship === "adjacent");
  const scoreOf = (capId: string, compId: string | null) => scores.find((s) => s.capability_id === capId && s.competitor_id === compId)?.score ?? 0;

  async function addCompetitor(e: React.FormEvent) {
    e.preventDefault(); if (!comp.name.trim()) return;
    const orgId = await getOrgId(); if (!orgId) return;
    const { error } = await supabase.from("competitors").insert({ org_id: orgId, name: comp.name.trim(), relationship: comp.relationship });
    if (error) setError(error.message); else { setAddingComp(false); setComp({ name: "", relationship: "direct" }); reload(); }
  }
  async function addCapability(e: React.FormEvent) {
    e.preventDefault(); if (!capName.trim()) return;
    const orgId = await getOrgId(); if (!orgId) return;
    const { error } = await supabase.from("capabilities").insert({ org_id: orgId, name: capName.trim() });
    if (error) setError(error.message); else { setAddingCap(false); setCapName(""); reload(); }
  }
  // Remove a competitor that shouldn't be tracked. The × button stages it; an
  // in-app ConfirmDialog (not the browser popup) confirms the destructive delete.
  function removeCompetitor(e: React.MouseEvent, c: Competitor) {
    e.preventDefault(); e.stopPropagation(); // the row is a link; don't navigate
    setPendingDelete(c);
  }
  async function doRemove() {
    const c = pendingDelete; if (!c) return;
    setError(null); setPendingDelete(null);
    const { error } = await supabase.from("competitors").delete().eq("id", c.id);
    if (error) setError(error.message); else reload();
  }
  const compById = (id: string | null) => competitors.find((c) => c.id === id) ?? null;
  const heat = (s: number) => ["var(--fill)", "#FCE4C7", "#CDEBD6", "#9FD9B4"][s] || "var(--fill)";
  const heatText = (s: number) => ["—", "Partial", "Good", "Strong"][s] || "—";

  // Metrics: where competitors out-cover us (gaps) and where we lead (edges).
  const usScore = (capId: string) => scoreOf(capId, null);
  const gaps = capabilities.filter((cap) => competitors.some((c) => scoreOf(cap.id, c.id) > usScore(cap.id))).length;
  const edges = capabilities.filter((cap) => usScore(cap.id) >= 3 && competitors.every((c) => scoreOf(cap.id, c.id) < 3)).length;
  const recent = compSignals.filter((s) => s.observed_at && Date.now() - new Date(s.observed_at).getTime() < 30 * 86400_000).length;
  const METRICS: [number, string, boolean][] = [
    [competitors.length, "Tracked", false],
    [direct.length, "Direct", false],
    [edges, "We lead", false],
    [gaps, "Gaps to close", gaps > 0],
    [recent, "Moves · 30d", recent > 0],
  ];

  return (
    <div>
      {/* Metrics — the landscape at a glance, not just a list */}
      <div className="card card-pad" style={{ marginBottom: "var(--sp-5)", display: "grid", gridTemplateColumns: `repeat(${METRICS.length}, 1fr)`, gap: "var(--sp-4)" }}>
        {METRICS.map(([n, label, warn]) => (
          <div key={label} className="stat"><span className="stat-num" style={{ color: warn ? "var(--am-text)" : undefined }}>{n}</span><span className="stat-label">{label}</span></div>
        ))}
      </div>

      {/* What's happening — high-value competitive moves */}
      {compSignals.length > 0 && (
        <Section label="What's happening">
          <div className="stack-3">
            {compSignals.slice(0, 4).map((s) => (
              <div key={s.id} className="card card-pad signal-card" style={{ borderLeft: "3px solid var(--vl)" }}>
                <div className="row-between" style={{ gap: 12, alignItems: "flex-start", marginBottom: 4 }}>
                  <span style={{ fontSize: 14, fontWeight: 620 }}>{s.title}</span>
                  <Confidence label={s.conf_label} level={s.conf_level} />
                </div>
                {s.why && <div className="t-sub t-muted" style={{ fontSize: 12.5, lineHeight: 1.45 }}>{s.why}</div>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Remove competitor?"
          message={<>Remove <b>{pendingDelete.name}</b> from competitive intel? This deletes its capability scores and battlecards, and can&rsquo;t be undone.</>}
          confirmLabel="Remove"
          onConfirm={doRemove}
          onCancel={() => setPendingDelete(null)}
        />
      )}
      {/* Capability matrix heat-map — the differentiator, up top */}
      <Section label="Capability matrix" action={!addingCap ? <button className="btn btn-secondary btn-sm" onClick={() => setAddingCap(true)}>+ Capability</button> : undefined}>
        <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>Functionality vectors × competitors (you vs each). Click any cell for the agent&rsquo;s read — reasons, sources, implications — then set the rating yourself.</div>
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
      </Section>

      {/* Competitors */}
      <Section label="Competitors" action={!addingComp ? <button className="btn btn-secondary btn-sm" onClick={() => setAddingComp(true)}>+ Competitor</button> : undefined}>
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
        {competitors.length === 0 && !addingComp ? <div className="t-sub t-muted">No competitors yet. Add direct and adjacent competitors to map the landscape.</div> : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-4)" }}>
            {[["Direct", direct, "accent"], ["Adjacent", adjacent, "violet"]].map(([label, list, tone]) => (
              <div key={label as string}>
                <div className="t-label" style={{ marginBottom: 8 }}>{label as string} · {(list as Competitor[]).length}</div>
                <div className="stack-3">
                  {(list as Competitor[]).map((c) => (
                    <a key={c.id} href={`/competitive/${c.id}`} className="card card-link card-pad row-between">
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{c.name}</span>
                      <span className="row gap-2" style={{ alignItems: "center" }}>
                        <Chip tone={tone as "accent" | "violet"}>{c.relationship}</Chip>
                        <span className="t-sub" style={{ color: "var(--ac-text)", fontWeight: 600, fontSize: 12 }}>Open →</span>
                        <button onClick={(e) => removeCompetitor(e, c)} title={`Remove ${c.name}`} aria-label={`Remove ${c.name}`}
                          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, lineHeight: 1, color: "var(--tm)", padding: "0 2px" }}>×</button>
                      </span>
                    </a>
                  ))}
                  {(list as Competitor[]).length === 0 && <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>None</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Org-wide competitive sources (cross-competitor) */}
      <SourceManager title="Competitive sources (all competitors)" />

      <CapabilityCellDrawer key={openCell ? `${openCell.capabilityId}:${openCell.competitorId}` : "none"} cell={openCell} onClose={() => setOpenCell(null)} onChanged={reload} />
    </div>
  );
}

// ---------- Battlecards ----------
type BcTab = "gtm" | "product" | "signals";
function Battlecards({ competitors, cards, overview, capabilities, scores, compSignals, reload, setError }: {
  competitors: Competitor[]; cards: Card[]; overview: { name: string; overview: string | null; valueProp: string | null } | null;
  capabilities: Capability[]; scores: Score[]; compSignals: Signal[]; reload: () => void; setError: (s: string | null) => void;
}) {
  const supabase = createClient();
  const [scope, setScope] = useState<string | null>(null); // selected competitor id; null = picker
  const [bcTab, setBcTab] = useState<BcTab>("gtm");
  const [take, setTake] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", detail: "" });

  const KINDS = [["win", "Why we win", "green"], ["lose", "Why we lose", "amber"], ["objection", "Objections", "default"], ["trap", "Traps to set", "violet"]] as const;
  const cardsFor = (kind: string) => cards.filter((c) => c.kind === kind && c.competitor_id === scope);
  const countFor = (compId: string) => cards.filter((c) => c.competitor_id === compId).length;
  const selected = competitors.find((c) => c.id === scope);
  const scoreOf = (capId: string, compId: string | null) => scores.find((s) => s.capability_id === capId && s.competitor_id === compId)?.score ?? 0;
  const heat = (s: number) => ["var(--fill)", "#FCE4C7", "#CDEBD6", "#9FD9B4"][s] || "var(--fill)";
  const heatText = (s: number) => ["—", "Partial", "Good", "Strong"][s] || "—";
  const compFor = (c?: Competitor) => (c ? compSignals.filter((s) => (s.title + " " + (s.why ?? "")).toLowerCase().includes(c.name.toLowerCase())) : []);

  async function add(kind: string) {
    if (!form.title.trim() || !scope) return;
    const orgId = await getOrgId(); if (!orgId) return;
    const { error } = await supabase.from("battlecard_items").insert({ org_id: orgId, competitor_id: scope, kind, title: form.title.trim(), detail: form.detail.trim() || null });
    if (error) setError(error.message); else { setAdding(null); setForm({ title: "", detail: "" }); reload(); }
  }
  async function remove(id: string) { setError(null); await supabase.from("battlecard_items").delete().eq("id", id); reload(); }

  async function askCompetitor() {
    if (!selected) return;
    setThinking(true); setError(null); setTake(null);
    try {
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      const prompt = `Help me compete against "${selected.name}"${selected.notes ? ` (${selected.notes})` : ""}. Our product${overview?.valueProp ? `: ${overview.valueProp}` : ""}. In 4–5 sentences: where we clearly win, where they're strong (be honest), the sharpest way to reframe the conversation, and the one trap to avoid. Ground it in how a buyer would actually compare us.`;
      const { data, error } = await supabase.functions.invoke("agent-chat", {
        body: { agent_key: "cro", messages: [{ role: "user", content: prompt }], context: { area: "gtm" } },
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setTake(data.reply);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not reach the CRO."); }
    finally { setThinking(false); }
  }

  // Competitor picker — battlecards are per-competitor, so choose one first.
  if (!scope) {
    return (
      <Section label="Choose a competitor">
        {competitors.length === 0 ? (
          <div className="t-sub t-muted">No competitors yet. Add direct/adjacent competitors on the Dashboard, then build their battlecards here.</div>
        ) : (
          <div className="grid-cards">
            {competitors.map((c) => (
              <button key={c.id} className="card card-link card-pad" style={{ textAlign: "left" }} onClick={() => setScope(c.id)}>
                <div className="row-between" style={{ marginBottom: 8 }}>
                  <span style={{ fontSize: 15, fontWeight: 620 }}>{c.name}</span>
                  <Chip tone={c.relationship === "direct" ? "accent" : "violet"}>{c.relationship}</Chip>
                </div>
                <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>{countFor(c.id)} battlecard item{countFor(c.id) === 1 ? "" : "s"} · open →</div>
              </button>
            ))}
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

      {/* Overviews — who they are vs who we are, so the battlecard stands alone */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-4)", marginBottom: "var(--sp-5)" }}>
        <div className="card card-pad" style={{ borderTop: "2px solid var(--vl)" }}>
          <div className="t-label" style={{ color: "var(--tm)", marginBottom: 6 }}>Them · {selected?.name}</div>
          <div className="t-sub" style={{ fontSize: 12.5, lineHeight: 1.5 }}>{selected?.notes || <span className="t-muted">No overview yet — add notes on the competitor.</span>}</div>
          {selected?.website && <a href={selected.website} target="_blank" rel="noreferrer" className="t-sub" style={{ fontSize: 12, color: "var(--ac-text)", fontWeight: 600, display: "inline-block", marginTop: 6 }}>{selected.website.replace(/^https?:\/\//, "")} →</a>}
        </div>
        <div className="card card-pad" style={{ borderTop: "2px solid var(--ac)" }}>
          <div className="t-label" style={{ color: "var(--tm)", marginBottom: 6 }}>Us · {overview?.name ?? "Our product"}</div>
          <div className="t-sub" style={{ fontSize: 12.5, lineHeight: 1.5 }}>{overview?.valueProp || overview?.overview || <span className="t-muted">Add an Overview / Value proposition on your product record.</span>}</div>
        </div>
      </div>

      {/* Competitor agent — a CRO read on how to win this matchup */}
      <div className="card card-pad" style={{ background: "var(--panel-2)", marginBottom: "var(--sp-5)" }}>
        <div className="row-between" style={{ alignItems: "center", gap: 10 }}>
          <span className="t-sub" style={{ fontSize: 12.5 }}>Get the CRO&rsquo;s read on how to win against {selected?.name}.</span>
          <button className="btn btn-sm" onClick={askCompetitor} disabled={thinking} style={{ background: "var(--ac)", color: "#fff", flexShrink: 0 }}>{thinking ? "CRO is thinking…" : `✦ Ask the CRO`}</button>
        </div>
        {take && <div className="card card-pad" style={{ marginTop: 10, background: "var(--panel)" }}><div className="t-sub" style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{take}</div></div>}
      </div>

      {/* Tabbed box — GTM battlecard · Product eval · Competitor signals */}
      <SubTabs<BcTab> tabs={[{ key: "gtm", label: "GTM battlecard" }, { key: "product", label: "Product eval" }, { key: "signals", label: `Signals${compFor(selected).length ? ` · ${compFor(selected).length}` : ""}` }]} active={bcTab} onChange={setBcTab} />

      {bcTab === "gtm" ? (
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
                  <div key={c.id} className="card card-pad" style={{ borderLeft: `2px solid var(--${tone === "green" ? "gn" : tone === "amber" ? "am-text" : tone === "violet" ? "vl" : "border-strong"})` }}>
                    <div className="row-between"><span style={{ fontSize: 13.5, fontWeight: 620 }}>{c.title}</span><button className="t-muted" onClick={() => remove(c.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15 }}>×</button></div>
                    {c.detail && <div className="t-sub" style={{ fontSize: 12.5, marginTop: 3 }}>{c.detail}</div>}
                  </div>
                ))}
                {cardsFor(kind).length === 0 && adding !== kind && <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>None yet.</div>}
              </div>
            </Section>
          ))}
        </div>
      ) : bcTab === "product" ? (
        <Section label="Product eval — feature-by-feature, us vs them">
          {capabilities.length === 0 ? <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No capabilities defined yet. Add them on the Dashboard matrix.</div> : (
            <div className="card" style={{ overflow: "hidden" }}>
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
                    const edge = us - them;
                    return (
                      <tr key={cap.id} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={{ padding: "8px 14px", fontWeight: 600 }}>{cap.name}</td>
                        <td style={{ padding: "6px 10px", textAlign: "center" }}><span style={{ display: "inline-block", minWidth: 58, padding: "5px 8px", borderRadius: 6, background: heat(us), fontSize: 11, fontWeight: 600 }}>{heatText(us)}</span></td>
                        <td style={{ padding: "6px 10px", textAlign: "center" }}><span style={{ display: "inline-block", minWidth: 58, padding: "5px 8px", borderRadius: 6, background: heat(them), fontSize: 11, fontWeight: 600 }}>{heatText(them)}</span></td>
                        <td style={{ padding: "6px 10px", textAlign: "center", fontWeight: 700, color: edge > 0 ? "var(--gn-text)" : edge < 0 ? "var(--rd-text)" : "var(--tm)" }}>{edge > 0 ? `+${edge}` : edge}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="t-sub t-muted" style={{ fontSize: 11.5, marginTop: 8 }}>Ratings come from the Dashboard matrix — open a cell there for the agent&rsquo;s reasoning + sources.</div>
        </Section>
      ) : (
        <Section label={`Signals on ${selected?.name}`}>
          {compFor(selected).length === 0 ? <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No competitive signals reference {selected?.name} yet. Log intel in the Signal feed.</div> : (
            <div className="stack-3">
              {compFor(selected).map((s) => (
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
  );
}

// ---------- Signal feed ----------
function Feed({ signals }: { signals: Signal[] }) {
  const feed = signals.filter((s) => s.metadata?.domain === "competitive");
  return (
    <div>
      <SourceManager title="Competitive sources" />
      <TrackingTopics category="competitive" suggestions={["Competitor pricing & packaging changes", "New competitor launches", "Win/loss themes vs top rivals", "Competitor messaging shifts"]} />
      <Section label="Competitive signals">
        {feed.length === 0 ? <div className="t-sub t-muted">No competitive signals yet. Log intel (it'll appear here) or add sources above.</div> : (
          <div className="stack-3">
            {feed.map((s) => (
              <div key={s.id} className="card card-pad">
                <div className="row-between" style={{ gap: 12, alignItems: "flex-start", marginBottom: 5 }}>
                  <span style={{ fontSize: 14.5, fontWeight: 620 }}>{s.title}</span>
                  <Confidence label={s.conf_label} level={s.conf_level} />
                </div>
                {s.why && <p className="t-sub" style={{ lineHeight: 1.5 }}>{s.why}</p>}
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
