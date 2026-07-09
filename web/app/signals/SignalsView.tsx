"use client";

// Signals — the SETUP page, and only that: build the search for signals and
// manage what you pull in. The profile's focus pages (tabs below) define WHAT
// the brain hunts; the review queue ratifies what the pulls brought back; the
// health strip says whether it's pulling on its own. The signals themselves
// live on the intelligence pages they feed — Competitive, Market, Technology.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { fireWorkflows } from "@/lib/triggers";
import { useProductScope } from "@/lib/ProductContext";
import { Banner, Modal } from "@/components/ui";
import PageBar from "@/components/PageBar";
import TrackingTopics from "@/components/TrackingTopics";
import IntelReview from "./IntelReview";
import SignalProfile from "@/components/SignalProfile";
import AutomationHealth from "@/components/AutomationHealth";
import { useAgentRun, AgentProgress } from "@/components/AgentProgress";

type Source = { id: string; label: string; icon: string; origin: string };

export default function SignalsView() {
  const supabase = createClient();
  const [sources, setSources] = useState<Source[]>([]);
  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  const [signalCount, setSignalCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const { active } = useProductScope();
  const synthRun = useAgentRun("synthesize");

  const [logOpen, setLogOpen] = useState(false);
  const [trackOpen, setTrackOpen] = useState(false);
  const [form, setForm] = useState({ title: "", why: "", conf: "0.7", source_id: "", category: "", origin: "internal", product_id: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data: srcs }, { data: prods }, { count }] = await Promise.all([
      supabase.from("sources").select("id, label, icon, origin").order("created_at"),
      supabase.from("product_records").select("id, name").order("created_at"),
      supabase.from("signals").select("id", { count: "exact", head: true }),
    ]);
    setSources(srcs ?? []); setProducts(prods ?? []); setSignalCount(count ?? 0);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const sourceById = (id: string | null) => sources.find((s) => s.id === id) ?? null;

  // Synthesize: fold pulled signals into themes + review proposals — the
  // "manage what came in" half of this page. Results are ratified in the
  // review queue below; the themes land on the strategy boards.
  async function synthesize() {
    setError(null);
    try {
      await synthRun.go(async () => {
        const { data: s } = await supabase.auth.getSession();
        const token = s.session?.access_token;
        const { data, error } = await supabase.functions.invoke("synthesize-signals", {
          body: {}, headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        await load();
      });
    } catch (e) { setError(e instanceof Error ? e.message : "Synthesis failed."); }
  }

  async function logSignal(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setBusy(true); setError(null);
    try {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization.");
      const lvl = parseFloat(form.conf);
      // A signal tied to a product carries scope='product' + product_id (the
      // constraint couples them); otherwise it's company-wide (scope='org').
      const product = form.product_id || null;
      const { data: sig, error } = await supabase.from("signals").insert({
        org_id: orgId, scope: product ? "product" : "org", product_id: product,
        title: form.title.trim(), why: form.why.trim() || null,
        conf_level: lvl, conf_label: lvl >= 0.85 ? "High" : lvl >= 0.6 ? "Medium" : "Low",
        source_id: form.source_id || null, category: form.category || null, origin: form.origin,
        observed_at: new Date().toISOString(),
      }).select("id").single();
      if (error) throw error;
      // A signal landing is a real event — fire on_signal workflows (propose-only).
      await fireWorkflows(supabase, orgId, "on_signal", { label: form.title.trim(), why: form.why.trim() || undefined, signalId: sig?.id });
      setLogOpen(false);
      setForm({ title: "", why: "", conf: "0.7", source_id: "", category: "", origin: "internal", product_id: "" });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not log the signal."); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <PageBar actions={
        <>
          <button className="btn btn-secondary btn-sm" onClick={() => setTrackOpen(true)}>Tracking</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setLogOpen(true)}>+ Log signal</button>
          {synthRun.active
            ? <AgentProgress run={synthRun} compact />
            : <button className="btn btn-sm" disabled={signalCount === 0} onClick={synthesize}
                title="Fold pulled signals into themes + review proposals — ratify them below">Synthesize</button>}
        </>
      } />
      <div className="t-sub t-muted" style={{ margin: "-6px 0 var(--sp-4)", fontSize: 12.5 }}>
        Set up the search and manage what comes in. The signals themselves live where they land: <a href="/competitive" style={{ color: "var(--ac-text)" }}>Competitive</a>, <a href="/market" style={{ color: "var(--ac-text)" }}>Market</a>, and <a href="/frontier" style={{ color: "var(--ac-text)" }}>Technology</a>.
      </div>
      <Banner>{error}</Banner>

      {/* Is the brain pulling on its own? */}
      <AutomationHealth />

      {/* What the pulls brought back — ratify it (accept / edit / reject). */}
      <IntelReview onApplied={load} productFilter={active} />

      {/* The search itself: one page per focus, nodes as the hierarchy. */}
      <SignalProfile scope="landscape" />

      {/* Log signal — modal */}
      <Modal open={logOpen} onClose={() => setLogOpen(false)} title="Log a signal">
        <form onSubmit={logSignal}>
          <label className="field"><span className="t-label">What&apos;s the signal?</span>
            <input className="input" autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Buyers stall on pricing after demo" /></label>
          <label className="field"><span className="t-label">Why it matters</span>
            <textarea className="textarea" rows={4} value={form.why} onChange={(e) => setForm({ ...form, why: e.target.value })} placeholder="Context, evidence, implication." /></label>
          {products.length > 1 && (
            <label className="field"><span className="t-label">Product</span>
              <select className="select" value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })}>
                <option value="">Company-wide</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></label>
          )}
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
