// ============================================================================
// outcome-watch — the Learn loop's clock. Checks expected outcomes against
// what actually happened, and DRAFTS a verdict for human review.
//
// Modes:
//   • Machine sweep (cron, service-role bearer): all org's outcomes with
//     status='watching' whose review_due_at has passed, capped per tick.
//   • Check now (user JWT, { outcome_id }): one outcome, on demand, even
//     before the horizon — RLS scopes the read to the caller's org.
//
// Evidence per measure kind:
//   • metric — record_metrics readings for the outcome's record_field_id,
//     baseline vs. since-declaration (provenance-enforced numbers only).
//   • signal — signals observed in the window (titles/why), which the model
//     weighs for support/contradiction of the claim.
//
// HITL, strictly: the model returns {verdict, rationale}; we set
// status='review' with ai_verdict/ai_rationale/evidence. A human resolves it
// in the Outcomes board — nothing is scored without ratification.
// Secret: ANTHROPIC_API_KEY.
// ============================================================================

import Anthropic from "npm:@anthropic-ai/sdk@0.69.0";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { logUsage } from "../_shared/ai_usage.ts";
import { resolveModelPolicy } from "../_shared/ai_policy.ts";

const MODEL = "claude-opus-4-8";
const MAX_PER_TICK = 10;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "content-type": "application/json" } });

const SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["hit", "missed", "inconclusive"] },
    rationale: { type: "string" },
  },
  required: ["verdict", "rationale"],
};

// deno-lint-ignore no-explicit-any
type Outcome = any;

