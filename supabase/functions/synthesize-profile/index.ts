// ============================================================================
// synthesize-profile — draft/refresh a Signal Profile from internal + external
// competitive signals. The profile is "your place in the market"; this reads the
// evidence and proposes a headline + sections. Returns a DRAFT only — the human
// edits and saves (HITL). Mirrors agent-propose conventions.
//
// Input (POST): { scope: 'landscape' | 'competitor', competitor_id?, current? }
//   current: optional existing fields [{field_key,label,value}] to refresh, not
//   regenerate from scratch.
// Runs as caller (JWT) → RLS fences reads to the org. Secret: ANTHROPIC_API_KEY.
// ============================================================================

import Anthropic from "npm:@anthropic-ai/sdk@0.69.0";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { logUsage } from "../_shared/ai_usage.ts";
import { loadMessaging } from "../_shared/messaging.ts";
import { resolveModelPolicy } from "../_shared/ai_policy.ts";

const MODEL = "claude-opus-4-8";
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
    fields: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { field_key: { type: "string" }, label: { type: "string" }, value: { type: "string" } },
        required: ["field_key", "label", "value"],
      },
    },
  },
  required: ["headline", "fields"],
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

  let input: { scope?: string; competitor_id?: string; current?: { field_key: string; label: string; value: string | null }[] };
  try { input = await req.json(); } catch { return json({ error: "invalid JSON body" }, 400); }
  const scope = input.scope === "landscape" ? "landscape" : "competitor";
  if (scope === "competitor" && !input.competitor_id) return json({ error: "competitor_id required for scope=competitor" }, 400);

  try {
    // ---- gather evidence: competitive signals (internal + external) ----------
    const { data: rawSigs } = await supabase
      .from("signals")
      .select("title, why, origin, conf_label, observed_at, metadata, competitor_id")
      .order("observed_at", { ascending: false, nullsFirst: false })
      .limit(120);
    // deno-lint-ignore no-explicit-any
    let comp = ((rawSigs ?? []) as any[]).filter((s) => s.metadata?.domain === "competitive" || s.competitor_id);
    if (scope === "competitor") comp = comp.filter((s) => (s.competitor_id ?? s.metadata?.competitor_id) === input.competitor_id);

    const fmt = (s: { title: string; why: string | null; origin: string; conf_label: string | null }) =>
      `• [${s.origin === "internal" ? "INTERNAL" : "EXTERNAL"}${s.conf_label ? `/${s.conf_label}` : ""}] ${s.title}${s.why ? ` — ${s.why}` : ""}`;
    const internal = comp.filter((s) => s.origin === "internal").map(fmt).join("\n");
    const external = comp.filter((s) => s.origin !== "internal").map(fmt).join("\n");

    // ---- context: our product, and (competitor) their matrix standing --------
    // OUR side of the dossier: the product record (what we ARE) + the GTM
    // record (how we SELL) — the real template keys, so the profile contrasts
    // them against us, not against a blank.
    let context = "";
    const { data: prod } = await supabase.from("product_records").select("id, name").order("created_at").limit(1).maybeSingle();
    if (prod) {
      const { data: fs } = await supabase.from("record_fields").select("field_key, value").eq("product_id", prod.id)
        .in("field_key", ["what_it_is", "value_prop", "overview", "core_capabilities", "differentiated_capabilities", "category"]);
      const get = (k: string) => fs?.find((f) => f.field_key === k)?.value;
      context = [
        `Our product: ${prod.name}${get("category") ? ` (${get("category")})` : ""}`,
        (get("what_it_is") ?? get("value_prop") ?? get("overview")) && `What we are: ${get("what_it_is") ?? get("value_prop") ?? get("overview")}`,
        get("core_capabilities") && `Our core capabilities: ${get("core_capabilities")}`,
        get("differentiated_capabilities") && `Our differentiation (product): ${get("differentiated_capabilities")}`,
      ].filter(Boolean).join("\n");
    }
    const { data: gtmRec } = await supabase.from("gtm_records").select("id").order("created_at").limit(1).maybeSingle();
    if (gtmRec) {
      const { data: gf } = await supabase.from("record_fields").select("field_key, value").eq("gtm_record_id", gtmRec.id)
        .in("field_key", ["icp", "pricing_model"]);
      const g = (k: string) => gf?.find((f) => f.field_key === k)?.value;
      const messaging = await loadMessaging(supabase, gtmRec.id); // positioning/differentiation/value/win-themes live in the framework
      const gtmBits = [
        g("icp") && `Our ICP: ${g("icp")}`,
        g("pricing_model") && `Our pricing model: ${g("pricing_model")}`,
        messaging && `OUR MESSAGING (from the messaging framework):\n${messaging}`,
      ].filter(Boolean).join("\n");
      if (gtmBits) context += `\n${gtmBits}`;
    }

    let target = "the overall competitive landscape and our place in it";
    let suggestedSections = "positioning, our_strengths, our_vulnerabilities, key_players, market_trends, strategic_implications";
    if (scope === "competitor") {
      const { data: c } = await supabase.from("competitors").select("name, relationship, notes").eq("id", input.competitor_id!).maybeSingle();
      target = `our standing vs ${c?.name ?? "this competitor"}${c?.relationship ? ` (${c.relationship})` : ""}`;
      if (c?.notes) context += `\nWhat we know about them: ${c.notes}`;
      // The ANALYSIS: matrix standing WITH the ratified rationales, plus this
      // competitor's synthesized themes — the profile builds on the analysis,
      // not beside it.
      const { data: caps } = await supabase.from("capabilities").select("id, name");
      const { data: scores } = await supabase.from("capability_scores").select("capability_id, competitor_id, score, scored_by, rationale");
      if (caps && scores) {
        const lines = caps.map((cap) => {
          const us = scores.find((sc) => sc.capability_id === cap.id && sc.competitor_id === null)?.score ?? 0;
          const themRow = scores.find((sc) => sc.capability_id === cap.id && sc.competitor_id === input.competitor_id);
          const them = themRow?.score ?? 0;
          return `${cap.name}: us ${us} / them ${them}${themRow?.rationale ? ` — ${themRow.rationale}` : ""}${themRow?.scored_by ? " [evidence-scored]" : ""}`;
        }).join("\n");
        if (lines) context += `\nCAPABILITY MATRIX (0-3, with ratified rationales):\n${lines}`;
      }
      const { data: compThemes } = await supabase.from("signal_themes").select("title, summary, recommendation, category, state, conf_level")
        .eq("competitor_id", input.competitor_id!).neq("state", "fading").order("last_evidence_at", { ascending: false, nullsFirst: false }).limit(10);
      if (compThemes?.length) {
        context += `\nTHEIR SYNTHESIZED THEMES:\n${compThemes.map((t) => `[${t.category}/${t.state} · conf ${(t.conf_level ?? 0).toFixed(2)}] ${t.title} — ${t.summary ?? ""}`).join("\n")}`;
      }
      // Battlecard-shaped sections: the profile IS the raw battlecard — facts the
      // refined battlecard gets built from.
      suggestedSections = "who_they_are, positioning, their_strengths, their_weaknesses, how_we_win, how_we_lose, objections_they_create, pricing_posture, momentum, what_to_watch, strategic_implications";
    } else {
      // LANDSCAPE = the broad competitive profile: a living AGGREGATE of our
      // battlecards + competitive signals + per-competitor themes + the matrix —
      // how the MARKET IS MOVING and how WE COMPARE. Built ON the product & GTM
      // records (already in `context`).
      target = "our broad competitive positioning — how the market is moving and how we compare against it";
      const { data: comps } = await supabase.from("competitors").select("id, name, relationship");
      const { data: caps } = await supabase.from("capabilities").select("id, name");
      const { data: scores } = await supabase.from("capability_scores").select("capability_id, competitor_id, score");
      if (caps?.length && scores?.length && comps?.length) {
        const sc = (capId: string, compId: string | null) => scores.find((s) => s.capability_id === capId && s.competitor_id === compId)?.score ?? 0;
        const lead = caps.filter((cap) => comps.every((c) => sc(cap.id, c.id) < sc(cap.id, null)));
        const lag = caps.filter((cap) => comps.some((c) => sc(cap.id, c.id) > sc(cap.id, null)));
        context += `\nMATRIX ROLL-UP (tracking ${comps.length} rival${comps.length === 1 ? "" : "s"}): we lead on ${lead.map((c) => c.name).join(", ") || "—"}; exposed on ${lag.map((c) => c.name).join(", ") || "—"}.`;
      }
      const { data: bc } = await supabase.from("battlecard_items").select("kind, title, detail, competitor_id").order("created_at", { ascending: false }).limit(60);
      if (bc?.length) {
        const nm = (id: string | null) => comps?.find((c) => c.id === id)?.name ?? "general";
        context += `\nOUR BATTLECARDS (aggregated — what we win/lose on across rivals):\n${bc.map((b) => `[${b.kind} · ${nm(b.competitor_id)}] ${b.title}${b.detail ? ` — ${b.detail}` : ""}`).join("\n")}`;
      }
      const { data: mvmt } = await supabase.from("signal_themes").select("title, summary, category, state, competitor_id").not("competitor_id", "is", null).neq("state", "fading").order("last_evidence_at", { ascending: false, nullsFirst: false }).limit(20);
      if (mvmt?.length) {
        const nm = (id: string | null) => comps?.find((c) => c.id === id)?.name ?? "market";
        context += `\nHOW RIVALS ARE MOVING (synthesized themes):\n${mvmt.map((t) => `[${t.category}/${t.state} · ${nm(t.competitor_id)}] ${t.title} — ${t.summary ?? ""}`).join("\n")}`;
      }
      suggestedSections = "how_the_market_is_moving, how_we_compare, competitive_battlegrounds, our_wedge, search_focus, strategic_implications";
    }

    const system = [
      `You maintain a HITL "Signal Profile" — a sharp, evidence-grounded record of ${target}. It is meant to DICTATE product and GTM strategy, so be decisive and specific, never generic.`,
      scope === "competitor"
        ? "For a competitor, this profile is the RAW BATTLECARD: the complete, honest dossier of who they are vs us, which the analyst refines into battlecard items and the messenger turns into GTM-ready copy for whatever motion the GTM record describes."
        : "This is our COMPETITIVE LENS — NOT a restatement of the product & GTM records (those already hold what-we-are / how-we-sell; reference them, never copy them). Its job is to give an agent the CONTEXT to do competitive search & analysis well: how the MARKET is moving (from our battlecards + competitive signals + rivals' themes) and how WE COMPARE. The 'search_focus' section is the most important: POINT at WHERE TO LOOK — which specific product modules/features and which GTM segments/positioning the agent should focus competitive search and analysis on (cite the record fields/modules by name) so it finds the RIGHT rivals and compares on the RIGHT axes. 'competitive_battlegrounds' = the capabilities/segments actually contested; 'our_wedge' = the differentiation that wins, referencing (not restating) the records.",
      "Synthesize the INTERNAL and EXTERNAL signals below into a headline + sections. INTERNAL signals (what our own teams hear in the field) and EXTERNAL signals (public: reviews, launches, pricing) are both evidence; weigh corroboration across them and note where they disagree.",
      `Use these section keys where supported (snake_case): ${suggestedSections}. Always include a 'strategic_implications' section spelling out what this means for product strategy and for GTM strategy. Only assert what the evidence supports; if thin, say so and keep it short.`,
      // Full & current — the user's standard: existence is not completeness.
      "Make EVERY section FULL and CURRENT. Re-evaluate each against the CURRENT product & GTM records and the latest signals/battlecards, and UPDATE it whenever they've moved — never leave a thin, vague, or stale section just because it already has text." + (input.current?.length ? " You are REFRESHING the existing profile (provided): fold the new evidence into each section and keep what still holds, but don't preserve a stale section just because a human wrote it — improve it." : ""),
    ].filter(Boolean).join("\n");

    const userText = [
      context ? `CONTEXT:\n${context}` : "",
      `\nINTERNAL competitive signals:\n${internal || "(none logged yet)"}`,
      `\nEXTERNAL competitive signals:\n${external || "(none logged yet)"}`,
      input.current?.length ? `\nEXISTING PROFILE (refresh this):\n${input.current.map((f) => `## ${f.label} (${f.field_key})\n${f.value ?? ""}`).join("\n\n")}` : "",
      "\nDraft the profile now.",
    ].filter(Boolean).join("\n");

    const anthropic = new Anthropic({ apiKey: key });
    const pol = await resolveModelPolicy(supabase, { task: "synthesize_profile", fallback: { model: MODEL, effort: "high" } });
    const message = (await anthropic.messages.create({
      model: pol.model,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: pol.effort, format: { type: "json_schema", schema: SCHEMA } },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userText }],
      // deno-lint-ignore no-explicit-any
    } as any)) as Anthropic.Message;
    await logUsage(supabase, { task: "synthesize_profile", model: pol.model, usage: message.usage });

    const block = message.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new Error(`no draft returned (stop_reason: ${message.stop_reason})`);
    const draft = JSON.parse(block.text) as { headline: string; fields: { field_key: string; label: string; value: string }[] };
    return json({ draft, evidence: { internal: comp.filter((s) => s.origin === "internal").length, external: comp.filter((s) => s.origin !== "internal").length } });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
