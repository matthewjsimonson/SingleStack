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
        .in("field_key", ["positioning", "differentiation", "value_prop", "icp", "win_themes", "pricing_model"]);
      const g = (k: string) => gf?.find((f) => f.field_key === k)?.value;
      const gtmBits = [
        g("positioning") && `How we position: ${g("positioning")}`,
        g("differentiation") && `Why we win (GTM): ${g("differentiation")}`,
        g("value_prop") && `Our promise: ${g("value_prop")}`,
        g("icp") && `Our ICP: ${g("icp")}`,
        g("win_themes") && `Our win themes: ${g("win_themes")}`,
        g("pricing_model") && `Our pricing model: ${g("pricing_model")}`,
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
      // Battlecard-shaped sections: the profile IS the raw battlecard — facts a
      // rep's card gets refined from.
      suggestedSections = "who_they_are, positioning, their_strengths, their_weaknesses, how_we_win, how_we_lose, objections_they_create, pricing_posture, momentum, what_to_watch, strategic_implications";
    }

    const system = [
      `You maintain a HITL "Signal Profile" — a sharp, evidence-grounded record of ${target}. For a competitor, this profile is the RAW BATTLECARD: the complete, honest dossier of who they are vs us, which the analyst refines into battlecard items and the messenger turns into seller copy. It is meant to DICTATE product and GTM strategy, so be decisive and specific, never generic.`,
      "Synthesize the INTERNAL and EXTERNAL signals below into a headline + sections. INTERNAL signals (what our own teams hear — deals, calls) and EXTERNAL signals (public: reviews, launches, pricing) are both evidence; weigh corroboration across them and note where they disagree.",
      `Use these section keys where supported (snake_case): ${suggestedSections}. Always include a 'strategic_implications' section spelling out what this means for product strategy and for GTM strategy. Only assert what the evidence supports; if thin, say so and keep it short.`,
      input.current?.length ? "REFRESH the existing profile (provided): keep what still holds, update what changed, don't discard human edits wholesale." : "",
    ].filter(Boolean).join("\n");

    const userText = [
      context ? `CONTEXT:\n${context}` : "",
      `\nINTERNAL competitive signals:\n${internal || "(none logged yet)"}`,
      `\nEXTERNAL competitive signals:\n${external || "(none logged yet)"}`,
      input.current?.length ? `\nEXISTING PROFILE (refresh this):\n${input.current.map((f) => `## ${f.label} (${f.field_key})\n${f.value ?? ""}`).join("\n\n")}` : "",
      "\nDraft the profile now.",
    ].filter(Boolean).join("\n");

    const anthropic = new Anthropic({ apiKey: key });
    const message = (await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userText }],
      // deno-lint-ignore no-explicit-any
    } as any)) as Anthropic.Message;

    const block = message.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new Error(`no draft returned (stop_reason: ${message.stop_reason})`);
    const draft = JSON.parse(block.text) as { headline: string; fields: { field_key: string; label: string; value: string }[] };
    return json({ draft, evidence: { internal: comp.filter((s) => s.origin === "internal").length, external: comp.filter((s) => s.origin !== "internal").length } });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
