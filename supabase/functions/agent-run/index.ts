// ============================================================================
// agent-run — a GENUINELY AGENTIC endpoint for an executive agent.
//
// Unlike agent-chat (a single grounded completion), this runs a real TOOL-USE
// LOOP: the officer decides what to do, calls tools to gather context and act,
// sees the results, and iterates until it can answer. It is also where SKILLS
// become real: only each skill's NAME + DESCRIPTION sit in context; the officer
// loads a skill's full playbook on demand via read_skill (progressive
// disclosure), exactly like an Agent Skill (SKILL.md).
//
// Tools (v1): read_skill, get_record, search_signals — all RLS-scoped to the
// caller's org via the forwarded JWT. The loop is bounded (MAX_STEPS) for
// stability. Streaming protocol matches our other streamers: the reasoning +
// tool narration stream first, then a marker (␞), then the final answer — so the
// existing alive UI (streamAgentChat) renders it with no client change.
//
// Additive: nothing else calls this yet, so it can be deployed and exercised
// without touching agent-chat or any live surface.
//
// Runs as the caller (JWT forwarded). Secret: ANTHROPIC_API_KEY.
// ============================================================================

import Anthropic from "npm:@anthropic-ai/sdk@0.69.0";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { resolveModelPolicy } from "../_shared/ai_policy.ts";
import { FIELD_WRITING_RULES } from "../_shared/field_writing.ts";

const DEFAULT_MODEL = "claude-opus-4-8";
const MAX_STEPS = 8; // bounded agent loop — stability over open-endedness
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const ANSWER_MARK = "␞";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "content-type": "application/json" } });

// The officer's tool surface. Small, real, RLS-scoped.
const TOOLS = [
  {
    name: "read_skill",
    description: "Load the full playbook (instructions) for one of your skills before doing specialized work. Pass the skill's key from the skills list in your system prompt.",
    input_schema: { type: "object", additionalProperties: false, properties: { skill_key: { type: "string", description: "The skill key, e.g. 'competitive_teardown'" } }, required: ["skill_key"] },
  },
  {
    name: "get_record",
    description: "Read a product or GTM record and all its structured fields. Use to ground your work in the actual record.",
    input_schema: { type: "object", additionalProperties: false, properties: { record_type: { type: "string", enum: ["product", "gtm"] }, record_id: { type: "string" } }, required: ["record_type", "record_id"] },
  },
  {
    name: "search_signals",
    description: "Pull recent signals (evidence). scope filters by origin: internal (your systems), external (market), or all.",
    input_schema: { type: "object", additionalProperties: false, properties: { scope: { type: "string", enum: ["internal", "external", "all"] }, limit: { type: "integer" } }, required: ["scope"] },
  },
  {
    name: "list_themes",
    description: "List the org's durable signal THEMES — corroborated patterns with a recommendation. The strongest evidence to ground strategy in. category filters product/gtm.",
    input_schema: { type: "object", additionalProperties: false, properties: { category: { type: "string", enum: ["product", "gtm"] } }, required: [] },
  },
  {
    name: "list_modules",
    description: "List a product's modules and their features (the product's structure). Defaults to the product you're grounded in.",
    input_schema: { type: "object", additionalProperties: false, properties: { product_id: { type: "string" } }, required: [] },
  },
  {
    name: "list_competitors",
    description: "List the competitors the org tracks (name, relationship, notes). Use when reasoning about positioning or who we're up against.",
    input_schema: { type: "object", additionalProperties: false, properties: {}, required: [] },
  },
  {
    name: "list_frontier_capabilities",
    description: "List recent frontier-model & platform capabilities the org tracks (what's newly possible). Use to ground technical/roadmap reasoning in current capability.",
    input_schema: { type: "object", additionalProperties: false, properties: { limit: { type: "integer" } }, required: [] },
  },
  {
    name: "list_initiatives",
    description: "List the org's initiatives (title, stage, lane, priority). Use to connect your work to the active roadmap/GTM efforts.",
    input_schema: { type: "object", additionalProperties: false, properties: { limit: { type: "integer" } }, required: [] },
  },
];

