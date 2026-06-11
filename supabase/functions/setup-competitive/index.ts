// ============================================================================
// setup-competitive — the AI half of the guided competitive-intel setup.
//
// Plain English: the setup wizard asks this function for PROPOSALS, never
// writes. Two steps:
//   • competitors  — web-searches the user's market (product + value prop +
//     the market they describe) and proposes real rivals: name, website,
//     direct/adjacent, and why they matter. Citation-grounded, not guessed.
//   • capabilities — proposes the matrix rows (the functionality vectors worth
//     comparing on) from the product, the market, and the confirmed rivals.
//
// HITL is absolute: this returns candidates; the human confirms/edits/discards
// each one in the wizard, and the WIZARD does the inserts as the user (RLS).
// Mirrors source-recipe conventions: caller's JWT, no DB writes, no secrets in
// the response. Secret: ANTHROPIC_API_KEY.
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

const COMPETITORS_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    competitors: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          name: { type: "string" },
          website: { type: "string" },         // homepage URL, or "" when unknown
          relationship: { type: "string", enum: ["direct", "adjacent"] },
          match: { type: "integer" },          // 0..100 — honest competitive-overlap score
          why: { type: "string" },             // one line: why they're a rival
          overlap: { type: "string" },         // the dimensions: buyer / industry / capability / positioning — which overlap, which don't
        },
        required: ["name", "website", "relationship", "match", "why", "overlap"],
      },
    },
  },
  required: ["competitors"],
};

const CAPABILITIES_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    capabilities: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          name: { type: "string" },            // short row label, e.g. "SSO & enterprise auth"
          category: { type: "string", enum: ["product", "gtm"] },
          why: { type: "string" },             // one line: why this vector decides deals
        },
        required: ["name", "category", "why"],
      },
    },
  },
  required: ["capabilities"],
};

