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
import { FIELD_WRITING_RULES } from "../_shared/field_writing.ts";

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
    // Refinement updates fields that ALREADY HOLD content — the editable set is the
    // FILLED fields of THIS record. This is the hard boundary that keeps product
    // refinement on the product record and GTM on the GTM record (a record only
    // owns its own fields), and keeps "refine" a true-update, not field invention.
    const editable = (fields ?? []).filter((f) => (f.value ?? "").trim());
    const editableText = editable.map((f) => `[${f.section ?? "Details"}] ${f.field_key} · ${f.label}`).join("\n");

    // For a PRODUCT record, the real surface area is its Modules → Features — read
    // them so refinements are grounded in what the product actually does, not just
    // the narrative fields. (Mirrors the competitive-setup grounding.)
    let modulesText = "";
    if (isProduct) {
      const { data: mods } = await supabase.from("modules").select("id, name, description").eq("product_id", target.id).order("position").order("created_at");
      const modIds = (mods ?? []).map((m) => m.id);
      const { data: feats } = modIds.length
        ? await supabase.from("features").select("module_id, name, description").in("module_id", modIds)
        : { data: [] as { module_id: string; name: string; description: string | null }[] };
      const byMod: Record<string, string[]> = {};
      for (const ft of feats ?? []) (byMod[ft.module_id] ??= []).push(ft.description ? `${ft.name} (${ft.description})` : ft.name);
      modulesText = (mods ?? []).map((m) => {
        const fl = byMod[m.id] ?? [];
        const head = m.description ? `${m.name} — ${m.description}` : m.name;
        return fl.length ? `${head} · features: ${fl.join(", ")}` : head;
      }).join("\n");
    }

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
      `You are refining the ${isProduct ? "PRODUCT" : "GTM"} record "${rec.data.name}" with its owner. ${isProduct ? "This record describes what the product IS and how it's built — overview, capabilities, technical, product strategy. Market positioning, messaging, differentiation, competitive landscape, buyer/ICP, GTM motion and pricing live on the GTM record — NEVER propose those here." : "This record describes how the product is SOLD — positioning, messaging, differentiation, buyer/ICP, GTM motion, pricing. What the product is and how it's built lives on the PRODUCT record — NEVER propose those here."} You also have the org's active intelligence themes and recent external (marketplace) + internal (company) signals as grounding.`,
      "SCOPE — refinement improves fields that ALREADY HOLD content. Propose changes ONLY to the EDITABLE FIELDS listed below (the existing, filled fields of THIS record), using each field's EXACT field_key, label, and section. Do NOT invent new fields, do NOT propose fields shown '(empty)', and do NOT propose anything that belongs on the other record. (Filling blank fields and adding new ones is initial setup/import, not refinement.)",
      "A refinement is a TRUE UPDATE: take the field's CURRENT value, fold in the additional/new information (from the signals or what the owner tells you), and write ONE clean, current, and COMPLETE replacement — preserve everything still true, integrate what's new, drop nothing of value, and never merely append or restate. proposed_value = that full new field text. If a field is already clean, current, and complete, leave it alone and say so. Every suggestion carries a rationale citing the theme/signal (or the owner's words) that motivates it; never invent facts beyond the provided intelligence.",
      FIELD_WRITING_RULES,
      "Conversational rules: tight replies (2-5 sentences) — discuss, then suggest. Attach suggestions ONLY when you have a concrete true-update (suggestions: [] otherwise). Let the user steer — answer what they ask; otherwise lead with the filled field whose content is most stale or incomplete vs the intelligence.",
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
          `THE RECORD (for context):\n${fieldText || "(no fields yet)"}`,
          editableText
            ? `EDITABLE FIELDS — propose true-updates ONLY to these (existing & filled on this record):\n${editableText}`
            : "EDITABLE FIELDS: none — this record has no filled fields yet, so there's nothing to refine. Tell the owner to populate it via setup/import first.",
          modulesText ? `MODULES & FEATURES (what the product actually does):\n${modulesText}` : "",
          themeText ? `ACTIVE INTELLIGENCE THEMES:\n${themeText}` : "",
          extText ? `RECENT MARKETPLACE SIGNALS (external):\n${extText}` : "",
          intText ? `RECENT COMPANY SIGNALS (internal):\n${intText}` : "",
          "Open the conversation: the single most important TRUE-UPDATE among the editable (filled) fields, given the intelligence — or an honest 'this record holds up' if every filled field is already clean, current, and complete.",
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
