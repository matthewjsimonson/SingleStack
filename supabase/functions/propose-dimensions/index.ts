// ============================================================================
// propose-dimensions — agents shape the terrain. For themes missing map
// dimensions (horizon, owner, objective), the model proposes values, which
// QUEUE into intel_updates as 'set_dimension' for a human to ratify on the same
// "Review intelligence updates" surface. Agents guide; humans confirm — the
// control/guidance that keeps the map intentional rather than a free-for-all.
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
    suggestions: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          theme_id: { type: "string" },
          horizon: { type: "string", enum: ["now", "next", "future", ""] },
          owner_team: { type: "string" },          // "" = no suggestion
          objective_id: { type: "string" },        // "" = no suggestion
          why: { type: "string" },
        },
        required: ["theme_id"],
      },
    },
  },
  required: ["suggestions"],
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

    // Themes missing at least one dimension (skip dismissed/dormant).
    const { data: themes } = await supabase
      .from("signal_themes")
      .select("id, title, summary, category, state, horizon, owner_team, objective_id")
      .neq("state", "dormant");
    const need = (themes ?? []).filter((t) => !t.horizon || !t.owner_team || !t.objective_id);
    if (need.length === 0) return json({ proposed: 0, message: "All live themes already have their dimensions set." });

    const { data: objectives } = await supabase.from("objectives").select("id, title, pillar").eq("status", "active");
    const objText = (objectives ?? []).map((o) => `{id:${o.id}} ${o.title}${o.pillar ? ` [${o.pillar}]` : ""}`).join("\n") || "(no objectives defined)";
    const objIds = new Set((objectives ?? []).map((o) => o.id));

    const themeText = need.map((t) =>
      `{id:${t.id}} [${t.category}/${t.state}] ${t.title}${t.summary ? " — " + t.summary : ""}` +
      ` (has: horizon=${t.horizon ?? "?"} owner=${t.owner_team ?? "?"} objective=${t.objective_id ? "set" : "?"})`
    ).join("\n");

    const system = [
      "You assign MAP DIMENSIONS to intelligence themes so they can be positioned on a strategy map. For each theme MISSING a dimension, suggest a value — only where you're reasonably confident; leave a field blank ('') otherwise.",
      "• horizon: how soon it matters — 'now' (act this cycle), 'next' (this quarter), 'future' (a longer bet).",
      "• owner_team: which team/function should own it (e.g. 'Product', 'GTM', 'Pricing', 'Engineering'). Keep it short.",
      "• objective_id: pick the BEST-FIT objective id from the list, or '' if none fits.",
      "Give a one-line 'why'. These are PROPOSALS a human will ratify — be helpful but not pushy; blank is fine.",
    ].join("\n");

    const userMsg = `OBJECTIVES:\n${objText}\n\nTHEMES NEEDING DIMENSIONS:\n${themeText}\n\nSuggest dimensions.`;

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
    if (!block || block.type !== "text") throw new Error("no suggestions returned");
    const parsed = JSON.parse(block.text) as { suggestions?: { theme_id: string; horizon?: string; owner_team?: string; objective_id?: string; why?: string }[] };

    const themeById = new Map(need.map((t) => [t.id, t]));
    const objTitle = (id: string) => (objectives ?? []).find((o) => o.id === id)?.title ?? id;
    const queue: Record<string, unknown>[] = [];

    for (const s of parsed.suggestions ?? []) {
      const t = themeById.get(s.theme_id);
      if (!t) continue;
      // One queued set_dimension per field actually suggested AND still unset.
      if (s.horizon && ["now", "next", "future"].includes(s.horizon) && !t.horizon) {
        queue.push(mk(orgId, s.theme_id, "horizon", s.horizon, s.horizon, t.title, s.why));
      }
      if (s.owner_team && s.owner_team.trim() && !t.owner_team) {
        queue.push(mk(orgId, s.theme_id, "owner_team", s.owner_team.trim(), s.owner_team.trim(), t.title, s.why));
      }
      if (s.objective_id && objIds.has(s.objective_id) && !t.objective_id) {
        queue.push(mk(orgId, s.theme_id, "objective_id", s.objective_id, objTitle(s.objective_id), t.title, s.why));
      }
    }

    let proposed = 0;
    if (queue.length) {
      const { data, error } = await supabase.from("intel_updates").insert(queue).select("id");
      if (error) throw error;
      proposed = (data ?? []).length;
    }
    return json({ proposed });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// Build one queued set_dimension intel_update.
function mk(orgId: string, themeId: string, field: string, value: string, valueLabel: string, themeTitle: string, why?: string) {
  const label = field === "horizon" ? `horizon → ${valueLabel}` : field === "owner_team" ? `owner → ${valueLabel}` : `objective → ${valueLabel}`;
  return {
    org_id: orgId, scope: "synthesis", kind: "set_dimension", theme_id: themeId, status: "pending",
    payload: { field, value, value_label: valueLabel, why: why ?? null },
    summary: `${themeTitle}: ${label}`,
  };
}