// Web-search loop (same pause_turn pattern as connector-runner): returns one
// citation-grounded briefing the structured pass then extracts from.
async function searchBriefing(key: string, sys: string, user: string): Promise<string> {
  const anthropic = new Anthropic({ apiKey: key });
  // deno-lint-ignore no-explicit-any
  let messages: any[] = [{ role: "user", content: user }];
  let text = "";
  for (let i = 0; i < 5; i++) {
    const resp = (await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8 }],
      system: [{ type: "text", text: sys }],
      messages,
      // deno-lint-ignore no-explicit-any
    } as any)) as Anthropic.Message;
    for (const b of resp.content) if (b.type === "text") text += b.text + "\n";
    if (resp.stop_reason === "pause_turn") { messages = [...messages, { role: "assistant", content: resp.content }]; continue; }
    break;
  }
  return text.trim();
}

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
    const step = body.step as string | undefined;
    const product = (body.product ?? {}) as { name?: string; value_prop?: string };
    const market = (body.market as string | undefined)?.trim() || "";
    const anthropic = new Anthropic({ apiKey: key });

    if (step === "competitors") {
      if (!market && !product.name) return json({ error: "Describe your market (or name your product) so the search has an aim." }, 400);
      // Don't re-propose rivals the org already tracks.
      const { data: existing } = await supabase.from("competitors").select("name");
      const known = (existing ?? []).map((c) => c.name);

      const briefing = await searchBriefing(
        key,
        "You are a competitive-landscape researcher. Use web search to identify the REAL competitors in the user's market — companies a buyer would actually evaluate against them. Assess every candidate on FOUR dimensions: (1) buyer overlap — do they sell to the same personas? (2) industry overlap — same verticals? (3) capability overlap — which of the user's features/modules do they also offer? (4) positioning collision — do they claim the same category or replace the same thing? For each rival report: company name, homepage URL, head-on (direct) vs partial/adjacent, and the per-dimension read with what you found. Concrete and current — cite what you find. 6–10 rivals that genuinely matter, not a directory dump.",
        [
          product.name ? `OUR PRODUCT: ${product.name}` : "",
          product.value_prop ? `VALUE PROP: ${product.value_prop}` : "",
          market ? `OUR MARKET (user's words): ${market}` : "",
          known.length ? `ALREADY TRACKED (skip these): ${known.join(", ")}` : "",
        ].filter(Boolean).join("\n"),
      );
      if (!briefing) return json({ error: "The landscape search returned nothing — try describing the market more specifically." }, 502);

      const resp = (await anthropic.messages.create({
        model: MODEL, max_tokens: 2500,
        output_config: { effort: "medium", format: { type: "json_schema", schema: COMPETITORS_SCHEMA } },
        system: "Extract the competitors from the research briefing into the schema. Keep only real, named companies with a clear competitive rationale. website = their homepage URL from the briefing ('' if absent). match = an HONEST 0..100 competitive-overlap score derived from the four dimensions in the briefing (buyer, industry, capability, positioning): head-on across all four ≈ 80-95; strong on two-three ≈ 50-75; adjacent/partial ≈ 25-50. Never inflate; if the briefing is thin on a dimension, score conservatively. overlap = one line naming which dimensions overlap and which don't (e.g. 'same buyer (PMM) + capability (battlecards); different industry focus, no unified record'). Do not invent companies not in the briefing.",
        messages: [{ role: "user", content: briefing }],
        // deno-lint-ignore no-explicit-any
      } as any)) as Anthropic.Message;
      const text = resp.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
      const out = JSON.parse(text) as { competitors: { name: string; website: string; relationship: string; match: number; why: string; overlap: string }[] };
      const knownLower = new Set(known.map((n) => n.toLowerCase()));
      const competitors = (out.competitors ?? [])
        .filter((c) => c.name?.trim() && !knownLower.has(c.name.trim().toLowerCase()))
        .map((c) => ({ ...c, name: c.name.trim(), relationship: c.relationship === "adjacent" ? "adjacent" : "direct",
          match: Math.min(100, Math.max(0, Math.round(Number((c as { match?: number }).match) || 0))) }))
        .sort((a, b) => b.match - a.match);
      return json({ competitors, briefing });
    }

    if (step === "capabilities") {
      const rivalNames = (Array.isArray(body.competitors) ? body.competitors : []).filter((n: unknown) => typeof n === "string") as string[];
      const resp = (await anthropic.messages.create({
        model: MODEL, max_tokens: 2500,
        thinking: { type: "adaptive" },
        output_config: { effort: "high", format: { type: "json_schema", schema: CAPABILITIES_SCHEMA } },
        system: "You design competitive capability matrices for product & GTM teams. Propose the 8–12 capability rows (functionality vectors) this team should compare themselves against rivals on — the dimensions that actually decide deals in their market. Mostly product capabilities; include 2–3 gtm vectors (e.g. pricing transparency, ecosystem/integrations, enterprise readiness) when they decide deals. Each: a short row label (3–5 words, matrix-friendly) and one line on why it decides deals. No fluff rows.",
        messages: [{ role: "user", content: [
          product.name ? `OUR PRODUCT: ${product.name}` : "",
          product.value_prop ? `VALUE PROP: ${product.value_prop}` : "",
          market ? `MARKET: ${market}` : "",
          rivalNames.length ? `CONFIRMED RIVALS: ${rivalNames.join(", ")}` : "",
        ].filter(Boolean).join("\n") || "Propose a general-purpose B2B SaaS capability matrix." }],
        // deno-lint-ignore no-explicit-any
      } as any)) as Anthropic.Message;
      const text = resp.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
      const out = JSON.parse(text) as { capabilities: { name: string; category: string; why: string }[] };
      const capabilities = (out.capabilities ?? []).filter((c) => c.name?.trim()).map((c) => ({ ...c, name: c.name.trim(), category: c.category === "gtm" ? "gtm" : "product" }));
      return json({ capabilities });
    }

    return json({ error: "step must be 'competitors' or 'capabilities'" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
