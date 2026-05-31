"use client";

// Signals — the INTEL HOMEPAGE, organized around the two lenses that matter:
//   • What a signal INFORMS — Product (how you build/update the product) vs
//     GTM (how you go to market: sales, messaging, marketing, pricing). This is
//     the primary structure: the Product and GTM tabs.
//   • Where it CAME FROM — Internal (your tools & engagements) vs External
//     (the web / market). This is a filter inside each lens.
// Home = a situation room (status, synthesized themes, unsorted triage, ticker).
// Setup (log a signal, sources, tracking) stays in modals / compact rows so the
// page is for SHOWING intel, not housing forms.
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { PageHeader, Section, Chip, Banner, Confidence, Modal, SubTabs } from "@/components/ui";
import TrackingTopics from "@/components/TrackingTopics";
import SourceManager from "@/components/SourceManager";

type Source = { id: string; label: string; icon: string; origin: string };
type Signal = {
  id: string; title: string; why: string | null; conf_label: string | null; conf_level: number | null;
  observed_at: string | null; scope: string; source_id: string | null; category: string | null; origin: string;
};
type Theme = {
  id: string; category: string; title: string; summary: string | null;
  recommendation: string | null; conf_level: number | null; signal_ids: string[] | null;
};

type Lens = "product" | "gtm";
type Tab = "home" | Lens;
type OriginFilter = "all" | "internal" | "external";

// Best-practice scaffolding so a fresh org sees the intended SHAPE of each lens,
// not an empty form. Pure guidance — not stored.
const LENS_GUIDE: Record<Lens, { title: string; tone: "accent" | "violet"; blurb: string; buckets: string[] }> = {
  product: {
    title: "Product intelligence", tone: "accent",
    blurb: "How you build and update the product.",
    buckets: ["Usage & adoption", "Feature requests", "Quality & reliability", "Technical & competitive product moves"],
  },
  gtm: {
    title: "Go-to-market intelligence", tone: "violet",
    blurb: "How you take the product to market — sales, messaging, marketing, pricing.",
    buckets: ["Messaging & positioning", "Pricing", "Sales objections & wins", "Market & competitive moves"],
  },
};

const CATS: [string, string][] = [["product", "Product"], ["gtm", "GTM"], ["both", "Both"]];

function ago(iso: string | null) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

// A signal shows in a lens when it's tagged for that lens (or 'both').
const inLens = (s: Signal, lens: Lens) => s.category === lens || s.category === "both";

