// ============================================================================
// score-capabilities — the agent that gives the capability matrix a brain.
//
// Plain English: reads ONE competitor's evidence — their per-competitor themes
// (product + gtm), their recent signals, the capabilities we compare on, and
// the score each capability currently holds for them — and proposes a fresh
// score (0..3) for the capabilities where the evidence justifies one. Every
// proposed score MUST cite the signals that back it; a capability with no
// supporting evidence is left alone (no guessing the matrix full).
//
// Scores THEM (the competitor), not us: the evidence here is the competitor's
// signals. Our own (competitor_id null) scores are about our product and are
// set elsewhere. Output is HITL-absolute, exactly like battlecard-analyst:
// proposals queue as intel_updates (kind 'capability_score') for the same
// accept/edit/reject + rationale teaching loop. Nothing writes the matrix
// directly — resolve-intel-update upserts the cell on accept.
//
// Input (POST): { competitor_id, workflow_id } — step 1 of the workflow is the
//   scorer: the USER'S agent + cornerstone skills + the step's child skill
//   carry identity and playbook; this function is only the substrate + the gate.
// Runs as caller (JWT) → RLS fences everything to the org. Secret: ANTHROPIC_API_KEY.
// ============================================================================

import Anthropic from "npm:@anthropic-ai/sdk@0.69.0";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { resolveModelPolicy } from "../_shared/ai_policy.ts";

const MODEL = "claude-opus-5";
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 5, output: 25 },
};
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "content-type": "application/json" } });

const LABEL = ["none", "partial", "good", "strong"]; // 0..3

