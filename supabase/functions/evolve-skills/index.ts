// ============================================================================
// evolve-skills — the agent skill-authoring service. Two modes:
//   • evolve (default) — review the agent's attached skills against new
//     intelligence and PROPOSE evolved instructions (drift-driven).
//   • draft  — author ONE new skill from the operator's description
//     (intent-first): a cornerstone from the company's product truth + ICP +
//     role, or a child from the agent's cornerstone + the task/area described.
//     Returns { draft: { name, description, category, instructions, areas,
//     connectors, rationale, kind } }. Writes nothing — the human accepts/edits.
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
import { SKILL_QBAR, exemplarFor } from "../_shared/skill_spec.ts";
import { logUsage } from "../_shared/ai_usage.ts";
import { resolveModelPolicy } from "../_shared/ai_policy.ts";

const MODEL = "claude-opus-4-8";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "content-type": "application/json" } });

type Area = "products" | "gtm" | "signals" | "capabilities" | "records";
const ALL_AREAS: Area[] = ["products", "gtm", "signals", "capabilities", "records"];

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
          areas: { type: "array", items: { type: "string" } },
          connectors: { type: "array", items: { type: "string" } },
          rationale: { type: "string" },
          drivers: { type: "array", items: { type: "string" } },
        },
        required: ["name", "description", "category", "instructions", "areas", "connectors", "rationale", "drivers"],
      },
    },
  },
  required: ["revisions", "new_skills"],
};

// Draft mode returns ONE authored skill from the operator's description.
const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    description: { type: "string" },
    category: { type: "string", enum: ["product", "gtm", "research", "general"] },
    instructions: { type: "string" },
    areas: { type: "array", items: { type: "string" } },
    connectors: { type: "array", items: { type: "string" } },
    rationale: { type: "string" },
  },
  required: ["name", "description", "category", "instructions", "areas", "connectors", "rationale"],
};

