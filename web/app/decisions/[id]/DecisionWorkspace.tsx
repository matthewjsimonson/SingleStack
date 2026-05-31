"use client";

// Decision workspace — the centerpiece of the Intelligence→Ship loop. NOT a text
// box: a decision is made among OPTIONS, each with explicit tradeoffs, one
// recommended. AI can draft the options from the source theme (proposals you
// edit); the human picks one to DECIDE; deciding unlocks ROUTE TO SHIP, which
// spawns a build item whose Why is pre-filled from this decision + evidence.
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { PageHeader, Section, Chip, Banner, BackLink, Spinner } from "@/components/ui";
import { useAgentRun, AgentProgress } from "@/components/AgentProgress";

type Decision = {
  id: string; title: string; question: string | null; status: string; scope: string;
  theme_id: string | null; chosen_option_id: string | null; rationale: string | null; owner: string | null; product_id: string | null;
};
type Option = { id: string; title: string; detail: string | null; tradeoffs: string | null; recommended: boolean; position: number };
type Evidence = { id: string; theme_id: string | null; signal_id: string | null; label: string };

export default function DecisionWorkspace({ id }: { id: string }) {
  const supabase = createClient();
  const router = useRouter();
  const [d, setD] = useState<Decision | null>(null);
  const [options, setOptions] = useState<Option[]>([]);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const optionsRun = useAgentRun("draftDecision");
  const [routing, setRouting] = useState(false);
  const [addingOpt, setAddingOpt] = useState(false);
  const [optForm, setOptForm] = useState({ title: "", detail: "", tradeoffs: "" });
  const [rationale, setRationale] = useState("");

  const load = useCallback(async () => {
    const { data: dec, error: dErr } = await supabase.from("decisions")
      .select("id, title, question, status, scope, theme_id, chosen_option_id, rationale, owner, product_id").eq("id", id).single();
    if (dErr) setError(dErr.message);
    setD(dec ?? null);
    setRationale(dec?.rationale ?? "");
    const { data: opts } = await supabase.from("decision_options").select("id, title, detail, tradeoffs, recommended, position").eq("decision_id", id).order("position");
    setOptions(opts ?? []);
    // Evidence: resolve theme/signal titles for chips.
    const { data: ev } = await supabase.from("decision_evidence").select("id, theme_id, signal_id").eq("decision_id", id);
    const rows: Evidence[] = [];
    for (const e of ev ?? []) {
      if (e.theme_id) { const { data: t } = await supabase.from("signal_themes").select("title").eq("id", e.theme_id).single(); rows.push({ ...e, label: t?.title ?? "theme" }); }
      else if (e.signal_id) { const { data: s } = await supabase.from("signals").select("title").eq("id", e.signal_id).single(); rows.push({ ...e, label: s?.title ?? "signal" }); }
    }
    setEvidence(rows);
    setLoading(false);
  }, [supabase, id]);
  useEffect(() => { load(); }, [load]);

  async function draftOptions() {
    if (!d?.theme_id) { setError("This decision isn't linked to a theme, so AI can't draft from one. Add options manually, or start the decision from a theme."); return; }
    setError(null);
    try {
      await optionsRun.go(async () => {
        const { data, error: fnErr } = await supabase.functions.invoke("draft-decision", { body: { theme_id: d.theme_id } });
        if (fnErr) throw fnErr;
        if (data?.error) throw new Error(data.message || data.error);
        const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
        if (data?.question && !d.question) await supabase.from("decisions").update({ question: data.question }).eq("id", id);
        const opts = (data?.options ?? []) as { title: string; detail: string; tradeoffs: string; recommended: boolean }[];
        if (opts.length) {
          await supabase.from("decision_options").insert(opts.map((o, i) => ({
            org_id: orgId, decision_id: id, title: o.title, detail: o.detail, tradeoffs: o.tradeoffs, recommended: !!o.recommended, position: options.length + i,
          })));
        }
        await load();
      });
    } catch (e) { setError(e instanceof Error ? e.message : "Could not draft options."); }
  }

  async function addOption(e: React.FormEvent) {
    e.preventDefault(); if (!optForm.title.trim()) return;
    setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      await supabase.from("decision_options").insert({ org_id: orgId, decision_id: id, title: optForm.title.trim(), detail: optForm.detail.trim() || null, tradeoffs: optForm.tradeoffs.trim() || null, position: options.length });
      setOptForm({ title: "", detail: "", tradeoffs: "" }); setAddingOpt(false); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not add option."); }
  }

  async function choose(optId: string) {
    setError(null);
    await supabase.from("decisions").update({ chosen_option_id: optId, status: "decided", rationale: rationale.trim() || null, decided_at: new Date().toISOString() }).eq("id", id);
    await load();
  }

  async function routeToShip() {
    if (!d || !d.chosen_option_id) return;
    setRouting(true); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      const chosen = options.find((o) => o.id === d.chosen_option_id);
      // Spawn a build item carrying the decision's intent.
      const { data: item, error: iErr } = await supabase.from("initiatives").insert({
        org_id: orgId, lane: "ship", title: chosen?.title || d.title, build_stage: "spec", stage: "active",
        priority: "medium", product_id: d.product_id, decision_id: d.id,
      }).select("id").single();
      if (iErr) throw iErr;
      // Pre-fill the Why from the decision + chosen option + evidence.
      const evidenceText = evidence.map((e) => `• ${e.label}`).join("\n");
      const whyFields = [
        { field_key: "hypothesis", label: "Hypothesis", section: "Why", value: chosen?.detail || d.title, position: 0 },
        { field_key: "problem", label: "Problem / opportunity", section: "Why", value: d.question || null, position: 1 },
        { field_key: "evidence", label: "Evidence", section: "Why", value: evidenceText || `From decision: ${d.title}`, position: 3 },
      ].filter((f) => f.value);
      await supabase.from("initiative_fields").insert(whyFields.map((f) => ({ org_id: orgId, initiative_id: item.id, ...f })));
      // Carry the decision's evidence signals onto the build item.
      const sigIds = evidence.filter((e) => e.signal_id).map((e) => e.signal_id);
      if (sigIds.length) await supabase.from("initiative_signals").insert(sigIds.map((sid) => ({ org_id: orgId, initiative_id: item.id, signal_id: sid })));
      await supabase.from("decisions").update({ status: "routed" }).eq("id", id);
      router.push(`/ship/${item.id}`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not route to Ship."); setRouting(false); }
  }

  if (loading) return <Spinner label="Loading decision…" />;
  if (!d) return <Banner>Decision not found.</Banner>;
  const chosen = options.find((o) => o.id === d.chosen_option_id);

  return (
    <div>
      <BackLink href="/decisions" label="Decisions" />
      <PageHeader
        title={d.title}
        meta={d.question || "Decide among the options — each with its tradeoffs — then route the call into Ship."}
        actions={<Chip tone={d.status === "routed" ? "green" : d.status === "decided" ? "default" : "accent"}>{d.status}</Chip>}
      />
      <Banner>{error}</Banner>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 300px", gap: "var(--sp-6)", alignItems: "start" }}>
        {/* LEFT: the options */}
        <div style={{ display: "grid", gap: "var(--sp-4)" }}>
          <Section
            label="Options"
            action={<div className="row gap-2">
              {d.theme_id && (optionsRun.active ? <AgentProgress run={optionsRun} compact /> : <button className="btn btn-accent btn-sm" onClick={draftOptions}>✨ Draft options</button>)}
              <button className="btn btn-secondary btn-sm" onClick={() => setAddingOpt((v) => !v)}>{addingOpt ? "Cancel" : "+ Option"}</button>
            </div>}
          >
            <div className="t-sub t-muted" style={{ marginBottom: "var(--sp-3)" }}>Each option carries its tradeoffs. Pick one to decide.</div>

            {addingOpt && (
              <form onSubmit={addOption} className="card card-pad" style={{ marginBottom: "var(--sp-3)", borderStyle: "dashed" }}>
                <label className="field"><span className="t-label">Option</span><input className="input" autoFocus value={optForm.title} onChange={(e) => setOptForm({ ...optForm, title: e.target.value })} placeholder="The choice in a phrase" /></label>
                <label className="field"><span className="t-label">Detail</span><textarea className="textarea" rows={2} value={optForm.detail} onChange={(e) => setOptForm({ ...optForm, detail: e.target.value })} placeholder="What choosing it actually means" /></label>
                <label className="field"><span className="t-label">Tradeoffs</span><textarea className="textarea" rows={2} value={optForm.tradeoffs} onChange={(e) => setOptForm({ ...optForm, tradeoffs: e.target.value })} placeholder="The cost / risk of this option" /></label>
                <button className="btn btn-sm" type="submit">Add option</button>
              </form>
            )}

            {options.length === 0 && !addingOpt && (
              <p className="t-muted" style={{ margin: 0 }}>No options yet. {d.theme_id ? "Draft them from the theme, or add your own." : "Add the choices you're weighing."}</p>
            )}

            <div className="stack-3">
              {options.map((o) => {
                const isChosen = o.id === d.chosen_option_id;
                return (
                  <div key={o.id} className="card card-pad" style={{ borderColor: isChosen ? "var(--gn)" : o.recommended ? "var(--ac)" : undefined, borderWidth: isChosen ? 2 : 1 }}>
                    <div className="row-between" style={{ alignItems: "baseline" }}>
                      <span style={{ fontSize: 14, fontWeight: 640 }}>{o.title}</span>
                      <div className="row gap-2">
                        {o.recommended && <Chip tone="accent">recommended</Chip>}
                        {isChosen ? <Chip tone="green">chosen</Chip> : <button className="btn btn-sm" onClick={() => choose(o.id)}>Choose</button>}
                      </div>
                    </div>
                    {o.detail && <p style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>{o.detail}</p>}
                    {o.tradeoffs && (
                      <div className="t-sub" style={{ fontSize: 12.5, background: "var(--fill)", borderRadius: 6, padding: "7px 9px", marginTop: 8 }}>
                        <strong>Tradeoffs:</strong> {o.tradeoffs}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Section>

          <Section label="Rationale">
            <div className="t-sub t-muted" style={{ marginBottom: "var(--sp-3)" }}>Why this call. Saved when you choose an option.</div>
            <textarea className="textarea" rows={3} value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="The reasoning behind the decision." onBlur={() => { if (rationale !== (d.rationale ?? "")) supabase.from("decisions").update({ rationale: rationale.trim() || null }).eq("id", id); }} />
          </Section>
        </div>

        {/* RIGHT: evidence + route */}
        <div style={{ display: "grid", gap: "var(--sp-4)", position: "sticky", top: "var(--sp-4)" }}>
          <Section label="Decision">
            <div style={{ display: "grid", gap: 8 }}>
              <div className="row gap-2"><Chip>{d.scope}</Chip>{d.theme_id && <Chip tone="violet">from theme</Chip>}</div>
              {chosen ? (
                <div className="t-sub"><span className="t-muted">Chosen: </span><strong>{chosen.title}</strong></div>
              ) : (
                <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No option chosen yet.</div>
              )}
              <button className="btn" disabled={!chosen || routing || d.status === "routed"} onClick={routeToShip}>
                {d.status === "routed" ? "Routed to Ship ✓" : routing ? "Routing…" : "Route to Ship →"}
              </button>
              {!chosen && <div className="t-sub t-muted" style={{ fontSize: 11 }}>Choose an option to enable routing.</div>}
            </div>
          </Section>

          <Section label="Evidence">
            <div className="t-sub t-muted" style={{ marginBottom: "var(--sp-3)" }}>What backs this decision.</div>
            {evidence.length === 0 ? (
              <p className="t-muted" style={{ margin: 0 }}>No evidence linked.</p>
            ) : (
              <div className="row gap-2" style={{ flexWrap: "wrap" }}>
                {evidence.map((e) => <Chip key={e.id} tone="violet">{e.label}</Chip>)}
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
