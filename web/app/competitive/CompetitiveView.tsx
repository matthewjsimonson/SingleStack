"use client";

// Competitive intel — sub-tabbed module:
//   • Dashboard   — the competitive landscape: direct/adjacent competitors +
//                   a capability matrix heat-map (us vs each competitor).
//   • Battlecards — why we win / lose / objections / traps, per competitor.
//   • Signal feed — tracking topics + the competitive signal stream.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { PageHeader, Section, Chip, Banner, Confidence, SubTabs } from "@/components/ui";
import TrackingTopics from "@/components/TrackingTopics";
import SourceManager from "@/components/SourceManager";

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
    setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <PageHeader title="Competitive intel" meta="The competitive landscape — what's moving, how you stack up, and why you win. Feeds your CRO & CCO agents and GTM record." />
      <Banner>{error}</Banner>
      <SubTabs<Tab> tabs={[{ key: "dashboard", label: "Dashboard" }, { key: "battlecards", label: "Battlecards" }, { key: "feed", label: "Signal feed" }]} active={tab} onChange={setTab} />

      {loading ? <div className="t-sub t-muted">Loading…</div>
        : tab === "dashboard" ? <Dashboard competitors={competitors} capabilities={capabilities} scores={scores} reload={load} setError={setError} />
        : tab === "battlecards" ? <Battlecards competitors={competitors} cards={cards} reload={load} setError={setError} />
        : <Feed signals={signals} />}
    </div>
  );
}

// ---------- Dashboard: competitors + capability heat-map ----------
function Dashboard({ competitors, capabilities, scores, reload, setError }: {
  competitors: Competitor[]; capabilities: Capability[]; scores: Score[]; reload: () => void; setError: (s: string | null) => void;
}) {
  const supabase = createClient();
  const [addingComp, setAddingComp] = useState(false);
  const [comp, setComp] = useState({ name: "", relationship: "direct" });
  const [addingCap, setAddingCap] = useState(false);
  const [capName, setCapName] = useState("");

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
  async function cycleScore(capId: string, compId: string | null, current: number) {
    setError(null);
    const next = (current + 1) % 4; // 0→1→2→3→0
    const existing = scores.find((s) => s.capability_id === capId && s.competitor_id === compId);
    const orgId = await getOrgId(); if (!orgId) return;
    if (existing) await supabase.from("capability_scores").update({ score: next }).eq("id", existing.id);
    else await supabase.from("capability_scores").insert({ org_id: orgId, capability_id: capId, competitor_id: compId, score: next });
    reload();
  }

  const heat = (s: number) => ["var(--fill)", "#FCE4C7", "#CDEBD6", "#9FD9B4"][s] || "var(--fill)";
  const heatText = (s: number) => ["—", "Partial", "Good", "Strong"][s] || "—";

  return (
    <div>
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
                      <span className="row gap-2"><Chip tone={tone as "accent" | "violet"}>{c.relationship}</Chip><span className="t-sub" style={{ color: "var(--ac-text)", fontWeight: 600, fontSize: 12 }}>Open →</span></span>
                    </a>
                  ))}
                  {(list as Competitor[]).length === 0 && <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>None</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Capability matrix heat-map */}
      <Section label="Capability matrix" action={!addingCap ? <button className="btn btn-secondary btn-sm" onClick={() => setAddingCap(true)}>+ Capability</button> : undefined}>
        <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>Click a cell to cycle strength (— → Partial → Good → Strong). Compares you against each competitor.</div>
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
                  <th style={{ padding: "10px 8px", fontWeight: 700, fontSize: 12 }}>Us</th>
                  {competitors.map((c) => <th key={c.id} style={{ padding: "10px 8px", fontWeight: 600, fontSize: 12, color: "var(--ts)" }}>{c.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {capabilities.map((cap, i) => (
                  <tr key={cap.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "8px 14px", fontWeight: 600 }}>{cap.name}</td>
                    {[null, ...competitors.map((c) => c.id)].map((compId) => {
                      const s = scoreOf(cap.id, compId);
                      return (
                        <td key={compId ?? "us"} style={{ padding: "6px 8px", textAlign: "center" }}>
                          <button onClick={() => cycleScore(cap.id, compId, s)} title={heatText(s)}
                            style={{ width: "100%", minWidth: 64, padding: "8px 6px", borderRadius: 6, border: "1px solid var(--border)", background: heat(s), cursor: "pointer", fontSize: 11, fontWeight: 600, color: "var(--tp)" }}>
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

      {/* Org-wide competitive sources (cross-competitor) */}
      <SourceManager title="Competitive sources (all competitors)" />
    </div>
  );
}

// ---------- Battlecards ----------
function Battlecards({ competitors, cards, reload, setError }: {
  competitors: Competitor[]; cards: Card[]; reload: () => void; setError: (s: string | null) => void;
}) {
  const supabase = createClient();
  const [scope, setScope] = useState<string | null>(null); // selected competitor id; null = picker
  const [adding, setAdding] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", detail: "" });

  const KINDS = [["win", "Why we win", "green"], ["lose", "Why we lose", "amber"], ["objection", "Objections", "default"], ["trap", "Traps to set", "violet"]] as const;
  const cardsFor = (kind: string) => cards.filter((c) => c.kind === kind && c.competitor_id === scope);
  const countFor = (compId: string) => cards.filter((c) => c.competitor_id === compId).length;
  const selected = competitors.find((c) => c.id === scope);

  async function add(kind: string) {
    if (!form.title.trim() || !scope) return;
    const orgId = await getOrgId(); if (!orgId) return;
    const { error } = await supabase.from("battlecard_items").insert({ org_id: orgId, competitor_id: scope, kind, title: form.title.trim(), detail: form.detail.trim() || null });
    if (error) setError(error.message); else { setAdding(null); setForm({ title: "", detail: "" }); reload(); }
  }
  async function remove(id: string) { setError(null); await supabase.from("battlecard_items").delete().eq("id", id); reload(); }

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
