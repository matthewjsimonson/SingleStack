// ============================================================================
// evolve-skills — recursively evolve an agent's skills from new intelligence.
//
// Plain English: a skill's `instructions` are its playbook. As the market,
// positioning, product releases, and dev strategy shift (captured as signals +
// reconciled themes), an agent's playbooks should evolve to match — but never
// silently. This reads the agent's attached skills + the recent intelligence in
// the agent's CONNECTED AREAS, and asks the model to PROPOSE evolved
// instructions for the skills the new intelligence actually changes. It writes
// NOTHING: it returns proposals the human accepts/edits/rejects on the agent's
// Skills tab. Accepting calls apply_skill_evolution(), which evolves the skill
// and records a provenance-tagged revision (the compounding, recursive loop).
//
// Runs as the caller (JWT forwarded) → RLS scopes everything to their org.
// Secret: ANTHROPIC_API_KEY. Mirrors distill-lessons conventions.
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

type Area = "products" | "gtm" | "signals" | "records";
const ALL_AREAS: Area[] = ["products", "gtm", "signals", "records"];

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    revisions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          skill_id: { type: "string" },
          change: { type: "boolean" },
          proposed_instructions: { type: "string" },
          rationale: { type: "string" },
          drivers: { type: "array", items: { type: "string" } },
        },
        required: ["skill_id", "change", "proposed_instructions", "rationale", "drivers"],
      },
    },
    // Genuinely NEW capabilities the agent lacks — not a sharpening of an
    // existing skill, but a capability the new intelligence reveals it needs.
    new_skills: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          category: { type: "string", enum: ["product", "gtm", "research", "general"] },
          instructions: { type: "string" },
          rationale: { type: "string" },
          drivers: { type: "array", items: { type: "string" } },
        },
        required: ["name", "description", "category", "instructions", "rationale", "drivers"],
      },
    },
  },
  required: ["revisions", "new_skills"],
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

  let input: { agent_id?: string; agent_key?: string };
  try { input = await req.json(); } catch { return json({ error: "invalid JSON body" }, 400); }

  // Load the agent (by id or key), RLS-scoped.
  let q = supabase.from("agents").select("id, name, role").eq("is_active", true);
  q = input.agent_id ? q.eq("id", input.agent_id) : input.agent_key ? q.eq("key", input.agent_key) : q;
  if (!input.agent_id && !input.agent_key) return json({ error: "agent_id or agent_key required" }, 400);
  const { data: agent, error: aErr } = await q.maybeSingle();
  if (aErr) return json({ error: `agent lookup failed: ${aErr.message}` }, 500);
  if (!agent) return json({ error: "agent not found" }, 404);

  try {
    // Attached skills (the playbooks we might evolve).
    const { data: skillRows } = await supabase
      .from("agent_skills")
      .select("skills ( id, name, description, instructions, category )")
      .eq("agent_id", agent.id);
    // deno-lint-ignore no-explicit-any
    const skills = (skillRows ?? []).map((r: any) => r.skills).filter(Boolean).slice(0, 8);
    if (skills.length === 0) return json({ revisions: [], message: "This agent has no skills attached yet. Attach a skill, then evolve it from signals." });

    // Connected areas scope which intelligence we consider.
    const { data: connRows } = await supabase.from("connections").select("area").eq("agent_id", agent.id).eq("kind", "internal");
    const declared = [...new Set((connRows ?? []).map((c) => c.area).filter(Boolean))] as Area[];
    const areas = declared.length ? declared : ALL_AREAS;
    const seesSignals = areas.includes("signals") || areas.includes("records");

    // The intelligence digest: reconciled themes (the durable patterns) + recent
    // signals. Themes carry state/momentum/recommendation — the substance of
    // "what has changed". Scope by category to the agent's areas where possible.
    const themeCats = areas.includes("records") || (areas.includes("products") && areas.includes("gtm"))
      ? null
      : areas.includes("products") ? "product" : areas.includes("gtm") ? "gtm" : null;
    let themeQ = supabase.from("signal_themes").select("title, summary, recommendation, state, momentum, conf_level, category").order("last_evidence_at", { ascending: false }).limit(20);
    if (themeCats) themeQ = themeQ.eq("category", themeCats);
    const [{ data: themes }, { data: rawSigs }] = await Promise.all([
      themeQ,
      seesSignals
        ? supabase.from("signals").select("title, why, metadata").order("observed_at", { ascending: false }).limit(30)
        : Promise.resolve({ data: [] as { title: string; why: string | null; metadata: { domain?: string; provider?: string; area?: string } | null }[] }),
    ]);
    // deno-lint-ignore no-explicit-any
    const allSigs = (rawSigs ?? []) as any[];
    const capSigs = allSigs.filter((s) => s.metadata?.domain === "capability");
    const sigs = allSigs.filter((s) => s.metadata?.domain !== "capability").slice(0, 20);

    if ((themes ?? []).length === 0 && allSigs.length === 0) {
      return json({ revisions: [], new_skills: [], message: "No intelligence in this agent's areas yet — log/synthesize signals first, then evolve." });
    }

    const digest = [
      "RECONCILED THEMES (durable patterns — the substance of what has changed):",
      ...(themes ?? []).map((t) => `• [${t.state}/${t.momentum}${t.conf_level != null ? `, conf ${t.conf_level}` : ""}] (${t.category}) ${t.title}${t.summary ? ` — ${t.summary}` : ""}${t.recommendation ? ` → ${t.recommendation}` : ""}`),
      ...(capSigs.length ? [
        "",
        "PLATFORM CAPABILITIES (what is now POSSIBLE to leverage — frontier/platform releases). Treat these as opportunities to upgrade how this agent works (e.g. a new orchestration/coding capability may warrant a new or revised engineering skill):",
        ...capSigs.map((s) => `• ${s.metadata?.provider ? `[${s.metadata.provider}${s.metadata?.area ? `/${s.metadata.area}` : ""}] ` : ""}${s.title}${s.why ? ` — ${s.why}` : ""}`),
      ] : []),
      "",
      "RECENT SIGNALS:",
      ...sigs.map((s) => `• ${s.title}${s.why ? ` (${s.why})` : ""}`),
    ].join("\n");

    const skillList = skills.map((s) =>
      `### skill_id: ${s.id}\nName: ${s.name}${s.category ? ` (${s.category})` : ""}\nDescription: ${s.description ?? "—"}\nCurrent instructions:\n${s.instructions ?? "(none yet)"}`,
    ).join("\n\n");

    const system = [
      `You evolve the playbooks ("instructions") of ${agent.name}${agent.role ? `, ${agent.role}` : ""}, an executive agent, so they stay current with new intelligence.`,
      "",
      "REVISE an existing skill when the new intelligence (themes + signals) MEANINGFULLY changes how that EXISTING capability should be applied — same job, sharper playbook. For each skill:",
      "• If it does: set change=true and rewrite the FULL instructions — preserve the skill's intent and structure, evolve the specifics. Keep it a tight, usable playbook (not a changelog). Cite the exact theme/signal titles in `drivers`.",
      "• If it does NOT: set change=false, leave proposed_instructions empty, drivers empty, and say why in one line in rationale. Do NOT manufacture changes — a no-op is the right answer when nothing relevant shifted.",
      "Return one revisions entry per skill, keyed by the exact skill_id given.",
      "",
      "ADD a new skill ONLY when the intelligence reveals a capability this agent genuinely LACKS — a new capability, not a sharpening of an existing skill (e.g. a new platform/model capability or market motion that needs its own playbook). Put these in new_skills with a tight name, one-line description, the best-fit category, and a usable instructions playbook. Be conservative: most reviews should add zero new skills. If nothing warrants a new capability, return an empty new_skills array.",
      "",
      "Restraint is the point: a review that changes little is a sign of health, not failure. Do not pad.",
    ].join("\n");

    const userMsg = `INTELLIGENCE DIGEST (scoped to this agent's connected areas: ${areas.join(", ")}):\n${digest}\n\nSKILLS TO REVIEW:\n${skillList}\n\nPropose evolutions.`;

    const anthropic = new Anthropic({ apiKey: key });
    const resp = (await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userMsg }],
      // deno-lint-ignore no-explicit-any
    } as any)) as Anthropic.Message;

    const block = resp.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new Error("no revisions returned");
    const parsed = JSON.parse(block.text) as {
      revisions?: { skill_id: string; change: boolean; proposed_instructions: string; rationale: string; drivers: string[] }[];
      new_skills?: { name: string; description: string; category: string; instructions: string; rationale: string; drivers: string[] }[];
    };

    // Decorate with current text + names so the client can show a clean diff;
    // only return entries that propose a real change.
    const byId = new Map(skills.map((s) => [s.id, s]));
    const revisions = (parsed.revisions ?? [])
      .filter((r) => r.change && r.proposed_instructions && byId.has(r.skill_id))
      .map((r) => {
        const s = byId.get(r.skill_id)!;
        return {
          skill_id: r.skill_id,
          name: s.name,
          category: s.category,
          current_instructions: s.instructions ?? "",
          proposed_instructions: r.proposed_instructions,
          rationale: r.rationale,
          drivers: r.drivers ?? [],
        };
      });

    // Don't propose a "new" skill whose name collides with one this agent
    // already has (that's a revision, not a new capability).
    const haveNames = new Set(skills.map((s) => (s.name ?? "").trim().toLowerCase()));
    const newSkills = (parsed.new_skills ?? [])
      .filter((n) => n.name && n.instructions && !haveNames.has(n.name.trim().toLowerCase()))
      .map((n) => ({
        name: n.name,
        description: n.description ?? "",
        category: ["product", "gtm", "research", "general"].includes(n.category) ? n.category : "general",
        instructions: n.instructions,
        rationale: n.rationale ?? "",
        drivers: n.drivers ?? [],
      }));

    return json({ revisions, new_skills: newSkills, reviewed: skills.length });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
