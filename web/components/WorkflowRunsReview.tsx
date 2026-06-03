"use client";

// Automations inbox — the propose-only trigger queue, two HITL gates.
//
//   Gate 1 (here): a real event (signal landed, capability logged, release
//   shipped) FIRED a workflow. Nothing happened on its own; it waits for you.
//   Gate 2: when you say go, the officer DRAFTS — for a record-targeted
//   workflow it runs agent-propose, landing a proposal in that record's review
//   queue (you ratify there); otherwise it drafts a starter initiative. The AI
//   does the work; humans hold both gates.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { spawnInitiative } from "@/lib/routing";
import { Section, Chip } from "@/components/ui";

type Ctx = { label?: string; why?: string; releaseId?: string; capabilityId?: string; signalId?: string };
type Wf = { agent_id: string | null; target_type: string | null; target_id: string | null };
type Run = {
  id: string; workflow_id: string; trigger: string; context: Ctx | null;
  summary: string | null; proposed_action: string | null; created_at: string; workflows: Wf | null;
};
type Done = { kind: "proposal" | "initiative"; href: string; label: string };

const TRIGGER_LABEL: Record<string, string> = { on_release: "On release", on_capability_update: "On new capability", on_signal: "When a signal lands" };

// The brief handed to the officer — carries the event so the draft is grounded.
function instructionFor(trigger: string, ctx: Ctx): string {
  const why = ctx.why ? ` Context: ${ctx.why}` : "";
  switch (trigger) {
    case "on_signal":
      return `A new signal just landed: “${ctx.label}”.${why} Review this record against it and propose changes only if genuinely warranted — prefer restraint.`;
    case "on_capability_update":
      return `A new frontier capability just landed: “${ctx.label}”.${why} Propose how this record should respond — what becomes newly possible, what to sharpen — only if warranted.`;
    case "on_release":
      return `“${ctx.label}” just shipped.${why} Propose the go-to-market follow-through for this record, only if warranted.`;
    default:
      return `Event: “${ctx.label}”.${why} Propose a response only if warranted.`;
  }
}

