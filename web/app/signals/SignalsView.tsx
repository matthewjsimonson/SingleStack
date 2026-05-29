"use client";

// Signals — a tabbed intelligence area:
//   • Homepage  — the dynamic dashboard. AI synthesizes ALL signals into THEMES,
//                 split Product vs GTM, each with a prescriptive recommendation.
//                 "Synthesize" runs the synthesize-signals function (real Claude).
//   • Internal  — raw signal stream from your own tools/subscriptions.
//   • External  — raw signal stream from market/web resources.
// Sources are managed in Settings; agents primarily run from the Homepage.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { PageHeader, Section, Chip, Banner, Confidence } from "@/components/ui";

type Source = { id: string; label: string; icon: string; origin: string };
type Signal = {
  id: string; title: string; why: string | null; conf_label: string | null; conf_level: number | null;
  observed_at: string | null; scope: string; source_id: string | null;
};
type Theme = {
  id: string; category: string; title: string; summary: string | null;
  recommendation: string | null; conf_level: number | null; signal_ids: string[] | null;
};

function ago(iso: string | null) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

type Tab = "home" | "internal" | "external";

export default function SignalsView() {
  const supabase = createClient();
  const [sources, setSources] = useState<Source[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [synth, setSynth] = useState(false);

  const [logging, setLogging] = useState(false);
  const [form, setForm] = useState({ title: "", why: "", conf: "0.7", source_id: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data: srcs }, { data: sigs }, { data: ths }] = await Promise.all([
      supabase.from("sources").select("id, label, icon, origin").order("created_at"),
      supabase.from("signals").select("id, title, why, conf_label, conf_level, observed_at, scope, source_id").order("observed_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }),
      supabase.from("signal_themes").select("id, category, title, summary, recommendation, conf_level, signal_ids").order("position"),
    ]);
    setSources(srcs ?? []); setSignals(sigs ?? []); setThemes(ths ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const internalIds = new Set(sources.filter((s) => s.origin === "internal").map((s) => s.id));
  const sourceById = (id: string | null) => sources.find((s) => s.id === id) ?? null;
  const isInternal = (s: Signal) => internalIds.has(s.source_id ?? "");

  async function synthesize() {
    setSynth(true); setError(null);
    try {
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      const { data, error } = await supabase.functions.invoke("synthesize-signals", {
        body: {}, headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Synthesis failed."); }
    finally { setSynth(false); }
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
        observed_at: new Date().toISOString(), source_id: form.source_id || null,
      });
      if (error) throw error;
      setLogging(false); setForm({ title: "", why: "", conf: "0.7", source_id: "" });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not log signal."); }
    finally { setBusy(false); }
  }

  const stream = signals.filter((s) => tab === "internal" ? isInternal(s) : tab === "external" ? !isInternal(s) : true);
  const productThemes = themes.filter((t) => t.category === "product");
  const gtmThemes = themes.filter((t) => t.category === "gtm");

  return (
    <div>
      <PageHeader
        title="Signals"
        meta="Your intelligence dashboard — internal & external intel, synthesized into what to do next."
        actions={<><a className="btn btn-secondary" href="/settings">Manage sources</a><button className="btn" onClick={() => setLogging((v) => !v)}>{logging ? "Close" : "+ Log signal"}</button></>}
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

      {/* Tabs */}
      <div className="row gap-2" style={{ marginBottom: "var(--sp-5)", borderBottom: "1px solid var(--border)" }}>
        {([["home", "Homepage"], ["internal", "Internal"], ["external", "External"]] as [Tab, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{ background: "none", border: "none", borderBottom: tab === k ? "2px solid var(--ac)" : "2px solid transparent", color: tab === k ? "var(--tp)" : "var(--ts)", fontWeight: 640, fontSize: 13.5, padding: "8px 14px", cursor: "pointer", marginBottom: -1 }}>
            {label}{k === "internal" ? ` · ${signals.filter(isInternal).length}` : k === "external" ? ` · ${signals.filter((s) => !isInternal(s)).length}` : ""}
          </button>
        ))}
      </div>

      {loading ? <div className="t-sub t-muted">Loading…</div> : tab === "home" ? (
        <HomeTab themes={themes} productThemes={productThemes} gtmThemes={gtmThemes} signals={signals} synth={synth} onSynthesize={synthesize} />
      ) : (
        <Stream stream={stream} sourceById={sourceById} kind={tab} />
      )}
    </div>
  );
}

function HomeTab({ themes, productThemes, gtmThemes, signals, synth, onSynthesize }: {
  themes: Theme[]; productThemes: Theme[]; gtmThemes: Theme[]; signals: Signal[]; synth: boolean; onSynthesize: () => void;
}) {
  return (
    <div>
      <div className="card card-pad" style={{ marginBottom: "var(--sp-6)", display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14.5, fontWeight: 640 }}>Intelligence synthesis</div>
          <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>
            {themes.length > 0 ? `${themes.length} themes across ${signals.length} signals. Re-synthesize when new intel lands.` : `Synthesize ${signals.length} signal${signals.length === 1 ? "" : "s"} into actionable themes.`}
          </div>
        </div>
        <button className="btn btn-accent" disabled={synth || signals.length === 0} onClick={onSynthesize}>{synth ? "Synthesizing…" : themes.length ? "Re-synthesize" : "Synthesize"}</button>
      </div>

      {themes.length === 0 ? (
        <div className="empty">
          <div className="t-body" style={{ fontWeight: 600, marginBottom: 6 }}>No themes yet</div>
          <div className="t-sub" style={{ maxWidth: 460, marginInline: "auto" }}>
            {signals.length === 0 ? "Log signals or connect sources, then synthesize to see the patterns across them." : "Click Synthesize — AI will read every signal and surface the product & GTM themes worth acting on."}
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-5)", alignItems: "start" }}>
          <ThemeColumn title="Product themes" tone="accent" themes={productThemes} />
          <ThemeColumn title="Go-to-market themes" tone="violet" themes={gtmThemes} />
        </div>
      )}
    </div>
  );
}

function ThemeColumn({ title, tone, themes }: { title: string; tone: "accent" | "violet"; themes: Theme[] }) {
  return (
    <div>
      <div className="t-label" style={{ marginBottom: "var(--sp-3)" }}>{title}</div>
      {themes.length === 0 ? <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No themes in this category.</div> : (
        <div className="stack-3">
          {themes.map((t) => (
            <div key={t.id} className="card card-pad" style={{ borderTop: `2px solid var(--${tone === "accent" ? "ac" : "vl"})` }}>
              <div className="row-between" style={{ gap: 10, alignItems: "flex-start", marginBottom: 6 }}>
                <span style={{ fontSize: 14.5, fontWeight: 640 }}>{t.title}</span>
                <Confidence level={t.conf_level} label={t.conf_level != null ? (t.conf_level >= 0.75 ? "High" : t.conf_level >= 0.5 ? "Med" : "Low") : null} />
              </div>
              {t.summary && <p className="t-sub" style={{ lineHeight: 1.5, marginBottom: 10 }}>{t.summary}</p>}
              {t.recommendation && (
                <div style={{ background: "var(--panel-2)", borderRadius: 8, padding: "10px 12px" }}>
                  <div className="t-label" style={{ marginBottom: 3 }}>Recommended</div>
                  <div className="t-body" style={{ fontSize: 13, lineHeight: 1.5 }}>{t.recommendation}</div>
                </div>
              )}
              <div className="t-mono-xs" style={{ marginTop: 8 }}>{(t.signal_ids ?? []).length} supporting signal{(t.signal_ids ?? []).length === 1 ? "" : "s"}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stream({ stream, sourceById, kind }: { stream: Signal[]; sourceById: (id: string | null) => Source | null; kind: "internal" | "external" }) {
  if (stream.length === 0) return <div className="t-sub t-muted">No {kind} signals yet. {kind === "internal" ? "Connect your tools in Settings, or log one." : "Add external sources in Settings, or log one."}</div>;
  return (
    <div className="stack-3">
      {stream.map((s) => {
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
  );
}