export default function SignalsView() {
  const supabase = createClient();
  const [sources, setSources] = useState<Source[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [originFilter, setOriginFilter] = useState<OriginFilter>("all");
  const [synth, setSynth] = useState(false);

  const [logOpen, setLogOpen] = useState(false);
  const [trackOpen, setTrackOpen] = useState(false);
  const [form, setForm] = useState({ title: "", why: "", conf: "0.7", source_id: "", category: "", origin: "internal" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data: srcs }, { data: sigs }, { data: ths }] = await Promise.all([
      supabase.from("sources").select("id, label, icon, origin").order("created_at"),
      supabase.from("signals").select("id, title, why, conf_label, conf_level, observed_at, scope, source_id, category, origin").order("observed_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }),
      supabase.from("signal_themes").select("id, category, title, summary, recommendation, conf_level, signal_ids").order("position"),
    ]);
    setSources(srcs ?? []); setSignals(sigs ?? []); setThemes(ths ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const sourceById = (id: string | null) => sources.find((s) => s.id === id) ?? null;

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
        category: form.category || null, origin: form.origin,
      });
      if (error) throw error;
      setLogOpen(false); setForm({ title: "", why: "", conf: "0.7", source_id: "", category: "", origin: "internal" });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not log signal."); }
    finally { setBusy(false); }
  }

  // Inline (re)classification — the "clean way to sort what you're looking at".
  async function setCategory(id: string, category: string | null) {
    setError(null);
    setSignals((prev) => prev.map((s) => (s.id === id ? { ...s, category } : s)));
    const { error } = await supabase.from("signals").update({ category }).eq("id", id);
    if (error) { setError(error.message); await load(); }
  }

  const internalCount = signals.filter((s) => s.origin === "internal").length;
  const externalCount = signals.filter((s) => s.origin === "external").length;
  const unsorted = signals.filter((s) => !s.category);
  const productThemes = themes.filter((t) => t.category === "product");
  const gtmThemes = themes.filter((t) => t.category === "gtm");
  const highSignals = signals.filter((s) => (s.conf_level ?? 0) >= 0.75);

  return (
    <div>
      <PageHeader
        title="Signals"
        meta="Your intelligence dashboard — internal & external intel, sorted by what it informs, synthesized into what to do next."
        actions={
          <>
            <button className="btn btn-secondary" onClick={() => setTrackOpen(true)}>Tracking</button>
            <button className="btn" onClick={() => setLogOpen(true)}>+ Log signal</button>
          </>
        }
      />
      <Banner>{error}</Banner>

      <SubTabs<Tab>
        tabs={[
          { key: "home", label: "Homepage" },
          { key: "product", label: `Product · ${signals.filter((s) => inLens(s, "product")).length}` },
          { key: "gtm", label: `GTM · ${signals.filter((s) => inLens(s, "gtm")).length}` },
        ]}
        active={tab} onChange={setTab}
      />

      {loading ? <div className="t-sub t-muted">Loading…</div> : tab === "home" ? (
        <Home
          signals={signals} themes={themes} productThemes={productThemes} gtmThemes={gtmThemes}
          highSignals={highSignals} unsorted={unsorted} internalCount={internalCount} externalCount={externalCount}
          sourceById={sourceById} synth={synth} onSynthesize={synthesize} setCategory={setCategory} goLens={setTab}
        />
      ) : (
        <LensTab
          lens={tab} signals={signals.filter((s) => inLens(s, tab))} originFilter={originFilter}
          onOriginFilter={setOriginFilter} sourceById={sourceById} setCategory={setCategory}
        />
      )}

      {/* Log signal — modal */}
      <Modal open={logOpen} onClose={() => setLogOpen(false)} title="Log a signal">
        <form onSubmit={logSignal}>
          <label className="field"><span className="t-label">What&apos;s the signal?</span>
            <input className="input" autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Buyers stall on pricing after demo" /></label>
          <label className="field"><span className="t-label">Why it matters</span>
            <textarea className="textarea" rows={2} value={form.why} onChange={(e) => setForm({ ...form, why: e.target.value })} placeholder="Context, evidence, implication." /></label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-3)" }}>
            <label className="field"><span className="t-label">Informs</span>
              <select className="select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                <option value="">Let AI sort</option>
                <option value="product">Product</option><option value="gtm">GTM</option><option value="both">Both</option>
              </select></label>
            <label className="field"><span className="t-label">Origin</span>
              <select className="select" value={form.origin} onChange={(e) => setForm({ ...form, origin: e.target.value })}>
                <option value="internal">Internal</option><option value="external">External</option>
              </select></label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-3)" }}>
            <label className="field"><span className="t-label">Confidence</span>
              <select className="select" value={form.conf} onChange={(e) => setForm({ ...form, conf: e.target.value })}>
                <option value="0.9">High (90%)</option><option value="0.7">Medium (70%)</option><option value="0.4">Low (40%)</option>
              </select></label>
            <label className="field"><span className="t-label">Source</span>
              <select className="select" value={form.source_id} onChange={(e) => {
                const src = sourceById(e.target.value);
                setForm({ ...form, source_id: e.target.value, origin: src ? src.origin : form.origin });
              }}>
                <option value="">— none —</option>
                {sources.map((s) => <option key={s.id} value={s.id}>{s.icon} {s.label}</option>)}
              </select></label>
          </div>
          <div className="row gap-2"><button className="btn" type="submit" disabled={busy}>{busy ? "Logging…" : "Log signal"}</button><button className="btn btn-secondary" type="button" onClick={() => setLogOpen(false)}>Cancel</button></div>
        </form>
      </Modal>

      {/* Tracking topics — modal */}
      <Modal open={trackOpen} onClose={() => setTrackOpen(false)} title="What you're tracking">
        <TrackingTopics category="signals" suggestions={["Recurring onboarding friction", "Feature requests by segment", "Churn signals from usage", "Support ticket themes"]} />
      </Modal>
    </div>
  );
}

