// ============================================================================
// setup-competitive — the AI half of the guided competitive-intel setup.
//
// Plain English: the setup wizard asks this function for PROPOSALS, never
// writes. Four steps:
//   • interview    — reads EVERYTHING the records already say (all product +
//     GTM fields + modules) and asks the single most discriminating question
//     the records DON'T answer — chat-like, one at a time, done when specific.
//   • picture      — synthesizes records + interview answers into the full
//     picture of the product/market the human approves before search runs.
//   • competitors  — web-searches the market and proposes real rivals with an
//     honest match % across four overlap dimensions. Citation-grounded.
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
          website: { type: "string" },         // homepage URL from the briefing, or "" — never invented
          linkedin: { type: "string" },        // linkedin.com/company/... URL from the briefing, or "" — never invented
          overview: { type: "string" },        // 2-3 factual sentences: who they are, what they sell, to whom
          relationship: { type: "string", enum: ["direct", "adjacent"] },
          match: { type: "integer" },          // 0..100 — honest competitive-overlap score
          why: { type: "string" },             // one line: why they're a rival
          overlap: { type: "string" },         // the dimensions: buyer / industry / capability / positioning — which overlap, which don't
        },
        required: ["name", "website", "linkedin", "overview", "relationship", "match", "why", "overlap"],
      },
    },
  },
  required: ["competitors"],
};

const INTERVIEW_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    done: { type: "boolean" },      // true = enough specificity; stop asking
    question: { type: "string" },   // the next question ("" when done)
    why: { type: "string" },        // one line: why this question sharpens the competitor search
    readiness: { type: "integer" }, // 0..100 — how precisely a competitor search could run RIGHT NOW
    gaps: { type: "string" },       // what's still thin, one line ("" when nothing material)
  },
  required: ["done", "question", "why", "readiness", "gaps"],
};

