"use client";

// Signals — the intelligence dashboard (not a library; sources live in Settings).
// Top: two agent-sliced lenses (Product: CPO+CEng / GTM: CRO+CCO) that turn
// intel into action — run the right agent on the right record to generate a
// proposal. Below: the signal stream (all/internal/external) + manual logging.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { PageHeader, Section, Chip, Banner, Confidence } from "@/components/ui";
import { LENSES, type Lens } from "@/lib/lenses";
import { EXEC_BY_KEY } from "@/lib/team";

type Source = { id: string; label: string; icon: string; origin: string };
type Signal = {
  id: string; title: string; why: string | null; conf_label: string | null; conf_level: number | null;
  observed_at: string | null; scope: string; source_id: string | null; product_id: string | null; gtm_record_id: string | null;
};
type Rec = { id: string; name: string };

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
  const [products, setProducts] = useState<Rec[]>([]);
  const [gtm, setGtm] = useState<Rec[]>([]);
  const [activeAgents, setActiveAgents] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"all" | "internal" | "external">("all");
  const [running, setRunning] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const [logging, setLogging] = useState(false);
  const [form, setForm] = useState({ title: "", why: "", conf: "0.7", source_id: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data: srcs }, { data: sigs }, { data: prods }, { data: gtms }, { data: ags }] = await Promise.all([
      supabase.from("sources").select("id, label, icon, origin").order("created_at"),
      supabase.from("signals").select("id, title, why, conf_label, conf_level, observed_at, scope, source_id, product_id, gtm_record_id").order("observed_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }),
      supabase.from("product_records").select("id, name"),
      supabase.from("gtm_records").select("id, name"),
      supabase.from("agents").select("key").eq("is_active", true),
    ]);
    setSources(srcs ?? []); setSignals(sigs ?? []); setProducts(prods ?? []); setGtm(gtms ?? []);
    setActiveAgents(new Set((ags ?? []).map((a) => a.key)));
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const sourceById = (id: string | null) => sources.find((s) => s.id === id) ?? null;
  const internalIds = new Set(sources.filter((s) => s.origin === "internal").map((s) => s.id));

  // signals relevant to a lens: org-wide always, plus the lens's record scope
  const lensSignals = (lens: Lens) =>
    signals.filter((s) => s.scope === "org" || s.scope === lens.recordType);

  async function runAgentOnRecord(agentKey: string, lens: Lens, recordId: string) {
    const tagId = `${agentKey}:${recordId}`;
    setRunning(tagId); setError(null); setDone(null);
    try {
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      const body = lens.recordType === "product" ? { agent_key: agentKey, product_id: recordId } : { agent_key: agentKey, gtm_record_id: recordId };
      const { data, error } = await supabase.functions.invoke("agent-propose", { body, headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setDone(tagId);
    } catch (e) { setError(e instanceof Error ? e.message : "Agent run failed."); }
    finally { setRunning(null); }
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

  const visible = signals.filter((s) => tab === "all" ? true : tab === "internal" ? internalIds.has(s.source_id ?? "") : !internalIds.has(s.source_id ?? ""));
  const internalCount = signals.filter((s) => internalIds.has(s.source_id ?? "")).length;

  return (
    <div>
      <PageHeader
        title="Signals"
        meta="Your intelligence dashboard — turn internal & external intel into product and go-to-market updates."
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

      {/* Intelligence lenses — the actionable core */}
      <Section label="Turn intel into action">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-4)" }}>
          {LENSES.map((lens) => {
            const relevant = lensSignals(lens);
            const records = lens.recordType === "product" ? products : gtm;
            const agents = lens.agentKeys.filter((k) => activeAgents.has(k)).map((k) => EXEC_BY_KEY[k]).filter(Boolean);
            return (
              <div key={lens.key} className="card card-pad" style={{ borderTop: `2px solid ${lens.accent}` }}>
                <div className="row-between" style={{ marginBottom: 6 }}>
                  <span className="t-h2" style={{ fontSize: 14.5 }}>{lens.title}</span>
                  <Chip tone={lens.key === "product" ? "accent" : "violet"}>{relevant.length} signals</Chip>
                </div>
                <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12, lineHeight: 1.45 }}>{lens.blurb}</div>

                {/* interpreting agents */}
                <div className="row gap-2" style={{ marginBottom: 12 }}>
                  {agents.length === 0 ? <a href="/" className="t-sub" style={{ color: "var(--ac-text)", fontWeight: 600 }}>Set up agents →</a>
                    : agents.map((a) => (
                      <span key={a.key} className="row gap-2" title={a.name} style={{ gap: 6 }}>
                        <span style={{ width: 24, height: 24, borderRadius: 7, background: a.accent, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 11 }}>{a.short}</span>
                      </span>
                    ))}
                </div>

                {/* actionable: run the lead agent on a record to generate a proposal */}
                {agents.length > 0 && (
                  <div>
                    <div className="t-label" style={{ marginBottom: 6 }}>Interpret into a record</div>
                    {records.length === 0 ? (
                      <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No {lens.recordType} records yet.</div>
                    ) : (
                      <div className="stack-3">
                        {records.slice(0, 4).map((r) => {
                          const lead = agents[0];
                          const tagId = `${lead.key}:${r.id}`;
                          return (
                            <div key={r.id} className="row-between card" style={{ padding: "8px 12px" }}>
                              <span style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                              {done === tagId
                                ? <a className="chip chip-green" href={lens.recordType === "product" ? `/records/${r.id}` : `/gtm/${r.id}`}>Proposal ready →</a>
                                : <button className="btn btn-sm" disabled={running !== null} onClick={() => runAgentOnRecord(lead.key, lens, r.id)}>{running === tagId ? "Running…" : `Run ${lead.short}`}</button>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      {/* Signal stream */}
      <Section label={<span className="row gap-2" style={{ gap: 10 }}>Signal stream
        <span className="row gap-2" style={{ gap: 4 }}>
          {(["all", "internal", "external"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className="chip" style={{ cursor: "pointer", textTransform: "capitalize", background: tab === t ? "var(--tp)" : "var(--fill)", color: tab === t ? "#fff" : "var(--ts)" }}>
              {t} · {t === "internal" ? internalCount : t === "external" ? signals.length - internalCount : signals.length}
            </button>
          ))}
        </span>
      </span>}>
        {loading ? <div className="t-sub t-muted">Loading…</div>
          : visible.length === 0 ? <div className="t-sub t-muted">No signals yet. Log one above, or connect a source in Settings.</div>
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
