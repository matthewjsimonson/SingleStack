"use client";

// Outcomes — the Learn loop's board. Declare a falsifiable claim on an epic
// ("if this works, X moves up within 30 days"), the watcher drafts a verdict
// at the horizon, a human resolves it, and the resolution feeds back into the
// signal stream — shipped work becomes evidence. Decisions get a track record.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Section, Chip, Banner } from "@/components/ui";
import { errText, authHeader } from "@/lib/strategy";

type Outcome = {
  id: string; bundle_id: string; title: string; measure_kind: string; record_field_id: string | null;
  direction: string; horizon_days: number; review_due_at: string; baseline_num: number | null;
  status: string; ai_verdict: string | null; ai_rationale: string | null; checked_at: string | null;
  resolved_at: string | null; resolution_note: string | null;
};
type Epic = { id: string; title: string; state: string };
type MetricField = { id: string; label: string };

const VERDICT_TONE: Record<string, "green" | "amber" | "default"> = { hit: "green", missed: "amber", inconclusive: "default" };
const BLANK = { bundle_id: "", title: "", measure_kind: "signal", record_field_id: "", direction: "up", horizon: "30" };

export default function OutcomesBoard() {
  const supabase = createClient();
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [epics, setEpics] = useState<Epic[]>([]);
  const [metricFields, setMetricFields] = useState<MetricField[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [declaring, setDeclaring] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const [{ data: os }, { data: eps }, { data: mfs }] = await Promise.all([
      supabase.from("expected_outcomes").select("id, bundle_id, title, measure_kind, record_field_id, direction, horizon_days, review_due_at, baseline_num, status, ai_verdict, ai_rationale, checked_at, resolved_at, resolution_note").order("created_at", { ascending: false }),
      supabase.from("strategy_bundles").select("id, title, state").order("created_at", { ascending: false }),
      supabase.from("record_fields").select("id, label").eq("field_kind", "metric").order("label"),
    ]);
    setOutcomes((os ?? []) as Outcome[]); setEpics((eps ?? []) as Epic[]); setMetricFields((mfs ?? []) as MetricField[]);
    setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const epicTitle = (id: string) => epics.find((e) => e.id === id)?.title ?? "an epic";

  async function declare(e: React.FormEvent) {
    e.preventDefault();
    if (!form.bundle_id || !form.title.trim()) { setError("Pick an epic and state the claim."); return; }
    if (form.measure_kind === "metric" && !form.record_field_id) { setError("Pick which metric should move."); return; }
    setBusy("declare"); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      const horizon = Math.min(365, Math.max(1, parseInt(form.horizon) || 30));
      // Metric kind: capture the baseline NOW so "moved" is testable later.
      let baseline_num: number | null = null;
      if (form.measure_kind === "metric") {
        const { data: latest } = await supabase.from("record_metrics").select("value_num").eq("record_field_id", form.record_field_id).order("period", { ascending: false }).limit(1).maybeSingle();
        baseline_num = latest?.value_num ?? null;
      }
      const { error } = await supabase.from("expected_outcomes").insert({
        org_id: orgId, bundle_id: form.bundle_id, title: form.title.trim(),
        measure_kind: form.measure_kind, record_field_id: form.measure_kind === "metric" ? form.record_field_id : null,
        direction: form.direction, horizon_days: horizon,
        review_due_at: new Date(Date.now() + horizon * 86400_000).toISOString(),
        baseline_num, baseline_at: new Date().toISOString(),
      });
      if (error) throw error;
      setDeclaring(false); setForm(BLANK); await load();
    } catch (e) { setError(errText(e, "Could not declare the outcome.")); }
    finally { setBusy(null); }
  }

  async function checkNow(o: Outcome) {
    setBusy(o.id); setError(null);
    try {
      const { data, error } = await supabase.functions.invoke("outcome-watch", { body: { outcome_id: o.id }, headers: await authHeader(supabase) });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      await load();
    } catch (e) { setError(errText(e, "Could not check the outcome.")); }
    finally { setBusy(null); }
  }

  // Resolve = the human verdict. Also feeds the result BACK into the signal
  // stream — ship → outcome → signal, the Learn loop closing for real.
  async function resolve(o: Outcome, verdict: "hit" | "missed" | "inconclusive") {
    setBusy(o.id); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      const note = (notes[o.id] ?? "").trim() || null;
      const { error } = await supabase.from("expected_outcomes").update({
        status: verdict, resolved_at: new Date().toISOString(), resolved_by: "human", resolution_note: note,
      }).eq("id", o.id);
      if (error) throw error;
      await supabase.from("signals").insert({
        org_id: orgId, scope: "org", origin: "internal", category: "product",
        title: `Outcome ${verdict}: ${o.title}`.slice(0, 280),
        why: (note ?? o.ai_rationale ?? `Resolved on "${epicTitle(o.bundle_id)}"`).slice(0, 1000),
        conf_level: 0.9, conf_label: "High", observed_at: new Date().toISOString(),
        metadata: { kind: "outcome", outcome_id: o.id, verdict },
      });
      await load();
    } catch (e) { setError(errText(e, "Could not resolve the outcome.")); }
    finally { setBusy(null); }
  }

  if (loading) return <div className="t-sub t-muted">Loading…</div>;

  const inReview = outcomes.filter((o) => o.status === "review");
  const watching = outcomes.filter((o) => o.status === "watching");
  const resolved = outcomes.filter((o) => ["hit", "missed", "inconclusive"].includes(o.status));
  const score = resolved.length ? `${resolved.filter((o) => o.status === "hit").length}/${resolved.length} hit` : null;

  const head = (o: Outcome) => (
    <div className="row gap-2" style={{ flexWrap: "wrap", alignItems: "center" }}>
      <span style={{ fontSize: 13.5, fontWeight: 640 }}>{o.title}</span>
      <Chip>{epicTitle(o.bundle_id)}</Chip>
      <span className="t-mono-xs t-muted">{o.measure_kind === "metric" ? `metric ${o.direction}` : `signals ${o.direction}`} · {o.horizon_days}d{o.baseline_num != null ? ` · baseline ${o.baseline_num}` : ""}</span>
    </div>
  );

  return (
    <div>
      <div className="row gap-2" style={{ marginBottom: "var(--sp-3)", alignItems: "center", flexWrap: "wrap" }}>
        <span className="t-label">Outcomes — did shipped work actually move things?</span>
        {score && <Chip tone="green">{score}</Chip>}
        <div style={{ flex: 1 }} />
        <button className="btn btn-sm" onClick={() => { setDeclaring((v) => !v); setError(null); }}>{declaring ? "Close" : "+ Declare outcome"}</button>
      </div>
      <Banner>{error}</Banner>

      {declaring && (
        <form onSubmit={declare} className="card card-pad" style={{ marginBottom: "var(--sp-4)", background: "var(--panel-2)" }}>
          <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 10 }}>A falsifiable claim: if this epic works, what should move, which way, by when? The watcher checks it at the horizon and drafts a verdict for you.</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-3)" }}>
            <label className="field"><span className="t-label">Epic</span>
              <select className="select" value={form.bundle_id} onChange={(e) => setForm({ ...form, bundle_id: e.target.value })}>
                <option value="">— pick the shipped/shipping epic —</option>
                {epics.map((e) => <option key={e.id} value={e.id}>{e.title || "Untitled epic"}{e.state === "promoted" ? " · shipped" : ""}</option>)}
              </select></label>
            <label className="field"><span className="t-label">Claim</span>
              <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Activation rate rises" /></label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "var(--sp-3)" }}>
            <label className="field"><span className="t-label">Measure</span>
              <select className="select" value={form.measure_kind} onChange={(e) => setForm({ ...form, measure_kind: e.target.value })}>
                <option value="signal">Signals (qualitative)</option>
                <option value="metric" disabled={metricFields.length === 0}>Metric{metricFields.length === 0 ? " — add a metric field first" : ""}</option>
              </select></label>
            {form.measure_kind === "metric" && (
              <label className="field"><span className="t-label">Which metric</span>
                <select className="select" value={form.record_field_id} onChange={(e) => setForm({ ...form, record_field_id: e.target.value })}>
                  <option value="">— pick —</option>
                  {metricFields.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select></label>
            )}
            <label className="field"><span className="t-label">Direction</span>
              <select className="select" value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}>
                <option value="up">Up = success</option><option value="down">Down = success</option>
              </select></label>
            <label className="field"><span className="t-label">Horizon (days)</span>
              <input className="input" value={form.horizon} onChange={(e) => setForm({ ...form, horizon: e.target.value })} placeholder="30" /></label>
          </div>
          <button className="btn btn-sm" type="submit" disabled={busy === "declare"}>{busy === "declare" ? "Declaring…" : "Declare — start watching"}</button>
        </form>
      )}

      {outcomes.length === 0 && !declaring && (
        <div className="empty"><div className="t-body" style={{ fontWeight: 600, marginBottom: 6 }}>No outcomes declared yet</div><div className="t-sub" style={{ maxWidth: 480, marginInline: "auto" }}>Strategy without a scoreboard is just opinions. Declare what each epic should move — the watcher checks at the horizon, you call the verdict, and the result flows back into your signals.</div></div>
      )}

      {inReview.length > 0 && (
        <Section label={`In review · ${inReview.length} — the AI drafted a verdict; you decide`}>
          <div className="stack-3">
            {inReview.map((o) => (
              <div key={o.id} className="card card-pad" style={{ borderLeft: "3px solid var(--am-text)" }}>
                {head(o)}
                <div className="row gap-2" style={{ marginTop: 8, alignItems: "center" }}>
                  <Chip tone={VERDICT_TONE[o.ai_verdict ?? ""] ?? "default"}>AI draft: {o.ai_verdict}</Chip>
                  {o.checked_at && <span className="t-mono-xs t-muted">checked {new Date(o.checked_at).toLocaleDateString()}</span>}
                </div>
                {o.ai_rationale && <div className="t-sub" style={{ fontSize: 12.5, lineHeight: 1.5, marginTop: 6 }}>{o.ai_rationale}</div>}
                <input className="input" style={{ marginTop: 10 }} value={notes[o.id] ?? ""} onChange={(e) => setNotes({ ...notes, [o.id]: e.target.value })} placeholder="Your read (optional) — recorded with the verdict and fed back as a signal" />
                <div className="row gap-2" style={{ marginTop: 8, flexWrap: "wrap" }}>
                  <button className="btn btn-sm" disabled={busy === o.id} onClick={() => resolve(o, "hit")} style={{ background: "var(--gn)", color: "#fff" }}>✓ Hit</button>
                  <button className="btn btn-sm" disabled={busy === o.id} onClick={() => resolve(o, "missed")} style={{ background: "var(--am-text)", color: "#fff" }}>✗ Missed</button>
                  <button className="btn btn-secondary btn-sm" disabled={busy === o.id} onClick={() => resolve(o, "inconclusive")}>Inconclusive</button>
                  <button className="btn btn-secondary btn-sm" disabled={busy === o.id} onClick={() => checkNow(o)}>{busy === o.id ? "Re-checking…" : "↻ Re-check"}</button>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {watching.length > 0 && (
        <Section label={`Watching · ${watching.length}`}>
          <div className="stack-3">
            {watching.map((o) => (
              <div key={o.id} className="card card-pad row-between" style={{ alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>{head(o)}</div>
                <div className="row gap-2" style={{ alignItems: "center", flexShrink: 0 }}>
                  <span className="t-mono-xs t-muted">verdict due {new Date(o.review_due_at).toLocaleDateString()}</span>
                  <button className="btn btn-secondary btn-sm" disabled={busy === o.id} onClick={() => checkNow(o)}>{busy === o.id ? "Checking…" : "Check now"}</button>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {resolved.length > 0 && (
        <Section label={`Track record · ${resolved.length}`}>
          <div className="stack-2">
            {resolved.map((o) => (
              <div key={o.id} className="card card-pad" style={{ padding: "10px 14px" }}>
                <div className="row-between" style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {head(o)}
                  <span className="row gap-2" style={{ alignItems: "center", flexShrink: 0 }}>
                    <Chip tone={VERDICT_TONE[o.status] ?? "default"}>{o.status}</Chip>
                    {o.resolved_at && <span className="t-mono-xs t-muted">{new Date(o.resolved_at).toLocaleDateString()}</span>}
                  </span>
                </div>
                {o.resolution_note && <div className="t-sub t-muted" style={{ fontSize: 12, marginTop: 4 }}>{o.resolution_note}</div>}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
