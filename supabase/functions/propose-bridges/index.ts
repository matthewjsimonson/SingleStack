// ============================================================================
// propose-bridges — find cross-lens Product↔GTM patterns.
//
// Plain English: reads the org's PRODUCT themes and GTM themes and asks the
// model where a product-side pattern and a gtm-side pattern are really one
// reality ("positioning works, but token economics is the build-side blocker").
// Each genuine connection becomes a PROPOSED bridge (product_theme + gtm_theme +
// a synthesized insight + a two-sided recommendation). It writes nothing as
// active — bridges land 'proposed' for the human to confirm or dismiss, exactly
// like high-judgment theme changes. Honest confidence (weaker leg) is computed
// by the DB, not the model.
//
// Conservative by design: only propose a bridge when the connection is real and
// non-obvious; skip pairs already bridged.
//
// Runs as the caller (JWT forwarded) → RLS scopes everything to their org.
// Secret: ANTHROPIC_API_KEY. Mirrors synthesize-signals conventions.
// ============================================================================

import Anthropic from "npm:@anthropic-ai/sdk@0.69.0";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const MODEL = "claude-opus-4-8";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "content-type": "application/json" } });

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    bridges: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          product_theme_id: { type: "string" },
          gtm_theme_id: { type: "string" },
          title: { type: "string" },
          insight: { type: "string" },         // what the two halves mean together
          recommendation: { type: "string" },  // the (usually two-sided) move
        },
        required: ["product_theme_id", "gtm_theme_id", "title", "insight", "recommendation"],
      },
    },
  },
  required: ["bridges"],
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
    const { data: orgId } = await supabase.rpc("current_org_id");
    if (!orgId) return json({ error: "could not resolve org" }, 400);

    // Both lenses of living themes (skip dismissed/dormant — bridges need life).
    const { data: themes } = await supabase
      .from("signal_themes").select("id, category, title, summary, recommendation, state")
      .neq("state", "dormant");
    const product = (themes ?? []).filter((t) => t.category === "product");
    const gtm = (themes ?? []).filter((t) => t.category === "gtm");
    if (product.length === 0 || gtm.length === 0) {
      return json({ bridges: 0, message: "Need at least one product theme and one gtm theme to find a bridge." });
    }

    // Pairs already bridged — don't re-propose.
    const { data: existing } = await supabase.from("bridges").select("product_theme_id, gtm_theme_id");
    const seen = new Set((existing ?? []).map((b) => `${b.product_theme_id}|${b.gtm_theme_id}`));

    const fmt = (t: { id: string; title: string; summary: string | null }) => `{id:${t.id}} ${t.title}${t.summary ? " — " + t.summary : ""}`;
    const system = [
      "You are a cross-lens strategist for SingleStack. You find BRIDGES: where a PRODUCT-side theme and a GTM-side theme are really one underlying reality.",
      "A bridge is the differentiated insight a siloed view misses (e.g. 'the positioning lands, but the build-side token economics is what kills adoption').",
      "Only propose a bridge when the connection is REAL and non-obvious — a true causal/strategic link, not a loose topical overlap. It's fine to return none.",
      "For each: pick one product_theme_id and one gtm_theme_id, write a tight title, an insight (what the two halves mean TOGETHER), and a recommendation that typically requires action on BOTH sides.",
    ].join("\n");

    const userMsg = [
      "PRODUCT THEMES:", product.map(fmt).join("\n") || "(none)",
      "", "GTM THEMES:", gtm.map(fmt).join("\n") || "(none)",
      "", "Propose only genuine cross-lens bridges.",
    ].join("\n");

    const anthropic = new Anthropic({ apiKey: key });
    const resp = (await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userMsg }],
      // deno-lint-ignore no-explicit-any
    } as any)) as Anthropic.Message;

    const block = resp.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new Error("no bridges returned");
    const parsed = JSON.parse(block.text) as { bridges?: { product_theme_id: string; gtm_theme_id: string; title: string; insight: string; recommendation: string }[] };

    const productIds = new Set(product.map((t) => t.id));
    const gtmIds = new Set(gtm.map((t) => t.id));
    const rows = (parsed.bridges ?? [])
      .filter((b) => productIds.has(b.product_theme_id) && gtmIds.has(b.gtm_theme_id))
      .filter((b) => !seen.has(`${b.product_theme_id}|${b.gtm_theme_id}`))
      .map((b) => ({
        org_id: orgId, title: b.title, insight: b.insight, recommendation: b.recommendation,
        state: "proposed", product_theme_id: b.product_theme_id, gtm_theme_id: b.gtm_theme_id,
      }));

    let created = 0;
    if (rows.length) {
      const { data, error } = await supabase.from("bridges").insert(rows).select("id");
      if (error) throw error;
      created = (data ?? []).length;
    }

    return json({ bridges: created });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
