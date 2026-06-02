// ============================================================================
// agent-chat — conversational endpoint for an executive agent.
//
// Plain English: powers the command-center drawer. Given an agent_key, the
// conversation so far, and (optionally) what the operator is currently looking
// at, it loads that agent and reasons AS that agent — using:
//   • the agent's SKILLS (attached playbooks) injected as how-to-think guidance,
//   • the agent's CONNECTIONS (internal areas: products|gtm|signals|records),
//     which SCOPE what org data the agent can see — so a CPO agent connected to
//     "products" reasons over the product foundation, a CRO over GTM, etc.
//     (Aligning agents to a module/function.) Agents with no connections
//     declared default to full Foundation access (backward compatible.)
//   • CONTEXT: when the drawer is opened on a specific record/module, that
//     record's fields + related signals/themes/proposals are pulled in so the
//     reply is grounded in exactly what the operator is looking at.
// Returns the agent's reply and logs the turn in agent_runs.
//
// This is structured cross-module grounding (no embeddings). True semantic RAG
// over document_chunks is an optional upgrade once an embedding key exists.
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
type Area = "products" | "gtm" | "signals" | "records";
type Ctx = {
  area?: Area;
  record_id?: string;
  record_type?: "product" | "gtm";
  record_name?: string;
  module?: string;
};

