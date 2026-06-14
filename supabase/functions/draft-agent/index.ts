// ============================================================================
// draft-agent — the HITL CHAT that creates a new executive agent. An agent IS its
// CORNERSTONE (its identity), so this proposes the agent's name + role + its
// cornerstone identity body, in conversation. Grounded in the company's product +
// GTM truth, recent signals/themes, and frontier capabilities; held to the skill
// quality bar (anchored on the cornerstone gold-standard exemplar); with a
// CONTROLLED set of cited recommendations. Writes NOTHING — the client creates the
// agent + its cornerstone instance on accept (no system_prompt: identity = the
// cornerstone). Mirrors draft-skill / tailor-skill. Secret: ANTHROPIC_API_KEY.
// ============================================================================

import Anthropic from "npm:@anthropic-ai/sdk@0.69.0";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { SKILL_QBAR, CORNERSTONE_EXEMPLAR } from "../_shared/skill_spec.ts";
import { logUsage } from "../_shared/ai_usage.ts";
import { resolveModelPolicy } from "../_shared/ai_policy.ts";

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
    reply: { type: "string" },
    recommendations: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          source: { type: "string", enum: ["signal", "theme", "record", "capability", "best_practice"] },
          point: { type: "string" }, evidence: { type: "string" },
        },
        required: ["source", "point", "evidence"],
      },
    },
    draft: {
      type: ["object", "null"], additionalProperties: false,
      properties: {
        name: { type: "string" },          // e.g. "Chief Marketing Officer"
        role: { type: "string" },          // one line — what they own
        category: { type: "string", enum: ["product", "gtm", "research", "general"] },
        description: { type: "string" },   // the cornerstone's routing/identity description
        instructions: { type: "string" },  // the cornerstone identity body (the quality-bar shape)
        summary: { type: "string" },
      },
      required: ["name", "role", "category", "description", "instructions", "summary"],
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
    const transcript = (Array.isArray(body.transcript) ? body.transcript : []) as { role: string; text: string }[];

    // ---- grounding: product/GTM truth + intelligence + the existing roster ----
    const { data: pf } = await supabase.from("record_fields").select("label, value")
      .not("product_id", "is", null)
      .in("field_key", ["overview", "value_prop", "category", "strategic_intent", "differentiation"]).limit(20);
    const { data: gf } = await supabase.from("record_fields").select("label, value")
      .not("gtm_record_id", "is", null)
      .in("field_key", ["icp", "industries", "primary_persona", "positioning", "category_pov", "gtm_motion"]).limit(20);
    const productText = (pf ?? []).filter((f) => (f.value ?? "").trim()).map((f) => `• ${f.label}: ${f.value}`).join("\n");
    const gtmText = (gf ?? []).filter((f) => (f.value ?? "").trim()).map((f) => `• ${f.label}: ${f.value}`).join("\n");

    const [{ data: roster }, { data: themes }, { data: sigs }] = await Promise.all([
      supabase.from("agents").select("name, role").eq("is_active", true).order("name"),
      supabase.from("signal_themes").select("title, summary, category, state").neq("state", "fading").order("last_evidence_at", { ascending: false, nullsFirst: false }).limit(8),
      supabase.from("signals").select("title, why, metadata").order("observed_at", { ascending: false, nullsFirst: false }).limit(16),
    ]);
    const rosterText = (roster ?? []).map((a) => `• ${a.name}${a.role ? ` — ${a.role}` : ""}`).join("\n");
    const themeText = (themes ?? []).map((t) => `• [${t.category}/${t.state}] ${t.title}${t.summary ? ` — ${t.summary}` : ""}`).join("\n");
    // deno-lint-ignore no-explicit-any
    const capText = ((sigs ?? []) as any[]).filter((s) => s.metadata?.domain === "capability").slice(0, 5).map((s) => `• ${s.title}${s.why ? ` — ${s.why}` : ""}`).join("\n");

    const system = [
      "You are creating a new EXECUTIVE AGENT for SingleStack in conversation with the operator. An agent IS its CORNERSTONE — its always-on identity. You propose the agent's name (a role title), a one-line role, and its cornerstone identity body.",
      "Discuss first, then propose. Surface a CONTROLLED set of evidence-backed recommendations — at most 4, ONLY when relevant, each citing its source (a signal/theme, a product/GTM field, a frontier capability, or the quality bar). Consider the EXISTING ROSTER: recommend an agent that fills a real gap and has clean Scope & handoffs (no overlap/contradiction with existing officers). Do not invent facts beyond the grounding.",
      "When you have enough, return `draft` = the agent (name, role, category, description, instructions, summary) where `instructions` is the cornerstone identity body at the quality bar; else draft=null and keep discussing. Match the depth and structure of the GOLD-STANDARD CORNERSTONE EXAMPLE exactly — especially the 'Scope & handoffs' section.",
      SKILL_QBAR,
    ].join("\n\n");

    const convo = transcript.map((t) => ({ role: t.role === "a" ? "user" as const : "assistant" as const, content: t.text }));
    const anthropic = new Anthropic({ apiKey: key });
    const pol = await resolveModelPolicy(supabase, { task: "draft_agent", fallback: { model: MODEL, effort: "high" } });
    const resp = (await anthropic.messages.create({
      model: pol.model, max_tokens: 8000, thinking: { type: "adaptive" },
      output_config: { effort: pol.effort, format: { type: "json_schema", schema: SCHEMA } },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [
        { role: "user", content: [
          rosterText ? `EXISTING ROSTER (avoid overlap; define clean handoffs):\n${rosterText}` : "(no agents yet)",
          productText ? `PRODUCT TRUTH:\n${productText}` : "",
          gtmText ? `GTM — MARKET & PERSONAS:\n${gtmText}` : "",
          themeText ? `ACTIVE THEMES:\n${themeText}` : "",
          capText ? `FRONTIER CAPABILITIES:\n${capText}` : "",
          `GOLD-STANDARD CORNERSTONE EXAMPLE (match this depth and structure):\n${CORNERSTONE_EXEMPLAR}`,
          "Open: ask what role this agent should play (or, if the operator already said, propose the agent + cornerstone) — with at most a few cited recommendations grounded in the company's truth and the roster gap.",
        ].filter(Boolean).join("\n\n") },
        ...convo,
      ],
      // deno-lint-ignore no-explicit-any
    } as any)) as Anthropic.Message;

    const text = resp.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    await logUsage(supabase, { task: "draft_agent", model: pol.model, usage: resp.usage });
    try { return json(JSON.parse(text)); }
    catch { return json({ error: "The assistant's response was cut off before it finished. Please try again, or send a shorter message." }, 502); }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
