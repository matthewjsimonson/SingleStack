// ============================================================================
// setup-market — propose the RIGHT market watches, aligned to our actual offering.
//
// Market intel is industry × persona. But a company serves a RANGE of industries
// and personas, and a market signal only matters if it touches a segment we
// ACTUALLY serve WITH A REAL CAPABILITY. So this doesn't watch generic industry
// news — it keys off the INTERSECTION of (the GTM record's industries/personas) ×
// (the product's modules/features that serve them), and proposes a FEW sharply-
// aligned watches: each names the serving capability and aims at shifts that
// affect OUR offering for that segment.
//
// Returns proposals only (HITL). The client stands them up as sources
// (market_lens + config.{industry|persona}) + tracking_topics, and ignites pulls.
// Runs as caller (JWT) → RLS fences reads. Secret: ANTHROPIC_API_KEY.
// ============================================================================

import Anthropic from "npm:@anthropic-ai/sdk@0.69.0";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { logUsage } from "../_shared/ai_usage.ts";
import { loadMessagingMap } from "../_shared/messaging.ts";
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
    watches: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          lens: { type: "string", enum: ["industry", "persona", "analyst", "tech"] },
          value: { type: "string" },     // the specific segment, e.g. "Healthcare" / "Product leader"
          serves: { type: "string" },    // WHICH of our modules/features/capabilities serves this segment (the alignment)
          why: { type: "string" },       // why this watch matters to US specifically
          guidance: { type: "string" },  // the search aim, alignment-aware (what to surface, what to ignore)
          kinds: { type: "array", items: { type: "string", enum: ["press", "social", "reviews", "web_search"] } },
        },
        required: ["lens", "value", "serves", "why", "guidance", "kinds"],
      },
    },
    note: { type: "string" },   // one line on what was prioritized / left out, so coverage isn't silently capped
  },
  required: ["watches", "note"],
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
    const targetCount = Math.max(3, Math.min(12, Math.round(Number((body as { target?: number }).target) || 6)));

    // ---- our records: who we sell to (GTM) + what we actually build (product) ----
    const { data: prod } = await supabase.from("product_records").select("id, name").order("created_at").limit(1).maybeSingle();
    let category = "", whatItIs = "", modulesText = "";
    if (prod) {
      const { data: pf } = await supabase.from("record_fields").select("field_key, value").eq("product_id", prod.id).in("field_key", ["what_it_is", "value_prop", "category", "core_capabilities", "differentiated_capabilities"]);
      const f = (k: string) => pf?.find((x) => x.field_key === k)?.value ?? "";
      category = f("category"); whatItIs = f("what_it_is") || f("value_prop");
      const { data: mods } = await supabase.from("modules").select("id, name, description").eq("product_id", prod.id).order("position").order("created_at");
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
    let industries = "", personas = "", positioning = "", icp = "";
    const { data: gtm } = await supabase.from("gtm_records").select("id").order("created_at").limit(1).maybeSingle();
    if (gtm) {
      const { data: gf } = await supabase.from("record_fields").select("field_key, value").eq("gtm_record_id", gtm.id).in("field_key", ["industries", "primary_persona", "icp"]);
      const g = (k: string) => gf?.find((x) => x.field_key === k)?.value ?? "";
      industries = g("industries"); personas = g("primary_persona"); icp = g("icp");
      const msg = await loadMessagingMap(supabase, gtm.id); // positioning now lives in the messaging framework
      positioning = msg["positioning_statement"] || msg["strategic_narrative"] || "";
    }
    if (!modulesText && !whatItIs && !industries) {
      return json({ error: "Your product & GTM records are too sparse to align market watches. Fill them in (Set up with AI), then come back." }, 422);
    }

    // ---- the central signals profile's MARKET vector — the curated where-to-look
    // that AIMS this. The profile drives discovery; fold its market nodes in. ----
    let profileMarket = "";
    const { data: prof } = await supabase.from("signal_profiles").select("id").eq("scope", "landscape").is("competitor_id", null).maybeSingle();
    if (prof) {
      const { data: pfs } = await supabase.from("signal_profile_fields").select("label, value, vector, weight").eq("profile_id", prof.id);
      // The market vector (and core) aims the watches; weight = applicability
      // (direct → adjacent → indirect), so direct segments/personas lead.
      // Legacy 'industry'/'persona' vector values still count as market.
      profileMarket = (pfs ?? []).filter((f) => (f.vector === "market" || f.vector === "industry" || f.vector === "persona" || f.vector === "core") && f.value?.trim())
        .sort((a, b) => ((b.weight as number) ?? 2) - ((a.weight as number) ?? 2))
        .map((f) => `- [${((f.weight as number) ?? 2) >= 3 ? "direct" : ((f.weight as number) ?? 2) <= 1 ? "indirect" : "adjacent"} · ${f.vector}] ${f.label}: ${f.value}`).join("\n");
    }

    // ---- existing market watches, so we don't re-propose ----
    const { data: have } = await supabase.from("sources").select("label, market_lens").not("market_lens", "is", null);
    const existing = (have ?? []).map((s) => s.label).join("; ");

    const system = [
      "You design a FOCUSED set of market-intelligence watches for a product. Market intel is industry × persona — but a product serves a RANGE of segments, and a market signal only matters if it touches a segment WE ACTUALLY SERVE WITH A REAL CAPABILITY.",
      "So DO NOT propose generic industry/persona news. Key every watch off the INTERSECTION of (the industries/personas in our GTM record) and (the modules/features that serve them). For EACH watch: name the specific segment (value), name WHICH of our modules/features/capabilities serves it (serves), and write guidance that aims the search at shifts affecting OUR offering for that segment — regulation, buying behavior, budget, substitutes, persona tooling/job changes — while ignoring generic noise.",
      `Be RUTHLESSLY focused: propose at most ${targetCount} watches — the segments that are core ICP AND capability-backed. If we list 15 industries, watch the few that matter most; say what you left out in 'note'. A few aligned watches beat broad coverage that floods the feed.`,
      "Lenses: 'industry' (a vertical we serve), 'persona' (a buyer/user we serve), 'analyst' (category coverage e.g. Gartner/Forrester for our category), 'tech' (category/platform shifts that change what buyers expect). kinds = which live search-backed sources fit (press, social, reviews, web_search).",
      "Ground everything in the records below. Never invent a segment we don't serve or a capability we don't have.",
      "If a SIGNALS PROFILE (market vector) is provided, treat it as the curated AIM — prioritize the [direct·…] segments and personas and the specific sources/communities it names; it is the user's own where-to-look.",
    ].join("\n");

    const userText = [
      `OUR PRODUCT: ${prod?.name ?? "(unnamed)"}${category ? ` · category: ${category}` : ""}`,
      whatItIs ? `What it is: ${whatItIs}` : "",
      modulesText ? `MODULES & FEATURES (what we actually build — use this to decide which segments we can really serve):\n${modulesText}` : "(no modules/features recorded)",
      positioning ? `Positioning: ${positioning}` : "",
      `\nWHO WE SELL TO (GTM record):`,
      industries ? `Industries / verticals: ${industries}` : "Industries: (not specified)",
      personas ? `Primary persona(s): ${personas}` : "",
      icp ? `ICP: ${icp}` : "",
      profileMarket ? `\nFROM OUR SIGNALS PROFILE — the market vector, graded by applicability (lean hardest on [direct], least on [indirect]; aim the watches at exactly these segments & sources):\n${profileMarket}` : "",
      existing ? `\nAlready watched (don't duplicate): ${existing}` : "",
      `\nPropose up to ${targetCount} aligned market watches now.`,
    ].filter(Boolean).join("\n");

    const anthropic = new Anthropic({ apiKey: key });
    const pol = await resolveModelPolicy(supabase, { task: "setup_market", fallback: { model: MODEL, effort: "high" } });
    const message = (await anthropic.messages.create({
      model: pol.model, max_tokens: 6000,
      thinking: { type: "adaptive" },
      output_config: { effort: pol.effort, format: { type: "json_schema", schema: SCHEMA } },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userText }],
      // deno-lint-ignore no-explicit-any
    } as any)) as Anthropic.Message;
    await logUsage(supabase, { task: "setup_market", model: pol.model, usage: message.usage });

    const block = message.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new Error(`no watches returned (stop_reason: ${message.stop_reason})`);
    const out = JSON.parse(block.text) as { watches: unknown[]; note: string };
    return json(out);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
