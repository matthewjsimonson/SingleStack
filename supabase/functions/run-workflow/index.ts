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

const DEFAULT_MODEL = "claude-opus-4-8";
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const ANSWER_MARK = "␞";
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

  let input: { workflow_id?: string; stream?: boolean };
  try { input = await req.json(); } catch { return json({ error: "invalid JSON body" }, 400); }
  const { workflow_id } = input;
  if (!workflow_id) return json({ error: "workflow_id is required" }, 400);

  const { data: wf } = await supabase.from("workflows").select("id, org_id, name, description, steps, target_type, target_id, is_active").eq("id", workflow_id).maybeSingle();
  if (!wf) return json({ error: `unknown workflow '${workflow_id}'` }, 404);
  if (wf.is_active === false) return json({ error: `the "${wf.name}" workflow is turned off` }, 400);
  const steps = (wf.steps ?? []) as Step[];
  if (!steps.length) return json({ error: `the "${wf.name}" workflow has no steps` }, 400);
  const orgId = wf.org_id as string;

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

  async function generate(emit?: (s: string) => void) {
    // deno-lint-ignore no-explicit-any
    const results: { agentName: string; skillName: string | null; payload: any }[] = [];
    let inTok = 0, outTok = 0, cost = 0, prior = "";
    for (let idx = 0; idx < steps.length; idx++) {
      const step = steps[idx];
      const ag = agentById(step.agent_id);
      if (!ag) continue; // an officer that no longer exists — skip the step
      const [corner, playSkill] = await Promise.all([loadCornerstones(ag.id), step.skill_id ? loadSkill(step.skill_id) : Promise.resolve(null)]);
      const aModel = (ag.model as string) || DEFAULT_MODEL;
      const skillsBlock = [
        corner.length ? `\n\nYOUR CORNERSTONE SKILLS (always on):\n${corner.map((s) => `## ${s.name}\n${s.instructions ?? ""}`).join("\n\n")}` : "",
        playSkill ? `\n\nTHE PLAY SKILL FOR THIS STEP — apply it:\n## ${playSkill.name}\n${playSkill.instructions ?? ""}` : "",
      ].join("");
      const system = [
        ag.system_prompt || `You are ${ag.name}${ag.role ? `, ${ag.role}` : ""}, an executive agent in SingleStack.`,
        skillsBlock,
        `\n\nYou are running step ${idx + 1} of ${steps.length} in the "${wf.name}" workflow${wf.description ? ` — ${wf.description}` : ""}.`,
        step.instruction ? `\nYour task this step: ${step.instruction}` : "\nDo your part of the workflow at this step.",
        steps.length > 1 ? `\nThis is a chain — build on the prior steps and hand off to the next; don't repeat what's covered.${prior ? ` Earlier steps produced:${prior}` : " You go first."}` : "",
        "\nRules: be specific and concrete, grounded in the signals/context provided; in each section's `evidence`, cite the exact signals you leaned on (or note 'thin evidence' honestly). headline = a one-line take. recommendations = concrete next steps. confidence = a short, honest read.",
      ].join("");
      const sigText = signalsFor(step.signals);
      const user = [
        step.signals === "none" ? "(this step uses no signals)" : `SIGNALS (${SIGNAL_PROMPT[step.signals]}):\n${sigText}`,
        prior ? `\nWHAT EARLIER STEPS PRODUCED (build on this):${prior}` : "",
        `\nRun step ${idx + 1} now.`,
      ].join("\n");
      const body = {
        model: aModel, max_tokens: 2600, thinking: { type: "adaptive" },
        output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: user }],
      };
      let resp: Anthropic.Message;
      if (emit) {
        emit(`\n— Step ${idx + 1}: ${ag.name}${playSkill ? ` · ${playSkill.name}` : ""} —\n`);
        // deno-lint-ignore no-explicit-any
        const s = anthropic.messages.stream(body as any);
        // deno-lint-ignore no-explicit-any
        for await (const ev of s as any) {
          if (ev.type === "content_block_delta" && ev.delta?.type === "thinking_delta" && ev.delta.thinking) emit(ev.delta.thinking);
        }
        resp = await s.finalMessage();
      } else {
        // deno-lint-ignore no-explicit-any
        resp = (await anthropic.messages.create(body as any)) as Anthropic.Message;
      }
      const block = resp.content.find((b) => b.type === "text");
      if (!block || block.type !== "text") throw new Error(`step ${idx + 1} (${ag.name}) returned no analysis`);
      const payload = JSON.parse(block.text);
      results.push({ agentName: ag.name as string, skillName: playSkill?.name ?? null, payload });
      inTok += resp.usage.input_tokens; outTok += resp.usage.output_tokens;
      const price = PRICING[aModel]; if (price) cost += (resp.usage.input_tokens * price.input + resp.usage.output_tokens * price.output) / 1_000_000;
      prior += `\n  • Step ${idx + 1} (${ag.name}): ${payload.headline ?? ""}${(payload.recommendations ?? []).length ? ` — next: ${(payload.recommendations as string[]).slice(0, 3).join("; ")}` : ""}`;
    }

    if (results.length === 0) throw new Error("no runnable steps (officers may have been removed)");

    // Aggregate the steps into one artifact, attributing each section to its step.
    const payload = {
      headline: results[results.length - 1]?.payload?.headline ?? wf.name,
      // deno-lint-ignore no-explicit-any
      sections: results.flatMap((r, i) => (r.payload?.sections ?? []).map((s: any) => ({ ...s, title: `Step ${i + 1} · ${r.agentName}${r.skillName ? ` · ${r.skillName}` : ""} — ${s.title}` }))),
      recommendations: results.flatMap((r) => r.payload?.recommendations ?? []),
      confidence: results.map((r, i) => `Step ${i + 1}: ${r.payload?.confidence ?? "—"}`).join(" · "),
    };

    const firstAgentId = steps.find((s) => agentById(s.agent_id))?.agent_id ?? null;
    const { data: run } = await supabase.from("agent_runs").insert({
      org_id: orgId, agent_id: firstAgentId, status: "succeeded",
      input: { kind: "workflow", workflow_id: wf.id, steps: steps.length }, output: payload.headline ?? "(workflow)",
      model: DEFAULT_MODEL, input_tokens: inTok, output_tokens: outTok, cost_usd: cost || null, finished_at: new Date().toISOString(),
    }).select("id").single();

    const { data: artifact, error: artErr } = await supabase.from("agent_artifacts").insert({
      org_id: orgId, agent_id: firstAgentId, function_key: `workflow:${wf.id}`,
      target_type: (wf.target_type as string) || "workflow", target_id: (wf.target_id as string) ?? wf.id,
      title: wf.name, status: "draft", payload, run_id: run?.id ?? null,
    }).select("id, function_key, title, status, payload, run_id, agent_id").single();
    if (artErr) throw artErr;

    await supabase.from("workflows").update({ last_run_at: new Date().toISOString() }).eq("id", wf.id);
    return artifact;
  }

  const officer = steps.map((s) => agentById(s.agent_id)?.name ?? "officer").join(" → ");

  try {
    if (input.stream) {
      const enc = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          try {
            const artifact = await generate((s) => controller.enqueue(enc.encode(s)));
            controller.enqueue(enc.encode(ANSWER_MARK + JSON.stringify({ artifact, officer })));
          } catch (e) {
            controller.enqueue(enc.encode(ANSWER_MARK + JSON.stringify({ error: e instanceof Error ? e.message : String(e) })));
          } finally { controller.close(); }
        },
      });
      return new Response(stream, { headers: { ...CORS, "content-type": "text/plain; charset=utf-8", "cache-control": "no-cache" } });
    }
    const artifact = await generate();
    return json({ artifact, officer });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
