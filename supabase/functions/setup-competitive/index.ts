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
import { logUsage } from "../_shared/ai_usage.ts";
import { resolveModelPolicy } from "../_shared/ai_policy.ts";
import { dispatch, type Progress } from "../_shared/progress.ts";

const MODEL = "claude-opus-5";
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

// The placement dimensions — the SAME axes a competitor search/placement uses.
// Each carries a weight; readiness is COMPUTED from per-dimension coverage, not
// guessed. This is the scoring + check system: auditable, reproducible.
// The placement dimensions — the axes a competitor search actually clusters on.
// Beyond what/who/positioning, RIVALS cluster by the jobs they do, the wedge that
// wins, how they price, and their motion — so those are first-class here. Each
// maps to a canonical record field where one exists (so answers also complete the
// record), and carries a weight; readiness is COMPUTED from coverage, not guessed.
const DIMENSIONS = [
  { key: "product",         label: "What it is",                  weight: 2 },
  { key: "features",        label: "Features / capabilities",     weight: 2 },
  { key: "use_cases",       label: "Use cases / jobs-to-be-done", weight: 1.5 },
  { key: "personas",        label: "Buyer personas",              weight: 2 },
  { key: "industries",      label: "Industries / verticals",      weight: 1.5 },
  { key: "segment",         label: "Segment (SMB/mid/ent)",       weight: 1 },
  { key: "positioning",     label: "Positioning / category",      weight: 2 },
  { key: "differentiation", label: "Differentiation / wedge",     weight: 1.5 },
  { key: "pricing",         label: "Pricing & packaging",         weight: 1 },
  // GTM motion here = how they MESSAGE & convince — value prop, the narrative,
  // the claims/proof they lead with (channel is a minor part). The strongest
  // dimension for matching rivals who talk to the same buyer the same way.
  { key: "gtm_motion",      label: "GTM motion — messaging & narrative", weight: 2 },
  { key: "known_rivals",    label: "Known rivals",                weight: 1.5 },
  { key: "deal_loss",       label: "Who they lose to",            weight: 1 },
] as const;
const DIM_KEYS = DIMENSIONS.map((d) => d.key);
const STATUS_SCORE: Record<string, number> = { covered: 1, partial: 0.5, missing: 0, not_applicable: 0 };

// The model ASSESSES coverage per dimension (with evidence + source); the
// function computes the score from ALL dimensions. No maturity "stages": an
// incomplete dimension honestly lowers the score — the profile is a living thing
// you keep current and grow, not a bar graded against an inferred stage.
const INTERVIEW_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    coverage: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          dimension: { type: "string", enum: DIM_KEYS },
          status: { type: "string", enum: ["covered", "partial", "missing"] },
          source: { type: "string", enum: ["records", "answer", "none"] },
          note: { type: "string" },   // the actual evidence (or why n/a)
        },
        required: ["dimension", "status", "source", "note"],
      },
    },
    next_dimension: { type: "string" },   // dim the next question targets, "" if none
    question: { type: "string" },         // "" when nothing worth asking
    why: { type: "string" },
  },
  required: ["coverage", "next_dimension", "question", "why"],
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
    // The FULL record fill: every canonical product/GTM field the records + interview
    // legitimately support, so setup leaves a complete product & GTM record (not just
    // the search context). Only real canonical keys; only what's grounded; omit the rest.
    record_updates: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          scope: { type: "string", enum: ["product", "gtm"] },
          field_key: { type: "string" },
          value: { type: "string" },
        },
        required: ["scope", "field_key", "value"],
      },
    },
  },
  required: ["picture", "product", "features", "who", "industries", "positioning", "more", "known_competitors", "record_updates"],
};

