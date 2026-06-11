// ============================================================================
// battlecard-analyst — the GROUNDED half of the battlecard agent pair.
//
// Plain English: reads one competitor's evidence — their per-competitor themes
// (product + gtm), the capability matrix (us vs them), their recent signals,
// and our own value prop — and proposes battlecard_items (win / lose /
// objection / trap / …). Conservative by design: its job is ACCURACY. Every
// proposed item cites the signals that back it; items without evidence in the
// provided material must not be invented.
//
// Output honors the 'intelligence' autonomy dial (review_policies):
//   propose_only (default) → items queue as intel_updates (kind:
//   'battlecard_item') for the same accept/edit/reject + rationale teaching
//   loop themes use. autonomous → items insert directly (audited via
//   agent_runs + provenance columns).
//
// The creative half (battlecard-messaging) reads the RATIFIED items and drafts
// seller-facing copy — persuasion built on this function's facts.
//
// Input (POST): { competitor_id, workflow_id } — step 1 of the workflow is the analyst:
//   the USER'S agent + cornerstone skills + analyst child skill carry identity
//   and playbook; this function is only the execution substrate + the gate.
// Runs as caller (JWT) → RLS fences everything to the org. Secret: ANTHROPIC_API_KEY.
// ============================================================================

import Anthropic from "npm:@anthropic-ai/sdk@0.69.0";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

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

const KINDS = ["win", "lose", "strength", "objection", "trap", "pricing", "proof", "discovery"];

