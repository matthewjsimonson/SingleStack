import type { SupabaseClient } from "@supabase/supabase-js";

// ----------------------------------------------------------------------------
// One place that spawns a cross-functional INITIATIVE from any intelligence
// artifact (signal / capability / theme / decision). Plain English: the
// initiative is the cross-functional unit, so routing must seed REAL Build/GTM
// tasks — not just create an empty shell. Tasks are what land on the Ship /
// Enablement boards and what the lifecycle rollup advances; an initiative with
// no tasks is a dead end. `lane` is still written (back-compat) but is DERIVED
// from where the work sits — scope is the real concept, not a single lane.
// ----------------------------------------------------------------------------

export type SeedTask = { area: "build" | "gtm"; title: string; assignee_id?: string | null };
export type SeedField = { field_key: string; label: string; section: string; value: string | null };

export type SpawnInput = {
  title: string;
  description?: string | null;
  scope?: "product" | "gtm" | "both"; // default derived from the seeded tasks
  lifecycle?: string;                 // default "plan"
  priority?: string;                  // default "high"
  kind?: string | null;
  productId?: string | null;
  gtmRecordId?: string | null;
  decisionId?: string | null;
  objectiveId?: string | null;
  assigneeId?: string | null;
  signalIds?: string[];
  tasks?: SeedTask[];
  fields?: SeedField[];
};

export async function spawnInitiative(
  supabase: SupabaseClient,
  orgId: string,
  input: SpawnInput,
): Promise<string> {
  const tasks = input.tasks ?? [];
  const areas = new Set(tasks.map((t) => t.area));
  // Scope is explicit if given, else derived from the work we're seeding.
  const scope =
    input.scope ??
    (areas.has("build") && areas.has("gtm") ? "both" : areas.has("gtm") ? "gtm" : "product");
  const lifecycle = input.lifecycle ?? "plan";
  // Derived back-compat lane: where the primary work sits (GTM-only → enablement).
  const lane = scope === "gtm" ? "enablement" : "ship";

  const { data: ini, error } = await supabase
    .from("initiatives")
    .insert({
      org_id: orgId,
      lane,
      scope,
      lifecycle,
      title: input.title,
      description: input.description ?? null,
      kind: input.kind ?? null,
      priority: input.priority ?? "high",
      product_id: input.productId ?? null,
      gtm_record_id: input.gtmRecordId ?? null,
      decision_id: input.decisionId ?? null,
      objective_id: input.objectiveId ?? null,
      assignee_id: input.assigneeId ?? null,
      stage: "active",
    })
    .select("id")
    .single();
  if (error) throw error;
  const id = ini.id as string;

  if (tasks.length) {
    const { error: te } = await supabase.from("initiative_workstreams").insert(
      tasks.map((t) => ({
        org_id: orgId,
        initiative_id: id,
        area: t.area,
        lifecycle_stage: lifecycle,
        title: t.title,
        assignee_id: t.assignee_id ?? null,
        stage: "backlog",
      })),
    );
    if (te) throw te;
  }

  const fields = (input.fields ?? []).filter((f) => f.value);
  if (fields.length) {
    await supabase.from("initiative_fields").insert(
      fields.map((f, i) => ({
        org_id: orgId,
        initiative_id: id,
        field_key: f.field_key,
        label: f.label,
        section: f.section,
        value: f.value,
        position: i,
      })),
    );
  }

  const sids = (input.signalIds ?? []).filter(Boolean);
  if (sids.length) {
    await supabase
      .from("initiative_signals")
      .insert(sids.map((sid) => ({ org_id: orgId, initiative_id: id, signal_id: sid })));
  }

  return id;
}
