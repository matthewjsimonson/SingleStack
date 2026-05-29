// ============================================================================
// agent-chat — conversational endpoint for an executive agent.
//
// Plain English: powers the command-center drawer. Given an agent_key and the
// conversation so far, it loads that agent (its role + system prompt + model),
// gives Claude lightweight context about the org's Foundation (products, GTM
// records, pending proposals, recent signals), and returns the agent's reply.
// Logs the turn in agent_runs. The agent can be asked for a "daily briefing" or
// anything else. Action *execution* (creating records, etc.) is a later layer;
// this is real chat grounded in the org's data.
//
// Runs as the caller (JWT forwarded) so all reads are org-scoped by RLS.
// Secret: ANTHROPIC_API_KEY.
// ============================================================================

import Anthropic from "npm:@anthropic-ai/sdk@0.69.0";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const DEFAULT_MODEL = "claude-opus-4-8";
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });
}

type ChatMsg = { role: "user" | "assistant"; content: string };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing Authorization header" }, 401);
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) return json({ error: "server missing ANTHROPIC_API_KEY" }, 500);

  const supabase: SupabaseClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  let input: { agent_key?: string; messages?: ChatMsg[] };
  try { input = await req.json(); } catch { return json({ error: "invalid JSON body" }, 400); }
  const { agent_key, messages } = input;
  if (!agent_key) return json({ error: "agent_key is required" }, 400);
  if (!Array.isArray(messages) || messages.length === 0) return json({ error: "messages required" }, 400);

  // Load the agent (RLS-scoped).
  const { data: agent, error: aErr } = await supabase
    .from("agents").select("id, org_id, name, role, model, system_prompt").eq("key", agent_key).eq("is_active", true).maybeSingle();
  if (aErr) return json({ error: `agent lookup failed: ${aErr.message}` }, 500);
  if (!agent) return json({ error: `no active agent with key '${agent_key}'` }, 404);

  const model = (agent.model as string) || DEFAULT_MODEL;
  const orgId = agent.org_id as string;

  try {
    // Lightweight org context so replies are grounded (not generic).
    const [{ data: prods }, { data: gtms }, { count: pending }, { data: sigs }] = await Promise.all([
      supabase.from("product_records").select("name").limit(25),
      supabase.from("gtm_records").select("name").limit(25),
      supabase.from("proposals").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("signals").select("title, conf_label").order("observed_at", { ascending: false }).limit(10),
    ]);

    const context = [
      `Organization Foundation snapshot:`,
      `- Products: ${(prods ?? []).map((p) => p.name).join(", ") || "none yet"}`,
      `- GTM records: ${(gtms ?? []).map((g) => g.name).join(", ") || "none yet"}`,
      `- Pending proposals awaiting review: ${pending ?? 0}`,
      `- Recent signals: ${(sigs ?? []).map((s) => s.title).join("; ") || "none yet"}`,
    ].join("\n");

    const system = [
      agent.system_prompt || `You are ${agent.name}${agent.role ? `, ${agent.role}` : ""}, an executive agent in SingleStack.`,
      "",
      "You advise the operator on this organization's product and go-to-market. Be concise, specific, and action-oriented. When asked for a daily briefing, give a tight summary of what needs attention and 2–3 concrete recommended next steps. Ground everything in the snapshot below; if data is missing, say so plainly.",
      "",
      context,
    ].join("\n");

    const anthropic = new Anthropic({ apiKey: anthropicKey });
    const resp = (await anthropic.messages.create({
      model,
      max_tokens: 2000,
      thinking: { type: "adaptive" },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      // deno-lint-ignore no-explicit-any
    } as any)) as Anthropic.Message;

    const text = resp.content.find((b) => b.type === "text");
    const reply = text && text.type === "text" ? text.text : "(no response)";

    // Log the turn.
    const price = PRICING[model];
    const cost = price ? (resp.usage.input_tokens * price.input + resp.usage.output_tokens * price.output) / 1_000_000 : null;
    await supabase.from("agent_runs").insert({
      org_id: orgId, agent_id: agent.id, status: "succeeded",
      input: { kind: "chat", messages }, output: reply, model,
      input_tokens: resp.usage.input_tokens, output_tokens: resp.usage.output_tokens, cost_usd: cost,
      finished_at: new Date().toISOString(),
    });

    return json({ reply });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
