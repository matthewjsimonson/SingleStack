"use client";

// Market intel — two tabs: Overview (dashboard) and Market signals (swimlanes).
// Swimlanes (Analysts · Industry & tech · Persona) are scrollable rows of signal
// cards you click to drill into; trackers + sources live per lane. Feeds product
// strategy & narrative (CPO/CEng/CCO agents).
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { PageHeader, Section, Chip, Banner, Confidence, SubTabs } from "@/components/ui";
import TrackingTopics from "@/components/TrackingTopics";
import SourceManager from "@/components/SourceManager";

type Signal = { id: string; title: string; why: string | null; conf_label: string | null; conf_level: number | null; observed_at: string | null; metadata: { domain?: string; lens?: string } | null };
type Tab = "overview" | "signals";
type Lane = "analysts" | "industry" | "persona";

const LANES: { key: Lane; label: string; blurb: string }[] = [
  { key: "analysts", label: "Analysts", blurb: "Analyst & research moves" },
  { key: "industry", label: "Industry & tech", blurb: "Category, technology & regulation" },
  { key: "persona", label: "Persona", blurb: "Buyer & stakeholder shifts" },
];

function ago(iso: string | null) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 86400) return `${Math.max(1, Math.round(s / 3600))}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export default function MarketView() {
  const supabase = createClient();
  const [tab, setTab] = useState<Tab>("overview");
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Signal | null>(null);
  const [logging, setLogging] = useState<Lane | null>(null);
  const [form, setForm] = useState({ title: "", why: "", conf: "0.7" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from("signals").select("id, title, why, conf_label, conf_level, observed_at, metadata").order("observed_at", { ascending: false, nullsFirst: false });
    setSignals((data ?? []).filter((s) => s.metadata?.domain === "market"));
    setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const laneSignals = (lane: Lane) => signals.filter((s) => s.metadata?.lens === lane);

  async function logSignal(e: React.FormEvent, lane: Lane) {
    e.preventDefault(); if (!form.title.trim()) return;
    setBusy(true); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      const lvl = parseFloat(form.conf);
      const { error } = await supabase.from("signals").insert({
        org_id: orgId, scope: "org", title: form.title.trim(), why: form.why.trim() || null,
        conf_level: isNaN(lvl) ? null : lvl, conf_label: isNaN(lvl) ? null : lvl >= 0.75 ? "High" : lvl >= 0.5 ? "Medium" : "Low",
        observed_at: new Date().toISOString(), metadata: { domain: "market", lens: lane },
      });
      if (error) throw error;
      setLogging(null); setForm({ title: "", why: "", conf: "0.7" }); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not log."); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <PageHeader title="Market intel" meta="Analysts, industry & tech, and personas — the broad intel shaping product strategy & narrative." />
      <Banner>{error}</Banner>
      <SubTabs<Tab> tabs={[{ key: "overview", label: "Overview" }, { key: "signals", label: "Market signals" }]} active={tab} onChange={setTab} />

      {loading ? <div className="t-sub t-muted">Loading…</div> : tab === "overview" ? (
        <div>
          <div className="card card-pad" style={{ marginBottom: "var(--sp-6)", display: "grid", gridTemplateColumns: `repeat(${LANES.length + 1}, 1fr)`, gap: "var(--sp-4)" }}>
            <div className="stat"><span className="stat-num">{signals.length}</span><span className="stat-label">Market signals</span></div>
            {LANES.map((l) => <div key={l.key} className="stat"><span className="stat-num">{laneSignals(l.key).length}</span><span className="stat-label">{l.label}</span></div>)}
          </div>
          <SourceManager title="Market sources" />
          <TrackingTopics category="market" suggestions={["Category narrative & framing", "Emerging buyer priorities", "Demand & funding shifts"]} />
          <Section label="Recent highlights">
            {signals.length === 0 ? <div className="t-sub t-muted">No market signals yet. Add sources or log intel under Market signals.</div> : (
              <div className="stack-3">
                {signals.slice(0, 5).map((s) => (
                  <button key={s.id} className="card card-pad row-between" style={{ textAlign: "left", cursor: "pointer" }} onClick={() => setOpen(s)}>
                    <div className="row gap-2">{s.metadata?.lens && <Chip>{s.metadata.lens}</Chip>}<span style={{ fontSize: 14, fontWeight: 600 }}>{s.title}</span></div>
                    <Confidence label={s.conf_label} level={s.conf_level} />
                  </button>
                ))}
              </div>
            )}
          </Section>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-6)" }}>
          {LANES.map((lane) => {
            const items = laneSignals(lane.key);
            return (
              <div key={lane.key}>
                <div className="section-head">
                  <div><div className="t-h2" style={{ fontSize: 14.5 }}>{lane.label}</div><div className="t-sub t-muted" style={{ fontSize: 12.5 }}>{lane.blurb}</div></div>
                  <button className="btn btn-secondary btn-sm" onClick={() => { setLogging(logging === lane.key ? null : lane.key); setForm({ title: "", why: "", conf: "0.7" }); }}>{logging === lane.key ? "Cancel" : "+ Log"}</button>
                </div>
                {logging === lane.key && (
                  <form onSubmit={(e) => logSignal(e, lane.key)} className="card card-pad" style={{ marginBottom: "var(--sp-3)" }}>
                    <input className="input" autoFocus placeholder="What did you observe?" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} style={{ marginBottom: 8 }} />
                    <textarea className="textarea" rows={2} placeholder="Why it matters" value={form.why} onChange={(e) => setForm({ ...form, why: e.target.value })} style={{ marginBottom: 8 }} />
                    <div className="row gap-2"><button className="btn btn-sm" type="submit" disabled={busy}>{busy ? "Logging…" : "Log"}</button></div>
                  </form>
                )}
                {items.length === 0 ? <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No signals in this lane yet.</div> : (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "var(--sp-3)" }}>
                    {items.map((s) => (
                      <button key={s.id} onClick={() => setOpen(s)} className="card card-link card-pad" style={{ textAlign: "left" }}>
                        <div className="row-between" style={{ marginBottom: 6 }}><Confidence label={s.conf_label} level={s.conf_level} />{s.observed_at && <span className="t-mono-xs">{ago(s.observed_at)}</span>}</div>
                        <div style={{ fontSize: 13.5, fontWeight: 620, lineHeight: 1.35, marginBottom: 4 }}>{s.title}</div>
                        {s.why && <div className="t-sub t-muted" style={{ fontSize: 12, lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{s.why}</div>}
                      </button>
                    ))}
                  </div>
                )}
                <div style={{ marginTop: "var(--sp-3)" }}>
                  <SourceManager scope={{ marketLens: lane.key }} title={`${lane.label} sources`} compact />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {open && (
        <>
          <div onClick={() => setOpen(null)} style={{ position: "fixed", inset: 0, background: "rgba(11,12,14,0.32)", zIndex: 40 }} />
          <aside style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: 440, maxWidth: "92vw", background: "var(--panel)", borderLeft: "1px solid var(--border)", boxShadow: "var(--shadow-md)", zIndex: 41, padding: 20, overflowY: "auto" }}>
            <div className="row-between" style={{ marginBottom: 14 }}>
              {open.metadata?.lens && <Chip>{open.metadata.lens}</Chip>}
              <button className="btn btn-secondary btn-sm" onClick={() => setOpen(null)}>Close</button>
            </div>
            <h2 className="t-h2" style={{ marginBottom: 8 }}>{open.title}</h2>
            <div className="row gap-2" style={{ marginBottom: 14 }}><Confidence label={open.conf_label} level={open.conf_level} />{open.observed_at && <span className="t-mono-xs">{ago(open.observed_at)}</span>}</div>
            {open.why && <p className="t-body" style={{ lineHeight: 1.6 }}>{open.why}</p>}
          </aside>
        </>
      )}
    </div>
  );
}
