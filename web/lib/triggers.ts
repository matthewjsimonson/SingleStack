import type { SupabaseClient } from "@supabase/supabase-js";

// ----------------------------------------------------------------------------
// Workflow triggers — PROPOSE-ONLY. Plain English: real events call
// fireWorkflows(...) which finds the active workflows listening for that event
// and enqueues a workflow_run for each — a pending item a human ratifies. It
// NEVER acts on its own. This is what makes authored workflows actually fire
// while keeping the spine intact: agents propose, humans ratify.
// ----------------------------------------------------------------------------

export type TriggerKind = "on_signal" | "on_release" | "on_capability_update";

export type TriggerCtx = {
  label: string;          // human-readable name of the thing that fired it
  why?: string;           // the "so-what" — passed to the agent as context
  releaseId?: string;
  capabilityId?: string;
  signalId?: string;
};

// What accepting a run of this trigger will DO (shown to the human, executed on accept).
function actionFor(trigger: TriggerKind, ctx: TriggerCtx): string {
  switch (trigger) {
    case "on_release":
      return `Draft a GTM launch follow-through initiative for “${ctx.label}”.`;
    case "on_capability_update":
      return `Draft an initiative to evaluate and leverage “${ctx.label}”.`;
    case "on_signal":
      return `Draft an initiative responding to the signal “${ctx.label}”.`;
  }
}

const ctxKey = (ctx: TriggerCtx) => ctx.releaseId ?? ctx.capabilityId ?? ctx.signalId ?? ctx.label;

// Fire all active workflows listening for `trigger`. Returns how many runs were
// enqueued. Idempotent per (workflow, event): won't double-enqueue a still
// pending run for the same thing.
export async function fireWorkflows(
  supabase: SupabaseClient,
  orgId: string,
  trigger: TriggerKind,
  ctx: TriggerCtx,
): Promise<number> {
  const { data: wfs } = await supabase
    .from("workflows")
    .select("id, name")
    .eq("trigger", trigger)
    .eq("is_active", true);
  if (!wfs || wfs.length === 0) return 0;

  const ids = wfs.map((w) => w.id);
  // Skip workflows that already have a pending run for this same event.
  const key = ctxKey(ctx);
  const { data: open } = await supabase
    .from("workflow_runs")
    .select("workflow_id, context")
    .in("workflow_id", ids)
    .eq("status", "pending");
  const already = new Set(
    (open ?? [])
      .filter((r) => {
        const c = (r.context ?? {}) as TriggerCtx;
        return ctxKey(c) === key;
      })
      .map((r) => r.workflow_id),
  );

  const rows = wfs
    .filter((w) => !already.has(w.id))
    .map((w) => ({
      org_id: orgId,
      workflow_id: w.id,
      trigger,
      status: "pending",
      context: ctx,
      summary: `${w.name} — ${ctx.label}`,
      proposed_action: actionFor(trigger, ctx),
    }));
  if (rows.length === 0) return 0;

  const { error } = await supabase.from("workflow_runs").insert(rows);
  // Firing is best-effort: it must never fail the user action that triggered it
  // (logging a signal, shipping a release). Surface failures to the console so
  // they're debuggable rather than wholly invisible.
  if (error) { console.warn("fireWorkflows: could not enqueue workflow runs", error); return 0; }
  // Stamp last_run_at on the workflows that fired (first writer of this column).
  await supabase
    .from("workflows")
    .update({ last_run_at: new Date().toISOString() })
    .in("id", rows.map((r) => r.workflow_id));
  return rows.length;
}