// Structured output: a list of evidence-cited battlecard items.
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", enum: KINDS },
          title: { type: "string" },
          detail: { type: "string" },
          signal_indices: { type: "array", items: { type: "integer" } },
          theme_index: { type: "integer" }, // -1 = no single motivating theme
          rationale: { type: "string" },
        },
        required: ["kind", "title", "detail", "signal_indices", "theme_index", "rationale"],
      },
    },
  },
  required: ["items"],
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

  // The USER-BUILT configuration: this function is only the execution substrate
  // + the gate. Step 1 of the attached workflow is the analyst — its agent and
  // child skill carry the identity and the playbook; nothing is hardcoded here.
  const { data: wf } = await supabase.from("workflows").select("id, name, steps").eq("id", workflowId).maybeSingle();
  if (!wf) return json({ error: `no workflow with id '${workflowId}'` }, 404);
  const step = (Array.isArray(wf.steps) ? wf.steps : [])[0] as { agent_id?: string; skill_id?: string | null; instruction?: string } | undefined;
  if (!step?.agent_id) return json({ error: `workflow "${wf.name}" has no step 1 with an agent — add one (agent × analyst skill)` }, 400);

  const { data: agent } = await supabase.from("agents").select("id, name, role, model, system_prompt").eq("id", step.agent_id).eq("is_active", true).maybeSingle();
  if (!agent) return json({ error: "step 1's agent was not found or is inactive" }, 404);
  // Cornerstone skills (always on) + the step's child skill (the analyst play).
  const { data: corner } = await supabase.from("agent_skills").select("skills ( name, instructions )").eq("agent_id", agent.id).eq("is_cornerstone", true);
  // deno-lint-ignore no-explicit-any
  const cornerstones = ((corner ?? []) as any[]).map((r) => r.skills).filter(Boolean) as { name: string; instructions: string | null }[];
  let childSkill: { name: string; instructions: string | null } | null = null;
  if (step.skill_id) {
    const { data: sk } = await supabase.from("skills").select("name, instructions").eq("id", step.skill_id).maybeSingle();
    childSkill = sk ?? null;
  }
  if (!childSkill) return json({ error: `workflow "${wf.name}" step 1 has no skill — attach your analyst skill to it` }, 400);
  const model = agent.model || MODEL;

  const { data: run } = await supabase.from("agent_runs")
    .insert({ org_id: orgId, agent_id: agent.id, status: "running", input: { competitor_id: competitorId }, model })
    .select("id").single();
  const runId = run?.id;
  const fail = async (msg: string, status = 500) => {
    if (runId) await supabase.from("agent_runs").update({ status: "failed", error: msg, finished_at: new Date().toISOString() }).eq("id", runId);
    return json({ error: msg }, status);
  };

  try {
    // ---- gather the evidence (all RLS-fenced reads) -------------------------
    const [{ data: comp }, { data: themes }, { data: sigs }, { data: caps }, { data: scores }, { data: existing }, { data: prod }] = await Promise.all([
      supabase.from("competitors").select("id, name, relationship, notes").eq("id", competitorId).maybeSingle(),
      supabase.from("signal_themes").select("id, title, summary, recommendation, category, state").eq("competitor_id", competitorId).order("last_evidence_at", { ascending: false, nullsFirst: false }).limit(12),
      supabase.from("signals").select("id, title, why, origin, conf_label, observed_at").eq("competitor_id", competitorId).order("observed_at", { ascending: false, nullsFirst: false }).limit(25),
      supabase.from("capabilities").select("id, name"),
      supabase.from("capability_scores").select("capability_id, competitor_id, score"),
      supabase.from("battlecard_items").select("kind, title").eq("competitor_id", competitorId),
      supabase.from("product_records").select("id, name").order("created_at").limit(1).maybeSingle(),
    ]);
    if (!comp) return await fail(`no competitor with id '${competitorId}'`, 404);

    let valueProp: string | null = null;
    if (prod) {
      const { data: vp } = await supabase.from("record_fields").select("value").eq("product_id", prod.id).eq("field_key", "value_prop").maybeSingle();
      valueProp = vp?.value ?? null;
    }

    const matrix = (caps ?? []).map((c) => {
      const us = (scores ?? []).find((s) => s.capability_id === c.id && s.competitor_id === null)?.score ?? 0;
      const them = (scores ?? []).find((s) => s.capability_id === c.id && s.competitor_id === competitorId)?.score ?? 0;
      return `${c.name}: us ${us}/3, them ${them}/3`;
    });
    const themeList = themes ?? [];
    const sigList = sigs ?? [];
    if (themeList.length === 0 && sigList.length === 0 && matrix.length === 0) {
      if (runId) await supabase.from("agent_runs").update({ status: "succeeded", output: "no evidence", finished_at: new Date().toISOString() }).eq("id", runId);
      return json({ proposed: 0, created: 0, message: `No themes, signals, or matrix data for ${comp.name} yet — log signals and run synthesis first.` });
    }

    // ---- ask Claude (structured output) -------------------------------------
    const anthropic = new Anthropic({ apiKey: key });
    const prompt = [
      `COMPETITOR: ${comp.name} (${comp.relationship})${comp.notes ? `\nOverview: ${comp.notes}` : ""}`,
      valueProp ? `OUR VALUE PROP: ${valueProp}` : "",
      matrix.length ? `CAPABILITY MATRIX (0=none..3=strong):\n${matrix.join("\n")}` : "",
      themeList.length ? `THEIR THEMES (synthesized intelligence):\n${themeList.map((t, i) => `{T${i}} [${t.category}/${t.state}] ${t.title} — ${t.summary ?? ""}`).join("\n")}` : "",
      sigList.length ? `THEIR SIGNALS (raw evidence):\n${sigList.map((s, i) => `[${i}] (${s.origin ?? "?"} · ${s.conf_label ?? "?"}) ${s.title}${s.why ? " — " + s.why : ""}`).join("\n")}` : "",
      (existing ?? []).length ? `EXISTING BATTLECARD ITEMS (do not duplicate):\n${(existing ?? []).map((e) => `- [${e.kind}] ${e.title}`).join("\n")}` : "",
    ].filter(Boolean).join("\n\n");

    // Identity and judgment come from the USER'S configuration (agent system
    // prompt + cornerstone skills + the analyst child skill + the step's
    // instruction). Only the GATE CONTRACT — the output shape battlecard_items
    // requires (cited signal indices, no unevidenced claims) — is fixed here.
    const system = [
      agent.system_prompt || `You are ${agent.name}${agent.role ? `, ${agent.role}` : ""}, an executive agent in SingleStack.`,
      cornerstones.length ? `\nYOUR CORNERSTONE SKILLS (always on):\n${cornerstones.map((s) => `## ${s.name}\n${s.instructions ?? ""}`).join("\n\n")}` : "",
      `\nTHE SKILL FOR THIS TASK — apply it:\n## ${childSkill.name}\n${childSkill.instructions ?? ""}`,
      step.instruction ? `\nSTEP INSTRUCTION: ${step.instruction}` : "",
      `\nGATE CONTRACT (non-negotiable output rules): you are proposing STRUCTURED battlecard items (kinds: ${KINDS.join(", ")}) about this competitor, strictly from the evidence provided. Every item MUST cite the signal indices that back it (signal_indices) — an item you cannot back with at least one listed signal or a clear matrix delta must not be proposed. Set theme_index to the {T#} that motivated the item, or -1. Never invent capabilities, pricing, or quotes. Prefer fewer, well-evidenced items over coverage. Do not duplicate existing items. title = the point a seller needs (one line); detail = the substantiation (2-3 sentences, factual tone).`,
    ].filter(Boolean).join("\n");

    const resp = await anthropic.messages.create({
      model, max_tokens: 3000,
      system,
      messages: [{ role: "user", content: prompt }],
      output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
      // deno-lint-ignore no-explicit-any
    } as any);

    const text = resp.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    const out = JSON.parse(text) as { items: { kind: string; title: string; detail: string; signal_indices: number[]; theme_index: number; rationale: string }[] };
    const items = (out.items ?? []).filter((it) => KINDS.includes(it.kind) && it.title?.trim());

    // ---- persist per the autonomy dial ---------------------------------------
    const { data: polRow } = await supabase.from("review_policies").select("mode").eq("org_id", orgId).eq("surface", "intelligence").maybeSingle();
    const autonomous = polRow?.mode === "autonomous";

    const sigIdAt = (i: number) => sigList[i]?.id;
    const themeIdAt = (i: number) => (i >= 0 ? themeList[i]?.id ?? null : null);
    let created = 0, proposed = 0;
    for (const it of items) {
      const signal_ids = (it.signal_indices ?? []).map(sigIdAt).filter(Boolean) as string[];
      const theme_id = themeIdAt(it.theme_index);
      if (autonomous) {
        const { error } = await supabase.from("battlecard_items").insert({
          org_id: orgId, competitor_id: competitorId, kind: it.kind, title: it.title.trim(), detail: it.detail?.trim() || null,
          signal_ids, theme_id, proposed_by: agent.name,
        });
        if (!error) created++;
      } else {
        const { error } = await supabase.from("intel_updates").insert({
          org_id: orgId, scope: "battlecard", kind: "battlecard_item", theme_id,
          payload: { competitor_id: competitorId, kind: it.kind, title: it.title.trim(), detail: it.detail?.trim() || null, signal_ids, theme_id, rationale: it.rationale, proposed_by: agent.name },
          summary: `${comp.name} battlecard · ${it.kind}: "${it.title.trim()}" (${signal_ids.length} signal${signal_ids.length === 1 ? "" : "s"})`,
          status: "pending",
        });
        if (!error) proposed++;
      }
    }

    const usage = { input_tokens: resp.usage?.input_tokens ?? 0, output_tokens: resp.usage?.output_tokens ?? 0 };
    const price = PRICING[model];
    const cost = price ? (usage.input_tokens * price.input + usage.output_tokens * price.output) / 1_000_000 : null;
    if (runId) await supabase.from("agent_runs").update({ status: "succeeded", output: JSON.stringify(out), input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, cost_usd: cost, finished_at: new Date().toISOString() }).eq("id", runId);

    return json({ proposed, created, autonomous, message: autonomous
      ? `${created} battlecard item${created === 1 ? "" : "s"} added for ${comp.name} (autonomous policy).`
      : `${proposed} battlecard item${proposed === 1 ? "" : "s"} proposed for ${comp.name} — review them in Signals → Review.` });
  } catch (e) {
    return await fail(e instanceof Error ? e.message : "analyst run failed");
  }
});
