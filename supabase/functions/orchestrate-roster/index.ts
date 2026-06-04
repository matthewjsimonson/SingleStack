// ============================================================================
// orchestrate-roster — the Chief of Staff. Reviews the WHOLE agent roster
// against the current intelligence (themes + capabilities + signals) and
// proposes skill evolution, WITH RESTRAINT.
//
// The whole point is to NOT over-rotate (mirrors living-records'
// "gated cadence" and compounding-intelligence's anti-goals): it only proposes
// changes driven by durable, corroborated intelligence (escalating/active
// themes, capabilities), caps how many changes it makes, skips skills changed
// or reviewed very recently, and EXPLICITLY records what it considered but is
// leaving alone (kind='hold'). A review that changes little is healthy.
//
// Writes roster_recommendations (one batch) and stamps skills.reviewed_at. It
// applies NOTHING to skills — humans ratify each change on /agents.
//
// Runs as the caller (JWT forwarded) → RLS scopes everything. Secret:
// ANTHROPIC_API_KEY. Mirrors evolve-skills / distill-lessons conventions.
// ============================================================================

import Anthropic from "npm:@anthropic-ai/sdk@0.69.0";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

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
      .select("agent_id, skills ( id, name, description, instructions, category, last_evolved_at )");
    // deno-lint-ignore no-explicit-any
    const byAgent = new Map<string, any[]>();
    for (const l of (links ?? [])) {
      // deno-lint-ignore no-explicit-any
      const arr = byAgent.get((l as any).agent_id) ?? [];
      // deno-lint-ignore no-explicit-any
      if ((l as any).skills) arr.push((l as any).skills);
      // deno-lint-ignore no-explicit-any
      byAgent.set((l as any).agent_id, arr);
    }

    // ---- The intelligence. Only durable, corroborated patterns are candidates
    // for change (restraint). Plus capabilities (leverage) + recent signals. ---
    const recentCut = new Date(Date.now() - RECENT_DAYS * 86400_000).toISOString();
    const [{ data: themes }, { data: rawSigs }] = await Promise.all([
      supabase.from("signal_themes")
        .select("title, summary, recommendation, state, momentum, conf_level, category")
        .in("state", ["escalating", "active", "steady"])
        .order("last_evidence_at", { ascending: false }).limit(24),
      supabase.from("signals").select("title, why, metadata").order("observed_at", { ascending: false }).limit(40),
    ]);
    // deno-lint-ignore no-explicit-any
    const allSigs = (rawSigs ?? []) as any[];
    const capSigs = allSigs.filter((s) => s.metadata?.domain === "capability");
    const otherSigs = allSigs.filter((s) => s.metadata?.domain !== "capability").slice(0, 24);

    if ((themes ?? []).length === 0 && allSigs.length === 0) {
      return json({ recommendations: [], message: "No durable intelligence yet — synthesize signals (and log capabilities) first, then review the roster." });
    }

    const intel = [
      "DURABLE THEMES (escalating/active/steady — the only patterns strong enough to justify changing an agent):",
      ...(themes ?? []).map((t) => `• [${t.state}/${t.momentum}${t.conf_level != null ? `, conf ${t.conf_level}` : ""}] (${t.category}) ${t.title}${t.summary ? ` — ${t.summary}` : ""}${t.recommendation ? ` → ${t.recommendation}` : ""}`),
      ...(capSigs.length ? ["", "PLATFORM CAPABILITIES (what's now possible to leverage):", ...capSigs.map((s) => `• ${s.metadata?.provider ? `[${s.metadata.provider}${s.metadata?.area ? `/${s.metadata.area}` : ""}] ` : ""}${s.title}${s.why ? ` — ${s.why}` : ""}`)] : []),
      "", "RECENT SIGNALS (context, weaker — should not by themselves drive change):",
      ...otherSigs.map((s) => `• ${s.title}${s.why ? ` (${s.why})` : ""}`),
    ].join("\n");

    // Roster rendering, marking skills changed recently (don't churn them).
    const roster = (agents ?? []).map((a) => {
      const sk = byAgent.get(a.id) ?? [];
      const lines = sk.length
        ? sk.map((s) => {
            const recent = s.last_evolved_at && s.last_evolved_at > recentCut;
            return `  - skill_id ${s.id} · "${s.name}" (${s.category ?? "general"})${recent ? " [changed recently — leave unless a NEW capability demands it]" : ""}\n      instructions: ${(s.instructions ?? "(none)").slice(0, 400)}`;
          }).join("\n")
        : "  (no skills attached)";
      return `AGENT ${a.key} — ${a.name}${a.role ? ` (${a.role})` : ""}\n${lines}`;
    }).join("\n\n");

    const system = [
      "You are the Chief of Staff for an executive agent roster. Your job is to keep each agent's skills (playbooks) current with durable intelligence — and CRUCIALLY, to NOT over-rotate.",
      "",
      "Rules of restraint (load-bearing):",
      `• Propose AT MOST ${MAX_CHANGES} changes total across the whole roster. Fewer is better. A review that changes little is HEALTHY, not a failure.`,
      "• Only propose a change when a DURABLE theme (escalating/active) or a real platform capability clearly warrants it. A single recent signal is NOT enough.",
      "• Match each change to the RIGHT agent (by its role) and the right skill. Revise an existing skill when the capability is the same but should be applied differently; propose a NEW skill only for a capability the agent genuinely lacks.",
      "• Do NOT churn skills marked 'changed recently' unless a brand-new capability demands it.",
      "",
      "For things you CONSIDERED but are deliberately NOT changing, emit kind='hold' with a one-line rationale (this restraint record is required, not optional — include a few). Cite exact theme/capability/signal titles in drivers for every item.",
      "",
      "Output: revise_skill needs agent_key + skill_id + proposed_instructions (full rewritten playbook). new_skill needs agent_key + new_name + new_description + new_category + new_instructions. hold needs agent_key (+ skill_id if about a specific skill).",
    ].join("\n");

    const userMsg = `CURRENT INTELLIGENCE:\n${intel}\n\nTHE ROSTER:\n${roster}\n\nReview the roster and return your recommendations (changes + holds), exercising restraint.`;

    const anthropic = new Anthropic({ apiKey: key });
    const resp = (await anthropic.messages.create({
      model: MODEL,
      max_tokens: 6000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userMsg }],
      // deno-lint-ignore no-explicit-any
    } as any)) as Anthropic.Message;

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
