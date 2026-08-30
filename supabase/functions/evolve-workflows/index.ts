// ============================================================================
// evolve-workflows — the agent workflow-authoring service. Two modes:
//   • evolve (default) — review the workflows this agent owns / runs through
//     against new intelligence and PROPOSE evolved STEPS (drift-driven): resharpen
//     a step's instruction, reorder steps, or add a NEW step covering an emerging
//     capability/theme. Returns { reviewed, revisions: [...] }.
//   • draft  — author ONE new workflow from the operator's intent, grounded in
//     the org's real roster (agents + their child skills) + the target area.
//     Returns { draft: { name, description, target_type, steps, summary,
//     rationale, drivers } }. Writes nothing — the human accepts/edits.
//
// Plain English: a workflow's `steps` are its operating procedure — an ordered
// chain of (agent + skill + instruction). As the market, positioning, product
// releases, and dev strategy shift (captured as signals + reconciled themes),
// that procedure should evolve to match — but never silently. EVOLVE reads the
// agent's workflows + the recent intelligence in its CONNECTED AREAS and asks the
// model to PROPOSE evolved steps for the workflows the new intelligence actually
// changes. It writes NOTHING: it returns proposals the human accepts/edits/
// rejects. Accepting calls apply_workflow_evolution(), which updates the steps
// and records a provenance-tagged workflow_revision (the compounding loop).
//
// Mirrors evolve-skills exactly (CORS, auth, model call, harvest, decorate) but
// for the WORKFLOW domain (steps as the unit instead of a skill's instructions).
// Steps may ONLY reference real roster agent_id/skill_id (same hard constraint as
// draft-workflow). Runs as the caller (JWT forwarded) → RLS scopes to their org.
// Secret: ANTHROPIC_API_KEY.
// ============================================================================

import Anthropic from "npm:@anthropic-ai/sdk@0.69.0";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { logUsage } from "../_shared/ai_usage.ts";
import { resolveModelPolicy } from "../_shared/ai_policy.ts";

const MODEL = "claude-opus-5";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "content-type": "application/json" } });

type Area = "products" | "gtm" | "signals" | "capabilities" | "records";
const ALL_AREAS: Area[] = ["products", "gtm", "signals", "capabilities", "records"];

// A single workflow step: one agent applying one of its child skills (or none)
// toward one task, with a signal-need declaration. Mirrors draft-workflow.
const STEP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    agent_id: { type: "string" },
    skill_id: { type: ["string", "null"] },
    signals: { type: "string", enum: ["none", "internal", "external", "both"] },
    instruction: { type: "string" },
  },
  required: ["agent_id", "skill_id", "signals", "instruction"],
};

// EVOLVE mode: one entry per reviewed workflow; only change=true ones survive
// the post-filter and are returned (decorated for the diff UI).
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
          workflow_id: { type: "string" },
          change: { type: "boolean" },
          proposed_steps: { type: "array", items: STEP_SCHEMA },
          rationale: { type: "string" },
          drivers: { type: "array", items: { type: "string" } },
        },
        required: ["workflow_id", "change", "proposed_steps", "rationale", "drivers"],
      },
    },
  },
  required: ["revisions"],
};

// DRAFT mode returns ONE authored workflow from the operator's intent.
const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    description: { type: "string" },
    target_type: { type: "string", enum: ["product", "gtm", "none"] },
    steps: { type: "array", items: STEP_SCHEMA },
    summary: { type: "string" },
    rationale: { type: "string" },
    drivers: { type: "array", items: { type: "string" } },
  },
  required: ["name", "description", "target_type", "steps", "summary", "rationale", "drivers"],
};

type WorkflowRow = {
  id: string;
  name: string;
  description: string | null;
  trigger: string | null;
  area_id: string | null;
  standard_key: string | null;
  target_type: string | null;
  // deno-lint-ignore no-explicit-any
  steps: any;
};