async function checkOne(supabase: SupabaseClient, anthropic: Anthropic, o: Outcome): Promise<{ verdict: string } | { error: string }> {
  // ---- gather evidence ------------------------------------------------------
  const sinceIso = (o.baseline_at ?? o.created_at) as string;
  // deno-lint-ignore no-explicit-any
  const evidence: Record<string, any> = {};
  let evidenceText = "";

  if (o.measure_kind === "metric" && o.record_field_id) {
    const { data: field } = await supabase.from("record_fields").select("label").eq("id", o.record_field_id).maybeSingle();
    const { data: readings } = await supabase.from("record_metrics")
      .select("period, value_num, source_label, created_at")
      .eq("record_field_id", o.record_field_id)
      .order("period", { ascending: true }).limit(36);
    const after = (readings ?? []).filter((r) => new Date(r.created_at).getTime() >= new Date(sinceIso).getTime());
    evidence.metric = { label: field?.label ?? "metric", baseline: o.baseline_num, readings: (readings ?? []).map((r) => ({ period: r.period, value: r.value_num, source: r.source_label })) };
    evidenceText = [
      `METRIC: ${field?.label ?? "metric"} — success direction: ${o.direction}.`,
      `Baseline at declaration (${sinceIso.slice(0, 10)}): ${o.baseline_num ?? "not captured"}.`,
      `All readings (period · value · source): ${(readings ?? []).map((r) => `${r.period}: ${r.value_num} (${r.source_label})`).join("; ") || "NONE recorded"}.`,
      `Readings recorded since declaration: ${after.length}.`,
    ].join("\n");
  } else {
    const { data: sigs } = await supabase.from("signals")
      .select("title, why, origin, conf_label, observed_at")
      .gte("observed_at", sinceIso)
      .order("observed_at", { ascending: false }).limit(40);
    evidence.signals = (sigs ?? []).map((s) => ({ title: s.title, why: s.why, origin: s.origin }));
    evidenceText = [
      `SIGNALS observed since declaration (${sinceIso.slice(0, 10)}) — weigh only those relevant to the claim:`,
      (sigs ?? []).map((s) => `• [${s.origin}${s.conf_label ? `/${s.conf_label}` : ""}] ${s.title}${s.why ? ` — ${s.why}` : ""}`).join("\n") || "(none)",
    ].join("\n");
  }

  // Epic context, so the model knows what was actually shipped.
  const { data: bundle } = await supabase.from("strategy_bundles").select("title, rationale, promoted_at").eq("id", o.bundle_id).maybeSingle();

  const system = [
    "You evaluate whether a shipped product/GTM decision produced its EXPECTED OUTCOME. You are drafting a verdict a human will review — be honest and conservative, never generous.",
    "Verdicts: 'hit' (the evidence clearly shows the claimed movement), 'missed' (the evidence clearly shows it did not move, or moved the wrong way), 'inconclusive' (not enough evidence either way — say exactly what's missing).",
    "If there are no readings or no relevant signals, the verdict is 'inconclusive' — absence of evidence is never a hit OR a miss. Cite the specific numbers/signals in your rationale.",
  ].join("\n");

  const userText = [
    `THE SHIPPED WORK (epic): ${bundle?.title ?? "unknown"}${bundle?.rationale ? ` — ${bundle.rationale}` : ""}${bundle?.promoted_at ? ` (shipped ${String(bundle.promoted_at).slice(0, 10)})` : " (not yet shipped)"}`,
    `THE CLAIM: "${o.title}" — should move ${o.direction} within ${o.horizon_days} days.`,
    "",
    evidenceText,
    "",
    "Draft the verdict.",
  ].join("\n");

  const pol = await resolveModelPolicy(supabase, { task: "outcome_watch", fallback: { model: MODEL, effort: "high" } });
  const resp = (await anthropic.messages.create({
    model: pol.model,
    max_tokens: 2000,
    thinking: { type: "adaptive" },
    output_config: { effort: pol.effort, format: { type: "json_schema", schema: SCHEMA } },
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userText }],
    // deno-lint-ignore no-explicit-any
  } as any)) as Anthropic.Message;
  await logUsage(supabase, { task: "outcome_watch", model: pol.model, usage: resp.usage });

  const block = resp.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") return { error: "no verdict returned" };
  const draft = JSON.parse(block.text) as { verdict: string; rationale: string };

  const { error } = await supabase.from("expected_outcomes").update({
    status: "review",
    ai_verdict: draft.verdict,
    ai_rationale: draft.rationale.slice(0, 2000),
    evidence,
    checked_at: new Date().toISOString(),
  }).eq("id", o.id);
  if (error) return { error: error.message };
  return { verdict: draft.verdict };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing Authorization header" }, 401);
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "server missing ANTHROPIC_API_KEY" }, 500);
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const isMachine = serviceKey !== "" && authHeader.replace(/^Bearer\s+/i, "") === serviceKey;

  // Caller-scoped client: a user JWT gets RLS; the machine sweep gets service role.
  const supabase: SupabaseClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const anthropic = new Anthropic({ apiKey: key });

  try {
    const { outcome_id } = await req.json().catch(() => ({}));

    if (outcome_id) {
      // Check-now: one outcome, any status=watching/review, user or machine.
      const { data: o } = await supabase.from("expected_outcomes").select("*").eq("id", outcome_id).maybeSingle();
      if (!o) return json({ error: "outcome not found" }, 404);
      if (o.status !== "watching" && o.status !== "review") return json({ error: "outcome already resolved" }, 422);
      const r = await checkOne(supabase, anthropic, o);
      return "error" in r ? json(r, 500) : json({ checked: 1, ...r });
    }

    // Sweep mode is machine-only — it spans orgs under the service role.
    if (!isMachine) return json({ error: "outcome_id required (sweeps are machine-only)" }, 400);
    const { data: due } = await supabase.from("expected_outcomes")
      .select("*").eq("status", "watching").lte("review_due_at", new Date().toISOString())
      .order("review_due_at", { ascending: true }).limit(MAX_PER_TICK);

    const results: { id: string; verdict?: string; error?: string }[] = [];
    for (const o of due ?? []) {
      const r = await checkOne(supabase, anthropic, o);
      results.push({ id: o.id, ...("error" in r ? { error: r.error } : { verdict: r.verdict }) });
    }
    return json({ due: (due ?? []).length, results });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
