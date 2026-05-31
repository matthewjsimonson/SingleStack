// ============================================================================
// draft-decision — Edge Function. Turns a synthesized THEME into a structured
// decision draft: the precise question + 2–4 OPTIONS, each with concrete detail
// and explicit TRADEOFFS, one flagged recommended. It writes NOTHING — it
// returns a draft the human edits and commits in the decision workspace.
// Pointed & configurable: AI proposes real options/tradeoffs, the human decides.
//
// Runs as the caller (JWT forwarded) → RLS scopes reads to their org.
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
    question: { type: "string" },
    options: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          detail: { type: "string" },
          tradeoffs: { type: "string" },
          recommended: { type: "boolean" },
        },
        required: ["title", "detail", "tradeoffs", "recommended"],
      },
    },
  },
  required: ["question", "options"],
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
    const { theme_id } = await req.json().catch(() => ({}));
    if (!theme_id) return json({ error: "theme_id required" }, 400);

    const { data: orgId } = await supabase.rpc("current_org_id");
    if (!orgId) return json({ error: "could not resolve org" }, 400);

    const { data: theme } = await supabase
      .from("signal_themes").select("id, title, summary, recommendation, category, signal_ids")
      .eq("id", theme_id).single();
    if (!theme) return json({ error: "Theme not found" }, 404);

    // Pull the supporting signals for grounding.
    let sigText = "(none)";
    if (theme.signal_ids && theme.signal_ids.length) {
      const { data: sigs } = await supabase.from("signals").select("title, why").in("id", theme.signal_ids).limit(20);
      if (sigs && sigs.length) sigText = sigs.map((s) => `- ${s.title}${s.why ? `: ${s.why}` : ""}`).join("\n");
    }

    const system = [
      "You are a decision architect for SingleStack, an AI-native product & GTM platform.",
      "Given a synthesized intelligence THEME, frame the precise QUESTION to decide, then propose 2–4 distinct OPTIONS.",
      "Each option must have: a short title, concrete detail (what doing it actually means), and explicit TRADEOFFS (the real cost/risk).",
      "Flag exactly one option as recommended (recommended=true), the rest false. Be specific and decision-useful, not generic.",
    ].join("\n");

    const userMsg = [
      `THEME (${theme.category}): ${theme.title}`,
      theme.summary ? `Summary: ${theme.summary}` : "",
      theme.recommendation ? `Prior recommendation: ${theme.recommendation}` : "",
      "",
      "Supporting signals:",
      sigText,
      "",
      "Frame the question and propose the options now.",
    ].filter(Boolean).join("\n");

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
    if (!block || block.type !== "text") throw new Error("no draft returned");
    const parsed = JSON.parse(block.text) as {
      question?: string;
      options?: { title: string; detail: string; tradeoffs: string; recommended: boolean }[];
    };

    return json({ question: parsed.question ?? "", options: parsed.options ?? [] });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