// propose_change is added to the tool set ONLY when a specific product/GTM record is
// in scope. In a general advisory chat there's nothing to propose into, so we don't
// offer it — that's what stops the agent hunting for a record to act on.
const PROPOSE_TOOL = {
  name: "propose_change",
  description: "Draft a concrete change to the record you're grounded in. It goes to the record's REVIEW QUEUE (pending) for the human to accept or reject — you never apply changes directly. For an update, use the field's id from get_record; for a new field, give a snake_case field_key + human label.",
  input_schema: {
    type: "object", additionalProperties: false,
    properties: {
      title: { type: "string", description: "Short title for the proposed change" },
      rationale: { type: "string", description: "Why — cite the records/signals/skills behind it" },
      conf_label: { type: "string", description: "A short confidence read, e.g. High / Medium / Low" },
      conf_level: { type: "number", description: "Confidence 0..1" },
      changes: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          properties: {
            change_kind: { type: "string", enum: ["update_field", "add_field"] },
            record_field_id: { type: "string", description: "update_field: the field's id from get_record" },
            field_key: { type: "string", description: "add_field: a snake_case key" },
            label: { type: "string", description: "add_field: a human label" },
            proposed_value: { type: "string" },
          },
          required: ["change_kind", "proposed_value"],
        },
      },
    },
    required: ["title", "rationale", "changes"],
  },
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

  let input: {
    agent_key?: string;
    messages?: { role: "user" | "assistant"; content: string }[];
    context?: {
      record_type?: string; record_id?: string;
      page?: string; entity_id?: string; label?: string;
      page_aware?: boolean;       // opt-in: deep-load the current page's data into the run
      steer_connector?: string;   // "/" selection: nudge the agent to use this connector this turn
      steer_skill?: string;       // "/" selection: summon a child skill (id) for this turn
    };
    stream?: boolean;
  };
  try { input = await req.json(); } catch { return json({ error: "invalid JSON body" }, 400); }
  const { agent_key } = input;
  const convo = (input.messages ?? []).filter((m) => m && m.content);
  if (!agent_key) return json({ error: "agent_key is required" }, 400);
  if (convo.length === 0) return json({ error: "messages is required" }, 400);

  const { data: agent } = await supabase.from("agents").select("id, org_id, name, role, model, system_prompt").eq("key", agent_key).eq("is_active", true).maybeSingle();
  if (!agent) return json({ error: `no active agent '${agent_key}'` }, 404);
  const orgId = agent.org_id as string;
  const pol = await resolveModelPolicy(supabase, { task: "agent_run", agentId: agent.id as string, fallback: { model: (agent.model as string) || DEFAULT_MODEL, effort: "high" } });
  const model = pol.model;

  // The agent's CORNERSTONE skills only — names + descriptions (progressive
  // disclosure; full body loads on demand via read_skill). Cornerstones are the
  // agent's general-purpose lens, always on. Child (non-cornerstone) skills are
  // for specific tasks and belong to workflows or a "/" summon — NOT general chat.
  const { data: skillRows } = await supabase.from("agent_skills").select("skills ( key, name, description, instructions )").eq("agent_id", agent.id).eq("is_cornerstone", true);
  // deno-lint-ignore no-explicit-any
  const skills = (skillRows ?? []).map((r: any) => r.skills).filter(Boolean) as { key: string; name: string; description: string | null; instructions: string | null }[];
  const skillCatalog = skills.length
    ? skills.map((s) => `- ${s.key}: ${s.name}${s.description ? ` — ${s.description}` : ""}`).join("\n")
    : "(no skills attached)";
  // Identity unification: the cornerstone IS the agent's identity and runs on every
  // job, so inline its full instructions as the base (not deferred to read_skill).
  // Ignore the legacy system_prompt when a cornerstone exists; fall back only when not.
  const cornerstoneText = skills.map((s) => s.instructions).filter(Boolean)[0] ?? "";

  // MCP connectors attached to this agent. Claude uses their tools IN the loop —
  // Anthropic executes them server-side (Messages API mcp_servers, beta). Gated:
  // only passed when present, so non-connector agents are unaffected. Auth (Phase 1):
  // optional bearer from config; secure store is Phase 1.5. See docs/mcp-connectors.md.
  const { data: mcpRows } = await supabase.from("connections").select("id, label, mcp_url, config, guidance, targets").eq("agent_id", agent.id).eq("kind", "mcp").neq("status", "disconnected");
  // deno-lint-ignore no-explicit-any
  const mcpConns = (mcpRows ?? []).filter((r: any) => r.mcp_url);
  // Tokens live in the RLS-locked connection_secrets; read them with the SERVICE ROLE
  // (never the client path). The connection ids came from the RLS-scoped query above,
  // so we only ever read secrets for this caller's org.
  const tokenById: Record<string, string> = {};
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (mcpConns.length && serviceKey) {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
    // tokens are encrypted in the vault; only this service-role RPC can decrypt them.
    for (const c of mcpConns) {
      // deno-lint-ignore no-explicit-any
      const { data: tok } = await admin.rpc("mcp_connection_token", { p_connection: (c as any).id });
      if (tok) tokenById[(c as { id: string }).id] = tok as string;
    }
  }
  // Stable connector name — used on the API and to label its guidance below.
  const connName = (label: string | null | undefined, i: number) =>
    String(label || `mcp_${i}`).toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_|_$/g, "") || `mcp_${i}`;
  // deno-lint-ignore no-explicit-any
  const mcpServers = mcpConns.map((r: any, i: number) => {
    const tok = tokenById[r.id] || r.config?.authorization_token;
    return {
      type: "url",
      name: connName(r.label, i),
      url: r.mcp_url as string,
      ...(tok ? { authorization_token: tok } : {}),
    };
  });
  // The operator's per-connector instructions — purpose ("what it does here") + the
  // "where to look / focus" targets they typed on the connection. These were being
  // dropped; we now feed them to the model so it actually honors that focus (and any
  // output structure the operator asked for there) when using the connector.
  // deno-lint-ignore no-explicit-any
  const mcpGuidance = mcpConns.map((r: any, i: number) => {
    const purpose = String(r.config?.purpose || r.guidance || "").trim();
    // deno-lint-ignore no-explicit-any
    const targets = (Array.isArray(r.targets) ? r.targets : []).map((t: any) => t?.ref).filter(Boolean);
    const bits: string[] = [];
    if (purpose) bits.push(purpose);
    if (targets.length) bits.push(`Focus / where to look: ${targets.join("; ")}`);
    return `- ${connName(r.label, i)}${bits.length ? `: ${bits.join(". ")}` : ""}`;
  }).join("\n");
  const mcpHeaders = mcpServers.length ? { headers: { "anthropic-beta": "mcp-client-2025-11-20" } } : undefined;
  // The mcp-client-2025-11-20 beta requires each declared MCP server to be opted into
  // via an mcp_toolset entry in `tools` — passing mcp_servers alone returns a 400
  // ("server X is defined but not referenced by any mcp_toolset"). One per server.
  const mcpToolsets = mcpServers.map((m) => ({ type: "mcp_toolset", mcp_server_name: m.name }));

  // ---- Page awareness (opt-in) ----------------------------------------------
  // Default: the agent only knows which record you're on (so propose_change can
  // target it). When the operator turns "Use this page" on (page_aware), we deep-
  // load a compact snapshot of what they're looking at and ground the run in it.
  // Everything here runs as the caller (RLS-scoped) — no privileged reads.
  const ctx = input.context ?? {};
  async function recordSnapshot(rt: string, id: string): Promise<string> {
    const table = rt === "product" ? "product_records" : "gtm_records";
    const fk = rt === "product" ? "product_id" : "gtm_record_id";
    const { data: rec } = await supabase.from(table).select("name").eq("id", id).maybeSingle();
    const { data: fields } = await supabase.from("record_fields").select("label, value").eq(fk, id).order("position", { ascending: true });
    // deno-lint-ignore no-explicit-any
    const lines = (fields ?? []).map((f: any) => `- ${f.label}: ${f.value}`).join("\n");
    // deno-lint-ignore no-explicit-any
    const head = (rec as any)?.name ? `${(rec as any).name}\n` : "";
    return `${head}${lines || "(no fields yet)"}`;
  }
  async function strategySnapshot(): Promise<string> {
    const { data: themes } = await supabase.from("signal_themes").select("title, summary, recommendation, category").order("position", { ascending: true }).limit(20);
    // deno-lint-ignore no-explicit-any
    const t = (themes ?? []).map((x: any) => `- [${x.category}] ${x.title}${x.summary ? ` — ${x.summary}` : ""}${x.recommendation ? `\n    → ${x.recommendation}` : ""}`).join("\n");
    return `Product strategy themes:\n${t || "(none yet)"}`;
  }
  async function marketSnapshot(): Promise<string> {
    const { data: comps } = await supabase.from("competitors").select("name, relationship, notes").order("position", { ascending: true }).limit(30);
    // deno-lint-ignore no-explicit-any
    const c = (comps ?? []).map((x: any) => `- ${x.name} [${x.relationship}]${x.notes ? ` — ${x.notes}` : ""}`).join("\n");
    return `Tracked competitors:\n${c || "(none tracked)"}`;
  }
  let pageContextText = "";
  if (ctx.record_id && (ctx.record_type === "product" || ctx.record_type === "gtm")) {
    pageContextText = `\nThe operator is currently viewing the ${ctx.record_type} record ${ctx.record_id}.`;
    pageContextText += ctx.page_aware
      ? ` WHAT YOU'RE LOOKING AT — ground your answer in this:\n${await recordSnapshot(ctx.record_type, ctx.record_id)}`
      : " Use get_record to read it when relevant.";
  } else if (ctx.page_aware && (ctx.page === "strategy" || ctx.page === "market")) {
    const snap = ctx.page === "strategy" ? await strategySnapshot() : await marketSnapshot();
    pageContextText = `\nWHAT YOU'RE LOOKING AT — the ${ctx.label || ctx.page} page. Ground your answer in this:\n${snap}`;
  } else if (ctx.page_aware && ctx.label) {
    pageContextText = `\nThe operator is currently on the ${ctx.label} page — factor that in.`;
  }
  // "/" connector steer — the operator explicitly chose a connector for this turn.
  const steerName = ctx.steer_connector ? connName(ctx.steer_connector, 0) : "";
  const steerText = steerName && mcpServers.some((m) => m.name === steerName)
    ? `\nThe operator selected the "${steerName}" connector for this turn — use it to gather what's needed before answering (your other tools remain available).`
    : "";

  // "/" skill summon — the operator brought a CHILD skill into this otherwise
  // cornerstone-only chat for this turn. Load its full playbook (validated as
  // attached to this agent) and apply it, and point at any preferred connectors
  // the agent actually has attached (soft — graceful degradation preserved).
  let summonedText = "";
  if (ctx.steer_skill) {
    const { data: sumRow } = await supabase.from("agent_skills")
      .select("skills ( name, instructions, connectors )")
      .eq("agent_id", agent.id).eq("skill_id", ctx.steer_skill).maybeSingle();
    // deno-lint-ignore no-explicit-any
    const sum = (sumRow as any)?.skills;
    if (sum && (sum.instructions || sum.name)) {
      const prefs: string[] = Array.isArray(sum.connectors) ? sum.connectors : [];
      const attachedPrefs = prefs.filter((p) => mcpServers.some((m) => m.name === connName(p, 0)));
      summonedText = [
        `\nTHE SKILL THE OPERATOR SUMMONED FOR THIS TURN — apply it as your playbook for this answer:`,
        `## ${sum.name}`,
        sum.instructions ?? "",
        attachedPrefs.length ? `\nThis skill prefers these connectors (attached) — lean on them: ${attachedPrefs.join(", ")}.` : "",
      ].join("\n");
    }
  }

  // propose_change is only in scope when a specific product/GTM record is open.
  // No record → advisory mode: answer, don't hunt for somewhere to act.
  const canPropose = !!(ctx.record_id && (ctx.record_type === "product" || ctx.record_type === "gtm"));

  const systemText = [
    cornerstoneText || agent.system_prompt || `You are ${agent.name}${agent.role ? `, ${agent.role}` : ""}, an executive agent in SingleStack.`,
    "",
    "You operate AGENTICALLY: use the tools to gather what you need and to ground your work, then answer. Don't guess when a tool can tell you. Keep tool use purposeful — a few targeted calls, not exhaustive sweeps.",
    canPropose
      ? "When you identify a concrete improvement to the record you're grounded in, draft it with propose_change — it goes to the record's review queue for the human to accept; you never apply changes yourself. Propose only when the operator wants a change or you've found a clear, well-grounded one; otherwise just answer."
      : "You are in ADVISORY mode — no record is open, so you cannot and should not propose changes. Answer the question directly and usefully from your cornerstone expertise and the grounding tools. Do NOT hunt for a product/GTM record, do NOT try to find an id to act on, and do NOT apologize for what you can't do or offer to open a record. If a change would help, describe it in plain language; the operator can open the relevant record and ask you to draft it there.",
    canPropose ? FIELD_WRITING_RULES : "",
    "",
    "YOUR CORNERSTONE SKILLS — your always-on lens (titles only; load a full playbook with read_skill(skill_key) before leaning on it):",
    skillCatalog,
    mcpServers.length ? `\nYOUR CONNECTORS (external systems via MCP) — use them when the task calls for it, and honor the focus + instructions given for each:\n${mcpGuidance}` : "",
    pageContextText,
    steerText,
    summonedText,
    "\nGround every claim in what the tools return. Be concrete; cite the records/signals/skills you used.",
    "If the operator's request, a skill, or a connector specifies how to structure the answer (e.g. named sections), follow that structure; otherwise choose a clean, scannable layout that fits the question. Don't impose a fixed template when none was asked for.",
  ].join("\n");

  const anthropic = new Anthropic({ apiKey: key });

  // ---- the bounded agent loop, emitting reasoning + tool narration -----------
  async function runLoop(emit: (s: string) => void): Promise<{ answer: string; inTok: number; outTok: number }> {
    // deno-lint-ignore no-explicit-any
    const messages: any[] = convo.map((m) => ({ role: m.role, content: m.content }));
    let inTok = 0, outTok = 0;
    // Connectors can be flaky/down — if one is unreachable, we drop them and carry
    // on with our own tools rather than failing the whole run (see the model call).
    let mcpActive = mcpServers.length > 0;

    // Tool set: read tools always; propose_change only when a record is in scope.
    const baseTools = canPropose ? [...TOOLS, PROPOSE_TOOL] : TOOLS;

    // One model call. `useMcp` lets us retry without connectors if they error out.
    const callModel = (useMcp: boolean) => anthropic.messages.create({
      model,
      max_tokens: 8000,
      thinking: { type: "adaptive", display: "summarized" }, // summarized → reasoning text is actually present on Opus 4.8
      output_config: { effort: pol.effort },
      system: [{ type: "text", text: systemText, cache_control: { type: "ephemeral" } }],
      tools: useMcp ? [...baseTools, ...mcpToolsets] : baseTools,
      ...(useMcp ? { mcp_servers: mcpServers } : {}),
      messages,
      // deno-lint-ignore no-explicit-any
    } as any, useMcp ? mcpHeaders : undefined) as Promise<Anthropic.Message>;

    for (let step = 0; step < MAX_STEPS; step++) {
      // Graceful connector degradation: a down/unreachable MCP server returns a 400
      // ("Connection error while communicating with MCP server"). Don't let that kill
      // the run — drop the connectors, tell the user, and answer with our own tools.
      let resp: Anthropic.Message;
      try {
        resp = await callModel(mcpActive);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (mcpActive && /mcp server|mcp_server|communicating with mcp/i.test(msg)) {
          emit(`\n⚠ A connector was unavailable — continuing without it.\n`);
          mcpActive = false;
          resp = await callModel(false);
        } else throw e;
      }
      inTok += resp.usage.input_tokens; outTok += resp.usage.output_tokens;

      // surface the officer's real reasoning + any connector calls for this step
      for (const b of resp.content) {
        // deno-lint-ignore no-explicit-any
        const bb = b as any;
        if (bb.type === "thinking" && bb.thinking) emit(bb.thinking);
        else if (bb.type === "mcp_tool_use") emit(`\n→ connector ${bb.server_name ?? ""}${bb.name ? `.${bb.name}` : ""}\n`);
      }

      // pause_turn = a server-side tool (e.g. an MCP connector) hit the loop limit;
      // re-send the assistant turn to let Anthropic resume.
      if (resp.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: resp.content }); continue; }

      if (resp.stop_reason !== "tool_use") {
        const answer = resp.content.filter((b) => b.type === "text").map((b) => (b.type === "text" ? b.text : "")).join("").trim();
        return { answer, inTok, outTok };
      }

      // execute every tool the officer asked for, in order
      messages.push({ role: "assistant", content: resp.content });
      // deno-lint-ignore no-explicit-any
      const toolUses = resp.content.filter((b: any) => b.type === "tool_use");
      // deno-lint-ignore no-explicit-any
      const results: any[] = [];
      for (const tu of toolUses) {
        // deno-lint-ignore no-explicit-any
        const t = tu as any;
        emit(`\n→ ${t.name}(${JSON.stringify(t.input)})\n`);
        let out = "";
        try {
          out = await runTool(t.name, t.input);
        } catch (e) { out = `error: ${e instanceof Error ? e.message : String(e)}`; }
        results.push({ type: "tool_result", tool_use_id: t.id, content: out });
      }
      messages.push({ role: "user", content: results });
    }
    return { answer: "I reached my step limit before finishing — here's where I got to. Ask me to continue if you'd like.", inTok, outTok };
  }

  // ---- tool implementations (RLS-scoped) ------------------------------------
  // deno-lint-ignore no-explicit-any
  async function runTool(name: string, args: any): Promise<string> {
    if (name === "read_skill") {
      const { data } = await supabase.from("skills").select("name, instructions").eq("key", args.skill_key).maybeSingle();
      if (!data) return `No skill '${args.skill_key}'.`;
      return `# ${data.name}\n\n${data.instructions ?? "(this skill has no instructions yet)"}`;
    }
    if (name === "get_record") {
      const table = args.record_type === "product" ? "product_records" : "gtm_records";
      const fk = args.record_type === "product" ? "product_id" : "gtm_record_id";
      const { data: rec } = await supabase.from(table).select("*").eq("id", args.record_id).maybeSingle();
      if (!rec) return `No ${args.record_type} record ${args.record_id}.`;
      const { data: fields } = await supabase.from("record_fields").select("id, label, value, position").eq(fk, args.record_id).order("position", { ascending: true });
      return JSON.stringify({ record: rec, fields: fields ?? [] });
    }
    if (name === "search_signals") {
      const lim = Math.min(40, Math.max(1, Number(args.limit) || 20));
      const { data } = await supabase.from("signals").select("title, why, observed_at, sources ( origin )").order("observed_at", { ascending: false, nullsFirst: false }).limit(60);
      // deno-lint-ignore no-explicit-any
      const origin = (r: any) => (r.sources?.origin === "external" ? "external" : "internal");
      // deno-lint-ignore no-explicit-any
      const rows = (data ?? []).filter((r: any) => args.scope === "all" || origin(r) === args.scope).slice(0, lim);
      if (!rows.length) return "(no signals on record)";
      // deno-lint-ignore no-explicit-any
      return rows.map((r: any) => `[${origin(r)}] ${r.title}${r.why ? ` — ${r.why}` : ""}`).join("\n");
    }
    if (name === "list_themes") {
      let q = supabase.from("signal_themes").select("title, summary, recommendation, category, conf_level").order("position", { ascending: true }).limit(30);
      if (args.category) q = q.eq("category", args.category);
      const { data } = await q;
      if (!data?.length) return "(no themes)";
      // deno-lint-ignore no-explicit-any
      return data.map((t: any) => `[${t.category}${t.conf_level != null ? ` ${Math.round(t.conf_level * 100)}%` : ""}] ${t.title}${t.summary ? ` — ${t.summary}` : ""}${t.recommendation ? `\n  → ${t.recommendation}` : ""}`).join("\n");
    }
    if (name === "list_modules") {
      const pid = args.product_id || (input.context?.record_type === "product" ? input.context.record_id : null);
      if (!pid) return "No product in scope — pass product_id, or open this from a product record.";
      const { data: mods } = await supabase.from("modules").select("id, name, description").eq("product_id", pid).order("created_at", { ascending: true });
      if (!mods?.length) return "(no modules)";
      // deno-lint-ignore no-explicit-any
      const ids = (mods as any[]).map((m) => m.id);
      const { data: feats } = await supabase.from("features").select("module_id, name").in("module_id", ids);
      const byMod: Record<string, string[]> = {};
      // deno-lint-ignore no-explicit-any
      for (const f of (feats ?? []) as any[]) { (byMod[f.module_id] ??= []).push(f.name); }
      // deno-lint-ignore no-explicit-any
      return (mods as any[]).map((m) => `${m.name}${m.description ? ` — ${m.description}` : ""}${byMod[m.id]?.length ? `\n  features: ${byMod[m.id].join(", ")}` : ""}`).join("\n");
    }
    if (name === "list_competitors") {
      const { data } = await supabase.from("competitors").select("name, relationship, website, notes").order("position", { ascending: true }).limit(40);
      if (!data?.length) return "(no competitors tracked)";
      // deno-lint-ignore no-explicit-any
      return data.map((c: any) => `${c.name} [${c.relationship}]${c.notes ? ` — ${c.notes}` : ""}`).join("\n");
    }
    if (name === "list_frontier_capabilities") {
      const lim = Math.min(40, Math.max(1, Number(args.limit) || 20));
      const { data } = await supabase.from("capability_notes").select("title, content, category, observed_at").order("observed_at", { ascending: false, nullsFirst: false }).limit(lim);
      if (!data?.length) return "(no frontier capabilities on record)";
      // deno-lint-ignore no-explicit-any
      return data.map((c: any) => `[${c.category}] ${c.title} — ${c.content}`).join("\n");
    }
    if (name === "list_initiatives") {
      const lim = Math.min(60, Math.max(1, Number(args.limit) || 30));
      const { data } = await supabase.from("initiatives").select("title, stage, lane, priority, description").order("created_at", { ascending: false }).limit(lim);
      if (!data?.length) return "(no initiatives)";
      // deno-lint-ignore no-explicit-any
      return data.map((i: any) => `${i.title} · ${i.lane}/${i.stage} · ${i.priority}${i.description ? ` — ${i.description}` : ""}`).join("\n");
    }
    if (name === "propose_change") {
      const ctx = input.context;
      if (!ctx?.record_id || !(ctx.record_type === "product" || ctx.record_type === "gtm")) {
        return "Can't propose: you're not grounded in a specific product or GTM record right now.";
      }
      const product_id = ctx.record_type === "product" ? ctx.record_id : null;
      const gtm_record_id = ctx.record_type === "gtm" ? ctx.record_id : null;
      const fk = ctx.record_type === "product" ? "product_id" : "gtm_record_id";
      const { data: fieldRows } = await supabase.from("record_fields").select("id, value").eq(fk, ctx.record_id);
      // deno-lint-ignore no-explicit-any
      const known = new Map((fieldRows ?? []).map((f: any) => [f.id, f.value]));
      const conf = Math.min(1, Math.max(0, Number(args.conf_level) || 0));
      const { data: created, error: pErr } = await supabase.from("proposals").insert({
        org_id: orgId, product_id, gtm_record_id,
        title: args.title, rationale: args.rationale ?? null, conf_level: conf, conf_label: args.conf_label ?? null,
        proposed_by: agent.name,
      }).select("id").single();
      if (pErr || !created) return `Could not create proposal: ${pErr?.message ?? "unknown error"}`;
      const pid = created.id as string;
      // deno-lint-ignore no-explicit-any
      const rows: any[] = [];
      for (const c of (args.changes ?? [])) {
        if (c.change_kind === "update_field" && c.record_field_id && known.has(c.record_field_id)) {
          rows.push({ org_id: orgId, proposal_id: pid, change_kind: "update_field", record_field_id: c.record_field_id, old_value: known.get(c.record_field_id) ?? null, field_key: null, label: null, proposed_value: c.proposed_value });
        } else if (c.change_kind === "add_field" && c.field_key && c.label) {
          rows.push({ org_id: orgId, proposal_id: pid, change_kind: "add_field", record_field_id: null, old_value: null, field_key: c.field_key, label: c.label, proposed_value: c.proposed_value });
        }
      }
      if (rows.length > 0) {
        const { error: cErr } = await supabase.from("proposal_changes").insert(rows);
        if (cErr) { await supabase.from("proposals").delete().eq("id", pid); return `Could not save changes: ${cErr.message}`; }
      }
      return `Drafted proposal "${args.title}" with ${rows.length} change(s). It's now waiting in this record's review queue for the human to accept or reject — you did not apply it directly.`;
    }
    return `Unknown tool '${name}'.`;
  }

  // ---- run + respond --------------------------------------------------------
  const finish = async (answer: string, inTok: number, outTok: number) => {
    const price = PRICING[model];
    const cost = price ? (inTok * price.input + outTok * price.output) / 1_000_000 : null;
    await supabase.from("agent_runs").insert({
      org_id: orgId, agent_id: agent.id, status: "succeeded",
      input: { kind: "agent-run", agent_key, turns: convo.length }, output: answer.slice(0, 2000),
      model, input_tokens: inTok, output_tokens: outTok, cost_usd: cost, finished_at: new Date().toISOString(),
    });
  };

  if (input.stream) {
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const { answer, inTok, outTok } = await runLoop((s) => controller.enqueue(enc.encode(s)));
          controller.enqueue(enc.encode(ANSWER_MARK + answer));
          await finish(answer, inTok, outTok);
        } catch (e) {
          controller.enqueue(enc.encode(ANSWER_MARK + `Sorry — I hit an error: ${e instanceof Error ? e.message : String(e)}`));
        } finally { controller.close(); }
      },
    });
    return new Response(stream, { headers: { ...CORS, "content-type": "text/plain; charset=utf-8", "cache-control": "no-cache" } });
  }

  try {
    const { answer, inTok, outTok } = await runLoop(() => {});
    await finish(answer, inTok, outTok);
    return json({ reply: answer });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