// The canonical record fields setup may fill, by scope. The model is held to THESE
// keys (anything else is dropped client-side) so updates land on real template
// fields, never an invented one. Mirrors lib/templates.ts.
const RECORD_FIELD_CATALOG = `PRODUCT record fields (scope "product"):
- what_it_is: a clear one-paragraph description of the product
- problem: the core problem it solves and why it matters now
- category: the market category it competes in
- strategic_intent: the bet — where this product takes the company
- core_capabilities: the handful of things the product does best
- differentiated_capabilities: capabilities competitors can't easily match
GTM record fields (scope "gtm"):
- primary_persona: the main person you sell to — role, goals, pains
- icp: the ideal customer profile — the accounts it's built for and how to qualify them
- positioning: how it's positioned vs the alternatives a buyer is weighing
- category_pov: your point of view on where the category is going and why now
- differentiation: the defensible wedge — why you win when you win
- value_prop: the core promise in one or two sentences
- pillars: the 2-4 message pillars all messaging ladders up to
- gtm_motion: how they go to market AND message — the narrative, the claims and proof they lead with, how they talk about themselves to convince a buyer (and the channel/motion)
- pricing_model: how it's packaged and priced, and how that shapes the motion
- win_themes: the recurring reasons you win`;

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
async function searchBriefing(supabase: SupabaseClient, key: string, sys: string, user: string): Promise<{ text: string; usage: { input: number; output: number } }> {
  const anthropic = new Anthropic({ apiKey: key });
  // Model-governed (the deliberate no-thinking speed budget is preserved — effort unchanged).
  const lp = await resolveModelPolicy(supabase, { task: "setup_competitive_landscape", fallback: { model: MODEL, effort: "high" } });
  // deno-lint-ignore no-explicit-any
  let messages: any[] = [{ role: "user", content: user }];
  let text = "";
  const usage = { input: 0, output: 0 };
  // BUDGETED HARD for latency + cost: ≤3 searches, ≤2 rounds, tight tokens,
  // no extended thinking. The briefing is for extraction, not prose.
  for (let i = 0; i < 2; i++) {
    const resp = (await anthropic.messages.create({
      model: lp.model,
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
  await logUsage(supabase, { task: "setup_competitive_landscape", model: lp.model, usage: { input_tokens: usage.input, output_tokens: usage.output } });
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
      const budget = Math.max(0, Math.min(10, Math.round(Number((body as { max_questions?: number }).max_questions) || 6)));
      const asked = transcript.filter((t) => t.role === "q").length;
      const pol = await resolveModelPolicy(supabase, { task: "setup_competitive_interview", fallback: { model: MODEL, effort: "medium" } });

      const ask = async (p: Progress) => {
        p.step("read", "Reading everything you've given it");
        p.done("read", `${transcript.length} answer${transcript.length === 1 ? "" : "s"} so far`);
        p.step("gap", "Spotting the most decisive gap");
        const streamed = anthropic.messages.stream({
          model: pol.model, max_tokens: 4000,
          output_config: { effort: pol.effort, format: { type: "json_schema", schema: INTERVIEW_SCHEMA } },
          system: [{ type: "text", cache_control: { type: "ephemeral" }, text: `You are SingleStack's competitive-profile interviewer. Your job: build a profile COMPLETE and ACCURATE enough that a search finds the RIGHT competitors. You report each dimension's status WITH EVIDENCE; the system computes readiness (don't invent a number).

  TEXT IS NOT TRUTH. A dimension is 'covered' ONLY if the records or an answer establish it FULLY, SPECIFICALLY, and ACCURATELY — a true, complete characterization. The mere existence of text does NOT make it covered: thin, generic, hedged, or MISCHARACTERIZED content is 'partial' or 'missing'. Re-examine EVERY dimension from scratch on every pass — never assume an area is done just because it has words in it. (Rubber-stamping every filled box is the exact failure you must avoid.)

  CHALLENGE THE PRODUCT CHARACTERIZATION above all else. The product, its buyers, and its industries are ENTIRELY whatever THIS user's records define — make NO assumption about category, motion, or what it does; this platform serves any product, so read it only from their fields, modules, and features. If the records describe the product narrowly — one tidy category label — but its MODULES & FEATURES show it does materially more, then 'product', 'positioning', 'use_cases', and 'differentiation' are NOT covered: the label is hiding what the product actually is, and that mischaracterization is exactly why the search returns the wrong rivals. Characterize the product by EVERYTHING it actually does — every module, feature, and job — not a convenient label, and ask the questions that pin that down.

  Assess EVERY dimension (one coverage entry each): ${DIMENSIONS.map((d) => `${d.key} (${d.label})`).join(", ")}.
  For each: status = covered (FULLY + ACCURATELY established) / partial (present but thin, generic, or only partly right) / missing (absent). source = records / answer / none. note = the actual evidence, TERSE (≤140 chars).

  WHY THESE DIMENSIONS — rivals cluster on more than what/who: the JOBS the product is hired for (functional substitutes), the WEDGE that wins deals, how it's PRICED & packaged, and its GTM MOTION — meaning how they MESSAGE and convince: the value prop, the narrative, the claims and proof they lead with, how they talk about themselves to win the buyer (not merely the sales channel). Two products that pitch the same story to the same buyer are direct rivals even if built differently. These are usually the records' weakest spots, so they're often where the highest-value questions are.

  LIVING PROFILE — there are NO maturity "stages" to grade against. Assess each dimension on its real evidence today; a young company will honestly have gaps (e.g. no deal-loss history yet) — mark those 'missing', don't excuse them. The profile is meant to be kept CURRENT and to GROW as the company learns more, so reflect exactly what's there now and let the score rise as it fills in.

  NEXT QUESTION — target the highest-WEIGHT dimension still 'missing' OR 'partial' that's worth asking (known rivals anchor the search — prioritize them early when missing). Write ONE specific, conversational question that pulls a CONCRETE answer — name the kind of detail you want (e.g. for pricing: "per-seat, usage, or platform fee — and what tier do most buyers land on?"; for GTM motion: "what's the core message and story you lead with to convince a buyer — the claims and the proof behind them?"). Sharpen a 'partial' as readily as you fill a 'missing'. If every weighted dimension is at least solidly covered, next_dimension='' and question=''. One question at a time.` }],
          messages: [{ role: "user", content: [
            // Stable for the whole interview — cached with the system prefix.
            { type: "text", cache_control: { type: "ephemeral" },
              text: records ? `THE RECORDS (everything already known):\n${records}` : "THE RECORDS: (none yet)" },
            // Grows every turn — must stay after the last breakpoint.
            { type: "text", text: [
              transcriptText ? `INTERVIEW SO FAR:\n${transcriptText}` : "INTERVIEW SO FAR: (not started)",
              `\nQUESTION BUDGET: ${budget} total; ${asked} already asked.`,
            ].join("\n\n") },
          ] }],
        // deno-lint-ignore no-explicit-any
        } as any);
        // deno-lint-ignore no-explicit-any
        for await (const ev of streamed as any) {
          if (ev.type === "content_block_delta" && ev.delta?.type === "thinking_delta" && ev.delta.thinking) p.think(ev.delta.thinking);
        }
        const resp = await streamed.finalMessage();
        const text = resp.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
        await logUsage(supabase, { task: "setup_competitive_interview", model: pol.model, usage: resp.usage });
      let out: { coverage: { dimension: string; status: string; source: string; note: string }[]; next_dimension: string; question: string; why: string };
      try { out = JSON.parse(text); }
      catch {
        // Truncated/invalid output must NOT block the flow: end the interview
        // gracefully so the picture step (the real synthesis) proceeds.
        p.done("gap", "ending the interview early");
        return { done: true, question: "", why: "", readiness: 75, gaps: "", coverage: [], partial: true };
      }
      // COMPUTE readiness from the assessed coverage — the actual score: weighted,
      // reproducible, auditable. EVERY dimension counts (no stage exemptions), so the
      // score is true completeness you keep growing, not a moving bar.
      const cov = (out.coverage ?? []).filter((c) => (DIM_KEYS as readonly string[]).includes(c.dimension));
      let num = 0, den = 0;
      for (const d of DIMENSIONS) {
        const status = cov.find((x) => x.dimension === d.key)?.status ?? "missing";
        den += d.weight; num += d.weight * (STATUS_SCORE[status] ?? 0);
      }
      const readiness = den > 0 ? Math.round((num / den) * 100) : 0;
      const labelOf = (k: string) => DIMENSIONS.find((d) => d.key === k)?.label ?? k;
      const weightOf = (k: string) => DIMENSIONS.find((d) => d.key === k)?.weight ?? 1;
      const gapsArr = cov.filter((c) => c.status === "missing" || c.status === "partial");
      const gaps = gapsArr.map((c) => labelOf(c.dimension)).join(", ");
      const budgetSpent = asked >= budget;
      const topGapWeight = Math.max(0, ...gapsArr.map((c) => weightOf(c.dimension)));
      // Done = budget spent, OR no worthwhile question, OR high score with no
      // high-weight gap left.
      const done = budgetSpent || !out.question?.trim() || (readiness >= 85 && topGapWeight < 1.5);
        p.done("gap", done ? "interview complete" : `readiness ${readiness}%`);
        return {
          done, question: done ? "" : out.question, why: out.why ?? "", readiness,
          gaps: budgetSpent && gapsArr.length ? `Budget reached — still thin: ${gaps}` : gaps,
          coverage: cov.map((c) => ({ ...c, label: labelOf(c.dimension), weight: weightOf(c.dimension) })),
        };
      };

      return dispatch((body as { stream?: boolean }).stream === true, CORS, ask);
    }

    if (step === "picture") {
      const pol = await resolveModelPolicy(supabase, { task: "setup_competitive_picture", fallback: { model: MODEL, effort: "medium" } });

      const paint = async (p: Progress) => {
        p.step("fold", "Folding the records and answers together");
        p.done("fold", `${transcript.length} interview turn${transcript.length === 1 ? "" : "s"}`);
        p.step("write", "Writing the full picture");
        const streamed = anthropic.messages.stream({
          model: pol.model, max_tokens: 4000,
          output_config: { effort: pol.effort, format: { type: "json_schema", schema: PICTURE_SCHEMA } },
          system: `Synthesize the records + interview into the FULL PICTURE of this product and its market — the brief a competitive researcher needs to find exactly the right rivals, AND a complete fill of the product & GTM records. picture = 1-2 tight paragraphs: what it is, who buys it (personas + industries + segment), how it positions and what it replaces, the features that win deals, and any deal-loss/competitor hints from the interview. The structured fields = the same content, distilled. known_competitors = every rival the user NAMED in the records or interview (comma-separated; empty string if none) — these seed and anchor the search.

  record_updates = the COMPLETE record fill. For EACH canonical field below that the records + interview legitimately support, emit { scope, field_key, value } with a crisp, record-ready value. This is how setup leaves a full, complete product & GTM record — the interview asks about product strategy, GTM motion, pricing, and positioning precisely so these get filled. Rules: use ONLY these exact field_keys; ground every value in the records/transcript (NO embellishment, no guessing); OMIT a field entirely if there's nothing real to say; prefer the user's own words. If a field already appears in THE RECORDS, only include it when the interview genuinely adds or sharpens it.

  ${RECORD_FIELD_CATALOG}`,
          messages: [{ role: "user", content: [
            records ? `THE RECORDS:\n${records}` : "THE RECORDS: (none)",
            transcriptText ? `THE INTERVIEW:\n${transcriptText}` : "",
          ].filter(Boolean).join("\n\n") }],
        // deno-lint-ignore no-explicit-any
        } as any);
        // deno-lint-ignore no-explicit-any
        for await (const ev of streamed as any) {
          if (ev.type === "content_block_delta" && ev.delta?.type === "thinking_delta" && ev.delta.thinking) p.think(ev.delta.thinking);
        }
        const resp = await streamed.finalMessage();
        const text = resp.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
        await logUsage(supabase, { task: "setup_competitive_picture", model: pol.model, usage: resp.usage });
        p.done("write");
        p.step("distil", "Distilling the profile fields");
        let picOut: unknown;
        try { picOut = JSON.parse(text); }
        catch {
          throw Object.assign(new Error("The picture came back incomplete — try '✦ Drill down' again, or search directly from your records."), { status: 502 });
        }
        p.done("distil", "queued for your review");
        return picOut;
      };

      return dispatch((body as { stream?: boolean }).stream === true, CORS, paint);
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
        supabase,
        key,
        `You are a competitive-landscape researcher. If the user NAMES known competitors in the market context, verify those FIRST (site, current positioning), then search beyond them. Use web search to identify the REAL competitors in the user's market — companies a buyer would actually evaluate against them. CHARACTERIZE THE USER'S PRODUCT BY EVERYTHING IT ACTUALLY DOES — its modules, features, and the full set of jobs across its whole scope — read ENTIRELY from their records; make NO assumption about its category, who it's for, or what industry (this tool serves any product). A single tidy category label usually understates the product and returns the wrong rivals; find the companies that compete on EACH major capability area it actually has, not just one label. Assess every candidate on FOUR dimensions: (1) buyer overlap — do they sell to the same personas? (2) industry overlap — same verticals? (3) capability overlap — which of the user's features/modules do they also offer? (4) positioning collision — do they claim the same category or replace the same thing? For each rival report: company name, homepage URL, head-on (direct) vs partial/adjacent, and the per-dimension read with what you found. For each rival also report their LinkedIn company page URL (linkedin.com/company/...) and a 2-3 sentence factual overview (who they are, what they sell, to whom) — URLs only from what you actually found, never constructed. Concrete and current. Return about ${target} rivals — the ones that genuinely matter MOST, not a directory dump; fewer high-overlap rivals beat a long thin list.`,
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
        supabase,
        key,
        `You are a competitive-landscape researcher. Use web search to identify the REAL competitors in the user's market — companies a buyer would actually evaluate against them. CHARACTERIZE THE USER'S PRODUCT BY EVERYTHING IT ACTUALLY DOES — its modules, features, and the full set of jobs across its whole scope — read ENTIRELY from their records; make NO assumption about its category, who it's for, or what industry (this tool serves any product). A single tidy category label usually understates the product and returns the wrong rivals; find the companies that compete on EACH major capability area it actually has, not just one label. Assess every candidate on FOUR dimensions: (1) buyer overlap — do they sell to the same personas? (2) industry overlap — same verticals? (3) capability overlap — which of the user's features/modules do they also offer? (4) positioning collision — do they claim the same category or replace the same thing? For each rival report: company name, homepage URL, head-on (direct) vs partial/adjacent, and the per-dimension read with what you found. For each rival also report their LinkedIn company page URL (linkedin.com/company/...) and a 2-3 sentence factual overview (who they are, what they sell, to whom) — URLs only from what you actually found, never constructed. Concrete and current. Return about ${target} rivals — the ones that genuinely matter MOST, not a directory dump; fewer high-overlap rivals beat a long thin list.`,
        [
          product.name ? `OUR PRODUCT: ${product.name}` : "",
          product.value_prop ? `VALUE PROP: ${product.value_prop}` : "",
          market ? `OUR MARKET (user's words): ${market}` : "",
          known.length ? `ALREADY TRACKED (skip these): ${known.join(", ")}` : "",
        ].filter(Boolean).join("\n"),
      )).text;
      if (!briefing) return json({ error: "The landscape search returned nothing — try describing the market more specifically." }, 502);

      const pol = await resolveModelPolicy(supabase, { task: "setup_competitive_competitors", fallback: { model: MODEL, effort: "medium" } });
      const resp = (await anthropic.messages.create({
        model: pol.model, max_tokens: 2000,
        output_config: { effort: pol.effort, format: { type: "json_schema", schema: COMPETITORS_SCHEMA } },
        system: "Extract the competitors from the research briefing into the schema. Keep only real, named companies with a clear competitive rationale. website = their homepage URL from the briefing ('' if absent). linkedin = their LinkedIn company page URL from the briefing ('' if absent) — NEVER constructed. overview = 2-3 factual sentences on who they are from the briefing. match = an HONEST 0..100 competitive-overlap score derived from the four dimensions in the briefing (buyer, industry, capability, positioning): head-on across all four ≈ 80-95; strong on two-three ≈ 50-75; adjacent/partial ≈ 25-50. Never inflate; if the briefing is thin on a dimension, score conservatively. overlap = one line naming which dimensions overlap and which don't (e.g. 'same buyer (PMM) + capability (battlecards); different industry focus, no unified record'). Do not invent companies not in the briefing.",
        messages: [{ role: "user", content: briefing }],
        // deno-lint-ignore no-explicit-any
      } as any)) as Anthropic.Message;
      const text = resp.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
      await logUsage(supabase, { task: "setup_competitive_competitors", model: pol.model, usage: resp.usage });
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
      // VERIFIED, not invented: web-ground the CATEGORY's standard evaluation
      // areas — the feature-function areas review sites and analysts actually
      // grid every vendor on — then extract them. This stops the matrix from
      // being self-referential niche rows.
      const caps = async (p: Progress) => {
        p.step("read", "Reading your category and confirmed rivals");
        p.done("read", rivalNames.length ? `${rivalNames.length} rival${rivalNames.length === 1 ? "" : "s"}` : "no rivals named yet");
        p.step("grade", "Checking how the category is actually graded");
        const { text: briefing } = await searchBriefing(
        supabase,
        key,
        `You are a software-category analyst. Identify the STANDARD capability / feature-function areas that buyers use to evaluate EVERY vendor in this category — the kind of rows a G2/Capterra feature grid or a Gartner/Forrester evaluation uses. Report 10-14 recognized, cross-vendor areas in INDUSTRY-STANDARD names (e.g. for CRM: pipeline & deal management, reporting & dashboards, workflow automation, integrations & API, mobile, security & compliance). These must apply to ALL the named rivals, not just one product. Avoid proprietary/marketing framings and hyper-niche rows.`,
        [
          market ? `THE MARKET / PRODUCT CONTEXT:\n${market}` : (product.name ? `Product: ${product.name}` : ""),
          product.value_prop ? `Value prop: ${product.value_prop}` : "",
          rivalNames.length ? `VENDORS IN THIS CATEGORY (the rows must apply to all): ${rivalNames.join(", ")}` : "",
        ].filter(Boolean).join("\n"),
      );
        p.done("grade");
        p.step("select", "Selecting standard, cross-vendor areas");
        const pol = await resolveModelPolicy(supabase, { task: "setup_competitive_capabilities", fallback: { model: MODEL, effort: "medium" } });
        const streamed = anthropic.messages.stream({
        model: pol.model, max_tokens: 3000,
        output_config: { effort: pol.effort, format: { type: "json_schema", schema: CAPABILITIES_SCHEMA } },
        system: `You build a competitive capability matrix from the analyst briefing below. Select the 8–12 best ROWS — each a STANDARD, INDUSTRY-RECOGNIZED feature-function area for this category that applies to EVERY vendor (so we can score us AND each rival on it). Rules: use the category's conventional names from the briefing, not our product's internal/proprietary language; one row per distinct capability AREA (map specific features into the standard area they belong to — do NOT make a row per niche feature); each row must be scoreable across all named rivals. Mostly product capability areas; include 2–3 gtm/commercial vectors only when they genuinely decide deals in this category (e.g. integrations/ecosystem, security & compliance, pricing/packaging). name = the short standard area label (2–5 words); why = one line on why buyers weigh it. No buzzword or fluff rows.`,
        messages: [{ role: "user", content: [
          `ANALYST BRIEFING (the category's standard evaluation areas):\n${briefing || "(none — fall back to the conventional areas for this category)"}`,
          market ? `\nOUR CONTEXT (for mapping our features to standard areas, NOT for inventing rows):\n${market}` : "",
          rivalNames.length ? `\nVENDORS THE ROWS MUST APPLY TO: ${rivalNames.join(", ")}` : "",
        ].filter(Boolean).join("\n") }],
        // deno-lint-ignore no-explicit-any
        } as any);
        // deno-lint-ignore no-explicit-any
        for await (const ev of streamed as any) {
          if (ev.type === "content_block_delta" && ev.delta?.type === "thinking_delta" && ev.delta.thinking) p.think(ev.delta.thinking);
        }
        const resp = await streamed.finalMessage();
        const text = resp.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
        await logUsage(supabase, { task: "setup_competitive_capabilities", model: pol.model, usage: resp.usage });
        let out: { capabilities: { name: string; category: string; why: string }[] };
        try { out = JSON.parse(text); }
        catch { throw Object.assign(new Error("The matrix-row proposal came back incomplete — try again."), { status: 502 }); }
        const capabilities = (out.capabilities ?? []).filter((c) => c.name?.trim()).map((c) => ({ ...c, name: c.name.trim(), category: c.category === "gtm" ? "gtm" : "product" }));
        p.done("select", `${capabilities.length} row${capabilities.length === 1 ? "" : "s"}`);
        return { capabilities };
      };

      return dispatch((body as { stream?: boolean }).stream === true, CORS, caps);
    }

    return json({ error: "step must be one of: interview, picture, landscape, competitors, capabilities" }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
