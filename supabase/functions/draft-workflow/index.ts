// ============================================================================
// draft-workflow — the HITL CHAT that authors a WORKFLOW aligned to an area's
// process. The operator describes the outcome; the assistant grounds in the
// area's tasks + the org's real agents and their child skills, and proposes an
// ORDERED step-chain where each step is one agent applying one of its child
// skills toward a task. Writes NOTHING; the client inserts the workflow on
// accept. Mirrors draft-skill. Secret: ANTHROPIC_API_KEY.
//
// Alignment is the whole point (coverage's workflow check needs a real,
// area-connected agent): every step's agent_id/skill_id MUST come from the
// provided roster, and steps should prefer agents CONNECTED to this area.
// ============================================================================

import Anthropic from "npm:@anthropic-ai/sdk@0.69.0";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { logUsage } from "../_shared/ai_usage.ts";
import { resolveModelPolicy } from "../_shared/ai_policy.ts";

const MODEL = "claude-opus-5";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "content-type": "application/json" } });

const SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    reply: { type: "string" },
    recommendations: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: { source: { type: "string", enum: ["task", "agent", "skill", "record", "best_practice"] }, point: { type: "string" }, evidence: { type: "string" } },
        required: ["source", "point", "evidence"],
      },
    },
    draft: {
      type: ["object", "null"], additionalProperties: false,
      properties: {
        name: { type: "string" },
        description: { type: "string" },
        target_type: { type: "string", enum: ["product", "gtm", "none"] },
        steps: {
          type: "array",
          items: {
            type: "object", additionalProperties: false,
            properties: {
              agent_id: { type: "string" },
              skill_id: { type: ["string", "null"] },
              signals: { type: "string", enum: ["none", "internal", "external", "both"] },
              instruction: { type: "string" },
            },
            required: ["agent_id", "skill_id", "signals", "instruction"],
          },
        },
        summary: { type: "string" },
      },
      required: ["name", "description", "target_type", "steps", "summary"],
    },
  },
  required: ["reply", "recommendations", "draft"],
};

