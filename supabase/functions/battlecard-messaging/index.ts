// ============================================================================
// battlecard-messaging — the CREATIVE half of the battlecard agent pair.
//
// Plain English: reads the RATIFIED battlecard items for a competitor (the
// analyst's facts, already human-approved) plus the GTM record's positioning,
// messaging, and buyer fields, and drafts the competitive Battlecard section
// — summary, positioning angle, objection/counter responses — in the org's
// voice, adapted to whatever GTM motion the record describes (self-serve,
// product-led, sales-assisted, partner-led, …). Generative by design: its job
// is PERSUASION, but built strictly on the analyst's facts.
// It introduces no new claims; if a point isn't in the ratified items or the
// GTM record, it doesn't get said.
//
// Output flows through the EXISTING field gate: a proposal + proposal_changes
// targeting the GTM record (add_field under the "Battlecard" section, or
// update_field when the field exists), with proposal_signals carrying the
// items' cited evidence forward. Honors the 'records' autonomy dial:
// autonomous → accept_proposal() applies it immediately (ratified as the agent).
//
// Input (POST): { competitor_id, workflow_id } — step 2 of the workflow is the messenger.
// Runs as caller (JWT) → RLS fences everything to the org. Secret: ANTHROPIC_API_KEY.
// ============================================================================

import Anthropic from "npm:@anthropic-ai/sdk@0.69.0";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { resolveModelPolicy } from "../_shared/ai_policy.ts";

const MODEL = "claude-opus-4-8";
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-8": { input: 5, output: 25 },
};
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "content-type": "application/json" } });

