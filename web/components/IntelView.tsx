"use client";

// Shared layout for the Competitive intel and Market intel tabs: a header,
// the human "what you're tracking" topics (with AI blind-spot suggestions),
// and the relevant signal stream for that domain. Signals here are scoped by
// matching the topic category; for now both pull external-origin signals (the
// market-facing intel) and let you log domain-specific signals.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { PageHeader, Section, Chip, Banner, Confidence } from "@/components/ui";
import TrackingTopics from "@/components/TrackingTopics";

type Signal = { id: string; title: string; why: string | null; conf_label: string | null; conf_level: number | null; observed_at: string | null; source_id: string | null; metadata: { domain?: string } | null };
type Source = { id: string; label: string; icon: string; origin: string };

function ago(iso: string | null) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export default function IntelView({ domain, title, meta, suggestions }: {
  domain: "competitive" | "market";
  title: string;
  meta: string;
  suggestions: string[];
}) {
  const supabase = createClient();
  const [signals, setSignals] = useState<Signal[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logging, setLogging] = useState(false);
  const [form, setForm] = useState({ title: "", why: "", conf: "0.7", source_id: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data: sigs }, { data: srcs }] = await Promise.all([
      supabase.from("signals").select("id, title, why, conf_label, conf_level, observed_at, source_id, metadata").order("observed_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }),
      supabase.from("sources").select("id, label, icon, origin").order("created_at"),
    ]);
    setSignals(sigs ?? []); setSources(srcs ?? []); setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const sourceById = (id: string | null) => sources.find((s) => s.id === id) ?? null;
  // Signals belonging to this domain: tagged in metadata.domain, or (fallback)
  // external-origin signals which are inherently market-facing.
  const externalIds = new Set(sources.filter((s) => s.origin === "external").map((s) => s.id));
  const domainSignals = signals.filter((s) => s.metadata?.domain === domain || (!s.metadata?.domain && externalIds.has(s.source_id ?? "")));

  async function logSignal(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setBusy(true); setError(null);
    try {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization.");
      const lvl = parseFloat(form.conf);
      const { error } = await supabase.from("signals").insert({
        org_id: orgId, scope: "org", title: form.title.trim(), why: form.why.trim() || null,
        conf_level: isNaN(lvl) ? null : lvl,
        conf_label: isNaN(lvl) ? null : lvl >= 0.75 ? "High" : lvl >= 0.5 ? "Medium" : "Low",
        observed_at: new Date().toISOString(), source_id: form.source_id || null, metadata: { domain },
      });
      if (error) throw error;
      setLogging(false); setForm({ title: "", why: "", conf: "0.7", source_id: "" });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not log."); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <PageHeader title={title} meta={meta} actions={<button className="btn" onClick={() => setLogging((v) => !v)}>{logging ? "Close" : "+ Log intel"}</button>} />
      <Banner>{error}</Banner>

      {logging && (
        <form onSubmit={logSignal} className="card card-pad" style={{ marginBottom: "var(--sp-6)" }}>
          <label className="field"><span className="t-label">What did you observe?</span>
            <input className="input" autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={domain === "competitive" ? "e.g. GovDash launched explainability feature" : "e.g. Analyst report names AI-native as the category"} /></label>
          <label className="field"><span className="t-label">Why it matters</span>
            <textarea className="textarea" rows={2} value={form.why} onChange={(e) => setForm({ ...form, why: e.target.value })} /></label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-3)" }}>
            <label className="field"><span className="t-label">Confidence</span>
              <select className="select" value={form.conf} onChange={(e) => setForm({ ...form, conf: e.target.value })}>
                <option value="0.9">High (90%)</option><option value="0.7">Medium (70%)</option><option value="0.4">Low (40%)</option>
              </select></label>
            <label className="field"><span className="t-label">Source</span>
              <select className="select" value={form.source_id} onChange={(e) => setForm({ ...form, source_id: e.target.value })}>
                <option value="">— none —</option>{sources.map((s) => <option key={s.id} value={s.id}>{s.icon} {s.label}</option>)}
              </select></label>
          </div>
          <div className="row gap-2"><button className="btn" type="submit" disabled={busy}>{busy ? "Logging…" : "Log"}</button><button className="btn btn-secondary" type="button" onClick={() => setLogging(false)}>Cancel</button></div>
        </form>
      )}

      <TrackingTopics category={domain} suggestions={suggestions} />

      <Section label={`${title} stream`}>
        {loading ? <div className="t-sub t-muted">Loading…</div>
          : domainSignals.length === 0 ? <div className="t-sub t-muted">Nothing here yet. Log intel above, or connect external sources in Settings.</div>
          : (
            <div className="stack-3">
              {domainSignals.map((s) => {
                const src = sourceById(s.source_id);
                return (
                  <div key={s.id} className="card card-pad">
                    <div className="row-between" style={{ gap: 12, alignItems: "flex-start", marginBottom: 5 }}>
                      <span style={{ fontSize: 14.5, fontWeight: 620 }}>{s.title}</span>
                      <Confidence label={s.conf_label} level={s.conf_level} />
                    </div>
                    {s.why && <p className="t-sub" style={{ lineHeight: 1.5, marginBottom: 8 }}>{s.why}</p>}
                    <div className="row gap-2" style={{ flexWrap: "wrap" }}>
                      {src && <Chip>{src.icon} {src.label}</Chip>}
                      {s.observed_at && <span className="t-mono-xs">{ago(s.observed_at)}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
      </Section>
    </div>
  );
}
