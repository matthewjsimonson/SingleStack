// ============================================================================
// refine-record — the HITL chat that keeps a record current.
//
// Plain English: proposals already let agents suggest record changes; this is
// the CONVERSATIONAL layer on top. The user opens a chat on a product or GTM
// record; the agent has read the whole record AND what's moving in the
// marketplace (active themes, recent external signals) and inside the company
// (recent internal signals), and discusses concrete refinements. Each turn it
// can attach field-level suggestions — current vs proposed with a rationale —
// which the UI renders as EDITABLE propositions: the human refines the text,
// then applies (audited through the proposals trail) or queues for review.
//
// Multi-turn via transcript; no DB writes here — the client owns the gate.
// Runs as caller (JWT) → RLS fences all reads. Secret: ANTHROPIC_API_KEY.
// ============================================================================

import Anthropic from "npm:@anthropic-ai/sdk@0.69.0";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
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
    reply: { type: "string" },        // the conversational turn (markdown, tight)
    suggestions: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          field_key: { type: "string" },     // existing field key, or a new snake_case key
          label: { type: "string" },         // display label (existing label when updating)
          section: { type: "string" },       // the record section it belongs to
          proposed_value: { type: "string" },
          rationale: { type: "string" },     // WHY — citing the market/company signal that motivates it
        },
        required: ["field_key", "label", "section", "proposed_value", "rationale"],
      },
    },
  },
  required: ["reply", "suggestions"],
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
  const { data: orgId } = await supabase.rpc("current_org_id");
  if (!orgId) return json({ error: "could not resolve org" }, 401);

  try {
    const body = await req.json().catch(() => ({}));
    const target = body.target as { kind?: string; id?: string } | undefined;
    if (!target?.kind || !target?.id) return json({ error: "target { kind, id } required" }, 400);
    const transcript = (Array.isArray(body.transcript) ? body.transcript : []) as { role: string; text: string }[];

    // ---- the record (every field) -------------------------------------------
    const isProduct = target.kind === "product";
    const rec = isProduct
      ? await supabase.from("product_records").select("id, name").eq("id", target.id).maybeSingle()
      : await supabase.from("gtm_records").select("id, name").eq("id", target.id).maybeSingle();
    if (!rec.data) return json({ error: "record not found" }, 404);
    const { data: fields } = await supabase.from("record_fields").select("field_key, label, section, value")
      .eq(isProduct ? "product_id" : "gtm_record_id", target.id).order("position");
    const fieldText = (fields ?? []).map((f) => `[${f.section ?? "Details"}] ${f.field_key} · ${f.label}: ${f.value ?? "(empty)"}`).join("\n");

    // ---- the grounding: marketplace + company ---------------------------------
    const [{ data: themes }, { data: ext }, { data: int }] = await Promise.all([
      supabase.from("signal_themes").select("title, summary, recommendation, category, state, conf_level").neq("state", "fading").order("last_evidence_at", { ascending: false, nullsFirst: false }).limit(10),
      supabase.from("signals").select("title, why, conf_label, observed_at").eq("origin", "external").order("observed_at", { ascending: false, nullsFirst: false }).limit(12),
      supabase.from("signals").select("title, why, conf_label, observed_at").eq("origin", "internal").order("observed_at", { ascending: false, nullsFirst: false }).limit(12),
    ]);
    const themeText = (themes ?? []).map((t) => `[${t.category}/${t.state} · conf ${(t.conf_level ?? 0).toFixed(2)}] ${t.title} — ${t.summary ?? ""}${t.recommendation ? ` → ${t.recommendation}` : ""}`).join("\n");
    const extText = (ext ?? []).map((s) => `(${s.conf_label ?? "?"}) ${s.title}${s.why ? " — " + s.why : ""}`).join("\n");
    const intText = (int ?? []).map((s) => `(${s.conf_label ?? "?"}) ${s.title}${s.why ? " — " + s.why : ""}`).join("\n");

    const system = [
      `You are refining the ${isProduct ? "PRODUCT" : "GTM"} record "${rec.data.name}" in conversation with its owner. You have the full record, the org's active intelligence themes, and recent external (marketplace) + internal (company) signals.`,
      "Your job: surface where the record is stale, vague, or contradicted by what's happening — and propose concrete field-level refinements. Every suggestion must carry a rationale citing the theme/signal (or the user's own words) that motivates it. Honest and conservative: if the record is fine, say so; never invent market facts beyond the provided intelligence.",
      "Conversational rules: tight replies (2-5 sentences) — discuss, then suggest. Attach suggestions ONLY when concrete (suggestions: [] otherwise). For an existing field use its exact field_key/label/section; for a genuinely new field use a snake_case key and the section it belongs in. proposed_value = the full new text of the field (not a diff). Let the user steer — answer what they ask; volunteer the most important staleness first.",
    ].join("\n\n");

    const convo = transcript.map((t) => ({ role: t.role === "a" ? "user" as const : "assistant" as const, content: t.text }));
    const anthropic = new Anthropic({ apiKey: key });
    const pol = await resolveModelPolicy(supabase, { task: "refine_record", fallback: { model: MODEL, effort: "medium" } });
    const resp = (await anthropic.messages.create({
      model: pol.model, max_tokens: 2500,
      thinking: { type: "adaptive" },
      output_config: { effort: pol.effort, format: { type: "json_schema", schema: SCHEMA } },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [
        { role: "user", content: [
          `THE RECORD:\n${fieldText || "(no fields yet)"}`,
          themeText ? `ACTIVE INTELLIGENCE THEMES:\n${themeText}` : "",
          extText ? `RECENT MARKETPLACE SIGNALS (external):\n${extText}` : "",
          intText ? `RECENT COMPANY SIGNALS (internal):\n${intText}` : "",
          "Open the conversation: the single most important refinement this record needs right now, given the intelligence — or an honest 'this record holds up' if it does.",
        ].filter(Boolean).join("\n\n") },
        ...convo,
      ],
      // deno-lint-ignore no-explicit-any
    } as any)) as Anthropic.Message;
    await logUsage(supabase, { task: "refine_record", model: pol.model, usage: resp.usage });

    const text = resp.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    return json(JSON.parse(text));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
