// ============================================================================
// profile-to-strategy — close the loop: turn a HITL Signal Profile into strategy.
//
// The Signal Profile is "your place in the market." This reads it and derives
// distinct PRODUCT themes (what to build/change) and GTM themes (how to position
// & sell), then writes them as signal_themes into the respective strategy boards
// — where humans curate them like any synthesized theme. Grounded strictly in
// the profile; nothing is auto-shipped.
//
// Input (POST): { profile_id }. Runs as caller (JWT) → RLS fences to the org.
// Secret: ANTHROPIC_API_KEY.
// ============================================================================

import Anthropic from "npm:@anthropic-ai/sdk@0.69.0";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { logUsage } from "../_shared/ai_usage.ts";
import { resolveModelPolicy } from "../_shared/ai_policy.ts";

const MODEL = "claude-opus-4-8";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "content-type": "application/json" } });

const THEME = {
  type: "object", additionalProperties: false,
  properties: { title: { type: "string" }, summary: { type: "string" }, recommendation: { type: "string" }, conf_level: { type: "number" } },
  required: ["title", "summary", "recommendation", "conf_level"],
};
const SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    product_themes: { type: "array", items: THEME },
    gtm_themes: { type: "array", items: THEME },
  },
  required: ["product_themes", "gtm_themes"],
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
    const { profile_id } = await req.json().catch(() => ({}));
    if (!profile_id) return json({ error: "profile_id required" }, 400);

    const { data: orgId } = await supabase.rpc("current_org_id");
    if (!orgId) return json({ error: "could not resolve org" }, 400);

    const { data: profile } = await supabase.from("signal_profiles").select("id, scope, competitor_id, headline").eq("id", profile_id).maybeSingle();
    if (!profile) return json({ error: "profile not found" }, 404);
    const { data: fields } = await supabase.from("signal_profile_fields").select("label, value").eq("profile_id", profile_id).order("position");
    let subject = "the competitive landscape";
    if (profile.scope === "competitor" && profile.competitor_id) {
      const { data: c } = await supabase.from("competitors").select("name").eq("id", profile.competitor_id).maybeSingle();
      subject = `competitor ${c?.name ?? "this rival"}`;
    }

    const profileText = [
      profile.headline ? `HEADLINE: ${profile.headline}` : "",
      ...(fields ?? []).map((f) => `## ${f.label}\n${f.value ?? ""}`),
    ].filter(Boolean).join("\n\n");
    if (!profileText.trim()) return json({ error: "This profile is empty — draft it first, then send to strategy." }, 422);

    const system = [
      `You convert a HITL competitive Signal Profile (about ${subject}) into strategy. Derive two distinct sets of themes:`,
      "• product_themes — what we should BUILD or change about the product (capabilities, gaps, bets) given our place in the market.",
      "• gtm_themes — how we should POSITION, message, or sell (campaigns, content, proof, audience) given the same.",
      "Each theme: a sharp title, a 1-2 sentence summary of the pattern, and a concrete recommendation. Ground STRICTLY in the profile — do not invent. Return only well-supported themes (fewer is better); conf_level 0..1 by evidence strength. If one lens isn't supported, return an empty array for it.",
    ].join("\n");

    const anthropic = new Anthropic({ apiKey: key });
    const pol = await resolveModelPolicy(supabase, { task: "profile_to_strategy", fallback: { model: MODEL, effort: "high" } });
    const message = (await anthropic.messages.create({
      model: pol.model,
      max_tokens: 6000,
      thinking: { type: "adaptive" },
      output_config: { effort: pol.effort, format: { type: "json_schema", schema: SCHEMA } },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `SIGNAL PROFILE:\n${profileText}\n\nDerive product and GTM strategy themes.` }],
      // deno-lint-ignore no-explicit-any
    } as any)) as Anthropic.Message;
    await logUsage(supabase, { task: "profile_to_strategy", model: pol.model, usage: message.usage });

    const block = message.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new Error(`no themes returned (stop_reason: ${message.stop_reason})`);
    const out = JSON.parse(block.text) as { product_themes: { title: string; summary: string; recommendation: string; conf_level: number }[]; gtm_themes: typeof out.product_themes };

    const now = new Date().toISOString();
    // A competitor-scoped profile's themes inherit that competitor_id — this is
    // what makes them visible to the capability scorer and the battlecard analyst
    // (both read themes WHERE competitor_id = X). Without it the profile was a
    // dead-end: it produced themes nothing downstream could pick up.
    const competitorId = profile.scope === "competitor" ? (profile.competitor_id ?? null) : null;
    // deno-lint-ignore no-explicit-any
    const mk = (t: any, category: "product" | "gtm") => ({
      org_id: orgId, category, domain: "competitive", title: String(t.title).slice(0, 280),
      summary: (t.summary ?? "").slice(0, 1000) || null, recommendation: (t.recommendation ?? "").slice(0, 1000) || null,
      conf_level: Math.min(1, Math.max(0, Number(t.conf_level) || 0.6)), state: "active", momentum: "steady",
      merged_by: "synthesis", last_evidence_at: now, competitor_id: competitorId,
    });
    const rows = [
      ...(out.product_themes ?? []).map((t) => mk(t, "product")),
      ...(out.gtm_themes ?? []).map((t) => mk(t, "gtm")),
    ];
    if (rows.length === 0) return json({ created: 0, message: "Nothing groundable to push to strategy yet." });

    const { data: created, error } = await supabase.from("signal_themes").insert(rows).select("id");
    if (error) throw error;
    // Trajectory events so each theme shows where it came from.
    await supabase.from("theme_events").insert((created ?? []).map((c) => ({ org_id: orgId, theme_id: c.id, kind: "created", detail: { from: "signal_profile", profile_id }, actor: "synthesis" })));

    return json({ created: rows.length, product: (out.product_themes ?? []).length, gtm: (out.gtm_themes ?? []).length });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
