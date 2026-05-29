"use client";

// Signals — the intelligence tab. Two halves:
//  1) Sources: register where signals come from (internal/external). Each
//     catalog connector is "manual" today (log signals by hand); live MCP
//     pulling plugs in later via the same source rows.
//  2) Signals: the evidence stream, grouped internal vs external, with source,
//     confidence, scope, and age — and a "Log signal" form.
// Client-fetched (session-carrying) so RLS scopes everything to the org.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { PageHeader, Section, Chip, Banner, Confidence } from "@/components/ui";
import { SOURCE_CATALOG, CATALOG_BY_KIND, type SourceDef } from "@/lib/sources";

type Source = { id: string; label: string; icon: string; origin: string; kind: string; status: string };
type Signal = {
  id: string; title: string; why: string | null; conf_label: string | null; conf_level: number | null;
  observed_at: string | null; scope: string; source_id: string | null;
};

function ago(iso: string | null) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export default function SignalsView() {
  const supabase = createClient();
  const [sources, setSources] = useState<Source[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"all" | "internal" | "external">("all");

  // log-signal form
  const [logging, setLogging] = useState(false);
  const [form, setForm] = useState({ title: "", why: "", conf: "0.7", source_id: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data: srcs }, { data: sigs }] = await Promise.all([
      supabase.from("sources").select("id, label, icon, origin, kind, status").order("created_at"),
      supabase.from("signals").select("id, title, why, conf_label, conf_level, observed_at, scope, source_id").order("observed_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }),
    ]);
    setSources(srcs ?? []);
    setSignals(sigs ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  async function addSource(def: SourceDef) {
    setError(null);
    try {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization.");
      const { error } = await supabase.from("sources").insert({
        org_id: orgId, label: def.label, icon: def.icon, origin: def.origin, kind: def.kind,
        status: def.live ? "connected" : "manual",
      });
      if (error) throw error;
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not add source."); }
  }

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
        observed_at: new Date().toISOString(),
        source_id: form.source_id || null,
      });
      if (error) throw error;
      setLogging(false); setForm({ title: "", why: "", conf: "0.7", source_id: "" });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not log signal."); }
    finally { setBusy(false); }
  }

  const registeredKinds = new Set(sources.map((s) => s.kind));
  const sourceById = (id: string | null) => sources.find((s) => s.id === id) ?? null;
  const internalSources = new Set(sources.filter((s) => s.origin === "internal").map((s) => s.id));

  const visible = signals.filter((s) => {
    if (tab === "all") return true;
    const src = sourceById(s.source_id);
    const origin = src?.origin ?? "internal";
    return origin === tab;
  });

  const internalCount = signals.filter((s) => internalSources.has(s.source_id ?? "")).length;
  const externalCount = signals.length - internalCount;

  return (
    <div>
      <PageHeader
        title="Signals"
        meta="Internal & external evidence that informs your Foundation and feeds your agents."
        actions={<button className="btn" onClick={() => setLogging((v) => !v)}>{logging ? "Close" : "+ Log signal"}</button>}
      />
      <Banner>{error}</Banner>

      {logging && (
        <form onSubmit={logSignal} className="card card-pad" style={{ marginBottom: "var(--sp-6)" }}>
          <label className="field"><span className="t-label">What's the signal?</span>
            <input className="input" autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Buyers stall on pricing after demo" /></label>
          <label className="field"><span className="t-label">Why it matters</span>
            <textarea className="textarea" rows={2} value={form.why} onChange={(e) => setForm({ ...form, why: e.target.value })} placeholder="Context, evidence, implication." /></label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-3)" }}>
            <label className="field"><span className="t-label">Confidence</span>
              <select className="select" value={form.conf} onChange={(e) => setForm({ ...form, conf: e.target.value })}>
                <option value="0.9">High (90%)</option><option value="0.7">Medium (70%)</option><option value="0.4">Low (40%)</option>
              </select></label>
            <label className="field"><span className="t-label">Source</span>
              <select className="select" value={form.source_id} onChange={(e) => setForm({ ...form, source_id: e.target.value })}>
                <option value="">— none —</option>
                {sources.map((s) => <option key={s.id} value={s.id}>{s.icon} {s.label}</option>)}
              </select></label>
          </div>
          <div className="row gap-2"><button className="btn" type="submit" disabled={busy}>{busy ? "Logging…" : "Log signal"}</button><button className="btn btn-secondary" type="button" onClick={() => setLogging(false)}>Cancel</button></div>
        </form>
      )}

      {/* Sources catalog */}
      <Section label="Sources">
        {sources.length > 0 && (
          <div className="row gap-2" style={{ flexWrap: "wrap", marginBottom: "var(--sp-4)" }}>
            {sources.map((s) => (
              <span key={s.id} className="chip" style={{ padding: "5px 11px" }}>
                <span>{s.icon}</span> {s.label}
                <span className="chip" style={{ marginLeft: 4, fontSize: 9.5, background: s.status === "connected" ? "var(--gn-fill)" : "var(--fill-2)", color: s.status === "connected" ? "var(--gn-text)" : "var(--tm)" }}>{s.status === "connected" ? "LIVE" : "MANUAL"}</span>
              </span>
            ))}
          </div>
        )}
        <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 10 }}>Add a source to track. Manual sources let you log signals now; connectors marked “live later” will pull automatically once connected.</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: "var(--sp-3)" }}>
          {SOURCE_CATALOG.filter((d) => !registeredKinds.has(d.kind)).map((d) => (
            <button key={d.kind} className="card card-pad pop" style={{ textAlign: "left" }} onClick={() => addSource(d)}>
              <div className="row-between" style={{ marginBottom: 6 }}>
                <span className="row gap-2"><span style={{ fontSize: 16 }}>{d.icon}</span><span style={{ fontSize: 13.5, fontWeight: 620 }}>{d.label}</span></span>
                <Chip tone={d.origin === "internal" ? "accent" : "violet"}>{d.origin}</Chip>
              </div>
              <div className="t-sub t-muted" style={{ fontSize: 12, lineHeight: 1.45 }}>{d.blurb}</div>
              <div style={{ marginTop: 8, fontSize: 11, fontWeight: 700, color: d.live ? "var(--gn-text)" : "var(--tm)" }}>{d.live ? "+ Add" : "+ Add · live later"}</div>
            </button>
          ))}
        </div>
      </Section>

      {/* Signals stream */}
      <Section label={<span className="row gap-2" style={{ gap: 10 }}>Signal stream
        <span className="row gap-2" style={{ gap: 4 }}>
          {(["all", "internal", "external"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className="chip" style={{ cursor: "pointer", background: tab === t ? "var(--tp)" : "var(--fill)", color: tab === t ? "#fff" : "var(--ts)", textTransform: "capitalize" }}>
              {t}{t === "internal" ? ` · ${internalCount}` : t === "external" ? ` · ${externalCount}` : ` · ${signals.length}`}
            </button>
          ))}
        </span>
      </span>}>
        {loading ? <div className="t-sub t-muted">Loading…</div>
          : visible.length === 0 ? <div className="t-sub t-muted">No signals yet. Log one above, or connect a source.</div>
          : (
            <div className="stack-3">
              {visible.map((s) => {
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
                      <Chip tone={s.scope === "org" ? "default" : s.scope === "product" ? "accent" : "violet"}>{s.scope}</Chip>
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