// ---------- Intel homepage ----------
function Home({ signals, themes, productThemes, gtmThemes, highSignals, unsorted, internalCount, externalCount, sourceById, synth, onSynthesize, setCategory, goLens }: {
  signals: Signal[]; themes: Theme[]; productThemes: Theme[]; gtmThemes: Theme[]; highSignals: Signal[]; unsorted: Signal[];
  internalCount: number; externalCount: number;
  sourceById: (id: string | null) => Source | null; synth: boolean; onSynthesize: () => void;
  setCategory: (id: string, c: string | null) => void; goLens: (l: Lens) => void;
}) {
  return (
    <div>
      {/* Situation strip */}
      <div className="card card-pad" style={{ marginBottom: "var(--sp-5)", display: "flex", alignItems: "center", gap: 20 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, auto)", gap: 28, flex: 1 }}>
          <Stat n={signals.length} label="Signals tracked" />
          <Stat n={internalCount} label="Internal" />
          <Stat n={externalCount} label="External" />
          <Stat n={unsorted.length} label="Unsorted" accent={unsorted.length > 0} />
          <Stat n={themes.length} label="Themes" accent={themes.length > 0} />
        </div>
        <button className="btn btn-accent" disabled={synth || signals.length === 0} onClick={onSynthesize}>
          {synth ? "Synthesizing…" : themes.length ? "Re-synthesize" : "Synthesize intel"}
        </button>
      </div>

      {signals.length === 0 ? (
        <div className="empty">
          <div className="t-body" style={{ fontWeight: 600, marginBottom: 6 }}>Your situation room is empty</div>
          <div className="t-sub" style={{ maxWidth: 460, marginInline: "auto" }}>Log signals (top right) or connect sources on the Product / GTM tabs, then synthesize to see the patterns and what to do.</div>
        </div>
      ) : (
        <>
          {/* Callouts: synthesized themes as product/gtm intelligence briefs */}
          {themes.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-5)", alignItems: "start", marginBottom: "var(--sp-6)" }}>
              <ThemeColumn title="Product intelligence" tone="accent" themes={productThemes} />
              <ThemeColumn title="Go-to-market intelligence" tone="violet" themes={gtmThemes} />
            </div>
          )}

          {/* Unsorted triage — sort signals into the lens they inform */}
          {unsorted.length > 0 && (
            <Section label={`Unsorted · ${unsorted.length}`}>
              <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 10 }}>Tag what each informs, or run Synthesize to let AI sort them.</div>
              <div className="stack-3">
                {unsorted.slice(0, 6).map((s) => (
                  <div key={s.id} className="card card-pad row-between" style={{ gap: 12, alignItems: "center" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</div>
                      <Chip tone={s.origin === "external" ? "violet" : "default"}>{s.origin}</Chip>
                    </div>
                    <CategoryPicker value={s.category} onChange={(c) => setCategory(s.id, c)} />
                  </div>
                ))}
              </div>
            </Section>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: "var(--sp-6)", alignItems: "start" }}>
            {/* Activity ticker */}
            <Section label="Live activity" action={<button className="btn btn-secondary btn-sm" onClick={() => goLens("product")}>Browse by lens →</button>}>
              <div className="card">
                {signals.slice(0, 8).map((s, i) => {
                  const src = sourceById(s.source_id);
                  return (
                    <div key={s.id} style={{ padding: "11px 14px", borderTop: i === 0 ? "none" : "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ width: 6, height: 6, borderRadius: 999, flexShrink: 0, background: (s.conf_level ?? 0) >= 0.75 ? "var(--gn)" : (s.conf_level ?? 0) >= 0.5 ? "var(--am-text)" : "var(--border-strong)" }} />
                      <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</span>
                      {s.category && <Chip tone={s.category === "gtm" ? "violet" : "accent"}>{s.category === "both" ? "P+G" : s.category}</Chip>}
                      {src && <span className="chip" style={{ flexShrink: 0 }}>{src.icon}</span>}
                      <span className="t-mono-xs" style={{ flexShrink: 0 }}>{ago(s.observed_at)}</span>
                    </div>
                  );
                })}
              </div>
            </Section>

            {/* High-confidence watch list */}
            <Section label="High-confidence">
              {highSignals.length === 0 ? <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No high-confidence signals yet.</div> : (
                <div className="stack-3">
                  {highSignals.slice(0, 5).map((s) => (
                    <div key={s.id} className="card card-pad" style={{ borderLeft: "2px solid var(--gn)", padding: "12px 14px" }}>
                      <div style={{ fontSize: 13.5, fontWeight: 620, marginBottom: 3 }}>{s.title}</div>
                      <Confidence label={s.conf_label} level={s.conf_level} />
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </div>
        </>
      )}
    </div>
  );
}

// ---------- Lens tab (Product / GTM) ----------
function LensTab({ lens, signals, originFilter, onOriginFilter, sourceById, setCategory }: {
  lens: Lens; signals: Signal[]; originFilter: OriginFilter; onOriginFilter: (f: OriginFilter) => void;
  sourceById: (id: string | null) => Source | null; setCategory: (id: string, c: string | null) => void;
}) {
  const guide = LENS_GUIDE[lens];
  const stream = signals.filter((s) => originFilter === "all" ? true : s.origin === originFilter);
  const internalN = signals.filter((s) => s.origin === "internal").length;
  const externalN = signals.filter((s) => s.origin === "external").length;
  const FILTERS: [OriginFilter, string][] = [["all", `All · ${signals.length}`], ["internal", `Internal · ${internalN}`], ["external", `External · ${externalN}`]];

  return (
    <div>
      {/* Lens header + best-practice scaffold */}
      <div className="card card-pad" style={{ borderTop: `2px solid var(--${guide.tone === "accent" ? "ac" : "vl"})`, marginBottom: "var(--sp-5)" }}>
        <div className="t-h2" style={{ fontSize: 15, marginBottom: 2 }}>{guide.title}</div>
        <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 10 }}>{guide.blurb}</div>
        <div className="row gap-2" style={{ flexWrap: "wrap" }}>
          <span className="t-label" style={{ marginRight: 2 }}>What good looks like:</span>
          {guide.buckets.map((b) => <Chip key={b}>{b}</Chip>)}
        </div>
      </div>

      {/* Origin filter */}
      <div className="row gap-2" style={{ marginBottom: "var(--sp-4)" }}>
        {FILTERS.map(([k, label]) => (
          <button key={k} className={`btn btn-sm ${originFilter === k ? "" : "btn-secondary"}`} onClick={() => onOriginFilter(k)}>{label}</button>
        ))}
      </div>

      <SourceManager title={`${guide.title} — sources`} />

      {stream.length === 0 ? (
        <div className="t-sub t-muted">No {originFilter === "all" ? "" : originFilter + " "}signals in this lens yet. Log one (top right) or connect a source above; unsorted signals get classified on Synthesize.</div>
      ) : (
        <div className="stack-3">
          {stream.map((s) => <SignalCard key={s.id} s={s} src={sourceById(s.source_id)} setCategory={setCategory} />)}
        </div>
      )}
    </div>
  );
}

function SignalCard({ s, src, setCategory }: { s: Signal; src: Source | null; setCategory: (id: string, c: string | null) => void }) {
  return (
    <div className="card card-pad">
      <div className="row-between" style={{ gap: 12, alignItems: "flex-start", marginBottom: 5 }}>
        <span style={{ fontSize: 14.5, fontWeight: 620 }}>{s.title}</span>
        <Confidence label={s.conf_label} level={s.conf_level} />
      </div>
      {s.why && <p className="t-sub" style={{ lineHeight: 1.5, marginBottom: 8 }}>{s.why}</p>}
      <div className="row-between" style={{ gap: 12, flexWrap: "wrap" }}>
        <div className="row gap-2" style={{ flexWrap: "wrap" }}>
          {src && <Chip>{src.icon} {src.label}</Chip>}
          <Chip tone={s.origin === "external" ? "violet" : "default"}>{s.origin}</Chip>
          {s.observed_at && <span className="t-mono-xs">{ago(s.observed_at)}</span>}
        </div>
        <CategoryPicker value={s.category} onChange={(c) => setCategory(s.id, c)} />
      </div>
    </div>
  );
}

// Compact lens (re)classifier. Click a lens to (re)tag; click the active one to
// clear back to unsorted.
function CategoryPicker({ value, onChange }: { value: string | null; onChange: (c: string | null) => void }) {
  return (
    <div className="row gap-2" style={{ flexShrink: 0 }}>
      {CATS.map(([key, label]) => {
        const on = value === key;
        return (
          <button key={key} type="button" onClick={() => onChange(on ? null : key)}
            className="chip" style={{ cursor: "pointer", background: on ? (key === "gtm" ? "var(--vl)" : "var(--ac)") : "var(--fill)", color: on ? "#fff" : "var(--ts)" }}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

function Stat({ n, label, accent }: { n: number; label: string; accent?: boolean }) {
  return (
    <div className="stat">
      <span className="stat-num" style={{ color: accent ? "var(--ac-text)" : undefined }}>{n}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function ThemeColumn({ title, tone, themes }: { title: string; tone: "accent" | "violet"; themes: Theme[] }) {
  const supabase = createClient();
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  // Turn a synthesized theme into a decision: carry the theme (and its signals)
  // as cited evidence, then open the decision workspace to weigh options.
  async function makeDecision(t: Theme) {
    setBusyId(t.id);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("no org");
      const { data: dec, error } = await supabase.from("decisions").insert({
        org_id: orgId, title: t.title, status: "open", scope: "org", theme_id: t.id,
      }).select("id").single();
      if (error) throw error;
      const evidence: { org_id: string; decision_id: string; theme_id?: string; signal_id?: string }[] =
        [{ org_id: orgId, decision_id: dec.id, theme_id: t.id }];
      for (const sid of t.signal_ids ?? []) evidence.push({ org_id: orgId, decision_id: dec.id, signal_id: sid });
      await supabase.from("decision_evidence").insert(evidence);
      router.push(`/decisions/${dec.id}`);
    } catch { setBusyId(null); }
  }

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
              <div className="row-between" style={{ marginTop: 10, alignItems: "center" }}>
                <span className="t-mono-xs">{(t.signal_ids ?? []).length} supporting signal{(t.signal_ids ?? []).length === 1 ? "" : "s"}</span>
                <button className="btn btn-secondary btn-sm" disabled={busyId === t.id} onClick={() => makeDecision(t)}>
                  {busyId === t.id ? "Creating…" : "Make a decision →"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
