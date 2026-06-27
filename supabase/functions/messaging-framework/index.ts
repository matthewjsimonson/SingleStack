// ============================================================================
// messaging-framework — AI build/complete the GTM messaging & narrative framework.
//
// The Messaging tab on a GTM record is a PMA-style "messaging house" + strategic
// narrative (see web/lib/messagingFramework.ts). This drafts/refreshes EVERY
// section to be full and complete, grounded ONLY in the org's own truth: the
// product record (what it is, capabilities), the GTM record (positioning, value
// prop, differentiation, personas, win themes, motion), and competitive themes.
//
// It WRITES NOTHING — it returns section drafts for the human to review, edit, and
// apply (the client upserts gtm_tabs). HITL by construction. Product/persona/
// industry-agnostic: the records define the specifics, this defines the shape.
//
// Input (POST): { gtm_record_id, guidance? }. Runs as caller (JWT) → RLS fences
// every read to the org. Secret: ANTHROPIC_API_KEY.
// ============================================================================

import Anthropic from "npm:@anthropic-ai/sdk@0.69.0";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { logUsage } from "../_shared/ai_usage.ts";
import { resolveModelPolicy } from "../_shared/ai_policy.ts";
import { FIELD_WRITING_RULES } from "../_shared/field_writing.ts";

const MODEL = "claude-opus-4-8";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "content-type": "application/json" } });

// The framework shape — kept in lockstep with web/lib/messagingFramework.ts.
const SECTIONS: { key: string; label: string; guidance: string }[] = [
  { key: "positioning_statement", label: "Positioning statement", guidance: "One or two sentences locating the product: for [audience] who [need], [product] is the [category] that [benefit], unlike [alternative]. The foundation everything builds on." },
  { key: "strategic_narrative", label: "Strategic narrative", guidance: "The story arc: the shift in the world, the stakes, the promised land the buyer wants, the obstacle, and how the product is the bridge." },
  { key: "value_proposition", label: "Value proposition", guidance: "The single clearest promise in plain language; consistent with the GTM record's value prop, sharpened." },
  { key: "pillar_1", label: "Messaging pillar 1", guidance: "A core theme: the CLAIM (one line) + SUPPORTING POINTS + PROOF (capabilities/evidence/outcomes)." },
  { key: "pillar_2", label: "Messaging pillar 2", guidance: "A second, distinct core theme: claim + supporting points + proof." },
  { key: "pillar_3", label: "Messaging pillar 3", guidance: "A third, distinct core theme: claim + supporting points + proof. The three pillars hold up the value prop." },
  { key: "persona_messaging", label: "Persona messaging", guidance: "Per persona FROM THE GTM RECORD: their pain, what they value, the one message that lands, the objection to preempt. Never invent personas." },
  { key: "tone_of_voice", label: "Tone of voice", guidance: "The voice attributes (e.g. clear, confident, human) with a do/don't each, usable by any writer." },
  { key: "proof_points", label: "Proof points", guidance: "The evidence library — metrics, outcomes, validation, capabilities — each usable to back a claim; concrete and sourced where possible." },
  { key: "elevator_pitch", label: "Elevator pitch & boilerplate", guidance: "Derived short-form, consistent with all above: a one-liner, a ~30-second pitch, and a reusable boilerplate paragraph." },
];

const SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    summary: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          key: { type: "string" },
          label: { type: "string" },
          proposed_value: { type: "string" },
          changed: { type: "boolean" }, // false when the current value already holds up
        },
        required: ["key", "label", "proposed_value", "changed"],
      },
    },
  },
  required: ["summary", "sections"],
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
    const gtmId = body.gtm_record_id as string | undefined;
    const guidance = (body.guidance as string | undefined)?.trim();
    if (!gtmId) return json({ error: "gtm_record_id required" }, 400);

    const { data: gtm } = await supabase.from("gtm_records").select("id, org_id, name, product_id").eq("id", gtmId).maybeSingle();
    if (!gtm) return json({ error: "GTM record not found" }, 404);

    // ---- grounding: GTM record fields, product record fields, competitive ----
    // The GTM record holds STRATEGY & OPS (audience, motion, operating model) — the
    // messaging house itself is what this function WRITES, so it grounds in the
    // strategy + product truth + competitive, not in pre-existing messaging fields.
    const { data: gf } = await supabase.from("record_fields").select("label, field_key, value")
      .eq("gtm_record_id", gtmId)
      .in("field_key", ["icp", "industries", "primary_persona", "gtm_motion", "pricing_model", "gtm_tools", "gtm_workflows", "execution_strategy"]);
    const gtmText = (gf ?? []).filter((f) => (f.value ?? "").trim()).map((f) => `• ${f.label}: ${f.value}`).join("\n");

    let productText = "";
    if (gtm.product_id) {
      const { data: pf } = await supabase.from("record_fields").select("label, value")
        .eq("product_id", gtm.product_id)
        .in("field_key", ["what_it_is", "category", "problem", "core_capabilities", "differentiated_capabilities", "strategic_intent"]);
      productText = (pf ?? []).filter((f) => (f.value ?? "").trim()).map((f) => `• ${f.label}: ${f.value}`).join("\n");
    }

    const { data: bc } = await supabase.from("battlecard_items").select("kind, title, detail").order("created_at", { ascending: false }).limit(20);
    const bcText = (bc ?? []).map((b) => `[${b.kind}] ${b.title}${b.detail ? ` — ${b.detail}` : ""}`).join("\n");
    const { data: themes } = await supabase.from("signal_themes").select("title, summary, category, state")
      .neq("state", "fading").order("last_evidence_at", { ascending: false, nullsFirst: false }).limit(10);
    const themeText = (themes ?? []).map((t) => `[${t.category}/${t.state}] ${t.title} — ${t.summary ?? ""}`).join("\n");

    if (!gtmText && !productText) {
      return json({ error: "Your product & GTM records are too sparse to build messaging from. Fill them in (Sweep with AI), then come back." }, 422);
    }

    // ---- existing framework sections (current values) ----
    const { data: existingTabs } = await supabase.from("gtm_tabs").select("tab_key, body").eq("gtm_record_id", gtmId);
    const currentByKey: Record<string, string> = {};
    for (const t of existingTabs ?? []) {
      const txt = (t.body as { text?: string } | null)?.text ?? "";
      if (SECTIONS.some((s) => s.key === t.tab_key)) currentByKey[t.tab_key] = txt;
    }

    const system = [
      "You build a complete PMA-style MESSAGING & NARRATIVE FRAMEWORK (a 'messaging house' + strategic narrative) for a GTM record. Draft or refresh EVERY section listed so the framework is FULL and COMPLETE — a writer with no prior context could produce on-message content from it.",
      "Ground EVERYTHING in the org's own truth provided below — the product record, the GTM record, and competitive evidence. Make NO assumption about category, buyer, industry, or motion beyond what the records state. Never invent personas, claims, metrics, or proof not supported by the grounding; if a section is genuinely thin on evidence, write the best honest version and keep it tight rather than fabricating.",
      "The sections form one coherent system: the pillars must hold up the value proposition, the narrative must frame the positioning, persona messaging must use only personas from the GTM record, and the elevator pitch/boilerplate must be consistent with all of it.",
      FIELD_WRITING_RULES,
      "For each section return proposed_value = the full section text at the guidance's shape. Set changed=false (and echo the current value) ONLY when the existing value is already full, current, and on-message; otherwise changed=true.",
      guidance ? `Operator focus: ${guidance}` : "",
    ].filter(Boolean).join("\n");

    const userText = [
      `GTM RECORD: ${gtm.name ?? "(unnamed)"}`,
      productText ? `\nPRODUCT TRUTH (what it is / capabilities):\n${productText}` : "",
      gtmText ? `\nGTM STRATEGY (who we serve / how we go to market / operating model):\n${gtmText}` : "",
      bcText ? `\nCOMPETITIVE (ratified battlecard items):\n${bcText}` : "",
      themeText ? `\nACTIVE THEMES:\n${themeText}` : "",
      "\nFRAMEWORK SECTIONS TO BUILD (write each to its guidance):",
      SECTIONS.map((s) => `\n## ${s.label} (key: ${s.key})\nGuidance: ${s.guidance}\nCurrent value: ${currentByKey[s.key] ? currentByKey[s.key] : "(empty)"}`).join("\n"),
      "\nBuild the full framework now — one entry per section, in order.",
    ].filter(Boolean).join("\n");

    const anthropic = new Anthropic({ apiKey: key });
    const pol = await resolveModelPolicy(supabase, { task: "messaging_framework", fallback: { model: MODEL, effort: "high" } });
    const message = (await anthropic.messages.create({
      model: pol.model,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: pol.effort, format: { type: "json_schema", schema: SCHEMA } },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userText }],
      // deno-lint-ignore no-explicit-any
    } as any)) as Anthropic.Message;
    await logUsage(supabase, { task: "messaging_framework", model: pol.model, usage: message.usage });

    const block = message.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new Error(`no draft returned (stop_reason: ${message.stop_reason})`);
    if (message.stop_reason === "max_tokens") throw new Error("The framework build ran out of room before finishing. Try again, or narrow with a focus.");
    const out = JSON.parse(block.text) as { summary: string; sections: { key: string; label: string; proposed_value: string; changed: boolean }[] };

    // Keep only known section keys, preserve framework order, drop empties.
    const byKey = new Map((out.sections ?? []).map((s) => [s.key, s]));
    const sections = SECTIONS.map((s) => byKey.get(s.key)).filter((s): s is NonNullable<typeof s> => !!s && !!s.proposed_value?.trim());

    return json({ summary: out.summary ?? "", sections });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
