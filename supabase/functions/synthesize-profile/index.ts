// ============================================================================
// synthesize-profile — draft/refresh a Signal Profile from internal + external
// competitive signals. The profile is "your place in the market"; this reads the
// evidence and proposes a headline + sections. Returns a DRAFT only — the human
// edits and saves (HITL). Mirrors agent-propose conventions.
//
// Input (POST): { scope: 'landscape' | 'competitor', competitor_id?, current? }
//   current: optional existing fields [{field_key,label,value}] to refresh, not
//   regenerate from scratch.
// Runs as caller (JWT) → RLS fences reads to the org. Secret: ANTHROPIC_API_KEY.
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

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headline: { type: "string" },
    fields: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { field_key: { type: "string" }, label: { type: "string" }, value: { type: "string" } },
        required: ["field_key", "label", "value"],
      },
    },
  },
  required: ["headline", "fields"],
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

  let input: { scope?: string; competitor_id?: string; current?: { field_key: string; label: string; value: string | null }[] };
  try { input = await req.json(); } catch { return json({ error: "invalid JSON body" }, 400); }
  const scope = input.scope === "landscape" ? "landscape" : "competitor";
  if (scope === "competitor" && !input.competitor_id) return json({ error: "competitor_id required for scope=competitor" }, 400);

  try {
    // ---- gather evidence: competitive signals (internal + external) ----------
    const { data: rawSigs } = await supabase
      .from("signals")
      .select("title, why, origin, conf_label, observed_at, metadata")
      .order("observed_at", { ascending: false, nullsFirst: false })
      .limit(120);
    // deno-lint-ignore no-explicit-any
    let comp = ((rawSigs ?? []) as any[]).filter((s) => s.metadata?.domain === "competitive");
    if (scope === "competitor") comp = comp.filter((s) => s.metadata?.competitor_id === input.competitor_id);

    const fmt = (s: { title: string; why: string | null; origin: string; conf_label: string | null }) =>
      `• [${s.origin === "internal" ? "INTERNAL" : "EXTERNAL"}${s.conf_label ? `/${s.conf_label}` : ""}] ${s.title}${s.why ? ` — ${s.why}` : ""}`;
    const internal = comp.filter((s) => s.origin === "internal").map(fmt).join("\n");
    const external = comp.filter((s) => s.origin !== "internal").map(fmt).join("\n");

    // ---- context: our product, and (competitor) their matrix standing --------
    let context = "";
    const { data: prod } = await supabase.from("product_records").select("id, name").order("created_at").limit(1).maybeSingle();
    if (prod) {
      const { data: fs } = await supabase.from("record_fields").select("field_key, value").eq("product_id", prod.id).in("field_key", ["overview", "value_prop", "positioning"]);
      const get = (k: string) => fs?.find((f) => f.field_key === k)?.value;
      context = [`Our product: ${prod.name}`, get("value_prop") && `Our value prop: ${get("value_prop")}`, get("positioning") && `Our positioning: ${get("positioning")}`].filter(Boolean).join("\n");
    }

    let target = "the overall competitive landscape and our place in it";
    let suggestedSections = "positioning, our_strengths, our_vulnerabilities, key_players, market_trends, strategic_implications";
    if (scope === "competitor") {
      const { data: c } = await supabase.from("competitors").select("name, relationship, notes").eq("id", input.competitor_id!).maybeSingle();
      target = `our standing vs ${c?.name ?? "this competitor"}${c?.relationship ? ` (${c.relationship})` : ""}`;
      if (c?.notes) context += `\nWhat we know about them: ${c.notes}`;
      // Matrix standing
      const { data: caps } = await supabase.from("capabilities").select("id, name");
      const { data: scores } = await supabase.from("capability_scores").select("capability_id, competitor_id, score");
      if (caps && scores) {
        const lines = caps.map((cap) => {
          const us = scores.find((s) => s.capability_id === cap.id && s.competitor_id === null)?.score ?? 0;
          const them = scores.find((s) => s.capability_id === cap.id && s.competitor_id === input.competitor_id)?.score ?? 0;
          return `${cap.name}: us ${us} / them ${them}`;
        }).join("; ");
        if (lines) context += `\nCapability matrix (0-3): ${lines}`;
      }
      suggestedSections = "positioning, their_strengths, their_weaknesses, how_we_win, how_we_lose, momentum, what_to_watch, strategic_implications";
    }

    const system = [
      `You maintain a HITL "Signal Profile" — a sharp, evidence-grounded record of ${target}. It is meant to DICTATE product and GTM strategy, so be decisive and specific, never generic.`,
      "Synthesize the INTERNAL and EXTERNAL signals below into a headline + sections. INTERNAL signals (what our own teams hear — deals, calls) and EXTERNAL signals (public: reviews, launches, pricing) are both evidence; weigh corroboration across them and note where they disagree.",
      `Use these section keys where supported (snake_case): ${suggestedSections}. Always include a 'strategic_implications' section spelling out what this means for product strategy and for GTM strategy. Only assert what the evidence supports; if thin, say so and keep it short.`,
      input.current?.length ? "REFRESH the existing profile (provided): keep what still holds, update what changed, don't discard human edits wholesale." : "",
    ].filter(Boolean).join("\n");

    const userText = [
      context ? `CONTEXT:\n${context}` : "",
      `\nINTERNAL competitive signals:\n${internal || "(none logged yet)"}`,
      `\nEXTERNAL competitive signals:\n${external || "(none logged yet)"}`,
      input.current?.length ? `\nEXISTING PROFILE (refresh this):\n${input.current.map((f) => `## ${f.label} (${f.field_key})\n${f.value ?? ""}`).join("\n\n")}` : "",
      "\nDraft the profile now.",
    ].filter(Boolean).join("\n");

    const anthropic = new Anthropic({ apiKey: key });
    const message = (await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userText }],
      // deno-lint-ignore no-explicit-any
    } as any)) as Anthropic.Message;

    const block = message.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new Error(`no draft returned (stop_reason: ${message.stop_reason})`);
    const draft = JSON.parse(block.text) as { headline: string; fields: { field_key: string; label: string; value: string }[] };
    return json({ draft, evidence: { internal: comp.filter((s) => s.origin === "internal").length, external: comp.filter((s) => s.origin !== "internal").length } });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
