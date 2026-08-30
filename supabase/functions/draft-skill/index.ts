// ============================================================================
// draft-skill — the HITL CHAT that authors a new LIBRARY skill (a generic,
// reusable TEMPLATE — agent-agnostic). The conversational create flow: the
// operator describes what they want; the assistant grounds in the company's
// product + GTM truth, recent signals/themes, and frontier capabilities, holds
// the skill quality bar (anchored on a gold-standard exemplar), surfaces a
// CONTROLLED set of cited recommendations, and — when ready — proposes a full
// skill at the bar. Writes NOTHING; the client inserts the template on accept
// (scope='library'). Mirrors tailor-skill. Secret: ANTHROPIC_API_KEY.
// ============================================================================

import Anthropic from "npm:@anthropic-ai/sdk@0.69.0";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { SKILL_QBAR, exemplarFor } from "../_shared/skill_spec.ts";
import { logUsage } from "../_shared/ai_usage.ts";
import { resolveModelPolicy } from "../_shared/ai_policy.ts";

const MODEL = "claude-opus-5";
const AREA_KEYS = ["product", "gtm", "competitive", "strategy", "market", "signals", "frontier", "roadmap", "content", "campaigns", "initiatives"];
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
        name: { type: "string" },
        description: { type: "string" },
        category: { type: "string", enum: ["product", "gtm", "research", "general"] },
        kind: { type: "string", enum: ["cornerstone", "child"] },
        areas: { type: "array", items: { type: "string" } },
        connectors: { type: "array", items: { type: "string" } },
        instructions: { type: "string" },
        summary: { type: "string" },
      },
      required: ["name", "description", "category", "kind", "areas", "connectors", "instructions", "summary"],
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
    const kind: "cornerstone" | "child" = body.kind === "cornerstone" ? "cornerstone" : "child";
    const transcript = (Array.isArray(body.transcript) ? body.transcript : []) as { role: string; text: string }[];

    // ---- grounding: product truth + GTM market/personas + intelligence --------
    const { data: pf } = await supabase.from("record_fields").select("label, value")
      .not("product_id", "is", null)
      .in("field_key", ["overview", "value_prop", "category", "strategic_intent", "differentiation"]).limit(20);
    const { data: gf } = await supabase.from("record_fields").select("label, value")
      .not("gtm_record_id", "is", null)
      .in("field_key", ["icp", "industries", "primary_persona", "positioning", "category_pov", "win_themes", "gtm_motion"]).limit(20);
    const productText = (pf ?? []).filter((f) => (f.value ?? "").trim()).map((f) => `• ${f.label}: ${f.value}`).join("\n");
    const gtmText = (gf ?? []).filter((f) => (f.value ?? "").trim()).map((f) => `• ${f.label}: ${f.value}`).join("\n");

    const [{ data: themes }, { data: sigs }] = await Promise.all([
      supabase.from("signal_themes").select("title, summary, recommendation, category, state, conf_level").neq("state", "fading").order("last_evidence_at", { ascending: false, nullsFirst: false }).limit(8),
      supabase.from("signals").select("title, why, metadata").order("observed_at", { ascending: false, nullsFirst: false }).limit(20),
    ]);
    // deno-lint-ignore no-explicit-any
    const allSigs = (sigs ?? []) as any[];
    const capText = allSigs.filter((s) => s.metadata?.domain === "capability").slice(0, 6).map((s) => `• ${s.title}${s.why ? ` — ${s.why}` : ""}`).join("\n");
    const themeText = (themes ?? []).map((t) => `• [${t.category}/${t.state}] ${t.title}${t.summary ? ` — ${t.summary}` : ""}`).join("\n");

    const system = [
      `You are authoring a new ${kind === "cornerstone" ? "CORNERSTONE (a role/identity profile)" : "CHILD (a task-specific)"} LIBRARY skill for SingleStack — a generic, reusable TEMPLATE, agent-agnostic (it will be tailored per agent later). You work in conversation with the operator.`,
      "Discuss first, then propose. Surface a CONTROLLED set of evidence-backed recommendations — at most 4, ONLY when relevant, each citing its source (a signal/theme, a product/GTM field, a frontier capability, or the quality bar). Never a firehose. Do not invent facts beyond the grounding.",
      "When you have enough, return `draft` = the full skill (name, description, category, kind, areas, connectors, instructions, summary) at the quality bar; else draft=null and keep discussing. Match the depth and structure of the GOLD-STANDARD EXAMPLE exactly.",
      `Set kind=${kind}. Set areas (children) to relevant keys from: ${AREA_KEYS.join(", ")} (cornerstone: []). category ∈ product|gtm|research|general.`,
      SKILL_QBAR,
    ].join("\n\n");

    const convo = transcript.map((t) => ({ role: t.role === "a" ? "user" as const : "assistant" as const, content: t.text }));
    const anthropic = new Anthropic({ apiKey: key });
    const pol = await resolveModelPolicy(supabase, { task: "draft_skill", fallback: { model: MODEL, effort: "high" } });
    const resp = (await anthropic.messages.create({
      model: pol.model, max_tokens: 8000, thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: pol.effort, format: { type: "json_schema", schema: SCHEMA } },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [
        { role: "user", content: [
          productText ? `PRODUCT TRUTH:\n${productText}` : "",
          gtmText ? `GTM — MARKET & PERSONAS:\n${gtmText}` : "",
          themeText ? `ACTIVE THEMES:\n${themeText}` : "",
          capText ? `FRONTIER CAPABILITIES:\n${capText}` : "",
          `GOLD-STANDARD EXAMPLE (a ${kind} skill at the required bar — your draft must match this depth and structure):\n${exemplarFor(kind)}`,
          "Open: ask what this skill should do/be (or, if the operator already said, propose a first draft) — with at most a few cited recommendations grounded in the company's truth.",
        ].filter(Boolean).join("\n\n") },
        ...convo,
      ],
      // deno-lint-ignore no-explicit-any
    } as any)) as Anthropic.Message;

    const text = resp.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    await logUsage(supabase, { task: "draft_skill", model: pol.model, usage: resp.usage });
    try { return json(JSON.parse(text)); }
    catch { return json({ error: "The assistant's response was cut off before it finished. Please try again, or send a shorter message." }, 502); }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
