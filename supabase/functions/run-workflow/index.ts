// ============================================================================
// run-workflow — run ONE authored workflow: a multi-step agentic task.
//
// A workflow is an ordered list of STEPS (workflows.steps jsonb). Each step is
// one officer applying one of its play skills, drawing on internal and/or external
// signals, with an optional instruction. Steps run in order; each sees the prior
// steps' output and adds to it. The whole thing aggregates into ONE structured
// artifact (agent_artifacts) — same shape as a Play — reviewed + ratified HITL.
//
// Runs as the caller (JWT forwarded) → RLS scopes everything to their org.
// Secret: ANTHROPIC_API_KEY. Streaming mirrors run-play: thinking → mark → JSON.
// ============================================================================

import Anthropic from "npm:@anthropic-ai/sdk@0.69.0";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { resolveModelPolicy } from "../_shared/ai_policy.ts";
import { PRICING } from "../_shared/ai_usage.ts";
import { noProgress, type Progress, progress } from "../_shared/progress.ts";

const DEFAULT_MODEL = "claude-opus-5";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "content-type": "application/json" } });

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headline: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { title: { type: "string" }, body: { type: "string" }, evidence: { type: "array", items: { type: "string" } } },
        required: ["title", "body", "evidence"],
      },
    },
    recommendations: { type: "array", items: { type: "string" } },
    confidence: { type: "string" },
  },
  required: ["headline", "sections", "recommendations", "confidence"],
};

