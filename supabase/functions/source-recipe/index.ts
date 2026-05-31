// ============================================================================
// source-recipe — the Source Recipe Builder (CONNECTIVITY.md Tier A).
//
// The non-technical user has an obscure signal they want ("tell me when Acme
// changes pricing or starts hiring senior sales reps"). They should NOT have to
// build an MCP server. Instead, Claude turns their plain-English intent into a
// runner-ready SOURCE CONFIG — the same shape the connector-runner already
// consumes (kind, url, targets, guidance, include/exclude, focus, cadence,
// budget). Safe: it emits CONFIG, never code; nothing new executes.
//
// Returns a recipe the UI pre-fills into the connect form for the user to
// confirm — plus one clarifying question if the intent is ambiguous. Runs as the
// caller (JWT → RLS). Secret: ANTHROPIC_API_KEY.
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

// Kinds the builder may choose — kept in sync with web/lib/sources.ts. Kinds
// flagged liveNow run for real today; others are configured now, pull when their
// credential connector lands. The builder is honest about which is which.
const KINDS = [
  { kind: "website", liveNow: true, note: "any public web page — pricing, blog, changelog, docs" },
  { kind: "youtube", liveNow: true, note: "a public video / channel — transcript & metadata" },
  { kind: "linkedin_posts", liveNow: false, note: "a company/person's posts" },
  { kind: "linkedin_jobs", liveNow: false, note: "a company's open roles (hiring signal)" },
  { kind: "github", liveNow: false, note: "repos/releases (shipping pace)" },
  { kind: "reviews", liveNow: false, note: "G2/TrustRadius reviews & ratings" },
  { kind: "web_search", liveNow: false, note: "ongoing web/news monitoring" },
  { kind: "social", liveNow: false, note: "X/Reddit posts" },
  { kind: "crm", liveNow: false, note: "deals/win-loss" },
  { kind: "support", liveNow: false, note: "tickets" },
  { kind: "analytics", liveNow: false, note: "usage data" },
];

const SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    recipe: {
      type: "object", additionalProperties: false,
      properties: {
        kind: { type: "string", enum: KINDS.map((k) => k.kind) },
        label: { type: "string" },
        url: { type: ["string", "null"] },
        targets: {
          type: "array",
          items: { type: "object", additionalProperties: false, properties: { type: { type: "string" }, ref: { type: "string" }, label: { type: "string" } }, required: ["type", "ref"] },
        },
        guidance: { type: "string" },
        include_terms: { type: "string" },
        exclude_terms: { type: "string" },
        focus: { type: "string", enum: ["product", "gtm", "both"] },
        cadence: { type: "string", enum: ["manual", "daily", "weekly"] },
        max_per_pull: { type: "integer" },
      },
      required: ["kind", "label", "targets", "guidance", "include_terms", "exclude_terms", "focus", "cadence", "max_per_pull"],
    },
    rationale: { type: "string" },                 // one line: why this shape
    runs_now: { type: "boolean" },                 // does the chosen kind pull today?
    followup: { type: ["string", "null"] },         // one clarifying question, if ambiguous
  },
  required: ["recipe", "rationale", "runs_now"],
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
    const { description, answer } = await req.json().catch(() => ({}));
    if (!description || typeof description !== "string" || description.trim().length < 4) {
      return json({ error: "Describe the signal you want to watch (a sentence is plenty)." }, 400);
    }
    const { data: orgId } = await supabase.rpc("current_org_id");
    if (!orgId) return json({ error: "could not resolve org" }, 400);

    const kindList = KINDS.map((k) => `• ${k.kind}${k.liveNow ? " (pulls today)" : " (configured now, pulls when its connector lands)"} — ${k.note}`).join("\n");

    const system = [
      "You are SingleStack's Source Recipe Builder. A user — often non-technical — describes an obscure signal they want to track. You turn that into a runner-ready SOURCE CONFIG. You emit CONFIG ONLY — never code, never a server.",
      "Pick the single best source KIND from this catalog:",
      kindList,
      "Prefer a kind that 'pulls today' (website, youtube) when it genuinely fits the intent — the user gets value immediately. Only pick a not-yet-live kind when it's clearly the right home for the signal.",
      "Fill the recipe so the connector runner is well-aimed and CANNOT overload the user:",
      "• url: the main page/handle, if the kind needs one (https only). null if not applicable.",
      "• targets: specific things to look at — [{type:'url',ref:'https://…',label:'…'}] for web/video, or [{type:'report'|'account'|'repo'|…, ref, label}] for tool kinds. This is the POINTING CONTEXT — be specific, it's what makes the source useful.",
      "• guidance: one or two plain sentences telling the runner where to look and what matters.",
      "• include_terms / exclude_terms: tight focus + noise/bias control. exclude_terms matters — name what to ignore.",
      "• focus: product | gtm | both. • cadence: manual | daily | weekly (default weekly unless they imply urgency).",
      "• max_per_pull: a SMALL budget (3–10) so it's a focused trickle, never a firehose. Default 6.",
      "Set runs_now true iff the chosen kind pulls today. Give a one-line rationale. If the intent is ambiguous (which competitor? which page?), ask ONE clarifying followup; otherwise followup null.",
      answer ? `The user already answered a prior clarifying question with: "${answer}". Incorporate it; do not ask again.` : "",
    ].filter(Boolean).join("\n");

    const anthropic = new Anthropic({ apiKey: key });
    const resp = (await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1200,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `The user wants to track: "${description.trim()}"` }],
      // deno-lint-ignore no-explicit-any
    } as any)) as Anthropic.Message;

    const block = resp.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new Error("no recipe returned");
    const out = JSON.parse(block.text) as {
      recipe: { kind: string; label: string; url: string | null; targets: { type: string; ref: string; label?: string }[]; guidance: string; include_terms: string; exclude_terms: string; focus: string; cadence: string; max_per_pull: number };
      rationale: string; runs_now: boolean; followup?: string | null;
    };
    // Clamp the budget server-side too — defense in depth against overload.
    out.recipe.max_per_pull = Math.min(20, Math.max(1, Number(out.recipe.max_per_pull) || 6));

    return json(out);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
