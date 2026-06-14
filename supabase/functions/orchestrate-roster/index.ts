// ============================================================================
// orchestrate-roster — the Chief of Staff. Reviews the WHOLE agent roster and
// evolves the AGENTS THEMSELVES — their SKILLS (cornerstone + play) and how they
// run their workflows — so the team is the best it can be at serving OUR USERS,
// evidenced by internal & external signals. WITH RESTRAINT.
//
// IMPORTANT — this is NOT about records. A roster review proposes changes to the
// agents' SKILLS only. Changes to product/GTM RECORD content (positioning,
// messaging, fields) are "Proposals" — a separate, human-ratified mechanism the
// agents use ON records. The Chief of Staff never proposes record changes here.
//
// Restraint is load-bearing (anti-over-rotation): it only changes skills when a
// durable, corroborated pattern warrants it, caps changes per run, skips skills
// changed recently, and EXPLICITLY records what it left alone (kind='hold').
//
// Writes roster_recommendations (one batch) + stamps skills.reviewed_at. Applies
// NOTHING — humans ratify each skill change on /agents. JWT forwarded → RLS.
// Secret: ANTHROPIC_API_KEY.
// ============================================================================

import Anthropic from "npm:@anthropic-ai/sdk@0.69.0";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { logUsage } from "../_shared/ai_usage.ts";
import { resolveModelPolicy } from "../_shared/ai_policy.ts";