// Structured output: a score per capability the agent can back with evidence.
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    scores: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          capability_index: { type: "integer" },
          score: { type: "integer", enum: [0, 1, 2, 3] },
          signal_indices: { type: "array", items: { type: "integer" } },
          rationale: { type: "string" },
        },
        required: ["capability_index", "score", "signal_indices", "rationale"],
      },
    },
  },
  required: ["scores"],
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

  const body = await req.json().catch(() => ({}));
  const competitorId = body.competitor_id as string | undefined;
  const workflowId = body.workflow_id as string | undefined;
  if (!competitorId) return json({ error: "competitor_id required" }, 400);
  if (!workflowId) return json({ error: "workflow_id required — attach a workflow (agent × scoring skill)" }, 400);

  const { data: orgId } = await supabase.rpc("current_org_id");
  if (!orgId) return json({ error: "could not resolve org" }, 401);

  // The USER-BUILT configuration: this function is only the substrate + the
  // gate. Step 1 of the attached workflow is the scorer — its agent and child
  // skill carry the identity and the playbook; nothing is hardcoded here.
  const { data: wf } = await supabase.from("workflows").select("id, name, steps").eq("id", workflowId).maybeSingle();
  if (!wf) return json({ error: `no workflow with id '${workflowId}'` }, 404);
  const step = (Array.isArray(wf.steps) ? wf.steps : [])[0] as { agent_id?: string; skill_id?: string | null; instruction?: string } | undefined;
  if (!step?.agent_id) return json({ error: `workflow "${wf.name}" has no step 1 with an agent — add one (agent × scoring skill)` }, 400);

  const { data: agent } = await supabase.from("agents").select("id, name, role, model, system_prompt").eq("id", step.agent_id).eq("is_active", true).maybeSingle();
  if (!agent) return json({ error: "step 1's agent was not found or is inactive" }, 404);
  const { data: corner } = await supabase.from("agent_skills").select("skills ( name, instructions )").eq("agent_id", agent.id).eq("is_cornerstone", true);
  // deno-lint-ignore no-explicit-any
  const cornerstones = ((corner ?? []) as any[]).map((r) => r.skills).filter(Boolean) as { name: string; instructions: string | null }[];
  let childSkill: { name: string; instructions: string | null } | null = null;
  if (step.skill_id) {
    const { data: sk } = await supabase.from("skills").select("name, instructions").eq("id", step.skill_id).maybeSingle();
    childSkill = sk ?? null;
  }
  if (!childSkill) return json({ error: `workflow "${wf.name}" step 1 has no skill — attach your scoring skill to it` }, 400);
  const pol = await resolveModelPolicy(supabase, { task: "score_capabilities", agentId: agent.id, fallback: { model: agent.model || MODEL, effort: "high" } });
  const model = pol.model;

  const { data: run } = await supabase.from("agent_runs")
    .insert({ org_id: orgId, agent_id: agent.id, status: "running", input: { competitor_id: competitorId, task: "score_capabilities" }, model })
    .select("id").single();
  const runId = run?.id;
  const fail = async (msg: string, status = 500) => {
    if (runId) await supabase.from("agent_runs").update({ status: "failed", error: msg, finished_at: new Date().toISOString() }).eq("id", runId);
    return json({ error: msg }, status);
  };

  try {
    // ---- gather the evidence (all RLS-fenced reads) -------------------------
    const [{ data: comp }, { data: themes }, { data: sigs }, { data: caps }, { data: scores }] = await Promise.all([
      supabase.from("competitors").select("id, name, relationship, notes").eq("id", competitorId).maybeSingle(),
      supabase.from("signal_themes").select("id, title, summary, category, state").eq("competitor_id", competitorId).order("last_evidence_at", { ascending: false, nullsFirst: false }).limit(12),
      supabase.from("signals").select("id, title, why, origin, conf_label, observed_at").eq("competitor_id", competitorId).order("observed_at", { ascending: false, nullsFirst: false }).limit(30),
      supabase.from("capabilities").select("id, name, category").order("position").order("created_at"),
      supabase.from("capability_scores").select("capability_id, competitor_id, score").eq("competitor_id", competitorId),
    ]);
    if (!comp) return await fail(`no competitor with id '${competitorId}'`, 404);

    const capList = caps ?? [];
    const sigList = sigs ?? [];
    const themeList = themes ?? [];
    if (capList.length === 0) {
      if (runId) await supabase.from("agent_runs").update({ status: "succeeded", output: "no capabilities", finished_at: new Date().toISOString() }).eq("id", runId);
      return json({ proposed: 0, message: "No capabilities defined yet — add them on the Dashboard matrix first." });
    }
    if (themeList.length === 0 && sigList.length === 0) {
      if (runId) await supabase.from("agent_runs").update({ status: "succeeded", output: "no evidence", finished_at: new Date().toISOString() }).eq("id", runId);
      return json({ proposed: 0, message: `No themes or signals for ${comp.name} yet — log signals (or pull their monitored links) and run synthesis first.` });
    }

    const prevScoreOf = (capId: string) => (scores ?? []).find((s) => s.capability_id === capId)?.score ?? 0;

    // ---- ask Claude (structured output) -------------------------------------
    const anthropic = new Anthropic({ apiKey: key });
    const prompt = [
      `COMPETITOR: ${comp.name} (${comp.relationship})${comp.notes ? `\nOverview: ${comp.notes}` : ""}`,
      `CAPABILITIES TO SCORE (score ${comp.name} on each, 0=none..3=strong; current score in brackets):\n${capList.map((c, i) => `{K${i}} ${c.name}${c.category ? ` [${c.category}]` : ""} — currently ${prevScoreOf(c.id)}/3 (${LABEL[prevScoreOf(c.id)]})`).join("\n")}`,
      themeList.length ? `THEIR THEMES (synthesized intelligence):\n${themeList.map((t) => `[${t.category}/${t.state}] ${t.title} — ${t.summary ?? ""}`).join("\n")}` : "",
      sigList.length ? `THEIR SIGNALS (raw evidence — cite by index):\n${sigList.map((s, i) => `[${i}] (${s.origin ?? "?"} · ${s.conf_label ?? "?"}) ${s.title}${s.why ? " — " + s.why : ""}`).join("\n")}` : "",
    ].filter(Boolean).join("\n\n");

    // Identity and judgment come from the USER'S configuration. Only the GATE
    // CONTRACT — score each capability strictly from cited evidence — is fixed.
    const system = [
      agent.system_prompt || `You are ${agent.name}${agent.role ? `, ${agent.role}` : ""}, an executive agent in SingleStack.`,
      cornerstones.length ? `\nYOUR CORNERSTONE SKILLS (always on):\n${cornerstones.map((s) => `## ${s.name}\n${s.instructions ?? ""}`).join("\n\n")}` : "",
      `\nTHE SKILL FOR THIS TASK — apply it:\n## ${childSkill.name}\n${childSkill.instructions ?? ""}`,
      step.instruction ? `\nSTEP INSTRUCTION: ${step.instruction}` : "",
      `\nGATE CONTRACT (non-negotiable output rules): you are scoring ${comp.name} on each listed capability from 0 (no capability) to 3 (strong, proven capability), STRICTLY from the evidence provided. The scale: 0 = no evidence they do this / known gap; 1 = partial / early / weak; 2 = solid, shipped capability; 3 = strong, differentiated, a clear strength. Return a score ONLY for capabilities the evidence speaks to — every returned score MUST cite the signal indices (signal_indices) that justify it. If the evidence does not address a capability, OMIT it (do not restate the current score, do not guess). If the evidence confirms the current score, you may still return it WITH its citation. rationale = one line tying the score to the cited evidence. Be conservative and honest: a single soft mention is a 1, not a 3.`,
    ].filter(Boolean).join("\n");

    const resp = await anthropic.messages.create({
      model, max_tokens: 3000,
      system,
      messages: [{ role: "user", content: prompt }],
      output_config: { effort: pol.effort, format: { type: "json_schema", schema: SCHEMA } },
      // deno-lint-ignore no-explicit-any
    } as any);

    const text = resp.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    const out = JSON.parse(text) as { scores: { capability_index: number; score: number; signal_indices: number[]; rationale: string }[] };

    const sigIdAt = (i: number) => sigList[i]?.id;
    const now = new Date().toISOString();
    let proposed = 0, skipped = 0;
    for (const sc of out.scores ?? []) {
      const cap = capList[sc.capability_index];
      if (!cap || sc.score < 0 || sc.score > 3) { skipped++; continue; }
      const signal_ids = (sc.signal_indices ?? []).map(sigIdAt).filter(Boolean) as string[];
      // The gate contract requires evidence: a score with no cited signal is dropped.
      if (signal_ids.length === 0) { skipped++; continue; }
      const prev = prevScoreOf(cap.id);
      // No-op proposals (same score, already evidenced) add only review noise.
      if (sc.score === prev && prev !== 0) { skipped++; continue; }
      const { error } = await supabase.from("intel_updates").insert({
        org_id: orgId, scope: "capability", kind: "capability_score",
        payload: {
          competitor_id: competitorId, capability_id: cap.id, capability_name: cap.name,
          score: sc.score, prev_score: prev, signal_ids, rationale: sc.rationale,
          scored_by: agent.name, evidence_at: now,
        },
        summary: `${comp.name} · ${cap.name}: ${LABEL[sc.score]} (${sc.score}/3)${prev !== sc.score ? ` ← was ${LABEL[prev]} (${prev}/3)` : " · confirmed"} · ${signal_ids.length} signal${signal_ids.length === 1 ? "" : "s"}`,
        status: "pending",
      });
      if (!error) proposed++;
    }

    const usage = { input_tokens: resp.usage?.input_tokens ?? 0, output_tokens: resp.usage?.output_tokens ?? 0 };
    const price = PRICING[model];
    const cost = price ? (usage.input_tokens * price.input + usage.output_tokens * price.output) / 1_000_000 : null;
    if (runId) await supabase.from("agent_runs").update({ status: "succeeded", output: JSON.stringify(out), input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, cost_usd: cost, finished_at: new Date().toISOString() }).eq("id", runId);

    return json({ proposed, skipped, message: proposed
      ? `${proposed} capability score${proposed === 1 ? "" : "s"} proposed for ${comp.name} — review them in Signals → Review, then the matrix updates.`
      : `No score changes for ${comp.name}: the current evidence doesn't move any capability. Log more signals and try again.` });
  } catch (e) {
    return await fail(e instanceof Error ? e.message : "scoring run failed");
  }
});