const PICTURE_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    picture: { type: "string" },      // the full narrative picture (markdown, 1-2 tight paragraphs)
    product: { type: "string" },      // what it is, one line
    features: { type: "string" },     // key features/modules, semicolon list
    who: { type: "string" },          // personas
    industries: { type: "string" },   // verticals
    positioning: { type: "string" },  // category claim / what it replaces
    more: { type: "string" },         // anything else competitive-relevant ("" if none)
    known_competitors: { type: "string" }, // rivals the user NAMED in records/interview ("" if none)
  },
  required: ["picture", "product", "features", "who", "industries", "positioning", "more", "known_competitors"],
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
async function searchBriefing(key: string, sys: string, user: string): Promise<{ text: string; usage: { input: number; output: number } }> {
  const anthropic = new Anthropic({ apiKey: key });
  // deno-lint-ignore no-explicit-any
  let messages: any[] = [{ role: "user", content: user }];
  let text = "";
  const usage = { input: 0, output: 0 };
  // BUDGETED HARD for latency + cost: ≤3 searches, ≤2 rounds, tight tokens,
  // no extended thinking. The briefing is for extraction, not prose.
  for (let i = 0; i < 2; i++) {
    const resp = (await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2200,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }],
      system: [{ type: "text", text: sys + " BE FAST: run at most 3 focused searches, then write the briefing immediately — terse bullets, no prose padding." }],
      messages,
      // deno-lint-ignore no-explicit-any
    } as any)) as Anthropic.Message;
    usage.input += resp.usage?.input_tokens ?? 0;
    usage.output += resp.usage?.output_tokens ?? 0;
    for (const b of resp.content) if (b.type === "text") text += b.text + "\n";
    if (resp.stop_reason === "pause_turn") { messages = [...messages, { role: "assistant", content: resp.content }]; continue; }
    break;
  }
  return { text: text.trim().slice(0, 12_000), usage };
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

    const records = (body.records as string | undefined)?.trim() || "";
    const transcript = (Array.isArray(body.transcript) ? body.transcript : []) as { role: string; text: string }[];
    const transcriptText = transcript.map((t) => `${t.role === "q" ? "AI asked" : "User answered"}: ${t.text}`).join("\n");

    if (step === "interview") {
      const budget = Math.max(0, Math.min(8, Math.round(Number((body as { max_questions?: number }).max_questions) || 4)));
      const asked = transcript.filter((t) => t.role === "q").length;
      // Hard stop server-side too: budget spent → done, no question.
      if (asked >= budget) {
        return json({ done: true, question: "", why: "", readiness: 80, gaps: "Question budget reached — searching from the records + your answers." });
      }
      const resp = (await anthropic.messages.create({
        model: MODEL, max_tokens: 1200,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium", format: { type: "json_schema", schema: INTERVIEW_SCHEMA } },
        system: `You are doing competitive-intelligence intake. You have everything the user's records already say, plus the interview so far. Ask the SINGLE most discriminating question the records do NOT answer — the one whose answer most changes WHO their real competitors are. High-value angles when missing: deal-deciding personas, industries/verticals served, segment (SMB/mid/enterprise), deployment model, price band, geography, who they actually lose deals to today, WHICH COMPETITORS THEY ALREADY KNOW THEY FACE (always worth asking early — named rivals anchor the whole search), and which feature wins deals. MATURITY MODEL: first infer the company's stage from the records/transcript (exploring = pre-launch; early = first users/deals; scaling = repeatable motion; established = mature) — ask ONE stage question only if you can't infer it. Then never ask a question the stage can't answer: no deal-loss or win-rate questions pre-revenue, no pricing-history questions pre-pricing; for young companies favor intended buyer, the alternative people use today, and the wedge. GOVERNANCE — read the records FIRST and DEFER to them hard: the GTM and product records usually answer product, personas, positioning, ICP, and more. Do NOT ask anything the records or transcript already answer, even loosely — re-asking is the failure mode to avoid. You have a QUESTION BUDGET of ${budget} (you have already asked ${asked}); set done=true the instant the budget is spent OR the records + answers are enough — whichever comes first. Ask only the single highest-value gap that the records genuinely leave open. One question at a time, conversational and concrete. ALWAYS score readiness (0..100): how precisely could a competitor search run RIGHT NOW on what's known? Calibrate across the dimensions that decide rivals — product+features, personas, industries, segment, positioning, deal-loss hints: all strong ≈ 85-95; most covered ≈ 65-80; basics only ≈ 35-55 — GRADED FOR THE STAGE: an exploring-stage company with crisp identity + intended buyer + the alternative they replace can hit 80+ without deal history. Honest, monotonic with information (an answer never lowers it). gaps = one plain line on what's still thin ('' when nothing material). Set done=true when readiness ≥ 80 or further questions would add little.`,
        messages: [{ role: "user", content: [
          records ? `THE RECORDS (everything already known):\n${records}` : "THE RECORDS: (none yet)",
          transcriptText ? `INTERVIEW SO FAR:\n${transcriptText}` : "INTERVIEW SO FAR: (not started)",
        ].join("\n\n") }],
        // deno-lint-ignore no-explicit-any
      } as any)) as Anthropic.Message;
      const text = resp.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
      return json(JSON.parse(text));
    }

    if (step === "picture") {
      const resp = (await anthropic.messages.create({
        model: MODEL, max_tokens: 2000,
        thinking: { type: "adaptive" },
        output_config: { effort: "high", format: { type: "json_schema", schema: PICTURE_SCHEMA } },
        system: "Synthesize the records + interview into the FULL PICTURE of this product and its market — the brief a competitive researcher needs to find exactly the right rivals. picture = 1-2 tight paragraphs: what it is, who buys it (personas + industries + segment), how it positions and what it replaces, the features that win deals, and any deal-loss/competitor hints from the interview. The structured fields = the same content, distilled. known_competitors = every rival the user NAMED in the records or interview (comma-separated; empty string if none) — these seed and anchor the search. Ground every claim in the records/transcript — no embellishment.",
        messages: [{ role: "user", content: [
          records ? `THE RECORDS:\n${records}` : "THE RECORDS: (none)",
          transcriptText ? `THE INTERVIEW:\n${transcriptText}` : "",
        ].filter(Boolean).join("\n\n") }],
        // deno-lint-ignore no-explicit-any
      } as any)) as Anthropic.Message;
      const text = resp.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
      return json(JSON.parse(text));
    }

    // landscape: the LONG half (live web search) as its own request, so no
    // single call flirts with the function wall-clock; the client then sends
    // the briefing to 'competitors' for extraction (short), retrying each
    // phase independently.
    const target = Math.max(3, Math.min(15, Math.round(Number((body as { target_matches?: number }).target_matches) || 8)));
    if (step === "landscape") {
      if (!market && !product.name) return json({ error: "Describe your market (or name your product) so the search has an aim." }, 400);
      const { data: existing } = await supabase.from("competitors").select("name");
      const known = (existing ?? []).map((c) => c.name);
      const { text: briefing, usage } = await searchBriefing(
        key,
        `You are a competitive-landscape researcher. If the user NAMES known competitors in the market context, verify those FIRST (site, current positioning), then search beyond them. Use web search to identify the REAL competitors in the user's market — companies a buyer would actually evaluate against them. Assess every candidate on FOUR dimensions: (1) buyer overlap — do they sell to the same personas? (2) industry overlap — same verticals? (3) capability overlap — which of the user's features/modules do they also offer? (4) positioning collision — do they claim the same category or replace the same thing? For each rival report: company name, homepage URL, head-on (direct) vs partial/adjacent, and the per-dimension read with what you found. For each rival also report their LinkedIn company page URL (linkedin.com/company/...) and a 2-3 sentence factual overview (who they are, what they sell, to whom) — URLs only from what you actually found, never constructed. Concrete and current. Return about ${target} rivals — the ones that genuinely matter MOST, not a directory dump; fewer high-overlap rivals beat a long thin list.`,
        [
          product.name ? `OUR PRODUCT: ${product.name}` : "",
          product.value_prop ? `VALUE PROP: ${product.value_prop}` : "",
          market ? `OUR MARKET (user's words): ${market}` : "",
          known.length ? `ALREADY TRACKED (skip these): ${known.join(", ")}` : "",
        ].filter(Boolean).join("\n"),
      );
      if (!briefing) return json({ error: "The landscape search returned nothing — try describing the market more specifically." }, 502);
      return json({ briefing, usage });
    }

    if (step === "competitors") {
      if (!market && !product.name) return json({ error: "Describe your market (or name your product) so the search has an aim." }, 400);
      // Don't re-propose rivals the org already tracks.
      const { data: existing } = await supabase.from("competitors").select("name");
      const known = (existing ?? []).map((c) => c.name);

      // Two-phase path: the client passes the landscape briefing; only when
      // absent do we search inline (backward-compatible single-call mode).
      const briefing = (body.briefing as string | undefined)?.trim() || (await searchBriefing(
        key,
        `You are a competitive-landscape researcher. Use web search to identify the REAL competitors in the user's market — companies a buyer would actually evaluate against them. Assess every candidate on FOUR dimensions: (1) buyer overlap — do they sell to the same personas? (2) industry overlap — same verticals? (3) capability overlap — which of the user's features/modules do they also offer? (4) positioning collision — do they claim the same category or replace the same thing? For each rival report: company name, homepage URL, head-on (direct) vs partial/adjacent, and the per-dimension read with what you found. For each rival also report their LinkedIn company page URL (linkedin.com/company/...) and a 2-3 sentence factual overview (who they are, what they sell, to whom) — URLs only from what you actually found, never constructed. Concrete and current. Return about ${target} rivals — the ones that genuinely matter MOST, not a directory dump; fewer high-overlap rivals beat a long thin list.`,
        [
          product.name ? `OUR PRODUCT: ${product.name}` : "",
          product.value_prop ? `VALUE PROP: ${product.value_prop}` : "",
          market ? `OUR MARKET (user's words): ${market}` : "",
          known.length ? `ALREADY TRACKED (skip these): ${known.join(", ")}` : "",
        ].filter(Boolean).join("\n"),
      )).text;
      if (!briefing) return json({ error: "The landscape search returned nothing — try describing the market more specifically." }, 502);

      const resp = (await anthropic.messages.create({
        model: MODEL, max_tokens: 2000,
        output_config: { effort: "medium", format: { type: "json_schema", schema: COMPETITORS_SCHEMA } },
        system: "Extract the competitors from the research briefing into the schema. Keep only real, named companies with a clear competitive rationale. website = their homepage URL from the briefing ('' if absent). linkedin = their LinkedIn company page URL from the briefing ('' if absent) — NEVER constructed. overview = 2-3 factual sentences on who they are from the briefing. match = an HONEST 0..100 competitive-overlap score derived from the four dimensions in the briefing (buyer, industry, capability, positioning): head-on across all four ≈ 80-95; strong on two-three ≈ 50-75; adjacent/partial ≈ 25-50. Never inflate; if the briefing is thin on a dimension, score conservatively. overlap = one line naming which dimensions overlap and which don't (e.g. 'same buyer (PMM) + capability (battlecards); different industry focus, no unified record'). Do not invent companies not in the briefing.",
        messages: [{ role: "user", content: briefing }],
        // deno-lint-ignore no-explicit-any
      } as any)) as Anthropic.Message;
      const text = resp.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
      const out = JSON.parse(text) as { competitors: { name: string; website: string; linkedin: string; overview: string; relationship: string; match: number; why: string; overlap: string }[] };
      const knownLower = new Set(known.map((n) => n.toLowerCase()));
      const competitors = (out.competitors ?? [])
        .filter((c) => c.name?.trim() && !knownLower.has(c.name.trim().toLowerCase()))
        .map((c) => ({ ...c, name: c.name.trim(), relationship: c.relationship === "adjacent" ? "adjacent" : "direct",
          match: Math.min(100, Math.max(0, Math.round(Number((c as { match?: number }).match) || 0))) }))
        .sort((a, b) => b.match - a.match)
        .slice(0, Math.min(15, target + 2));   // governed cap per run
      return json({ competitors, usage: { input: resp.usage?.input_tokens ?? 0, output: resp.usage?.output_tokens ?? 0 } });
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

    return json({ error: "step must be one of: interview, picture, landscape, competitors, capabilities" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