export default function WorkflowRunsReview({ onChanged }: { onChanged?: () => void }) {
  const supabase = createClient();
  const [runs, setRuns] = useState<Run[]>([]);
  const [agents, setAgents] = useState<Record<string, string>>({});       // agent_id → name
  const [agentKeys, setAgentKeys] = useState<Record<string, string>>({});  // agent_id → key
  const [recordNames, setRecordNames] = useState<Record<string, string>>({}); // target_id → name
  const [done, setDone] = useState<Record<string, Done>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("workflow_runs")
      .select("id, workflow_id, trigger, context, summary, proposed_action, created_at, workflows(agent_id, target_type, target_id)")
      .eq("status", "pending").order("created_at", { ascending: false });
    const rs = (data ?? []) as unknown as Run[];
    setRuns(rs);
    if (rs.length) {
      const [{ data: ag }, { data: pr }, { data: gr }] = await Promise.all([
        supabase.from("agents").select("id, key, name"),
        supabase.from("product_records").select("id, name"),
        supabase.from("gtm_records").select("id, name"),
      ]);
      setAgents(Object.fromEntries((ag ?? []).map((a) => [a.id, a.name])));
      setAgentKeys(Object.fromEntries((ag ?? []).map((a) => [a.id, a.key])));
      setRecordNames(Object.fromEntries([...(pr ?? []), ...(gr ?? [])].map((r) => [r.id, r.name])));
    }
    setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  // Does this run's workflow point at a record an officer can draft against?
  function recordTarget(r: Run): { kind: "product" | "gtm"; id: string; agentKey: string; agentName: string } | null {
    const wf = r.workflows; if (!wf?.agent_id || !wf.target_id) return null;
    const agentKey = agentKeys[wf.agent_id]; if (!agentKey) return null;
    if (wf.target_type === "product") return { kind: "product", id: wf.target_id, agentKey, agentName: agents[wf.agent_id] ?? "An officer" };
    if (wf.target_type === "gtm") return { kind: "gtm", id: wf.target_id, agentKey, agentName: agents[wf.agent_id] ?? "An officer" };
    return null;
  }

  async function accept(r: Run) {
    setBusy(r.id); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      const ctx = r.context ?? {}; const label = ctx.label ?? "the event";
      const tgt = recordTarget(r);

      if (tgt) {
        // Officer drafts a real proposal into the record's review queue.
        const { data: s } = await supabase.auth.getSession();
        const token = s.session?.access_token;
        const body = tgt.kind === "product"
          ? { agent_key: tgt.agentKey, product_id: tgt.id, instruction: instructionFor(r.trigger, ctx) }
          : { agent_key: tgt.agentKey, gtm_record_id: tgt.id, instruction: instructionFor(r.trigger, ctx) };
        const { data, error } = await supabase.functions.invoke("agent-propose", {
          body, headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        const href = tgt.kind === "product" ? `/records/${tgt.id}` : `/gtm/${tgt.id}`;
        const where = recordNames[tgt.id] ?? "the record";
        const result: Done = { kind: "proposal", href, label: `${tgt.agentName} drafted a proposal — review it on ${where}` };
        await supabase.from("workflow_runs").update({ status: "accepted", decided_at: new Date().toISOString(), context: { ...ctx, result } }).eq("id", r.id);
        setDone((d) => ({ ...d, [r.id]: result }));
      } else {
        // No record target — draft a starter initiative carrying the event.
        if (r.trigger === "on_release") {
          await spawnInitiative(supabase, orgId, { title: `Launch follow-through: ${label}`, scope: "gtm", lifecycle: "launch", priority: "medium", tasks: [{ area: "gtm", title: `Launch comms & enablement — ${label}` }] });
        } else if (r.trigger === "on_capability_update") {
          await spawnInitiative(supabase, orgId, { title: `Leverage: ${label}`, scope: "product", lifecycle: "plan", priority: "medium", signalIds: ctx.capabilityId ? [ctx.capabilityId] : [], tasks: [{ area: "build", title: `Evaluate & apply — ${label}` }] });
        } else {
          await spawnInitiative(supabase, orgId, { title: `Respond to: ${label}`, scope: "product", lifecycle: "plan", priority: "medium", signalIds: ctx.signalId ? [ctx.signalId] : [], tasks: [{ area: "build", title: `Address — ${label}` }] });
        }
        const result: Done = { kind: "initiative", href: "/initiatives", label: "Draft initiative created" };
        await supabase.from("workflow_runs").update({ status: "accepted", decided_at: new Date().toISOString(), context: { ...ctx, result } }).eq("id", r.id);
        setDone((d) => ({ ...d, [r.id]: result }));
      }
      onChanged?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not run this automation."); }
    finally { setBusy(null); }
  }

  async function dismiss(r: Run) {
    setBusy(r.id); setError(null);
    await supabase.from("workflow_runs").update({ status: "dismissed", decided_at: new Date().toISOString() }).eq("id", r.id);
    setRuns((prev) => prev.filter((x) => x.id !== r.id));
    setBusy(null);
  }

  function clearDone(id: string) {
    setRuns((prev) => prev.filter((x) => x.id !== id));
    setDone((d) => { const n = { ...d }; delete n[id]; return n; });
  }

  if (!loading && runs.length === 0) return null; // quiet until something fires

  const pending = runs.filter((r) => !done[r.id]);

  return (
    <Section label={`Automations awaiting you${pending.length ? ` · ${pending.length}` : ""}`}>
      <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
        Workflows that <strong>fired on a real event</strong>, waiting for your call. Nothing ran on its own — have the officer draft a response, or dismiss it.
      </div>
      {error && <div className="banner banner-error" style={{ marginBottom: 12 }}>{error}</div>}
      {loading ? <div className="t-sub t-muted">Loading…</div> : (
        <div className="stack-3">
          {runs.map((r) => {
            const d = done[r.id];
            if (d) return (
              <div key={r.id} className="card card-pad" style={{ background: "var(--panel-2)" }}>
                <div className="row-between" style={{ alignItems: "center", gap: 10 }}>
                  <div className="row gap-2" style={{ minWidth: 0, flexWrap: "wrap", alignItems: "center" }}>
                    <Chip tone="green">✓ done</Chip>
                    <span style={{ fontSize: 13 }}>{d.label}</span>
                    <a className="btn btn-secondary btn-sm" href={d.href}>{d.kind === "proposal" ? "Review →" : "Open Initiatives →"}</a>
                  </div>
                  <button className="btn btn-secondary btn-sm" onClick={() => clearDone(r.id)}>Clear</button>
                </div>
              </div>
            );
            const tgt = recordTarget(r);
            const where = tgt ? (recordNames[tgt.id] ?? "the record") : null;
            return (
              <div key={r.id} className="card card-pad">
                <div className="row gap-2" style={{ marginBottom: 6, flexWrap: "wrap" }}>
                  <Chip tone="violet">{TRIGGER_LABEL[r.trigger] ?? r.trigger}</Chip>
                  <span style={{ fontSize: 14, fontWeight: 640 }}>{r.summary ?? "Workflow fired"}</span>
                </div>
                {r.context?.why && <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 6 }}>{r.context.why}</div>}
                <div className="t-sub" style={{ fontSize: 12.5, marginBottom: 8 }}>
                  <strong>On accept:</strong>{" "}
                  {tgt ? <>✦ {tgt.agentName} drafts a proposal on <strong>{where}</strong> for your review.</> : (r.proposed_action ?? "Drafts a starter initiative.")}
                </div>
                <div className="row gap-2">
                  <button className="btn btn-sm" onClick={() => accept(r)} disabled={busy === r.id} style={{ background: "#D97706", color: "#fff" }}>
                    {busy === r.id ? "Drafting…" : tgt ? "✦ Draft with agent" : "Create draft"}
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => dismiss(r)} disabled={busy === r.id}>Dismiss</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}
