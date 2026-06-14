// ============================================================================
// draft-cornerstone — guided AI for setting up an agent's cornerstone identity.
//
// The agent overview no longer has one blank "base prompt" box; it has four
// guided windows (identity, mandate, principles, voice). This drafts all four
// from a short description, GROUNDED in the org's own product truth (so the
// officer reflects this company, not a generic template). Returns a draft only —
// the human edits and saves; saving composes system_prompt from the windows.
//
// Input (POST): { name?, role?, intent } — intent = a sentence on who this
//   officer should be. Runs as the caller (JWT) → RLS fences reads to the org.
// Secret: ANTHROPIC_API_KEY. Mirrors agent-propose conventions.
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

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    identity: { type: "string" },
    mandate: { type: "string" },
    principles: { type: "string" },
    voice: { type: "string" },
  },
  required: ["identity", "mandate", "principles", "voice"],
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

  let input: { name?: string; role?: string; intent?: string };
  try { input = await req.json(); } catch { return json({ error: "invalid JSON body" }, 400); }
  const intent = (input.intent ?? "").trim();
  if (!intent) return json({ error: "describe who this officer should be (intent)" }, 400);

  try {
    // Ground in the org's product truth so the cornerstone reflects THIS company.
    let truth = "";
    const { data: prod } = await supabase.from("product_records").select("id, name").order("created_at").limit(1).maybeSingle();
    if (prod) {
      const { data: fs } = await supabase.from("record_fields").select("field_key, value").eq("product_id", prod.id).in("field_key", ["overview", "value_prop", "positioning", "target_market"]);
      const get = (k: string) => fs?.find((f) => f.field_key === k)?.value;
      truth = [`Product: ${prod.name}`, get("overview") && `Overview: ${get("overview")}`, get("value_prop") && `Value prop: ${get("value_prop")}`, get("positioning") && `Positioning: ${get("positioning")}`, get("target_market") && `Target market: ${get("target_market")}`].filter(Boolean).join("\n");
    }

    const system = [
      "You set up the CORNERSTONE identity for an AI officer that co-owns product/GTM work alongside humans. Draft four tight, high-signal windows — no fluff, no preamble, second person ('You are…'):",
      "• identity — who this officer is: role, seniority, domain expertise, point of view.",
      "• mandate — what they own and are accountable for; what 'good' looks like.",
      "• principles — how they think and decide: priorities, tradeoffs, what they optimize for, what evidence they demand.",
      "• voice — tone + guardrails: how they communicate, and what they must NOT do (e.g. never fabricate, always cite, defer to humans on irreversible calls).",
      "Each window is a few sentences or tight bullets. Ground them in the company truth provided so this officer reflects THIS company.",
    ].join("\n");

    const userText = [
      input.name ? `Officer name: ${input.name}` : "",
      input.role ? `Role hint: ${input.role}` : "",
      `What this officer should be: ${intent}`,
      "",
      truth ? `COMPANY TRUTH (ground the cornerstone in this):\n${truth}` : "(No product record yet — draft from the description; keep it adaptable.)",
    ].filter(Boolean).join("\n");

    const anthropic = new Anthropic({ apiKey: key });
    const pol = await resolveModelPolicy(supabase, { task: "draft_cornerstone", fallback: { model: MODEL, effort: "high" } });
    const message = (await anthropic.messages.create({
      model: pol.model,
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      output_config: { effort: pol.effort, format: { type: "json_schema", schema: SCHEMA } },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userText }],
      // deno-lint-ignore no-explicit-any
    } as any)) as Anthropic.Message;
    await logUsage(supabase, { task: "draft_cornerstone", model: pol.model, usage: message.usage });

    const block = message.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new Error(`no draft returned (stop_reason: ${message.stop_reason})`);
    const draft = JSON.parse(block.text) as { identity: string; mandate: string; principles: string; voice: string };
    return json({ draft });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
