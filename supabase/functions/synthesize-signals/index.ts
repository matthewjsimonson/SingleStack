// ============================================================================
// synthesize-signals — turns an org's raw signals into themes.
//
// Plain English: this is the AI behind the Signals homepage. It loads all of
// the org's signals (with their source + scope), asks Claude to find the
// recurring patterns worth acting on, categorize each as product vs gtm, and
// give each a plain-English summary + a prescriptive recommendation + a
// confidence + which signals support it. It then replaces the org's
// signal_themes with the fresh set. Re-runnable — it's a derived dashboard.
//
// Runs as the caller (JWT forwarded) → RLS scopes reads/writes to their org.
// Secret: ANTHROPIC_API_KEY.
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
    themes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          category: { type: "string", enum: ["product", "gtm"] },
          title: { type: "string" },
          summary: { type: "string" },
          recommendation: { type: "string" },
          conf_level: { type: "number" },
          signal_indices: { type: "array", items: { type: "integer" } }, // indices into the input list
        },
        required: ["category", "title", "summary", "recommendation", "conf_level", "signal_indices"],
      },
    },
  },
  required: ["themes"],
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
    // Resolve org (for writes) and load signals + their source labels.
    const { data: orgId } = await supabase.rpc("current_org_id");
    if (!orgId) return json({ error: "could not resolve org" }, 400);

    const { data: signals } = await supabase
      .from("signals")
      .select("id, title, why, conf_level, scope, observed_at, sources(label, origin)")
      .order("observed_at", { ascending: false, nullsFirst: false })
      .limit(200);

    if (!signals || signals.length === 0) {
      // nothing to synthesize — clear themes and return empty
      await supabase.from("signal_themes").delete().eq("org_id", orgId);
      return json({ themes: 0, message: "No signals to synthesize yet." });
    }

    const list = signals.map((s, i) => {
      // deno-lint-ignore no-explicit-any
      const src = (s as any).sources;
      const origin = src?.origin ?? "internal";
      const label = src?.label ?? "unattributed";
      return `[${i}] (${origin} · ${label} · scope:${s.scope}) ${s.title}${s.why ? " — " + s.why : ""}`;
    }).join("\n");

    const system = [
      "You are the intelligence synthesis engine for SingleStack, an AI-native product & go-to-market platform.",
      "You receive an organization's raw signals (internal tool data + external market intel). Find the recurring PATTERNS worth acting on — not a restatement of each signal, but the themes that emerge across them.",
      "For each theme: categorize it as 'product' (informs the product record/strategy — usage, tech, roadmap) or 'gtm' (informs go-to-market — messaging, positioning, buyers, competition); write a tight plain-English summary of the pattern; give a prescriptive recommendation (the concrete 'so do this'); set conf_level 0..1 based on how strongly the signals support it; and list signal_indices (the [n] indices) that back the theme.",
      "Aim for 3–6 high-quality themes. Prefer themes supported by multiple signals. Be specific and useful, not generic.",
    ].join("\n");

    const anthropic = new Anthropic({ apiKey: key });
    const resp = (await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `Signals:\n${list}\n\nSynthesize the themes.` }],
      // deno-lint-ignore no-explicit-any
    } as any)) as Anthropic.Message;

    const block = resp.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new Error("no synthesis returned");
    const parsed = JSON.parse(block.text) as {
      themes: { category: string; title: string; summary: string; recommendation: string; conf_level: number; signal_indices: number[] }[];
    };

    // Replace prior themes with the fresh set.
    await supabase.from("signal_themes").delete().eq("org_id", orgId);
    const rows = (parsed.themes ?? []).map((t, i) => ({
      org_id: orgId,
      category: t.category === "gtm" ? "gtm" : "product",
      title: t.title,
      summary: t.summary,
      recommendation: t.recommendation,
      conf_level: Math.min(1, Math.max(0, Number(t.conf_level) || 0)),
      signal_ids: (t.signal_indices ?? []).map((idx) => signals[idx]?.id).filter(Boolean),
      position: i,
    }));
    if (rows.length) {
      const { error } = await supabase.from("signal_themes").insert(rows);
      if (error) throw error;
    }

    return json({ themes: rows.length });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