type AreaCtx = { key: string; label: string; circle: "product" | "gtm"; connAreas?: string[]; tasks?: { key: string; label: string }[]; blurb?: string };

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

  try {
    const body = await req.json().catch(() => ({}));
    const transcript = (Array.isArray(body.transcript) ? body.transcript : []) as { role: string; text: string }[];
    const area = (body.area ?? {}) as AreaCtx;
    const standard = (body.standard ?? null) as { name: string; purpose: string; skills: string[]; steps?: { skill: string; signals: "none" | "internal" | "external" | "both"; instruction: string }[] } | null;
    const connAreas = new Set(area.connAreas ?? []);

    // ---- roster: real agents + their child skills + who's connected to this area
    const [{ data: agentsRaw }, { data: agSk }, { data: skillsRaw }, { data: conns }] = await Promise.all([
      supabase.from("agents").select("id, name").eq("is_active", true).order("name"),
      supabase.from("agent_skills").select("agent_id, skill_id"),
      supabase.from("skills").select("id, name, kind"),
      supabase.from("connections").select("agent_id, area").eq("kind", "internal"),
    ]);
    const skillById = new Map((skillsRaw ?? []).map((s) => [s.id, s] as const));
    const childByAgent = new Map<string, { id: string; name: string }[]>();
    for (const as of agSk ?? []) {
      const sk = skillById.get(as.skill_id);
      if (!sk || sk.kind === "cornerstone") continue;
      const arr = childByAgent.get(as.agent_id) ?? []; arr.push({ id: sk.id, name: sk.name ?? "skill" }); childByAgent.set(as.agent_id, arr);
    }
    const connectedAgents = new Set((conns ?? []).filter((c) => c.agent_id && c.area && connAreas.has(c.area)).map((c) => c.agent_id as string));

    const rosterText = (agentsRaw ?? []).map((a) => {
      const kids = childByAgent.get(a.id) ?? [];
      const tag = connectedAgents.has(a.id) ? " [CONNECTED to this area]" : "";
      return `• ${a.name} (agent_id=${a.id})${tag}\n   child skills: ${kids.length ? kids.map((k) => `${k.name} (skill_id=${k.id})`).join("; ") : "none yet"}`;
    }).join("\n");

    // ---- light product/GTM grounding (same shape as draft-skill)
    const fieldKeys = area.circle === "product"
      ? ["overview", "value_prop", "category", "strategic_intent", "differentiation"]
      : ["icp", "positioning", "category_pov", "win_themes", "gtm_motion", "primary_persona"];
    const parentCol = area.circle === "product" ? "product_id" : "gtm_record_id";
    const { data: rf } = await supabase.from("record_fields").select("label, value").not(parentCol, "is", null).in("field_key", fieldKeys).limit(16);
    const recordText = (rf ?? []).filter((f) => (f.value ?? "").trim()).map((f) => `• ${f.label}: ${f.value}`).join("\n");

    const tasksText = (area.tasks ?? []).map((t) => `- ${t.label}`).join("\n");

    const system = [
      "You are authoring a WORKFLOW for SingleStack — a saved, ordered task an agent workforce runs. You work in conversation with the operator. Discuss first, then propose.",
      `The workflow serves the "${area.label}" area (${area.circle === "product" ? "Build / Product" : "Go-to-market"} circle).${area.blurb ? ` Area intent: ${area.blurb}` : ""}`,
      "A workflow is an ORDERED chain of steps. Each step = ONE agent applying ONE of its child skills toward ONE of the area's tasks, threading prior output forward. Cover the area's tasks in a sensible order (e.g. synthesize → decide → draft → validate).",
      "HARD CONSTRAINTS: use ONLY agent_id and skill_id values from the ROSTER below — never invent them. STRONGLY prefer agents marked [CONNECTED to this area]; if no connected agent can do a task, say so in `reply` and recommend connecting/skilling one rather than drafting a step with a wrong agent. Set each step's `signals` (none|internal|external|both) by whether that step needs internal product signals, external market signals, both, or none. If a step has no fitting child skill, set skill_id=null and make the instruction self-contained.",
      "Surface at most 4 cited recommendations (a task, an agent, a skill, a record field, or best practice). When ready, return `draft` (name, description, target_type, ordered steps, summary) with target_type matching the area circle; else draft=null and keep discussing. Do not invent facts beyond the grounding.",
    ].join("\n\n");

    const convo = transcript.map((t) => ({ role: t.role === "a" ? "user" as const : "assistant" as const, content: t.text }));
    const anthropic = new Anthropic({ apiKey: key });
    const pol = await resolveModelPolicy(supabase, { task: "draft_workflow", fallback: { model: MODEL, effort: "high" } });
    const resp = (await anthropic.messages.create({
      model: pol.model, max_tokens: 8000, thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: pol.effort, format: { type: "json_schema", schema: SCHEMA } },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [
        { role: "user", content: [
          standard ? [
            `STANDARD PLAYBOOK to instantiate — draft THIS specifically (not a different workflow):`,
            `• ${standard.name} — ${standard.purpose}`,
            `• Standard skills it needs: ${(standard.skills ?? []).join(", ")}`,
            (standard.steps ?? []).length
              ? `CANONICAL TEMPLATE PROCEDURE — this is the seed. INSTANTIATE it: keep this step ORDER, these SIGNALS, and each step's INTENT. For each template step, BIND it to a real roster agent_id (prefer one CONNECTED to this area) and to that agent's child skill_id whose name best matches the step's skill — set skill_id=null only if no child skill fits. Lightly adapt each instruction to this org's product/record; do NOT invent a different chain. If no roster agent can carry a step's skill, say so in your reply and recommend connecting/skilling one rather than binding the wrong agent.\n${(standard.steps ?? []).map((s, i) => `  ${i + 1}. [skill: ${s.skill}] [signals: ${s.signals}] ${s.instruction}`).join("\n")}`
              : `Map this playbook onto an ordered step-chain using the roster; prefer connected agents who hold (or whose cornerstone covers) these skills, and name any missing skill in your reply.`,
          ].join("\n") : "",
          `AREA TASKS to cover:\n${tasksText || "(no tasks listed)"}`,
          `ROSTER (the only agents/skills you may use):\n${rosterText || "(no agents yet — recommend creating/connecting one)"}`,
          recordText ? `${area.circle === "product" ? "PRODUCT" : "GTM"} TRUTH:\n${recordText}` : "",
          `target_type must be "${area.circle}".`,
          "Open: ask what outcome this workflow should drive for the area (or, if the operator already said, propose a first ordered draft) — with a few cited recommendations.",
        ].filter(Boolean).join("\n\n") },
        ...convo,
      ],
      // deno-lint-ignore no-explicit-any
    } as any)) as Anthropic.Message;

    const text = resp.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    await logUsage(supabase, { task: "draft_workflow", model: pol.model, usage: resp.usage });
    try { return json(JSON.parse(text)); }
    catch { return json({ error: "The assistant's response was cut off before it finished. Please try again, or send a shorter message." }, 502); }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