const SECTION = "Battlecard";
// The battlecard fields this agent owns on the GTM record.
const FIELDS: { key: string; label: string }[] = [
  { key: "battlecard_summary", label: "Battlecard summary" },
  { key: "talk_track", label: "Talk track" },
  { key: "objection_responses", label: "Objection responses" },
];

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    rationale: { type: "string" },
    conf_level: { type: "number" },
    fields: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          field_key: { type: "string", enum: FIELDS.map((f) => f.key) },
          value: { type: "string" },
        },
        required: ["field_key", "value"],
      },
    },
  },
  required: ["rationale", "conf_level", "fields"],
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
  if (!workflowId) return json({ error: "workflow_id required — attach a workflow (agent × skills) for the battlecard pair" }, 400);

  const { data: orgId } = await supabase.rpc("current_org_id");
  if (!orgId) return json({ error: "could not resolve org" }, 401);

  // The USER-BUILT configuration: step 2 of the attached workflow is the
  // messenger — its agent and child skill carry the identity and the playbook;
  // this function is only the execution substrate + the proposals gate.
  const { data: wf } = await supabase.from("workflows").select("id, name, steps").eq("id", workflowId).maybeSingle();
  if (!wf) return json({ error: `no workflow with id '${workflowId}'` }, 404);
  const step = (Array.isArray(wf.steps) ? wf.steps : [])[1] as { agent_id?: string; skill_id?: string | null; instruction?: string } | undefined;
  if (!step?.agent_id) return json({ error: `workflow "${wf.name}" has no step 2 with an agent — add one (agent × messenger skill)` }, 400);

  const { data: agent } = await supabase.from("agents").select("id, name, role, model, system_prompt").eq("id", step.agent_id).eq("is_active", true).maybeSingle();
  if (!agent) return json({ error: "step 2's agent was not found or is inactive" }, 404);
  const { data: corner } = await supabase.from("agent_skills").select("skills ( name, instructions )").eq("agent_id", agent.id).eq("is_cornerstone", true);
  // deno-lint-ignore no-explicit-any
  const cornerstones = ((corner ?? []) as any[]).map((r) => r.skills).filter(Boolean) as { name: string; instructions: string | null }[];
  let childSkill: { name: string; instructions: string | null } | null = null;
  if (step.skill_id) {
    const { data: sk } = await supabase.from("skills").select("name, instructions").eq("id", step.skill_id).maybeSingle();
    childSkill = sk ?? null;
  }
  if (!childSkill) return json({ error: `workflow "${wf.name}" step 2 has no skill — attach your messenger skill to it` }, 400);
  const pol = await resolveModelPolicy(supabase, { task: "battlecard_messaging", agentId: agent.id, fallback: { model: agent.model || MODEL, effort: "high" } });
  const model = pol.model;

  const { data: run } = await supabase.from("agent_runs")
    .insert({ org_id: orgId, agent_id: agent.id, status: "running", input: { competitor_id: competitorId }, model })
    .select("id").single();
  const runId = run?.id;
  const fail = async (msg: string, status = 500) => {
    if (runId) await supabase.from("agent_runs").update({ status: "failed", error: msg, finished_at: new Date().toISOString() }).eq("id", runId);
    return json({ error: msg }, status);
  };

  try {
    // ---- the facts: competitor + its RATIFIED battlecard items --------------
    const [{ data: comp }, { data: items }] = await Promise.all([
      supabase.from("competitors").select("id, name, relationship, product_id").eq("id", competitorId).maybeSingle(),
      supabase.from("battlecard_items").select("kind, title, detail, signal_ids").eq("competitor_id", competitorId).order("position").order("created_at"),
    ]);
    if (!comp) return await fail(`no competitor with id '${competitorId}'`, 404);
    if (!items?.length) {
      if (runId) await supabase.from("agent_runs").update({ status: "succeeded", output: "no ratified items", finished_at: new Date().toISOString() }).eq("id", runId);
      return json({ proposal_id: null, message: `No ratified battlecard items for ${comp.name} yet — run the analyst (and review its proposals) first.` });
    }

    // ---- the voice: the GTM record this battlecard sells for ----------------
    // Prefer the GTM record of the competitor's product line; fall back to the
    // org's first GTM record (single-product orgs).
    let gtmQ = supabase.from("gtm_records").select("id, name").order("created_at").limit(1);
    if (comp.product_id) gtmQ = gtmQ.eq("product_id", comp.product_id);
    let { data: gtm } = await gtmQ.maybeSingle();
    if (!gtm && comp.product_id) {
      ({ data: gtm } = await supabase.from("gtm_records").select("id, name").order("created_at").limit(1).maybeSingle());
    }
    if (!gtm) return await fail("no GTM record found — create one before drafting battlecard messaging", 404);

    const { data: gtmFields } = await supabase.from("record_fields")
      .select("id, field_key, label, value, section").eq("gtm_record_id", gtm.id);
    const voice = (gtmFields ?? []).filter((f) => f.value && ["Positioning", "Messaging", "Buyer"].includes(f.section ?? ""));

    // ---- ask Claude (structured output) --------------------------------------
    const anthropic = new Anthropic({ apiKey: key });
    const prompt = [
      `COMPETITOR: ${comp.name} (${comp.relationship})`,
      `RATIFIED BATTLECARD ITEMS (your only source of claims):\n${items.map((i) => `- [${i.kind}] ${i.title}${i.detail ? " — " + i.detail : ""}`).join("\n")}`,
      voice.length ? `GTM RECORD (our voice — positioning, messaging, buyer):\n${voice.map((f) => `${f.label}: ${f.value}`).join("\n")}` : "",
      `Draft these battlecard fields: ${FIELDS.map((f) => `${f.key} (${f.label})`).join("; ")}. Frame for ${comp.name} specifically, and pitch it for HOWEVER this org goes to market (read the GTM record's motion above) — assume no sales rep unless the record says so.`,
    ].filter(Boolean).join("\n\n");

    const resp = await anthropic.messages.create({
      model, max_tokens: 2500,
      system: [
        agent.system_prompt || `You are ${agent.name}${agent.role ? `, ${agent.role}` : ""}, an executive agent in SingleStack.`,
        cornerstones.length ? `\nYOUR CORNERSTONE SKILLS (always on):\n${cornerstones.map((s) => `## ${s.name}\n${s.instructions ?? ""}`).join("\n\n")}` : "",
        `\nTHE SKILL FOR THIS TASK — apply it:\n## ${childSkill.name}\n${childSkill.instructions ?? ""}`,
        step.instruction ? `\nSTEP INSTRUCTION: ${step.instruction}` : "",
        "\nGATE CONTRACT (non-negotiable output rules): you are turning RATIFIED battlecard items into competitive copy — a battlecard summary, a positioning angle (talk_track), and objection/counter responses. Every claim must trace to a ratified item or the GTM record — introduce nothing new. Objection responses address the [objection] items directly. Pitch it for HOWEVER this org goes to market — read the GTM record's motion and write copy usable in that motion (an in-product comparison, a landing page, a sales conversation, a partner brief — whatever fits); make NO assumption that there is a sales rep. Keep it tight, confident, and usable verbatim. rationale = one paragraph on how you used the facts; conf_level 0..1.",
      ].filter(Boolean).join("\n"),
      messages: [{ role: "user", content: prompt }],
      output_config: { effort: pol.effort, format: { type: "json_schema", schema: SCHEMA } },
      // deno-lint-ignore no-explicit-any
    } as any);

    const text = resp.content.filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
    const out = JSON.parse(text) as { rationale: string; conf_level: number; fields: { field_key: string; value: string }[] };
    const drafts = (out.fields ?? []).filter((f) => f.value?.trim());
    if (!drafts.length) return await fail("the model returned no field drafts");

    // ---- persist through the existing proposals gate --------------------------
    const conf = Math.min(1, Math.max(0, Number(out.conf_level) || 0));
    const { data: prop, error: propErr } = await supabase.from("proposals").insert({
      org_id: orgId, gtm_record_id: gtm.id,
      title: `Battlecard messaging · ${comp.name}`,
      rationale: out.rationale, conf_level: conf,
      conf_label: conf >= 0.75 ? "High" : conf >= 0.5 ? "Medium" : "Low",
      proposed_by: agent.name,
    }).select("id").single();
    if (propErr || !prop) throw new Error(`could not create proposal: ${propErr?.message ?? "no row"}`);

    const byKey = new Map((gtmFields ?? []).map((f) => [f.field_key, f]));
    const rows = drafts.map((d) => {
      const ex = byKey.get(d.field_key);
      const label = FIELDS.find((f) => f.key === d.field_key)?.label ?? d.field_key;
      return ex
        ? { org_id: orgId, proposal_id: prop.id, change_kind: "update_field", record_field_id: ex.id, old_value: ex.value ?? null, field_key: null, label: null, section: null, proposed_value: d.value.trim() }
        : { org_id: orgId, proposal_id: prop.id, change_kind: "add_field", record_field_id: null, old_value: null, field_key: d.field_key, label, section: SECTION, proposed_value: d.value.trim() };
    });
    const { error: chErr } = await supabase.from("proposal_changes").insert(rows);
    if (chErr) { await supabase.from("proposals").delete().eq("id", prop.id); throw new Error(`could not save changes: ${chErr.message}`); }

    // Carry the analyst's evidence forward: the union of the items' signals.
    const evidence = [...new Set(items.flatMap((i) => i.signal_ids ?? []))];
    if (evidence.length) {
      await supabase.from("proposal_signals").insert(evidence.map((sid) => ({ org_id: orgId, proposal_id: prop.id, signal_id: sid })));
    }

    // HITL is ABSOLUTE for battlecard messaging: always a pending proposal,
    // never auto-accepted — the human ratifies what sellers will say.
    const autoAccepted = false;

    const usage = { input_tokens: resp.usage?.input_tokens ?? 0, output_tokens: resp.usage?.output_tokens ?? 0 };
    const price = PRICING[model];
    const cost = price ? (usage.input_tokens * price.input + usage.output_tokens * price.output) / 1_000_000 : null;
    if (runId) await supabase.from("agent_runs").update({ status: "succeeded", output: JSON.stringify(out), input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, cost_usd: cost, finished_at: new Date().toISOString() }).eq("id", runId);

    return json({ proposal_id: prop.id, auto_accepted: autoAccepted, fields: drafts.length, message: autoAccepted
      ? `Battlecard messaging for ${comp.name} applied to "${gtm.name}" (autonomous policy).`
      : `Battlecard messaging for ${comp.name} proposed on "${gtm.name}" — review it on the GTM record.` });
  } catch (e) {
    return await fail(e instanceof Error ? e.message : "messaging run failed");
  }
});