const ALL_AREAS: Area[] = ["products", "gtm", "signals", "records"];

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

  let input: { agent_key?: string; messages?: ChatMsg[]; context?: Ctx };
  try { input = await req.json(); } catch { return json({ error: "invalid JSON body" }, 400); }
  const { agent_key, messages, context } = input;
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
    // ---- Skills: the agent's attached, tailorable playbooks. -----------------
    const { data: skillRows } = await supabase
      .from("agent_skills")
      .select("skills ( name, description, instructions, category )")
      .eq("agent_id", agent.id);
    // deno-lint-ignore no-explicit-any
    const skills = (skillRows ?? []).map((r: any) => r.skills).filter(Boolean);

    // ---- Connections: the internal areas this agent is allowed to see. -------
    const { data: connRows } = await supabase
      .from("connections")
      .select("kind, area, label, status")
      .eq("agent_id", agent.id)
      .eq("kind", "internal");
    const declaredAreas = [...new Set((connRows ?? []).map((c) => c.area).filter(Boolean))] as Area[];
    // No connections declared → full access (so existing agents keep working).
    const areas = declaredAreas.length ? declaredAreas : ALL_AREAS;
    const can = (a: Area) => areas.includes(a) || areas.includes("records");

    // The operator's current focus (drawer opened on a record/module) gives
    // access to that record regardless of declared areas — you can ask about
    // what you're looking at.
    const focus = context && context.record_id && context.record_type
      ? { id: context.record_id, type: context.record_type, name: context.record_name, module: context.module }
      : null;

    // ---- Build grounding context, scoped to the agent's areas + focus. -------
    const grounding: string[] = [];

    if (can("products") || focus?.type === "product") {
      const { data: prods } = await supabase.from("product_records").select("name").limit(25);
      grounding.push(`Products: ${(prods ?? []).map((p) => p.name).join(", ") || "none yet"}`);
    }
    if (can("gtm") || focus?.type === "gtm") {
      const { data: gtms } = await supabase.from("gtm_records").select("name").limit(25);
      grounding.push(`GTM records: ${(gtms ?? []).map((g) => g.name).join(", ") || "none yet"}`);
    }
    if (can("signals")) {
      const [{ data: sigs }, { data: themes }] = await Promise.all([
        supabase.from("signals").select("title, conf_label, observed_at").order("observed_at", { ascending: false }).limit(10),
        supabase.from("signal_themes").select("title, summary, recommendation, state, momentum").order("last_evidence_at", { ascending: false }).limit(6),
      ]);
      grounding.push(`Recent signals: ${(sigs ?? []).map((s) => s.title).join("; ") || "none yet"}`);
      if ((themes ?? []).length) {
        grounding.push(
          "Active intelligence themes:\n" +
          (themes ?? []).map((t) => `  • [${t.state}/${t.momentum}] ${t.title}${t.summary ? ` — ${t.summary}` : ""}${t.recommendation ? ` → ${t.recommendation}` : ""}`).join("\n"),
        );
      }
    }

    // Pending proposals count is always useful (the operator's queue).
    const { count: pending } = await supabase.from("proposals").select("id", { count: "exact", head: true }).eq("status", "pending");
    grounding.push(`Pending proposals awaiting review: ${pending ?? 0}`);

    // ---- Deep focus: the exact record the operator is looking at. ------------
    if (focus) {
      const col = focus.type === "product" ? "product_id" : "gtm_record_id";
      const [{ data: fields }, { data: props }] = await Promise.all([
        supabase.from("record_fields").select("label, value").eq(col, focus.id).order("position").limit(40),
        supabase.from("proposals").select("title, rationale, status").eq(col, focus.id).eq("status", "pending").limit(10),
      ]);
      const fieldText = (fields ?? []).filter((f) => f.value && f.value.trim())
        .map((f) => `  - ${f.label}: ${f.value}`).join("\n");
      const focusLines = [
        `\nCURRENT FOCUS — the operator is viewing this ${focus.type === "product" ? "Product" : "GTM"} record${focus.name ? ` "${focus.name}"` : ""}${focus.module ? ` (module: ${focus.module})` : ""}:`,
        fieldText ? `Record fields:\n${fieldText}` : "  (no fields filled yet)",
      ];
      if (focus.type === "gtm") {
        const { data: gsigs } = await supabase.from("signals").select("title, why, conf_label").eq("gtm_record_id", focus.id).order("observed_at", { ascending: false }).limit(8);
        if ((gsigs ?? []).length) focusLines.push(`Signals on this record:\n${(gsigs ?? []).map((s) => `  - ${s.title}${s.why ? ` (${s.why})` : ""}`).join("\n")}`);
      }
      if ((props ?? []).length) focusLines.push(`Pending proposals on this record:\n${(props ?? []).map((p) => `  - ${p.title}`).join("\n")}`);
      grounding.push(focusLines.join("\n"));
    }

    // ---- Assemble the system prompt. ----------------------------------------
    const areaLabels: Record<Area, string> = { products: "Product records", gtm: "GTM records", signals: "Signals & intelligence", records: "All records" };
    const accessLine = `You are connected to these areas of SingleStack and should ground answers in them: ${areas.map((a) => areaLabels[a]).join(", ")}. If asked about an area you are not connected to, say you don't have access to it rather than guessing.`;

    const skillsBlock = skills.length
      ? [
          "",
          "YOUR SKILLS — apply these playbooks when relevant. They are how you do your job:",
          ...skills.map((s) => `\n## ${s.name}${s.category ? ` (${s.category})` : ""}${s.description ? `\n${s.description}` : ""}${s.instructions ? `\n${s.instructions}` : ""}`),
        ].join("\n")
      : "";

    const system = [
      agent.system_prompt || `You are ${agent.name}${agent.role ? `, ${agent.role}` : ""}, an executive agent in SingleStack.`,
      "",
      "You advise the operator on this organization's product and go-to-market. Be concise, specific, and action-oriented. When asked for a daily briefing, give a tight summary of what needs attention and 2–3 concrete recommended next steps. Ground everything in the data below; if data is missing, say so plainly.",
      "",
      accessLine,
      skillsBlock,
      "",
      "ORGANIZATION CONTEXT:",
      grounding.join("\n"),
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
      input: { kind: "chat", messages, context: context ?? null, skills: skills.length, areas }, output: reply, model,
      input_tokens: resp.usage.input_tokens, output_tokens: resp.usage.output_tokens, cost_usd: cost,
      finished_at: new Date().toISOString(),
    });

    return json({ reply });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
