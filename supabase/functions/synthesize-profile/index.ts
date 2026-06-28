// ============================================================================
// synthesize-profile — draft/refresh a Signal Profile. Two scopes:
//   • landscape  — STEP ONE of the competitive workflow: built from OUR product &
//     GTM records to frame where we play and AIM the search for rivals. Works on
//     the FIRST run, before any competitor/battlecard/signal exists; downstream
//     evidence (matrix/battlecards/themes) is folded in only as it accrues.
//   • competitor — the RAW BATTLECARD for one rival: built from that rival's
//     signals + the matrix + our records.
// Returns a DRAFT only — the human edits and saves (HITL).
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
        properties: {
          field_key: { type: "string" },
          label: { type: "string" },
          value: { type: "string" },
          // Which vector of the signals network this node sits on. The center is
          // 'core'; the four arms are competitive/industry/persona/technology.
          // Competitor (battlecard) profiles set vector='core'.
          vector: { type: "string", enum: ["core", "competitive", "industry", "persona", "technology"] },
          // Distance from center: 3 = core (closest, highest weight), 2 = standard,
          // 1 = edge/adjacent (farthest).
          weight: { type: "integer", enum: [1, 2, 3] },
        },
        required: ["field_key", "label", "value", "vector", "weight"],
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
    // ---- gather evidence: signals (internal + external) ----------------------
    // Competitor scope sees only competitive signals; the central landscape
    // profile spans vectors, so it also sees market + frontier(capability)
    // signals as evidence (each tagged so the model routes it to the right
    // vector). At first run there are none — the records carry the profile.
    const { data: rawSigs } = await supabase
      .from("signals")
      .select("title, why, origin, conf_label, observed_at, metadata, competitor_id")
      .order("observed_at", { ascending: false, nullsFirst: false })
      .limit(160);
    const domainOf = (s: { metadata?: { domain?: string } | null; competitor_id?: string | null }) =>
      s.metadata?.domain ?? (s.competitor_id ? "competitive" : "signals");
    const LANDSCAPE_DOMAINS = new Set(["competitive", "market", "capability", "frontier"]);
    // deno-lint-ignore no-explicit-any
    let comp = ((rawSigs ?? []) as any[]).filter((s) =>
      scope === "competitor"
        ? (s.metadata?.domain === "competitive" || s.competitor_id)
        : LANDSCAPE_DOMAINS.has(domainOf(s)));
    if (scope === "competitor") comp = comp.filter((s) => (s.competitor_id ?? s.metadata?.competitor_id) === input.competitor_id);

    const fmt = (s: { title: string; why: string | null; origin: string; conf_label: string | null; metadata?: { domain?: string } | null; competitor_id?: string | null }) =>
      `• [${s.origin === "internal" ? "INTERNAL" : "EXTERNAL"}${s.conf_label ? `/${s.conf_label}` : ""}${scope === "landscape" ? `/${domainOf(s)}` : ""}] ${s.title}${s.why ? ` — ${s.why}` : ""}`;
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
        .in("field_key", ["icp", "pricing_model", "industries", "primary_persona"]);
      const g = (k: string) => gf?.find((f) => f.field_key === k)?.value;
      const messaging = await loadMessaging(supabase, gtmRec.id); // positioning/differentiation/value/win-themes live in the framework
      const gtmBits = [
        g("icp") && `Our ICP: ${g("icp")}`,
        g("industries") && `Our industries/verticals: ${g("industries")}`,        // feeds the MARKET vector
        g("primary_persona") && `Our primary persona(s): ${g("primary_persona")}`, // feeds the MARKET vector
        g("pricing_model") && `Our pricing model: ${g("pricing_model")}`,
        messaging && `OUR MESSAGING (from the messaging framework):\n${messaging}`,
      ].filter(Boolean).join("\n");
      if (gtmBits) context += `\n${gtmBits}`;
    }

    let target = "the overall competitive landscape and our place in it";
    let suggestedSections = "positioning, our_strengths, our_vulnerabilities, key_players, market_trends, strategic_implications";
    // THE SYNTHESIS GATE (landscape). Before signals are synthesized into themes,
    // the profile's job is purely DISCOVERY (what to find). Once synthesis has run,
    // it ALSO analyzes. Set from synthesized themes below.
    let synthesized = false;
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
      // LANDSCAPE = STEP ONE of the competitive workflow. It is grounded in OUR
      // product & GTM records (already in `context`) and its JOB is to FRAME the
      // competitive search: articulate where we play, the axes competition is
      // fought on, our wedge, and — most importantly — POINT the search at the
      // right rivals. It must work on the FIRST run, before ANY competitor,
      // battlecard, signal, or matrix exists. Downstream evidence (matrix,
      // battlecards, rival themes) is folded in ONLY as it accrues — it sharpens
      // the profile over time but is never required to build it.
      target = "our competitive positioning and where to aim the search for rivals — the records-grounded brief that DRIVES competitor discovery";
      const { data: comps } = await supabase.from("competitors").select("id, name, relationship");
      const tracked = comps?.length ?? 0;
      if (tracked) {
        const { data: caps } = await supabase.from("capabilities").select("id, name");
        const { data: scores } = await supabase.from("capability_scores").select("capability_id, competitor_id, score");
        if (caps?.length && scores?.length) {
          const sc = (capId: string, compId: string | null) => scores.find((s) => s.capability_id === capId && s.competitor_id === compId)?.score ?? 0;
          const lead = caps.filter((cap) => comps!.every((c) => sc(cap.id, c.id) < sc(cap.id, null)));
          const lag = caps.filter((cap) => comps!.some((c) => sc(cap.id, c.id) > sc(cap.id, null)));
          context += `\nMATRIX ROLL-UP (tracking ${tracked} rival${tracked === 1 ? "" : "s"}): we lead on ${lead.map((c) => c.name).join(", ") || "—"}; exposed on ${lag.map((c) => c.name).join(", ") || "—"}.`;
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
        context += `\n(Currently tracking ${tracked} rival${tracked === 1 ? "" : "s"} — fold what they reveal into the profile, but keep it grounded in our records.)`;
      } else {
        context += `\nNO COMPETITORS TRACKED YET. This is the FIRST pass: build the profile entirely from our product & GTM records. Its job here is to FRAME the hunt — say sharply where we play and what kind of rivals to go find — NOT to invent specific competitors or pretend to know how a market we haven't searched is moving.`;
      }
      // The gate: synthesized themes across ALL vectors (competitive, market,
      // frontier). Their existence flips the profile from discovery-only to
      // discovery + analysis. Each theme is tagged so the model routes it.
      const { data: synthThemes } = await supabase.from("signal_themes")
        .select("title, summary, recommendation, category, state, conf_level, competitor_id")
        .neq("state", "fading").order("last_evidence_at", { ascending: false, nullsFirst: false }).limit(24);
      synthesized = (synthThemes?.length ?? 0) > 0;
      if (synthesized) {
        context += `\nSYNTHESIZED THEMES (analysis is now LIVE — fold what these MEAN into the relevant vectors):\n${synthThemes!.map((t) => `[${t.category}/${t.state} · conf ${(t.conf_level ?? 0).toFixed(2)}] ${t.title} — ${t.summary ?? ""}${t.recommendation ? ` → ${t.recommendation}` : ""}`).join("\n")}`;
      }
      target = "our central SIGNALS NETWORK — the records-grounded map, organised as a CORE (what we are) + four weighted vectors, that aims discovery and analysis across every intelligence tab";
      // The signals network: a CENTER ('core') + four arms. Each node is tagged
      // with its vector AND a WEIGHT (3 = core/closest, 2 = standard, 1 = edge).
      // Weight = how central the node is: core features/personas/direct-rival
      // attributes weigh 3; lesser/adjacent/edge weigh 1. The tabs read their
      // vector to aim discovery; weight focuses it on the highest-signal nodes.
      suggestedSections = [
        "core (the CENTER — what we ARE in essence): essence, positioning, our_wedge. These are weight 3. Drawn straight from the records; every vector hangs off this.",
        "competitive vector — the attributes that pinpoint the RIGHT rivals: competitive_battlegrounds (capability areas/segments deals are contested on), competitive_search_focus (WHERE to look + the KIND of company — functional substitutes, not a tidy label), who_we_compete_with. WEIGHT: a defining head-on attribute / a direct rival archetype = 3; an adjacent or edge-case rival attribute = 1.",
        "industry vector — the verticals we serve: target_industries, industry_search_focus (publications, analyst coverage, regulators worth watching). WEIGHT: a core ICP vertical = 3; an occasional/edge vertical = 1.",
        "persona vector — the buyers/users we sell to: target_personas, persona_search_focus (the communities, forums, job boards, certifications where each persona's signal lives). WEIGHT: a core decision-making persona = 3; a peripheral influencer = 1.",
        "technology vector — frontier model/platform capabilities to watch that change what we can build or how: technology_watch. WEIGHT: a capability central to our build = 3; a peripheral one = 1.",
      ].join("\n");
    }

    const system = [
      `You maintain a HITL "Signal Profile" — a sharp, evidence-grounded record of ${target}. It is meant to DICTATE product and GTM strategy, so be decisive and specific, never generic.`,
      scope === "competitor"
        ? "For a competitor, this profile is the RAW BATTLECARD: the complete, honest dossier of who they are vs us, which the analyst refines into battlecard items and the messenger turns into GTM-ready copy for whatever motion the GTM record describes. Set vector='core' and weight=2 on EVERY field — vectors/weights only structure the central signals network, not a competitor dossier."
        : "This is the CENTRAL SIGNALS NETWORK, built FROM our product & GTM records — NOT a restatement of them (reference them, never copy them). It is a graph with a CENTER ('core' — what we ARE in essence) and four arms: 'competitive', 'industry', 'persona', 'technology'. Each intelligence tab reads its own vector to aim discovery & analysis. Set the right `vector` on every node, and a `weight` = how close to the center it sits: 3 = core (a defining attribute — a core feature, a core persona, a head-on rival attribute, a core vertical), 2 = standard, 1 = edge (adjacent/lesser). Weight is what focuses search on the RIGHT signals: the *_search_focus nodes name the SPECIFIC modules/segments/personas to search against and the KIND of source/company to look at (functional substitutes, not a tidy category label). Do NOT fabricate competitors, market movement, or momentum before evidence exists — when a vector has no signals yet, say plainly what to GO FIND.",
      "Synthesize the INTERNAL and EXTERNAL signals below (plus the records) into a headline + nodes. INTERNAL signals (what our own teams hear in the field) and EXTERNAL signals (public: reviews, launches, pricing) are both evidence; weigh corroboration across them and note where they disagree.",
      scope === "competitor"
        ? `Use these section keys where supported (snake_case): ${suggestedSections}. Always include a 'strategic_implications' section. Only assert what the evidence supports; if thin, say so and keep it short.`
        : `Build the network: a CORE plus nodes across all four vectors, each node tagged with its \`vector\`, an integer \`weight\` (3 core / 2 standard / 1 edge), and a snake_case field_key. Guide:\n${suggestedSections}\nGive each vector a few weight-3 nodes (the core attributes) and, where warranted, weight-2/1 nodes (standard/edge) — the spread is what lets search prioritise. Only assert what the records/evidence support; where a vector is thin, keep its nodes short and action-oriented (what to find), not padded.`,
      // The synthesis gate, made explicit to the model.
      scope === "landscape"
        ? (synthesized
            ? "SYNTHESIS HAS RUN — analysis is now LIVE. Beyond saying what to find, ANALYZE: fold what the synthesized themes MEAN into the relevant vectors (the patterns, how the market is moving, how we actually compare, what it implies for product & GTM). KEEP the *_search_focus nodes — discovery never stops — and ADD the analysis; add an 'analysis' node to a vector where its themes warrant it."
            : "SYNTHESIS HAS NOT RUN YET — this profile is in DISCOVERY mode. Say what to FIND and WHERE to look. Do NOT fabricate analysis, 'how we compare', or market movement from signals that haven't been gathered and synthesized; that analysis turns on only once synthesis has run.")
        : "",
      // Full & current — the user's standard: existence is not completeness.
      "Make EVERY section FULL and CURRENT. Re-evaluate each against the CURRENT product & GTM records and the latest signals/battlecards, and UPDATE it whenever they've moved — never leave a thin, vague, or stale section just because it already has text." + (input.current?.length ? " You are REFRESHING the existing profile (provided): fold the new evidence into each section and keep what still holds, but don't preserve a stale section just because a human wrote it — improve it." : ""),
    ].filter(Boolean).join("\n");

    const userText = [
      context ? `CONTEXT:\n${context}` : "",
      `\nINTERNAL ${scope === "landscape" ? "signals (tagged by vector/domain)" : "competitive signals"}:\n${internal || "(none logged yet)"}`,
      `\nEXTERNAL ${scope === "landscape" ? "signals (tagged by vector/domain)" : "competitive signals"}:\n${external || "(none logged yet)"}`,
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
    const draft = JSON.parse(block.text) as { headline: string; fields: { field_key: string; label: string; value: string; vector?: string; weight?: number }[] };
    return json({ draft, mode: scope === "landscape" ? (synthesized ? "analysis" : "discovery") : "competitor", evidence: { internal: comp.filter((s) => s.origin === "internal").length, external: comp.filter((s) => s.origin !== "internal").length } });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
