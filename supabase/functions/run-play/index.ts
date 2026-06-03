// ============================================================================
// run-play — run ONE Play (a typed agent analysis) over ONE target.
//
// A Play is an officer's analytical function with a fixed output shape. The same
// engine runs all of them; the agent's lens (system prompt + skills) shapes the
// content. v1 targets a competitor — four officers, four artifacts:
//   product_standing (CPO) · build_to_beat (CEng) · narrative_angle (CCO) · win_plan (CRO)
//
// Why per-target (not "the whole process"): one competitor + its context is a
// small, bounded prompt — fast, cacheable (the agent prefix is identical across
// a fan-out), retriable, and parallelizable. The client fires the four Plays
// concurrently; each returns its own structured artifact (agent_artifacts) and
// is logged in agent_runs so the outcome loop (rating) applies.
//
// Runs as the caller (JWT forwarded) → RLS scopes everything to their org.
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
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "content-type": "application/json" } });

// The Play registry. Same output shape for every Play (one renderer); the lens
// + focus + target differ. agent_key is the best-fit officer that runs it.
const PLAYS: Record<string, { label: string; agent_key: string; target: string; focus: string; sections_hint: string }> = {
  product_standing: {
    label: "Product standing",
    agent_key: "cpo",
    target: "competitor",
    focus: "Assess where OUR product stands versus this competitor, capability by capability — where we clearly win, where we're at parity, and where we lose. Be specific and honest (don't flatter us). Ground each call in the capability matrix scores, the battlecard, and the signals.",
    sections_hint: "Sections to produce: 'Where we win', 'At parity', 'Where we lose', 'Biggest gap to close'.",
  },
  build_to_beat: {
    label: "Build-to-beat",
    agent_key: "ceng",
    target: "competitor",
    focus: "From an engineering lens: what should we BUILD to catch up where we're behind and pull further ahead where we lead? For each move, note rough effort (S/M/L) and the leverage or technical risk. Be buildable and concrete, not aspirational.",
    sections_hint: "Sections to produce: 'Catch-up builds', 'Leap-ahead builds', 'Sequencing & effort', 'Technical risks'.",
  },
  narrative_angle: {
    label: "Narrative angle",
    agent_key: "cco",
    target: "competitor",
    focus: "How should we tell our story against this competitor? Amplify genuine strengths, honestly reframe (pad) weaknesses, and find the narrative wedge that reframes the category in our favor. No hype — concrete, human language.",
    sections_hint: "Sections to produce: 'Strengths to amplify', 'Weaknesses to reframe', 'The wedge (story arc)', 'Messages to avoid'.",
  },
  win_plan: {
    label: "Win plan",
    agent_key: "cro",
    target: "competitor",
    focus: "How do we WIN deals against this competitor? Where we win, traps to set early, how to handle their strongest objections, and the proof points that close. Make it usable by a rep on a live deal.",
    sections_hint: "Sections to produce: 'Where we win', 'Traps to set', 'Objection handling', 'Proof points'.",
  },
  // ---- Initiative Plays — the same engine, pointed at the work itself. --------
  initiative_review: {
    label: "Initiative review",
    agent_key: "cpo",
    target: "initiative",
    focus: "Review this initiative as a bet: is the scope right, is it sequenced sensibly, what is the single biggest risk to the outcome, and how strong is the evidence behind it? Be candid — say so if it looks thin or premature.",
    sections_hint: "Sections to produce: 'The bet', 'Scope check', 'Sequencing', 'Biggest risk'.",
  },
  delivery_risk: {
    label: "Delivery risk",
    agent_key: "ceng",
    target: "initiative",
    focus: "From an engineering lens, what could derail delivery of this initiative? Call out technical risks, dependencies, and the riskiest workstream, each with a concrete de-risking move.",
    sections_hint: "Sections to produce: 'Technical risks', 'Dependencies', 'Riskiest workstream', 'De-risking moves'.",
  },
  gtm_readiness: {
    label: "GTM readiness",
    agent_key: "cro",
    target: "initiative",
    focus: "Is this initiative ready to win in-market? Assess positioning readiness, the proof we will need, and the GTM gaps to close before launch.",
    sections_hint: "Sections to produce: 'Positioning readiness', 'Proof needed', 'GTM gaps', 'Launch checklist'.",
  },
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headline: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          body: { type: "string" },
          evidence: { type: "array", items: { type: "string" } },
        },
        required: ["title", "body", "evidence"],
      },
    },
    recommendations: { type: "array", items: { type: "string" } },
    confidence: { type: "string" },
  },
  required: ["headline", "sections", "recommendations", "confidence"],
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

  let input: { function_key?: string; target_type?: string; target_id?: string };
  try { input = await req.json(); } catch { return json({ error: "invalid JSON body" }, 400); }
  const { function_key, target_type, target_id } = input;
  if (!function_key || !PLAYS[function_key]) return json({ error: `unknown function_key '${function_key}'` }, 400);
  if (!target_id) return json({ error: "target_id is required" }, 400);
  if (target_type !== PLAYS[function_key].target) return json({ error: `the "${PLAYS[function_key].label}" play runs on a ${PLAYS[function_key].target}, not a ${target_type}` }, 400);

  const def = PLAYS[function_key];

  // Org config override (visible + editable in the Plays UI). Falls back to the
  // code default when no row exists — existing orgs work with zero seeding.
  const { data: cfg } = await supabase.from("plays").select("label, agent_id, focus, sections, is_active").eq("key", function_key).maybeSingle();
  if (cfg && cfg.is_active === false) return json({ error: `the "${def.label}" play is turned off` }, 400);
  const play = {
    label: cfg?.label || def.label,
    focus: cfg?.focus || def.focus,
    sections_hint: cfg?.sections || def.sections_hint,
  };

  // The officer that runs this Play — the configured agent, else the default key.
  let agentQ = supabase.from("agents").select("id, org_id, name, role, model, system_prompt").eq("is_active", true);
  agentQ = cfg?.agent_id ? agentQ.eq("id", cfg.agent_id) : agentQ.eq("key", def.agent_key);
  const { data: agent, error: aErr } = await agentQ.maybeSingle();
  if (aErr) return json({ error: `agent lookup failed: ${aErr.message}` }, 500);
  if (!agent) return json({ error: `the officer for the "${def.label}" play isn't active` }, 404);

  const model = (agent.model as string) || DEFAULT_MODEL;
  const orgId = agent.org_id as string;

  try {
    // Agent skills (shared across target types).
    const { data: skillRows } = await supabase.from("agent_skills").select("skills ( name, instructions )").eq("agent_id", agent.id);
    // deno-lint-ignore no-explicit-any
    const skills = (skillRows ?? []).map((r: any) => r.skills).filter(Boolean);

    // ---- Target context: built per target type. ------------------------------
    let ctx = "";
    let targetName = "";
    if (def.target === "competitor") {
      const { data: comp } = await supabase.from("competitors").select("name, relationship, website, notes").eq("id", target_id).maybeSingle();
      if (!comp) return json({ error: "competitor not found" }, 404);
      targetName = comp.name;
      const [{ data: cards }, { data: caps }, { data: scores }, { data: rawSigs }] = await Promise.all([
        supabase.from("battlecard_items").select("kind, title, detail").eq("competitor_id", target_id),
        supabase.from("capabilities").select("id, name").order("position"),
        supabase.from("capability_scores").select("capability_id, competitor_id, score"),
        supabase.from("signals").select("title, why, metadata").order("observed_at", { ascending: false, nullsFirst: false }).limit(120),
      ]);
      const SCORE_WORD = ["none", "partial", "good", "strong"];
      const scoreMap = new Map<string, { us?: number; them?: number }>();
      for (const s of scores ?? []) {
        const cell = scoreMap.get(s.capability_id) ?? {};
        if (s.competitor_id === null) cell.us = s.score;
        else if (s.competitor_id === target_id) cell.them = s.score;
        scoreMap.set(s.capability_id, cell);
      }
      const matrixLines = (caps ?? []).map((c) => {
        const cell = scoreMap.get(c.id);
        if (!cell || (cell.us == null && cell.them == null)) return null;
        const us = cell.us != null ? SCORE_WORD[cell.us] ?? cell.us : "—";
        const them = cell.them != null ? SCORE_WORD[cell.them] ?? cell.them : "—";
        return `  • ${c.name}: us=${us}, them=${them}`;
      }).filter(Boolean);
      // deno-lint-ignore no-explicit-any
      const sigs = (rawSigs ?? []).filter((s: any) => s.metadata?.competitor_id === target_id).slice(0, 20);
      const cardsByKind: Record<string, string[]> = {};
      for (const c of cards ?? []) (cardsByKind[c.kind] ??= []).push(`${c.title}${c.detail ? ` — ${c.detail}` : ""}`);
      ctx = [
        `COMPETITOR: ${comp.name} (${comp.relationship})${comp.website ? ` · ${comp.website}` : ""}`,
        comp.notes ? `Overview: ${comp.notes}` : "",
        matrixLines.length ? `\nCapability matrix (our score vs theirs, none<partial<good<strong):\n${matrixLines.join("\n")}` : "",
        Object.keys(cardsByKind).length ? `\nExisting battlecard:\n${Object.entries(cardsByKind).map(([k, v]) => `  [${k}] ${v.join(" | ")}`).join("\n")}` : "",
        sigs.length ? `\nSignals about this competitor (use as evidence; cite by title):\n${sigs.map((s) => `  • ${s.title}${s.why ? ` — ${s.why}` : ""}`).join("\n")}` : "\n(No signals logged about this competitor yet — say so where evidence is thin.)",
      ].filter(Boolean).join("\n");
    } else {
      // initiative — the work itself + its tasks + the signals behind it.
      const { data: ini } = await supabase.from("initiatives").select("title, description, scope, stage, lifecycle").eq("id", target_id).maybeSingle();
      if (!ini) return json({ error: "initiative not found" }, 404);
      targetName = ini.title;
      const [{ data: ws }, { data: links }] = await Promise.all([
        supabase.from("initiative_workstreams").select("title, area, stage").eq("initiative_id", target_id),
        supabase.from("initiative_signals").select("signals(title, why)").eq("initiative_id", target_id),
      ]);
      // deno-lint-ignore no-explicit-any
      const isigs = ((links ?? []) as any[]).map((l) => l.signals).filter(Boolean);
      ctx = [
        `INITIATIVE: ${ini.title} (scope: ${ini.scope ?? "—"}${ini.stage ? `, stage ${ini.stage}` : ""}${ini.lifecycle ? `, ${ini.lifecycle}` : ""})`,
        ini.description ? `Description: ${ini.description}` : "",
        (ws ?? []).length ? `\nWorkstreams:\n${(ws ?? []).map((w) => `  • [${w.area}${w.stage ? `, ${w.stage}` : ""}] ${w.title}`).join("\n")}` : "\n(No workstreams yet.)",
        isigs.length ? `\nSignals behind it (use as evidence; cite by title):\n${isigs.map((s) => `  • ${s.title}${s.why ? ` — ${s.why}` : ""}`).join("\n")}` : "\n(No signals linked — say so where evidence is thin.)",
      ].filter(Boolean).join("\n");
    }

    const skillsBlock = skills.length
      ? `\n\nYOUR SKILLS (apply these playbooks):\n${skills.map((s) => `## ${s.name}\n${s.instructions ?? ""}`).join("\n\n")}`
      : "";

    const system = [
      agent.system_prompt || `You are ${agent.name}${agent.role ? `, ${agent.role}` : ""}, an executive agent in SingleStack.`,
      skillsBlock,
      `\n\nYou are running the "${play.label}" analysis on this ${def.target}. ${play.focus}`,
      `\n${play.sections_hint}`,
      "\nRules: Be specific and concrete, never generic. Ground every claim in the provided context; in each section's `evidence`, list the exact signal/battlecard/matrix items you leaned on (or note 'thin evidence' honestly). headline = a one-line take. recommendations = concrete next steps. confidence = a short, honest read (e.g. 'Medium — matrix is filled but only 2 signals').",
    ].join("");

    const anthropic = new Anthropic({ apiKey: key });
    const resp = (await anthropic.messages.create({
      model,
      max_tokens: 3000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `${ctx}\n\nRun the ${play.label} analysis now.` }],
      // deno-lint-ignore no-explicit-any
    } as any)) as Anthropic.Message;

    const block = resp.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new Error("no analysis returned");
    const payload = JSON.parse(block.text);

    // Log the run (so the outcome loop applies) + persist the artifact.
    const price = PRICING[model];
    const cost = price ? (resp.usage.input_tokens * price.input + resp.usage.output_tokens * price.output) / 1_000_000 : null;
    const { data: run } = await supabase.from("agent_runs").insert({
      org_id: orgId, agent_id: agent.id, status: "succeeded",
      input: { kind: "play", function_key, target_type, target_id }, output: payload.headline ?? "(artifact)", model,
      input_tokens: resp.usage.input_tokens, output_tokens: resp.usage.output_tokens, cost_usd: cost,
      finished_at: new Date().toISOString(),
    }).select("id").single();

    const title = `${play.label} · ${targetName}`;
    const { data: artifact, error: artErr } = await supabase.from("agent_artifacts").insert({
      org_id: orgId, agent_id: agent.id, function_key, target_type, target_id, title,
      status: "draft", payload, run_id: run?.id ?? null,
    }).select("id, function_key, title, status, payload, run_id, agent_id").single();
    if (artErr) throw artErr;

    return json({ artifact, officer: agent.name });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