type Signals = "none" | "internal" | "external" | "both";
type Step = { id: string; agent_id: string; skill_id: string | null; signals: Signals; instruction: string };
const SIGNAL_PROMPT: Record<Signals, string> = { none: "", internal: "internal signals", external: "external (market) signals", both: "internal + external signals" };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing Authorization header" }, 401);
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "server missing ANTHROPIC_API_KEY" }, 500);

  const supabase: SupabaseClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  let input: { workflow_id?: string; target_type?: string; target_id?: string; stream?: boolean };
  try { input = await req.json(); } catch { return json({ error: "invalid JSON body" }, 400); }
  const { workflow_id } = input;
  if (!workflow_id) return json({ error: "workflow_id is required" }, 400);

  const { data: wf } = await supabase.from("workflows").select("id, org_id, name, description, steps, target_type, target_id, is_active").eq("id", workflow_id).maybeSingle();
  if (!wf) return json({ error: `unknown workflow '${workflow_id}'` }, 404);
  if (wf.is_active === false) return json({ error: `the "${wf.name}" workflow is turned off` }, 400);
  const steps = (wf.steps ?? []) as Step[];
  if (!steps.length) return json({ error: `the "${wf.name}" workflow has no steps` }, 400);
  const orgId = wf.org_id as string;
  // Capture past the null-check: TS re-widens `wf` inside the nested closures
  // below, so every use in generate() would otherwise read as possibly-null.
  const wfId = wf.id as string;
  const wfName = wf.name as string;
  const wfDescription = (wf.description as string | null) ?? null;

  // Optional runtime target: when launched from a record's chat, focus the whole
  // workflow on that record (its fields become shared context for every step). The
  // runtime target overrides the workflow's own configured target.
  let recordContext = "";
  let runTargetType = (wf.target_type as string) || "workflow";
  let runTargetId = (wf.target_id as string) ?? wf.id;
  if (input.target_id && (input.target_type === "product" || input.target_type === "gtm")) {
    const table = input.target_type === "product" ? "product_records" : "gtm_records";
    const fk = input.target_type === "product" ? "product_id" : "gtm_record_id";
    const { data: rec } = await supabase.from(table).select("*").eq("id", input.target_id).maybeSingle();
    if (rec) {
      const { data: fields } = await supabase.from("record_fields").select("label, value, position").eq(fk, input.target_id).order("position", { ascending: true });
      recordContext = `THE RECORD THIS WORKFLOW IS FOCUSED ON (${input.target_type === "gtm" ? "GTM record" : "Product record"}: ${(rec as { name?: string }).name ?? input.target_id}):\n${JSON.stringify({ record: rec, fields: fields ?? [] }, null, 2)}`;
      runTargetType = input.target_type;
      runTargetId = input.target_id;
    }
  }

  // Officers referenced by the steps.
  const agentIds = [...new Set(steps.map((s) => s.agent_id).filter(Boolean))];
  const { data: ags } = await supabase.from("agents").select("id, name, role, model, system_prompt").in("id", agentIds).eq("is_active", true);
  // deno-lint-ignore no-explicit-any
  const agentById = (id: string) => (ags ?? []).find((a: any) => a.id === id);

  // Recent signals once, split by origin (internal vs external, via the source).
  const { data: sigRows } = await supabase
    .from("signals").select("title, why, observed_at, sources ( origin )")
    .order("observed_at", { ascending: false, nullsFirst: false }).limit(60);
  // deno-lint-ignore no-explicit-any
  const sigOrigin = (r: any) => (r.sources?.origin === "external" ? "external" : "internal"); // default/internal
  function signalsFor(which: Signals): string {
    if (which === "none") return "";
    // deno-lint-ignore no-explicit-any
    const rows = (sigRows ?? []).filter((r: any) => which === "both" || sigOrigin(r) === which).slice(0, 24);
    if (!rows.length) return "(none on record)";
    // deno-lint-ignore no-explicit-any
    return rows.map((r: any) => `  • [${sigOrigin(r)}] ${r.title}${r.why ? ` — ${r.why}` : ""}`).join("\n");
  }

  async function loadCornerstones(agentId: string): Promise<{ name: string; instructions: string | null }[]> {
    const { data } = await supabase.from("agent_skills").select("skills ( name, instructions )").eq("agent_id", agentId).eq("is_cornerstone", true);
    // deno-lint-ignore no-explicit-any
    return (data ?? []).map((r: any) => r.skills).filter(Boolean);
  }
  async function loadSkill(skillId: string): Promise<{ name: string; instructions: string | null } | null> {
    const { data } = await supabase.from("skills").select("name, instructions").eq("id", skillId).maybeSingle();
    return (data as { name: string; instructions: string | null } | null) ?? null;
  }

  const anthropic = new Anthropic({ apiKey: key });

  async function generate(p: Progress) {
    // deno-lint-ignore no-explicit-any
    const results: { agentName: string; skillName: string | null; payload: any }[] = [];
    let inTok = 0, outTok = 0, cost = 0, prior = "";
    for (let idx = 0; idx < steps.length; idx++) {
      const step = steps[idx];
      const ag = agentById(step.agent_id);
      if (!ag) continue; // an officer that no longer exists — skip the step
      const [corner, playSkill] = await Promise.all([loadCornerstones(ag.id), step.skill_id ? loadSkill(step.skill_id) : Promise.resolve(null)]);
      const sPol = await resolveModelPolicy(supabase, { task: "run_workflow", agentId: ag.id as string, fallback: { model: (ag.model as string) || DEFAULT_MODEL, effort: "high" } });
      const aModel = sPol.model;
      const skillsBlock = [
        corner.length ? `\n\nYOUR CORNERSTONE SKILLS (always on):\n${corner.map((s) => `## ${s.name}\n${s.instructions ?? ""}`).join("\n\n")}` : "",
        playSkill ? `\n\nTHE PLAY SKILL FOR THIS STEP — apply it:\n## ${playSkill.name}\n${playSkill.instructions ?? ""}` : "",
      ].join("");
      const system = [
        ag.system_prompt || `You are ${ag.name}${ag.role ? `, ${ag.role}` : ""}, an executive agent in SingleStack.`,
        skillsBlock,
        `\n\nYou are running step ${idx + 1} of ${steps.length} in the "${wfName}" workflow${wfDescription ? ` — ${wfDescription}` : ""}.`,
        step.instruction ? `\nYour task this step: ${step.instruction}` : "\nDo your part of the workflow at this step.",
        steps.length > 1 ? `\nThis is a chain — build on the prior steps and hand off to the next; don't repeat what's covered.${prior ? ` Earlier steps produced:${prior}` : " You go first."}` : "",
        "\nRules: Stay strictly within THIS step's task and the workflow's stated purpose — do NOT wander into unrelated topics, other teams' problems, or tangents. Be specific and concrete, grounded in the signals/context; in each section's `evidence`, cite the exact signals you leaned on (or note 'thin evidence' honestly). headline = a one-line take. recommendations = at most 3–5 concrete next steps, each clearly serving THIS workflow's goal — don't pad the list. confidence = a short, honest read.",
      ].join("");
      const sigText = signalsFor(step.signals);
      const user = [
        recordContext ? `${recordContext}\n` : "",
        step.signals === "none" ? "(this step uses no signals)" : `SIGNALS (${SIGNAL_PROMPT[step.signals]}):\n${sigText}`,
        prior ? `\nWHAT EARLIER STEPS PRODUCED (build on this):${prior}` : "",
        `\nRun step ${idx + 1} now.`,
      ].filter(Boolean).join("\n");
      const body = {
        model: aModel, max_tokens: 8000, thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: sPol.effort, format: { type: "json_schema", schema: SCHEMA } },
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: user }],
      };
      // Always streamed from the API — it is how reasoning reaches `p` while the
      // step runs, and it keeps a long chain off the HTTP timeout.
      const stepId = `step:${idx}`;
      p.step(stepId, `${ag.name}${playSkill ? ` · ${playSkill.name}` : ""}`);
      // deno-lint-ignore no-explicit-any
      const streamed = anthropic.messages.stream(body as any);
      // deno-lint-ignore no-explicit-any
      for await (const ev of streamed as any) {
        if (ev.type === "content_block_delta" && ev.delta?.type === "thinking_delta" && ev.delta.thinking) p.think(ev.delta.thinking);
      }
      const resp: Anthropic.Message = await streamed.finalMessage();
      const block = resp.content.find((b) => b.type === "text");
      if (!block || block.type !== "text") throw new Error(`step ${idx + 1} (${ag.name}) returned no analysis`);
      if (resp.stop_reason === "max_tokens") throw new Error(`step ${idx + 1} (${ag.name}) ran out of room (hit the token cap before finishing). Try a tighter instruction.`);
      let payload;
      try { payload = JSON.parse(block.text); } catch { throw new Error(`step ${idx + 1} (${ag.name}) returned malformed output — likely truncated. Try a tighter instruction.`); }
      p.done(stepId, typeof payload?.headline === "string" ? payload.headline : undefined);
      results.push({ agentName: ag.name as string, skillName: playSkill?.name ?? null, payload });
      inTok += resp.usage.input_tokens; outTok += resp.usage.output_tokens;
      const price = PRICING[aModel]; if (price) cost += (resp.usage.input_tokens * price.input + resp.usage.output_tokens * price.output) / 1_000_000;
      prior += `\n  • Step ${idx + 1} (${ag.name}): ${payload.headline ?? ""}${(payload.recommendations ?? []).length ? ` — next: ${(payload.recommendations as string[]).slice(0, 3).join("; ")}` : ""}`;
    }

    if (results.length === 0) throw new Error("no runnable steps (officers may have been removed)");

    // Aggregate as ONE self-contained block per agent: each step's headline, its
    // analysis, ITS OWN recommendations, and its confidence fold into a single
    // section. No flattened top-level recommendations pile. headline = the final
    // step's one-line take (the chain's landing point).
    const payload = {
      headline: results[results.length - 1]?.payload?.headline ?? wfName,
      sections: results.map((r, i) => {
        // deno-lint-ignore no-explicit-any
        const subs = (r.payload?.sections ?? []) as any[];
        const recs = (r.payload?.recommendations ?? []) as string[];
        const body = [
          r.payload?.headline ? `**${r.payload.headline}**` : "",
          ...subs.map((s) => `${s.title}: ${s.body}`),
          recs.length ? `**Recommendations**\n${recs.map((x) => `• ${x}`).join("\n")}` : "",
          r.payload?.confidence ? `_Confidence: ${r.payload.confidence}_` : "",
        ].filter(Boolean).join("\n\n");
        return {
          title: `Step ${i + 1} · ${r.agentName}${r.skillName ? ` · ${r.skillName}` : ""}`,
          body,
          evidence: subs.flatMap((s) => s.evidence ?? []),
        };
      }),
      recommendations: [],
      confidence: results.map((r, i) => `Step ${i + 1}: ${r.payload?.confidence ?? "—"}`).join(" · "),
    };

    const firstAgentId = steps.find((s) => agentById(s.agent_id))?.agent_id ?? null;
    const { data: run } = await supabase.from("agent_runs").insert({
      org_id: orgId, agent_id: firstAgentId, status: "succeeded",
      input: { kind: "workflow", workflow_id: wfId, steps: steps.length }, output: payload.headline ?? "(workflow)",
      model: DEFAULT_MODEL, input_tokens: inTok, output_tokens: outTok, cost_usd: cost || null, finished_at: new Date().toISOString(),
    }).select("id").single();

    const { data: artifact, error: artErr } = await supabase.from("agent_artifacts").insert({
      org_id: orgId, agent_id: firstAgentId, function_key: `workflow:${wfId}`,
      target_type: runTargetType, target_id: runTargetId,
      title: wfName, status: "draft", payload, run_id: run?.id ?? null,
    }).select("id, function_key, title, status, payload, run_id, agent_id").single();
    if (artErr) throw artErr;

    await supabase.from("workflows").update({ last_run_at: new Date().toISOString() }).eq("id", wfId);
    return artifact;
  }

  const officer = steps.map((s) => agentById(s.agent_id)?.name ?? "officer").join(" → ");

  try {
    if (input.stream) {
      const stream = new ReadableStream({
        async start(controller) {
          const p = progress(controller);
          try {
            const artifact = await generate(p);
            p.answer(JSON.stringify({ artifact, officer }));
          } catch (e) {
            p.error(e instanceof Error ? e.message : String(e));
          } finally { controller.close(); }
        },
      });
      return new Response(stream, { headers: { ...CORS, "content-type": "text/plain; charset=utf-8", "cache-control": "no-cache" } });
    }
    const artifact = await generate(noProgress());
    return json({ artifact, officer });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