// Roster step constraint: scrub proposed steps down to real agent_id/skill_id and
// a valid signals enum. Drops steps that reference an agent off the roster; nulls
// a skill_id that isn't one of that agent's child skills. Mirrors the hard
// constraint draft-workflow enforces (steps may only reference the roster).
function sanitizeSteps(
  // deno-lint-ignore no-explicit-any
  raw: any,
  rosterAgentIds: Set<string>,
  childSkillsByAgent: Map<string, Set<string>>,
): { agent_id: string; skill_id: string | null; signals: string; instruction: string }[] {
  if (!Array.isArray(raw)) return [];
  const SIG = new Set(["none", "internal", "external", "both"]);
  return raw
    .filter((s) => s && typeof s === "object" && rosterAgentIds.has(s.agent_id))
    .map((s) => {
      const kids = childSkillsByAgent.get(s.agent_id) ?? new Set<string>();
      const skill_id = s.skill_id && kids.has(s.skill_id) ? (s.skill_id as string) : null;
      const signals = SIG.has(s.signals) ? (s.signals as string) : "none";
      return { agent_id: s.agent_id as string, skill_id, signals, instruction: String(s.instruction ?? "").trim() };
    })
    .filter((s) => s.instruction);
}

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
    agent_id?: string;
    agent_key?: string;
    mode?: string;
    intent?: string;
    // deno-lint-ignore no-explicit-any
    area?: any;
    // deno-lint-ignore no-explicit-any
    standard?: any;
  };
  try { input = await req.json(); } catch { return json({ error: "invalid JSON body" }, 400); }

  // Load the agent (by id or key), RLS-scoped.
  let q = supabase.from("agents").select("id, name, role").eq("is_active", true);
  q = input.agent_id ? q.eq("id", input.agent_id) : input.agent_key ? q.eq("key", input.agent_key) : q;
  if (!input.agent_id && !input.agent_key) return json({ error: "agent_id or agent_key required" }, 400);
  const { data: agent, error: aErr } = await q.maybeSingle();
  if (aErr) return json({ error: `agent lookup failed: ${aErr.message}` }, 500);
  if (!agent) return json({ error: "agent not found" }, 404);

  // ---- roster: real agents + their child skills (shared by both modes) -------
  // Every proposed/drafted step's agent_id/skill_id MUST come from this roster.
  const [{ data: agentsRaw }, { data: agSk }, { data: skillsRaw }, { data: connsAll }] = await Promise.all([
    supabase.from("agents").select("id, name, role").eq("is_active", true).order("name"),
    supabase.from("agent_skills").select("agent_id, skill_id"),
    supabase.from("skills").select("id, name, kind"),
    supabase.from("connections").select("agent_id, area").eq("kind", "internal"),
  ]);
  const skillById = new Map((skillsRaw ?? []).map((s) => [s.id, s] as const));
  const childByAgent = new Map<string, { id: string; name: string }[]>();
  const childIdsByAgent = new Map<string, Set<string>>();
  for (const as of agSk ?? []) {
    const sk = skillById.get(as.skill_id);
    if (!sk || sk.kind === "cornerstone") continue;
    const arr = childByAgent.get(as.agent_id) ?? []; arr.push({ id: sk.id, name: sk.name ?? "skill" }); childByAgent.set(as.agent_id, arr);
    const ids = childIdsByAgent.get(as.agent_id) ?? new Set<string>(); ids.add(sk.id); childIdsByAgent.set(as.agent_id, ids);
  }
  const rosterAgentIds = new Set((agentsRaw ?? []).map((a) => a.id as string));

  try {
    // ---- DRAFT MODE: author ONE workflow from the operator's intent ----------
    // Intent-first authoring (vs. evolve's drift-driven review). Grounds in the
    // roster + the target area's tasks + the area's product/GTM record truth.
    if (input.mode === "draft") {
      const intent = (input.intent ?? "").trim();
      if (!intent) return json({ error: "Describe what you want this workflow to do (intent is required)." }, 400);

      const area = (input.area ?? {}) as { key?: string; label?: string; circle?: "product" | "gtm"; connAreas?: string[]; tasks?: { key: string; label: string }[]; blurb?: string };
      const standard = (input.standard ?? null) as { name?: string; purpose?: string; skills?: string[] } | null;
      const circle: "product" | "gtm" | null = area.circle === "product" ? "product" : area.circle === "gtm" ? "gtm" : null;
      const connAreas = new Set(area.connAreas ?? []);

      // Mark which agents are CONNECTED to this area — steps should prefer them.
      const connectedAgents = new Set((connsAll ?? []).filter((c) => c.agent_id && c.area && connAreas.has(c.area)).map((c) => c.agent_id as string));
      const rosterText = (agentsRaw ?? []).map((a) => {
        const kids = childByAgent.get(a.id) ?? [];
        const tag = connectedAgents.has(a.id) ? " [CONNECTED to this area]" : "";
        return `• ${a.name} (agent_id=${a.id})${tag}\n   child skills: ${kids.length ? kids.map((k) => `${k.name} (skill_id=${k.id})`).join("; ") : "none yet"}`;
      }).join("\n");

      // Light product/GTM record grounding (same field shape as draft-workflow).
      let recordText = "";
      if (circle) {
        const fieldKeys = circle === "product"
          ? ["overview", "value_prop", "category", "strategic_intent", "differentiation"]
          : ["icp", "positioning", "category_pov", "win_themes", "gtm_motion", "primary_persona"];
        const parentCol = circle === "product" ? "product_id" : "gtm_record_id";
        const { data: rf } = await supabase.from("record_fields").select("label, value").not(parentCol, "is", null).in("field_key", fieldKeys).limit(16);
        recordText = (rf ?? []).filter((f) => (f.value ?? "").trim()).map((f) => `• ${f.label}: ${f.value}`).join("\n");
      }

      const tasksText = (area.tasks ?? []).map((t) => `- ${t.label}`).join("\n");
      const target = circle ?? "none";

      const system = [
        `You are authoring a WORKFLOW for ${agent.name}${agent.role ? `, ${agent.role}` : ""} in SingleStack — a saved, ordered task an agent workforce runs.`,
        area.label ? `The workflow serves the "${area.label}" area${circle ? ` (${circle === "product" ? "Build / Product" : "Go-to-market"} circle)` : ""}.${area.blurb ? ` Area intent: ${area.blurb}` : ""}` : "",
        "A workflow is an ORDERED chain of steps. Each step = ONE agent applying ONE of its child skills toward ONE of the area's tasks, threading prior output forward. Cover the area's tasks in a sensible order (e.g. synthesize → decide → draft → validate).",
        "HARD CONSTRAINTS: use ONLY agent_id and skill_id values from the ROSTER below — never invent them. STRONGLY prefer agents marked [CONNECTED to this area]. Set each step's `signals` (none|internal|external|both) by whether that step needs internal product signals, external market signals, both, or none. If a step has no fitting child skill, set skill_id=null and make the instruction self-contained.",
        `Return the workflow: name, description, target_type ("${target}"), an ordered list of steps, a one-line summary, a short rationale, and drivers (the area tasks / record truth that shaped it). Do not invent facts beyond the grounding.`,
      ].filter(Boolean).join("\n\n");

      const userMsg = [
        `WHAT THE OPERATOR WANTS THIS WORKFLOW TO DO:\n${intent}`,
        standard?.name ? `\nSTANDARD PLAYBOOK to instantiate — draft THIS specifically (not a different workflow):\n• ${standard.name}${standard.purpose ? ` — ${standard.purpose}` : ""}${(standard.skills ?? []).length ? `\n• Standard skills it needs: ${(standard.skills ?? []).join(", ")}` : ""}` : "",
        tasksText ? `\nAREA TASKS to cover:\n${tasksText}` : "",
        `\nROSTER (the only agents/skills you may use):\n${rosterText || "(no agents yet — recommend creating/connecting one)"}`,
        recordText ? `\n${circle === "product" ? "PRODUCT" : "GTM"} TRUTH:\n${recordText}` : "",
        `\ntarget_type must be "${target}".`,
        "\nDraft the workflow now.",
      ].filter(Boolean).join("");

      const anthropic = new Anthropic({ apiKey: key });
      const pol = await resolveModelPolicy(supabase, { task: "draft_workflow", agentId: agent.id, area: area.key ?? null, fallback: { model: MODEL, effort: "high" } });
      const resp = (await anthropic.messages.create({
        model: pol.model, max_tokens: 8000, thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: pol.effort, format: { type: "json_schema", schema: DRAFT_SCHEMA } },
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: userMsg }],
        // deno-lint-ignore no-explicit-any
      } as any)) as Anthropic.Message;
      await logUsage(supabase, { task: "draft_workflow", model: pol.model, usage: resp.usage, agentId: agent.id });

      const block = resp.content.find((b) => b.type === "text");
      if (!block || block.type !== "text") throw new Error("no draft returned");
      const d = JSON.parse(block.text) as { name: string; description: string; target_type: string; steps: unknown; summary: string; rationale: string; drivers: string[] };
      const target_type = ["product", "gtm", "none"].includes(d.target_type) ? d.target_type : target;
      const steps = sanitizeSteps(d.steps, rosterAgentIds, childIdsByAgent);
      return json({ draft: { name: d.name, description: d.description ?? "", target_type, steps, summary: d.summary ?? "", rationale: d.rationale ?? "", drivers: Array.isArray(d.drivers) ? d.drivers : [] } });
    }

    // ---- EVOLVE MODE (default): review the agent's workflows vs new intelligence ----
    // The workflows this agent owns OR participates in. We fetch the org's active
    // workflows (RLS-scoped) and keep those where agent_id = this agent OR any
    // step's agent_id = this agent (steps is jsonb — filter in JS).
    const { data: wfRows } = await supabase
      .from("workflows")
      .select("id, name, description, trigger, area_id, standard_key, target_type, steps, agent_id")
      .eq("is_active", true);
    // deno-lint-ignore no-explicit-any
    const all = (wfRows ?? []) as (WorkflowRow & { agent_id: string | null })[];
    const workflows = all.filter((w) => {
      if (w.agent_id === agent.id) return true;
      const steps = Array.isArray(w.steps) ? w.steps : [];
      // deno-lint-ignore no-explicit-any
      return steps.some((s: any) => s && s.agent_id === agent.id);
    }).slice(0, 8);
    if (workflows.length === 0) return json({ reviewed: 0, revisions: [], message: "This agent owns or runs no active workflows yet. Draft a workflow, then evolve it from signals." });

    // Connected areas scope which intelligence we consider (same as evolve-skills).
    const { data: connRows } = await supabase.from("connections").select("area").eq("agent_id", agent.id).eq("kind", "internal");
    const declared = [...new Set((connRows ?? []).map((c) => c.area).filter(Boolean))] as Area[];
    const areas = declared.length ? declared : ALL_AREAS;
    const seesSignals = areas.includes("signals") || areas.includes("records");
    const seesCaps = areas.includes("capabilities") || seesSignals;

    // The intelligence digest: reconciled themes (durable patterns) + recent
    // signals. Scope by category to the agent's areas where possible. Identical
    // harvest to evolve-skills.
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
      return json({ reviewed: workflows.length, revisions: [], message: "No intelligence in this agent's areas yet — log/synthesize signals first, then evolve." });
    }

    // The concrete WORK this agent is aligned to (initiatives/tasks) + the signals
    // tied to it. Identical to evolve-skills.
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

    // Outcome signal: runs the operator marked NOT helpful — the strongest cue for
    // what a workflow should fix. Identical to evolve-skills.
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
        "FRONTIER MODEL CAPABILITIES (what is now POSSIBLE to leverage). Treat these as opportunities to upgrade how THIS agent's workflows operate — in its own domain, whatever that is (product strategy, GTM, narrative, or engineering), not only engineering. An emerging capability/theme may justify ADDING a new step:",
        ...capSigs.map((s) => `• ${s.metadata?.provider ? `[${s.metadata.provider}${s.metadata?.area ? `/${s.metadata.area}` : ""}] ` : ""}${s.title}${s.why ? ` — ${s.why}` : ""}`),
      ] : []),
      ...(seesSignals ? ["", "RECENT SIGNALS:", ...sigs.map((s) => `• ${s.title}${s.why ? ` (${s.why})` : ""}`)] : []),
      ...(alignText ? ["", "WORK THIS AGENT IS ALIGNED TO (its standing remit — bias workflows toward serving this well):", alignText] : []),
      ...(feedbackText ? ["", "OPERATOR FEEDBACK — recent runs marked NOT helpful (evolve workflows to fix the underlying pattern):", feedbackText] : []),
    ].join("\n");

    // The roster the model may draw step agents/skills from (same constraint as draft).
    const rosterText = (agentsRaw ?? []).map((a) => {
      const kids = childByAgent.get(a.id) ?? [];
      return `• ${a.name} (agent_id=${a.id})\n   child skills: ${kids.length ? kids.map((k) => `${k.name} (skill_id=${k.id})`).join("; ") : "none yet"}`;
    }).join("\n");

    // Render each workflow's current steps for the model (step indices preserved).
    const wfList = workflows.map((w) => {
      const steps = Array.isArray(w.steps) ? w.steps : [];
      const stepText = steps.length
        // deno-lint-ignore no-explicit-any
        ? steps.map((s: any, i: number) => {
          const ag = (agentsRaw ?? []).find((a) => a.id === s.agent_id);
          const sk = s.skill_id ? skillById.get(s.skill_id) : null;
          return `  ${i + 1}. agent=${ag?.name ?? s.agent_id} (agent_id=${s.agent_id})${sk ? `, skill=${sk.name} (skill_id=${s.skill_id})` : ", skill=none"}, signals=${s.signals ?? "none"}\n     instruction: ${s.instruction ?? ""}`;
        }).join("\n")
        : "  (no steps yet)";
      return `### workflow_id: ${w.id}\nName: ${w.name}${w.target_type ? ` (${w.target_type})` : ""}${w.trigger ? ` · trigger: ${w.trigger}` : ""}\nDescription: ${w.description ?? "—"}\nCurrent steps:\n${stepText}`;
    }).join("\n\n");

    const system = [
      `You evolve the operating procedures ("steps") of the workflows run by ${agent.name}${agent.role ? `, ${agent.role}` : ""}, an executive agent, so they stay current with new intelligence.`,
      "",
      "A workflow is an ORDERED chain of steps. Each step = { agent_id, skill_id (or null), signals (none|internal|external|both), instruction }. HARD CONSTRAINT: every proposed step's agent_id and skill_id MUST come from the ROSTER below — never invent them. If a step needs no fitting child skill, set skill_id=null and make the instruction self-contained.",
      "",
      "REVISE a workflow when the new intelligence (themes + signals + frontier capabilities) MEANINGFULLY changes how its procedure should run — resharpen a step's instruction, reorder steps, or ADD a new step to cover an emerging capability/theme the procedure now misses. For each workflow:",
      "• If it does: set change=true and return the FULL proposed_steps (the complete ordered chain you propose, not just the delta) — preserve the workflow's intent, evolve the specifics. Cite the exact theme/signal titles that drove it in `drivers`.",
      "• If it does NOT: set change=false, leave proposed_steps empty, drivers empty, and say why in one line in rationale. Do NOT manufacture changes — a no-op is the right answer when nothing relevant shifted.",
      "Return one revisions entry per workflow, keyed by the exact workflow_id given.",
      "",
      "Restraint is the point: a review that changes little is a sign of health, not failure. Do not pad.",
    ].join("\n");

    const userMsg = `INTELLIGENCE DIGEST (scoped to this agent's connected areas: ${areas.join(", ")}):\n${digest}\n\nROSTER (the only agents/skills any step may use):\n${rosterText}\n\nWORKFLOWS TO REVIEW:\n${wfList}\n\nPropose evolutions.`;

    const anthropic = new Anthropic({ apiKey: key });
    const pol = await resolveModelPolicy(supabase, { task: "evolve_skills", agentId: agent.id, fallback: { model: MODEL, effort: "high" } });
    const resp = (await anthropic.messages.create({
      model: pol.model,
      max_tokens: 8000,
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: pol.effort, format: { type: "json_schema", schema: SCHEMA } },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userMsg }],
      // deno-lint-ignore no-explicit-any
    } as any)) as Anthropic.Message;
    await logUsage(supabase, { task: "evolve_skills", model: pol.model, usage: resp.usage, agentId: agent.id });

    const block = resp.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new Error("no revisions returned");
    const parsed = JSON.parse(block.text) as {
      revisions?: { workflow_id: string; change: boolean; proposed_steps: unknown; rationale: string; drivers: string[] }[];
    };

    // Decorate with the workflow's name + current steps so the client can show a
    // clean diff; only return entries that propose a real change, and scrub each
    // proposed step down to the roster (drop off-roster steps, null bad skill_ids).
    const byId = new Map(workflows.map((w) => [w.id, w]));
    const revisions = (parsed.revisions ?? [])
      .filter((r) => r.change && byId.has(r.workflow_id))
      .map((r) => {
        const w = byId.get(r.workflow_id)!;
        const proposed_steps = sanitizeSteps(r.proposed_steps, rosterAgentIds, childIdsByAgent);
        return { r, w, proposed_steps };
      })
      // A revision with no surviving steps after sanitization is not a real change.
      .filter(({ proposed_steps }) => proposed_steps.length > 0)
      .map(({ r, w, proposed_steps }) => ({
        workflow_id: r.workflow_id,
        name: w.name,
        target_type: w.target_type,
        current_steps: Array.isArray(w.steps) ? w.steps : [],
        proposed_steps,
        rationale: r.rationale,
        drivers: Array.isArray(r.drivers) ? r.drivers : [],
      }));

    return json({ reviewed: workflows.length, revisions });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
