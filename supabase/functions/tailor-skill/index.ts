// ============================================================================
// tailor-skill — the HITL CHAT that tailors a skill for a specific agent.
//
// Plain English: a library skill is generic; an agent gets a per-agent INSTANCE
// of it (scope='agent'). This is the conversational layer that specializes that
// instance for THIS agent and THIS company. The chat is grounded in:
//   • the agent's cornerstone (its identity — the child builds on it),
//   • the product record + the GTM record's market & personas,
//   • recent signals/themes in the skill's areas, and
//   • frontier-model CAPABILITY signals + the skill quality bar (best practice).
// Each turn it discusses, surfaces a CONTROLLED set of evidence-backed
// recommendations (each citing its source), and — when ready — proposes a full
// rewritten body at the quality bar. It writes NOTHING; the client applies via
// apply_skill_evolution (records a provenance-tagged revision). HITL throughout.
//
// "Controlled external best practice" = the distilled quality bar (derived from
// Anthropic's Agent Skills) + the capability signals already in the system. No
// live web calls — bounded, never a firehose. Runs as caller (JWT) → RLS fences
// reads. Secret: ANTHROPIC_API_KEY. Mirrors refine-record.
// ============================================================================

import Anthropic from "npm:@anthropic-ai/sdk@0.69.0";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { SKILL_QBAR, exemplarFor } from "../_shared/skill_spec.ts";

const MODEL = "claude-opus-4-8";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "content-type": "application/json" } });

const SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    reply: { type: "string" }, // the conversational turn (markdown, tight)
    // CONTROLLED, evidence-backed recommendations — at most 4, only when concrete.
    recommendations: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          source: { type: "string", enum: ["signal", "theme", "record", "capability", "best_practice"] },
          point: { type: "string" },     // the recommendation, one line
          evidence: { type: "string" },  // the specific signal/theme/field/capability/bar it rests on
        },
        required: ["source", "point", "evidence"],
      },
    },
    // The full proposed instructions for THIS instance, at the quality bar — or null
    // until the conversation has enough to propose. summary = one line of what changed.
    draft: {
      type: ["object", "null"], additionalProperties: false,
      properties: { instructions: { type: "string" }, summary: { type: "string" } },
      required: ["instructions", "summary"],
    },
  },
  required: ["reply", "recommendations", "draft"],
};

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
    const skillId = body.skill_id as string | undefined;
    if (!skillId) return json({ error: "skill_id required" }, 400);
    const transcript = (Array.isArray(body.transcript) ? body.transcript : []) as { role: string; text: string }[];

    // ---- the instance being tailored ----------------------------------------
    const { data: skill } = await supabase.from("skills")
      .select("id, name, description, instructions, category, kind, areas, agent_id, parent_id").eq("id", skillId).maybeSingle();
    if (!skill) return json({ error: "skill not found" }, 404);
    const isCornerstone = skill.kind === "cornerstone";

    // ---- the agent + its cornerstone (the identity this builds on) -----------
    let agentName = "this agent", agentRole = "";
    let cornerstone = "";
    if (skill.agent_id) {
      const { data: ag } = await supabase.from("agents").select("name, role").eq("id", skill.agent_id).maybeSingle();
      if (ag) { agentName = ag.name; agentRole = ag.role ?? ""; }
      if (!isCornerstone) {
        const { data: cs } = await supabase.from("skills").select("name, instructions").eq("agent_id", skill.agent_id).eq("kind", "cornerstone").eq("scope", "agent").maybeSingle();
        if (cs?.instructions) cornerstone = `## ${cs.name}\n${cs.instructions}`;
      }
    }

    // ---- grounding: product truth + GTM market/personas ----------------------
    const { data: pf } = await supabase.from("record_fields").select("label, value")
      .not("product_id", "is", null)
      .in("field_key", ["overview", "value_prop", "category", "strategic_intent", "differentiation"]).limit(20);
    const { data: gf } = await supabase.from("record_fields").select("label, value")
      .not("gtm_record_id", "is", null)
      .in("field_key", ["icp", "industries", "primary_persona", "positioning", "category_pov", "win_themes", "gtm_motion"]).limit(20);
    const productText = (pf ?? []).filter((f) => (f.value ?? "").trim()).map((f) => `• ${f.label}: ${f.value}`).join("\n");
    const gtmText = (gf ?? []).filter((f) => (f.value ?? "").trim()).map((f) => `• ${f.label}: ${f.value}`).join("\n");

    // ---- grounding: signals/themes in the skill's areas + capability signals --
    const cat = (skill.areas ?? []).includes("product") ? "product" : (skill.areas ?? []).includes("gtm") ? "gtm" : null;
    let themeQ = supabase.from("signal_themes").select("title, summary, recommendation, category, state, conf_level").neq("state", "fading").order("last_evidence_at", { ascending: false, nullsFirst: false }).limit(8);
    if (cat) themeQ = themeQ.eq("category", cat);
    const [{ data: themes }, { data: sigs }] = await Promise.all([
      themeQ,
      supabase.from("signals").select("title, why, metadata").order("observed_at", { ascending: false, nullsFirst: false }).limit(24),
    ]);
    // deno-lint-ignore no-explicit-any
    const allSigs = (sigs ?? []) as any[];
    const capText = allSigs.filter((s) => s.metadata?.domain === "capability").slice(0, 6).map((s) => `• ${s.metadata?.provider ? `[${s.metadata.provider}] ` : ""}${s.title}${s.why ? ` — ${s.why}` : ""}`).join("\n");
    const sigText = allSigs.filter((s) => s.metadata?.domain !== "capability").slice(0, 10).map((s) => `• ${s.title}${s.why ? ` — ${s.why}` : ""}`).join("\n");
    const themeText = (themes ?? []).map((t) => `• [${t.category}/${t.state} · conf ${(t.conf_level ?? 0).toFixed(2)}] ${t.title}${t.summary ? ` — ${t.summary}` : ""}${t.recommendation ? ` → ${t.recommendation}` : ""}`).join("\n");

    const system = [
      `You are tailoring the ${isCornerstone ? "CORNERSTONE (identity)" : "CHILD"} skill "${skill.name}" for ${agentName}${agentRole ? `, ${agentRole}` : ""}, in conversation with its operator. You specialize the generic skill for THIS agent and THIS company.`,
      "Discuss first, then propose. Surface a CONTROLLED set of evidence-backed recommendations — at most 4, ONLY when genuinely relevant, each citing its source (a signal/theme, a product/GTM record field, a frontier capability, or the skill quality bar). Never a firehose; restraint is the point. Do not invent facts beyond the grounding provided.",
      "When the conversation has enough, return `draft` = the FULL rewritten instructions for this instance at the quality bar, specialized to this agent/company (else draft=null and keep discussing). Match the depth and structure of the GOLD-STANDARD EXAMPLE exactly.",
      SKILL_QBAR,
    ].join("\n\n");

    const convo = transcript.map((t) => ({ role: t.role === "a" ? "user" as const : "assistant" as const, content: t.text }));
    const anthropic = new Anthropic({ apiKey: key });
    const resp = (await anthropic.messages.create({
      model: MODEL, max_tokens: 8000, thinking: { type: "adaptive" },
      output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [
        { role: "user", content: [
          `CURRENT SKILL BODY:\n${skill.instructions ?? "(empty)"}`,
          cornerstone ? `THE AGENT'S CORNERSTONE (its identity — this child serves it, does not restate it):\n${cornerstone}` : "",
          productText ? `PRODUCT TRUTH:\n${productText}` : "",
          gtmText ? `GTM — MARKET & PERSONAS:\n${gtmText}` : "",
          themeText ? `ACTIVE THEMES (in this skill's areas):\n${themeText}` : "",
          sigText ? `RECENT SIGNALS:\n${sigText}` : "",
          capText ? `FRONTIER CAPABILITIES (now possible to leverage):\n${capText}` : "",
          `GOLD-STANDARD EXAMPLE (a skill at the required bar — your draft must match this depth and structure):\n${exemplarFor(isCornerstone ? "cornerstone" : "child")}`,
          "Open: the single highest-value way this skill should be tailored for this agent/company right now — or an honest 'this holds up' — with at most a few cited recommendations.",
        ].filter(Boolean).join("\n\n") },
        ...convo,
      ],
      // deno-lint-ignore no-explicit-any
    } as any)) as Anthropic.Message;

    const text = resp.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    try { return json(JSON.parse(text)); }
    catch { return json({ error: "The assistant's response was cut off before it finished. Please try again, or send a shorter steer." }, 502); }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