// Area/surface vocabulary a child skill can declare relevance to.
const AREA_KEYS = ["product", "gtm", "competitive", "strategy", "market", "signals", "frontier", "roadmap", "content", "campaigns", "initiatives"];

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

  let input: { agent_id?: string; agent_key?: string; mode?: string; kind?: string; intent?: string; area?: string; current?: string };
  try { input = await req.json(); } catch { return json({ error: "invalid JSON body" }, 400); }

  // Load the agent (by id or key), RLS-scoped.
  let q = supabase.from("agents").select("id, name, role").eq("is_active", true);
  q = input.agent_id ? q.eq("id", input.agent_id) : input.agent_key ? q.eq("key", input.agent_key) : q;
  if (!input.agent_id && !input.agent_key) return json({ error: "agent_id or agent_key required" }, 400);
  const { data: agent, error: aErr } = await q.maybeSingle();
  if (aErr) return json({ error: `agent lookup failed: ${aErr.message}` }, 500);
  if (!agent) return json({ error: "agent not found" }, 404);

  try {
    // ---- DRAFT MODE: author a skill from the operator's description ----------
    // Intent-first authoring (vs. evolve's drift-driven review). A cornerstone is
    // drafted from the company's product truth + ICP + role; a child from the
    // agent's cornerstone (its identity) + the task/area the operator describes.
    if (input.mode === "draft") {
      const kind = input.kind === "cornerstone" ? "cornerstone" : "child";
      const intent = (input.intent ?? "").trim();
      if (!intent) return json({ error: "Describe what you want this skill to do/be (intent is required)." }, 400);
      const area = (input.area ?? "").trim().toLowerCase() || null;

      const ground: string[] = [];
      if (kind === "cornerstone") {
        // Aggregate product truth + ICP across the org's product records.
        const { data: pf } = await supabase
          .from("record_fields").select("field_key, label, value")
          .not("product_id", "is", null)
          .in("field_key", ["overview", "value_prop", "icp", "target_customer", "positioning", "differentiation"])
          .limit(40);
        const fields = (pf ?? []) as { field_key: string; label: string | null; value: string | null }[];
        const filled = fields.filter((f) => (f.value ?? "").trim());
        if (filled.length) ground.push("PRODUCT TRUTH & ICP (tailor the identity to this company):", ...filled.map((f) => `• ${f.label || f.field_key}: ${f.value}`));
      } else {
        // The cornerstone the child builds on.
        const { data: cornerRow } = await supabase
          .from("agent_skills").select("skills ( name, instructions )")
          .eq("agent_id", agent.id).eq("is_cornerstone", true).maybeSingle();
        // deno-lint-ignore no-explicit-any
        const corner = (cornerRow as any)?.skills;
        if (corner?.instructions) ground.push(`THE AGENT'S CORNERSTONE (its identity — this child skill builds on it, does not restate it):\n## ${corner.name}\n${corner.instructions}`);
      }

      // Light area intelligence: themes (scoped to product/gtm when the area maps).
      const cat = area === "product" ? "product" : area === "gtm" ? "gtm" : null;
      let tQ = supabase.from("signal_themes").select("title, summary, recommendation, category").order("last_evidence_at", { ascending: false }).limit(12);
      if (cat) tQ = tQ.eq("category", cat);
      const { data: themes } = await tQ;
      if ((themes ?? []).length) ground.push("", "RELEVANT THEMES:", ...(themes ?? []).map((t) => `• (${t.category}) ${t.title}${t.summary ? ` — ${t.summary}` : ""}${t.recommendation ? ` → ${t.recommendation}` : ""}`));

      const QBAR = SKILL_QBAR;

      const system = kind === "cornerstone"
        ? [
            `You are drafting the CORNERSTONE skill — the always-on IDENTITY — of ${agent.name}${agent.role ? `, ${agent.role}` : ""}, an executive agent in SingleStack.`,
            "The cornerstone defines who this agent IS and how it operates across EVERY job, tailored to this company's product truth, ICP, and GTM. It is general — not task-specific.",
            QBAR,
            "CORNERSTONE SHAPE (identity, same bar), second person ('You are…'). description: the role, what it owns, and that it's the always-on identity for this agent. Body sections, in order: '## What you own' · '## How you operate' (decision criteria, not platitudes) · '## Scope & handoffs' (what's YOURS vs what you DEFER, and to which other officer — this is what keeps agents from contradicting each other) · '## How you act' (propose-never-apply; abstain or escalate when evidence is thin or the call is irreversible) · '## What good looks like'.",
            "Set areas to [] (a cornerstone is general). Set connectors only if the identity clearly depends on a specific external system; otherwise [].",
          ].join("\n")
        : [
            `You are drafting a CHILD skill for ${agent.name}${agent.role ? `, ${agent.role}` : ""}, an executive agent in SingleStack.`,
            "A child skill is task/area-specific and BUILDS ON the agent's cornerstone (its identity, shown in grounding). Focused direction for ONE kind of work — do NOT restate the identity.",
            QBAR,
            "CHILD BODY SECTIONS, in order: '## When to use' (bullet triggers + a 'Don't use for' line naming the right sibling skill) · '## Inputs' (named SingleStack data) · '## Procedure' (executable, with criteria/thresholds) · '## Output' (the exact shape) · '## Worked example' (one concrete example) · '## Reject / push back if'. Ground every input and the example in this company's product truth, GTM/personas, and the area intelligence provided.",
            `Set areas to the relevant surface keys from this set: ${AREA_KEYS.join(", ")}. Set connectors to any external MCP systems the skill clearly needs, by label (e.g. DeepWiki, G2, GitHub). Use [] if none.`,
          ].join("\n");

      // Improve mode: an existing playbook is supplied → refine it in place rather
      // than author from scratch. Same schema/output; the instruction is the ask.
      const current = (input.current ?? "").trim();
      const userMsg = [
        current
          ? `IMPROVE THIS EXISTING ${kind === "cornerstone" ? "CORNERSTONE" : "CHILD SKILL"} PLAYBOOK — keep its intent, apply the change, AND bring it fully up to the quality bar above (add any missing sections — named inputs, an operational procedure, an explicit output, a worked example, 'reject if'). Return the FULL improved playbook:\n${current}\n\nTHE IMPROVEMENT THE OPERATOR WANTS:\n${intent}`
          : `WHAT THE OPERATOR WANTS THIS ${kind === "cornerstone" ? "AGENT (its cornerstone)" : "CHILD SKILL"} TO DO/BE:\n${intent}`,
        area ? `\nTARGET AREA: ${area}` : "",
        ground.length ? `\n\nGROUNDING:\n${ground.join("\n")}` : "",
        `\n\nGOLD-STANDARD EXAMPLE (a skill at the required bar — your output must match this depth and structure):\n${exemplarFor(kind === "cornerstone" ? "cornerstone" : "child")}`,
        current ? "\n\nReturn the improved skill now." : "\n\nDraft the skill now.",
      ].filter(Boolean).join("");

      const anthropic = new Anthropic({ apiKey: key });
      const pol = await resolveModelPolicy(supabase, { task: "evolve_draft", agentId: agent.id, area, fallback: { model: MODEL, effort: "high" } });
      const resp = (await anthropic.messages.create({
        model: pol.model, max_tokens: 8000, thinking: { type: "adaptive" },
        output_config: { effort: pol.effort, format: { type: "json_schema", schema: DRAFT_SCHEMA } },
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userMsg }],
        // deno-lint-ignore no-explicit-any
      } as any)) as Anthropic.Message;
      await logUsage(supabase, { task: "evolve_draft", model: pol.model, usage: resp.usage, agentId: agent.id });
      const block = resp.content.find((b) => b.type === "text");
      if (!block || block.type !== "text") throw new Error("no draft returned");
      const d = JSON.parse(block.text) as { name: string; description: string; category: string; instructions: string; areas: string[]; connectors: string[]; rationale: string };
      const category = ["product", "gtm", "research", "general"].includes(d.category) ? d.category : "general";
      const areas = kind === "cornerstone" ? [] : (Array.isArray(d.areas) ? d.areas.map((a) => String(a).toLowerCase()).filter((a) => AREA_KEYS.includes(a)) : []);
      const connectors = Array.isArray(d.connectors) ? d.connectors.map((c) => String(c).trim()).filter(Boolean) : [];
      return json({ draft: { name: d.name, description: d.description ?? "", category, instructions: d.instructions, areas, connectors, rationale: d.rationale ?? "", kind } });
    }

    // ---- EVOLVE MODE (default): review attached skills against new intelligence ----
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
    const seesCaps = areas.includes("capabilities") || seesSignals;

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
      (seesSignals || seesCaps)
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

    // The concrete WORK this agent is aligned to (initiatives/tasks) + the signals
    // tied to it. Skills should sharpen against what the agent is actually on the
    // hook for, not just ambient intelligence.
    const { data: alignRows } = await supabase
      .from("agent_alignments")
      .select("role, initiative_id, workstream_id, initiatives(title, stage), initiative_workstreams(title, area)")
      .eq("agent_id", agent.id);
    // deno-lint-ignore no-explicit-any
    const aRows = (alignRows ?? []) as any[];
    let alignText = "";
    if (aRows.length) {
      const initIds = [...new Set(aRows.map((r) => r.initiative_id).filter(Boolean))] as string[];
      const sigByInit: Record<string, string[]> = {};
      if (initIds.length) {
        const { data: links } = await supabase.from("initiative_signals").select("initiative_id, signals(title)").in("initiative_id", initIds);
        // deno-lint-ignore no-explicit-any
        for (const l of (links ?? []) as any[]) if (l.signals) (sigByInit[l.initiative_id] ??= []).push(l.signals.title);
      }
      // deno-lint-ignore no-explicit-any
      alignText = aRows.map((r: any) => r.workstream_id && r.initiative_workstreams
        ? `• [${r.role}] task: ${r.initiative_workstreams.title} (${r.initiative_workstreams.area})`
        : r.initiatives ? `• [${r.role}] initiative: ${r.initiatives.title}${r.initiatives.stage ? ` (${r.initiatives.stage})` : ""}${(sigByInit[r.initiative_id] ?? []).length ? ` — signals: ${(sigByInit[r.initiative_id] ?? []).slice(0, 5).join("; ")}` : ""}` : "").filter(Boolean).join("\n");
    }

    // Outcome signal: answers the operator marked NOT helpful — the strongest cue
    // for what a skill should fix. Evolution should not be blind to results.
    const { data: fbRows } = await supabase
      .from("agent_runs").select("feedback, reason_tags")
      .eq("agent_id", agent.id).eq("rating", "not_helpful")
      .order("rated_at", { ascending: false }).limit(8);
    const negFeedback = (fbRows ?? []) as { feedback: string | null; reason_tags: string[] | null }[];
    const feedbackText = negFeedback.length
      ? negFeedback.map((r) => `• ${r.reason_tags?.length ? `[${r.reason_tags.join(", ")}] ` : ""}${r.feedback ?? "(marked not helpful)"}`).join("\n")
      : "";

    const digest = [
      "RECONCILED THEMES (durable patterns — the substance of what has changed):",
      ...(themes ?? []).map((t) => `• [${t.state}/${t.momentum}${t.conf_level != null ? `, conf ${t.conf_level}` : ""}] (${t.category}) ${t.title}${t.summary ? ` — ${t.summary}` : ""}${t.recommendation ? ` → ${t.recommendation}` : ""}`),
      ...(capSigs.length ? [
        "",
        "FRONTIER MODEL CAPABILITIES (what is now POSSIBLE to leverage). Treat these as opportunities to upgrade how THIS agent works — in its own domain, whatever that is (product strategy, GTM, narrative, or engineering), not only engineering:",
        ...capSigs.map((s) => `• ${s.metadata?.provider ? `[${s.metadata.provider}${s.metadata?.area ? `/${s.metadata.area}` : ""}] ` : ""}${s.title}${s.why ? ` — ${s.why}` : ""}`),
      ] : []),
      ...(seesSignals ? ["", "RECENT SIGNALS:", ...sigs.map((s) => `• ${s.title}${s.why ? ` (${s.why})` : ""}`)] : []),
      ...(alignText ? ["", "WORK THIS AGENT IS ALIGNED TO (its standing remit — bias skills toward serving this well):", alignText] : []),
      ...(feedbackText ? ["", "OPERATOR FEEDBACK — recent answers marked NOT helpful (evolve skills to fix the underlying pattern):", feedbackText] : []),
    ].join("\n");

    const skillList = skills.map((s) =>
      `### skill_id: ${s.id}\nName: ${s.name}${s.category ? ` (${s.category})` : ""}\nDescription: ${s.description ?? "—"}\nCurrent instructions:\n${s.instructions ?? "(none yet)"}`,
    ).join("\n\n");

    const system = [
      `You evolve the playbooks ("instructions") of ${agent.name}${agent.role ? `, ${agent.role}` : ""}, an executive agent, so they stay current with new intelligence.`,
      "",
      SKILL_QBAR,
      "",
      "REVISE an existing skill when the new intelligence (themes + signals) MEANINGFULLY changes how that EXISTING capability should be applied — same job, sharper playbook. For each skill:",
      "• If it does: set change=true and rewrite the FULL instructions — preserve the skill's intent, evolve the specifics, and keep it at SingleStack's quality bar (a child: named inputs · an operational procedure with criteria · an explicit output · a worked example · a 'reject if' list, plus a routing-signal description; a cornerstone: what you own · how you operate · scope & handoffs · how you act · what good looks like). Not a changelog. Cite the exact theme/signal titles in `drivers`.",
      "• If it does NOT: set change=false, leave proposed_instructions empty, drivers empty, and say why in one line in rationale. Do NOT manufacture changes — a no-op is the right answer when nothing relevant shifted.",
      "Return one revisions entry per skill, keyed by the exact skill_id given.",
      "",
      "ADD a new skill ONLY when the intelligence reveals a capability this agent genuinely LACKS — a new capability, not a sharpening of an existing skill (e.g. a new platform/model capability or market motion that needs its own playbook). Put these in new_skills with a tight name, one-line description, the best-fit category, and a usable instructions playbook. Be conservative: most reviews should add zero new skills. If nothing warrants a new capability, return an empty new_skills array.",
      "",
      "Restraint is the point: a review that changes little is a sign of health, not failure. Do not pad.",
    ].join("\n");

    const userMsg = `INTELLIGENCE DIGEST (scoped to this agent's connected areas: ${areas.join(", ")}):\n${digest}\n\nSKILLS TO REVIEW:\n${skillList}\n\nPropose evolutions.`;

    const anthropic = new Anthropic({ apiKey: key });
    const pol = await resolveModelPolicy(supabase, { task: "evolve_skills", agentId: agent.id, fallback: { model: MODEL, effort: "high" } });
    const resp = (await anthropic.messages.create({
      model: pol.model,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: pol.effort, format: { type: "json_schema", schema: SCHEMA } },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userMsg }],
      // deno-lint-ignore no-explicit-any
    } as any)) as Anthropic.Message;
    await logUsage(supabase, { task: "evolve_skills", model: pol.model, usage: resp.usage, agentId: agent.id });

    const block = resp.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new Error("no revisions returned");
    const parsed = JSON.parse(block.text) as {
      revisions?: { skill_id: string; change: boolean; proposed_instructions: string; rationale: string; drivers: string[] }[];
      new_skills?: { name: string; description: string; category: string; instructions: string; areas?: string[]; connectors?: string[]; rationale: string; drivers: string[] }[];
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
        areas: Array.isArray(n.areas) ? n.areas.map((a) => String(a).toLowerCase()).filter((a) => AREA_KEYS.includes(a)) : [],
        connectors: Array.isArray(n.connectors) ? n.connectors.map((c) => String(c).trim()).filter(Boolean) : [],
        rationale: n.rationale ?? "",
        drivers: n.drivers ?? [],
      }));

    return json({ revisions, new_skills: newSkills, reviewed: skills.length });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
