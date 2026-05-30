"use client";

// Market intel — sub-tabbed for high-level → drill-down:
//   • Overview  — all market signals + the broad tracking topics.
//   • Analysts  — analyst / research angle.
//   • Industry & tech — category, technology, regulation movements.
//   • Personas  — buyer/persona shifts.
// Each lens filters the market signal stream by a metadata.lens tag and offers
// its own tailored tracking suggestions. Feeds product strategy & narrative
// (CPO/CCO/CEng agents).
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { PageHeader, Section, Chip, Banner, Confidence, SubTabs } from "@/components/ui";
import TrackingTopics from "@/components/TrackingTopics";
import SourceManager from "@/components/SourceManager";

type Signal = { id: string; title: string; why: string | null; conf_label: string | null; conf_level: number | null; observed_at: string | null; metadata: { domain?: string; lens?: string } | null; source_id: string | null };
type Tab = "overview" | "analysts" | "industry" | "personas";

const LENS_SUGGEST: Record<Tab, string[]> = {
  overview: ["Category narrative & framing", "Emerging buyer priorities", "Demand & funding shifts"],
  analysts: ["Analyst report mentions", "Magic Quadrant / Wave movements", "Analyst category definitions"],
  industry: ["Regulatory / compliance changes", "Technology trend shifts", "Adjacent market moves"],
  personas: ["Buyer role priorities", "New stakeholders in the deal", "Persona pain shifts"],
};

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
  const [logging, setLogging] = useState(false);
  const [form, setForm] = useState({ title: "", why: "", conf: "0.7" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from("signals").select("id, title, why, conf_label, conf_level, observed_at, metadata, source_id").order("observed_at", { ascending: false, nullsFirst: false });
    setSignals(data ?? []); setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const market = signals.filter((s) => s.metadata?.domain === "market");
  const feed = tab === "overview" ? market : market.filter((s) => s.metadata?.lens === tab);

  async function logSignal(e: React.FormEvent) {
    e.preventDefault(); if (!form.title.trim()) return;
    setBusy(true); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      const lvl = parseFloat(form.conf);
      const { error } = await supabase.from("signals").insert({
        org_id: orgId, scope: "org", title: form.title.trim(), why: form.why.trim() || null,
        conf_level: isNaN(lvl) ? null : lvl, conf_label: isNaN(lvl) ? null : lvl >= 0.75 ? "High" : lvl >= 0.5 ? "Medium" : "Low",
        observed_at: new Date().toISOString(), metadata: { domain: "market", lens: tab === "overview" ? null : tab },
      });
      if (error) throw error;
      setLogging(false); setForm({ title: "", why: "", conf: "0.7" }); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not log."); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <PageHeader title="Market intel" meta="Category, analysts, technology, and personas — the broad intel shaping product strategy & narrative." actions={<button className="btn" onClick={() => setLogging((v) => !v)}>{logging ? "Close" : "+ Log intel"}</button>} />
      <Banner>{error}</Banner>

      {logging && (
        <form onSubmit={logSignal} className="card card-pad" style={{ marginBottom: "var(--sp-6)" }}>
          <label className="field"><span className="t-label">What did you observe?</span><input className="input" autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Gartner names 'AI-native GTM' as an emerging category" /></label>
          <label className="field"><span className="t-label">Why it matters</span><textarea className="textarea" rows={2} value={form.why} onChange={(e) => setForm({ ...form, why: e.target.value })} /></label>
          <label className="field" style={{ maxWidth: 220 }}><span className="t-label">Confidence</span>
            <select className="select" value={form.conf} onChange={(e) => setForm({ ...form, conf: e.target.value })}><option value="0.9">High</option><option value="0.7">Medium</option><option value="0.4">Low</option></select></label>
          <div className="t-sub t-muted" style={{ fontSize: 12, marginBottom: 10 }}>Tagged to the “{tab}” lens.</div>
          <div className="row gap-2"><button className="btn" type="submit" disabled={busy}>{busy ? "Logging…" : "Log"}</button><button className="btn btn-secondary" type="button" onClick={() => setLogging(false)}>Cancel</button></div>
        </form>
      )}

      <SubTabs<Tab> tabs={[{ key: "overview", label: "Overview" }, { key: "analysts", label: "Analysts" }, { key: "industry", label: "Industry & tech" }, { key: "personas", label: "Personas" }]} active={tab} onChange={setTab} />

      <SourceManager scope={tab === "overview" ? {} : { marketLens: tab }} title={tab === "overview" ? "Market sources" : `${tab} sources`} />
      <TrackingTopics category="market" suggestions={LENS_SUGGEST[tab]} />

      <Section label={tab === "overview" ? "All market signals" : `${tab[0].toUpperCase()}${tab.slice(1)} signals`}>
        {loading ? <div className="t-sub t-muted">Loading…</div>
          : feed.length === 0 ? <div className="t-sub t-muted">Nothing here yet. Log intel above (tagged to this lens) or add sources above.</div>
          : (
            <div className="stack-3">
              {feed.map((s) => (
                <div key={s.id} className="card card-pad">
                  <div className="row-between" style={{ gap: 12, alignItems: "flex-start", marginBottom: 5 }}>
                    <span style={{ fontSize: 14.5, fontWeight: 620 }}>{s.title}</span>
                    <Confidence label={s.conf_label} level={s.conf_level} />
                  </div>
                  {s.why && <p className="t-sub" style={{ lineHeight: 1.5, marginBottom: 6 }}>{s.why}</p>}
                  <div className="row gap-2">{s.metadata?.lens && <Chip>{s.metadata.lens}</Chip>}{s.observed_at && <span className="t-mono-xs">{ago(s.observed_at)}</span>}</div>
                </div>
              ))}
            </div>
          )}
      </Section>
    </div>
  );
}
