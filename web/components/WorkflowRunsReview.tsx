"use client";

// Workflow runs — the propose-only trigger queue. Real events (a release
// shipped, a new capability) FIRE matching workflows, which land here as
// pending runs. Nothing acted on its own; the operator ratifies each: Accept
// takes the proposed action (drafts an initiative carrying the event's
// context), Dismiss rejects it. Same spine as roster review and proposals.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { spawnInitiative } from "@/lib/routing";
import { Section, Chip } from "@/components/ui";

type Ctx = { label?: string; releaseId?: string; capabilityId?: string; signalId?: string };
type Run = { id: string; workflow_id: string; trigger: string; context: Ctx | null; summary: string | null; proposed_action: string | null; created_at: string };

const TRIGGER_LABEL: Record<string, string> = { on_release: "On release", on_capability_update: "On new capability", on_signal: "When a signal lands" };

export default function WorkflowRunsReview({ onChanged }: { onChanged?: () => void }) {
  const supabase = createClient();
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("workflow_runs")
      .select("id, workflow_id, trigger, context, summary, proposed_action, created_at")
      .eq("status", "pending").order("created_at", { ascending: false });
    setRuns((data ?? []) as Run[]); setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  async function accept(r: Run) {
    setBusy(r.id); setError(null); setNote(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      const ctx = r.context ?? {};
      const label = ctx.label ?? "the event";
      // Take the proposed action — draft an initiative carrying the event's
      // context. Propose-only: the human chose to act; nothing auto-applied.
      if (r.trigger === "on_release") {
        await spawnInitiative(supabase, orgId, {
          title: `Launch follow-through: ${label}`, scope: "gtm", lifecycle: "launch", priority: "medium",
          tasks: [{ area: "gtm", title: `Launch comms & enablement — ${label}` }],
        });
      } else if (r.trigger === "on_capability_update") {
        await spawnInitiative(supabase, orgId, {
          title: `Leverage: ${label}`, scope: "product", lifecycle: "plan", priority: "medium",
          signalIds: ctx.capabilityId ? [ctx.capabilityId] : [],
          tasks: [{ area: "build", title: `Evaluate & apply — ${label}` }],
        });
      } else {
        await spawnInitiative(supabase, orgId, {
          title: `Respond to: ${label}`, scope: "product", lifecycle: "plan", priority: "medium",
          signalIds: ctx.signalId ? [ctx.signalId] : [],
          tasks: [{ area: "build", title: `Address — ${label}` }],
        });
      }
      await supabase.from("workflow_runs").update({ status: "accepted", decided_at: new Date().toISOString() }).eq("id", r.id);
      setRuns((prev) => prev.filter((x) => x.id !== r.id));
      setNote("Accepted — a draft initiative was created. Find it on the Initiatives board.");
      onChanged?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not accept run."); }
    finally { setBusy(null); }
  }

  async function dismiss(r: Run) {
    setBusy(r.id); setError(null);
    await supabase.from("workflow_runs").update({ status: "dismissed", decided_at: new Date().toISOString() }).eq("id", r.id);
    setRuns((prev) => prev.filter((x) => x.id !== r.id));
    setBusy(null);
  }

  if (!loading && runs.length === 0) return null; // quiet until something fires

  return (
    <Section label={`Automations awaiting you${runs.length ? ` · ${runs.length}` : ""}`}>
      <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
        Workflows that <strong>fired on a real event</strong> and are waiting for your call. Nothing ran on its own — accept to take the action, dismiss to reject.
      </div>
      {error && <div className="banner banner-error" style={{ marginBottom: 12 }}>{error}</div>}
      {note && !error && <div className="banner" style={{ marginBottom: 12 }}>{note}</div>}
      {loading ? <div className="t-sub t-muted">Loading…</div> : (
        <div className="stack-3">
          {runs.map((r) => (
            <div key={r.id} className="card card-pad">
              <div className="row gap-2" style={{ marginBottom: 6, flexWrap: "wrap" }}>
                <Chip tone="violet">{TRIGGER_LABEL[r.trigger] ?? r.trigger}</Chip>
                <span style={{ fontSize: 14, fontWeight: 640 }}>{r.summary ?? "Workflow fired"}</span>
              </div>
              {r.proposed_action && <div className="t-sub" style={{ fontSize: 12.5, marginBottom: 8 }}><strong>On accept:</strong> {r.proposed_action}</div>}
              <div className="row gap-2">
                <button className="btn btn-success btn-sm" onClick={() => accept(r)} disabled={busy === r.id}>{busy === r.id ? "Working…" : "Accept"}</button>
                <button className="btn btn-secondary btn-sm" onClick={() => dismiss(r)} disabled={busy === r.id}>Dismiss</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