const MODEL = "claude-opus-4-8";
const MAX_CHANGES = 5;       // hard cap on proposed changes per run (anti-over-rotation)
const RECENT_DAYS = 7;       // skills evolved within this window are skipped
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
    recommendations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", enum: ["revise_skill", "new_skill", "hold"] },
          agent_key: { type: "string" },
          skill_id: { type: "string" },          // for revise_skill / hold (may be "")
          title: { type: "string" },
          rationale: { type: "string" },
          drivers: { type: "array", items: { type: "string" } },
          // for revise_skill:
          proposed_instructions: { type: "string" },
          // for new_skill:
          new_name: { type: "string" },
          new_description: { type: "string" },
          new_category: { type: "string", enum: ["product", "gtm", "research", "general", ""] },
          new_instructions: { type: "string" },
        },
        required: ["kind", "agent_key", "title", "rationale", "drivers"],
      },
    },
  },
  required: ["recommendations"],
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

    // ---- The roster: active agents + their attached skills. -----------------
    const { data: agents } = await supabase.from("agents").select("id, key, name, role").eq("is_active", true).limit(20);
    if (!agents || agents.length === 0) return json({ recommendations: [], message: "No active agents to review." });

    const { data: links } = await supabase
      .from("agent_skills")
      .select("agent_id, is_cornerstone, skills ( id, name, description, instructions, category, last_evolved_at )");
    // deno-lint-ignore no-explicit-any
    const byAgent = new Map<string, { cornerstone: boolean; skill: any }[]>();
    for (const l of (links ?? [])) {
      // deno-lint-ignore no-explicit-any
      const ll = l as any;
      if (!ll.skills) continue;
      const arr = byAgent.get(ll.agent_id) ?? [];
      arr.push({ cornerstone: !!ll.is_cornerstone, skill: ll.skills });
      byAgent.set(ll.agent_id, arr);
    }

    // ---- The intelligence: our USERS' needs (internal signals) + the MARKET
    // (external signals) + durable themes + new platform capabilities. This is
    // what the agents must get better at serving. -----------------------------
    const recentCut = new Date(Date.now() - RECENT_DAYS * 86400_000).toISOString();
    const [{ data: themes }, { data: rawSigs }, { data: wfs }] = await Promise.all([
      supabase.from("signal_themes")
        .select("title, summary, recommendation, state, momentum, conf_level, category")
        .in("state", ["escalating", "active", "steady"])
        .order("last_evidence_at", { ascending: false }).limit(24),
      supabase.from("signals").select("title, why, metadata, sources ( origin )").order("observed_at", { ascending: false }).limit(50),
      supabase.from("workflows").select("name, description, steps").eq("is_active", true).limit(20),
    ]);
    // deno-lint-ignore no-explicit-any
    const allSigs = (rawSigs ?? []) as any[];
    // deno-lint-ignore no-explicit-any
    const originOf = (s: any) => (s.sources?.origin === "external" ? "external" : "internal");
    const capSigs = allSigs.filter((s) => s.metadata?.domain === "capability");
    const internalSigs = allSigs.filter((s) => s.metadata?.domain !== "capability" && originOf(s) === "internal").slice(0, 20);
    const externalSigs = allSigs.filter((s) => s.metadata?.domain !== "capability" && originOf(s) === "external").slice(0, 20);

    if ((themes ?? []).length === 0 && allSigs.length === 0) {
      return json({ recommendations: [], message: "No intelligence yet — synthesize signals (internal & external) first, then review the roster." });
    }

    const intel = [
      "DURABLE THEMES (corroborated patterns — the strongest justification for evolving an agent):",
      ...(themes ?? []).map((t) => `• [${t.state}/${t.momentum}${t.conf_level != null ? `, conf ${t.conf_level}` : ""}] (${t.category}) ${t.title}${t.summary ? ` — ${t.summary}` : ""}${t.recommendation ? ` → ${t.recommendation}` : ""}`),
      "", "INTERNAL SIGNALS (our users & our own systems — what our users need):",
      ...(internalSigs.length ? internalSigs.map((s) => `• ${s.title}${s.why ? ` — ${s.why}` : ""}`) : ["(none on record)"]),
      "", "EXTERNAL SIGNALS (the market & competitors):",
      ...(externalSigs.length ? externalSigs.map((s) => `• ${s.title}${s.why ? ` — ${s.why}` : ""}`) : ["(none on record)"]),
      ...(capSigs.length ? ["", "NEW PLATFORM CAPABILITIES (what's now possible to leverage):", ...capSigs.map((s) => `• ${s.metadata?.provider ? `[${s.metadata.provider}${s.metadata?.area ? `/${s.metadata.area}` : ""}] ` : ""}${s.title}${s.why ? ` — ${s.why}` : ""}`)] : []),
    ].join("\n");

    // Roster: each agent's CORNERSTONE skills (always-on identity) + PLAY skills
    // (task-specific), marking ones changed recently so we don't churn them.
    const roster = (agents ?? []).map((a) => {
      const items = byAgent.get(a.id) ?? [];
      // deno-lint-ignore no-explicit-any
      const render = (it: { cornerstone: boolean; skill: any }) => {
        const s = it.skill;
        const recent = s.last_evolved_at && s.last_evolved_at > recentCut;
        return `  - [${it.cornerstone ? "CORNERSTONE" : "play"}] skill_id ${s.id} · "${s.name}" (${s.category ?? "general"})${recent ? " [changed recently — leave unless newly warranted]" : ""}\n      instructions: ${(s.instructions ?? "(none)").slice(0, 400)}`;
      };
      const lines = items.length ? items.map(render).join("\n") : "  (no skills attached)";
      return `AGENT ${a.key} — ${a.name}${a.role ? ` (${a.role})` : ""}\n${lines}`;
    }).join("\n\n");

    // The workflows these agents run — a good skill change should make these better.
    // deno-lint-ignore no-explicit-any
    const nameById = new Map((agents ?? []).map((a: any) => [a.id, a.name]));
    // deno-lint-ignore no-explicit-any
    const workflowsBlock = (((wfs ?? []) as any[]).map((w) => {
      // deno-lint-ignore no-explicit-any
      const steps = (w.steps ?? []).map((st: any, i: number) => `${i + 1}.${nameById.get(st.agent_id) ?? "officer"}`).join(" → ");
      return `• "${w.name}"${w.description ? ` — ${w.description}` : ""}${steps ? `  [${steps}]` : ""}`;
    }).join("\n")) || "(no workflows yet)";

    const system = [
      "You are the Chief of Staff for an executive AGENT roster. You make the AGENTS — their skills and the workflows they run — the best they can be at serving OUR USERS, evidenced by internal & external signals. You exercise RESTRAINT.",
      "",
      "WHAT YOU EVOLVE — and what you must NOT touch:",
      "• You evolve the AGENTS themselves: their SKILLS. Two kinds — CORNERSTONE skills (an agent's always-on identity & method) and PLAY skills (task/process-specific). Revise or add either.",
      "• You do NOT propose changes to product or GTM record CONTENT (positioning copy, messaging, field values). Those are 'Proposals' — a completely separate, human-ratified mechanism the agents use ON records. Even if a signal implies a record should change, that is OUT OF SCOPE here. Your output is ONLY about improving the agents' skills.",
      "",
      "Rules of restraint (load-bearing):",
      `• Propose AT MOST ${MAX_CHANGES} skill changes total across the whole roster. Fewer is better — a review that changes little is HEALTHY.`,
      "• Change a skill only when a durable theme or a corroborated internal/external pattern (not one weak signal) clearly shows the agent would serve our users better. Tie each change to specific signals/themes.",
      "• Match each change to the RIGHT agent and RIGHT skill. Revise a CORNERSTONE skill to sharpen the agent's core method; revise/add a PLAY skill to improve a specific task or workflow step. Add a NEW skill only for a capability the agent genuinely lacks.",
      "• Don't churn skills marked 'changed recently' unless newly warranted.",
      "• Consider the agents' WORKFLOWS: a good skill change should make those processes better for users.",
      "",
      "For things you CONSIDERED but are deliberately NOT changing, emit kind='hold' with a one-line rationale (required — include a few). Cite exact theme/signal/capability titles in drivers for every item.",
      "",
      "Output: revise_skill needs agent_key + skill_id + proposed_instructions (full rewritten playbook). new_skill needs agent_key + new_name + new_description + new_category + new_instructions. hold needs agent_key (+ skill_id if about a specific skill).",
    ].join("\n");

    const userMsg = `CURRENT INTELLIGENCE (our users' needs + the market):\n${intel}\n\nTHE ROSTER (agents, their cornerstone + play skills):\n${roster}\n\nTHE WORKFLOWS THESE AGENTS RUN:\n${workflowsBlock}\n\nReturn skill changes + holds that make the agents and their workflows the best they can be for our users — exercising restraint, and NEVER proposing record-content changes.`;

    const anthropic = new Anthropic({ apiKey: key });
    const pol = await resolveModelPolicy(supabase, { task: "orchestrate_roster", fallback: { model: MODEL, effort: "high" } });
    const resp = (await anthropic.messages.create({
      model: pol.model,
      max_tokens: 6000,
      thinking: { type: "adaptive" },
      output_config: { effort: pol.effort, format: { type: "json_schema", schema: SCHEMA } },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userMsg }],
      // deno-lint-ignore no-explicit-any
    } as any)) as Anthropic.Message;
    await logUsage(supabase, { task: "orchestrate_roster", model: pol.model, usage: resp.usage });

    const block = resp.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new Error("no recommendations returned");
    const parsed = JSON.parse(block.text) as { recommendations?: Array<Record<string, unknown>> };

    const agentByKey = new Map((agents ?? []).map((a) => [a.key, a]));
    const recs = (parsed.recommendations ?? []);

    // Enforce the change cap server-side too (defense in depth), keep all holds.
    const changes = recs.filter((r) => r.kind === "revise_skill" || r.kind === "new_skill").slice(0, MAX_CHANGES);
    const holds = recs.filter((r) => r.kind === "hold");

    const batchId = crypto.randomUUID();
    const rows = [...changes, ...holds].map((r) => {
      const a = agentByKey.get(String(r.agent_key));
      const payload = r.kind === "revise_skill"
        ? { instructions: r.proposed_instructions }
        : r.kind === "new_skill"
        ? { name: r.new_name, description: r.new_description, category: r.new_category || "general", instructions: r.new_instructions }
        : {};
      return {
        org_id: orgId, batch_id: batchId, kind: r.kind,
        agent_id: a?.id ?? null, agent_key: String(r.agent_key ?? ""),
        skill_id: r.skill_id ? String(r.skill_id) : null,
        title: String(r.title ?? (r.kind === "new_skill" ? r.new_name : "Recommendation")),
        rationale: String(r.rationale ?? ""),
        drivers: (Array.isArray(r.drivers) ? r.drivers : []).map((d) => ({ kind: "intelligence", title: String(d) })),
        payload, status: "pending",
      };
    }).filter((row) => row.agent_id); // drop any rec that didn't map to a real agent

    if (rows.length) await supabase.from("roster_recommendations").insert(rows);

    // Stamp reviewed_at on every skill we considered (so we don't re-propose).
    const consideredSkillIds = [...new Set((links ?? []).map((l) => {
      // deno-lint-ignore no-explicit-any
      return (l as any).skills?.id as string | undefined;
    }).filter(Boolean))] as string[];
    if (consideredSkillIds.length) {
      await supabase.from("skills").update({ reviewed_at: new Date().toISOString() }).in("id", consideredSkillIds);
    }

    return json({
      batch_id: batchId,
      changes: rows.filter((r) => r.kind !== "hold").length,
      holds: rows.filter((r) => r.kind === "hold").length,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
