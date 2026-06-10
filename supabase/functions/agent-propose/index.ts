// ============================================================================
// agent-propose — the first working agent: read → Claude → propose.
//
// Plain English: this is the loop the prototype demoed, made real. Given an
// agent and a target record, it:
//   1. loads the record and its fields,
//   2. asks Claude to propose a concrete change to the record, citing why,
//   3. writes that as a `proposal` (+ `proposal_changes`) for human approval,
//   4. logs the whole invocation in `agent_runs`.
//
// The agent reasons with its SKILLS (attached playbooks) and the intelligence
// in its CONNECTED AREAS (themes, capabilities, and the record's own signals) —
// the same structured grounding agent-chat uses. Vector RAG over
// document_chunks stays parked (Anthropic has no embeddings API); the tables +
// match_document_chunks RPC remain so it can be switched on later.
//
// Runs as the caller (the user's JWT is forwarded to Supabase), so every read
// and write is fenced to their org by RLS. Provider key comes from a secret:
//   ANTHROPIC_API_KEY  — Claude (the reasoning)
// ============================================================================

import Anthropic from "npm:@anthropic-ai/sdk@0.69.0";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
const DEFAULT_CLAUDE_MODEL = "claude-opus-4-8";
const DEFAULT_TOP_K = 6;

// Per-1M-token prices (USD) for cost accounting. Unknown models → cost left null.
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

// Separates the streamed reasoning trace from the final JSON result (the client
// splits on the same glyph). Won't occur in normal model output.
const ANSWER_MARK = "␞";

// The shape we ask Claude to return (structured outputs guarantee valid JSON).
// Mirrors proposals + proposal_changes. conf_level range is clamped in code
// (structured outputs can't express numeric min/max).
const PROPOSAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    rationale: { type: "string" },
    conf_level: { type: "number" },
    conf_label: { type: "string" },
    changes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          change_kind: { type: "string", enum: ["update_field", "add_field"] },
          // update_field: which existing field (use an id from the record's fields)
          record_field_id: { type: ["string", "null"] },
          // add_field: the new field's identity
          field_key: { type: ["string", "null"] },
          label: { type: ["string", "null"] },
          proposed_value: { type: "string" },
        },
        required: ["change_kind", "record_field_id", "field_key", "label", "proposed_value"],
      },
    },
  },
  required: ["title", "rationale", "conf_level", "conf_label", "changes"],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing Authorization header" }, 401);

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) return json({ error: "server missing ANTHROPIC_API_KEY" }, 500);

  // Caller-scoped client: forwarding the JWT makes RLS apply as the caller's org.
  const supabase: SupabaseClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  // ---- parse + validate input ------------------------------------------------
  let input: {
    agent_key?: string;
    agent_keys?: string[]; // joint proposal: [author, ...advisors]; falls back to [agent_key]
    product_id?: string;
    gtm_record_id?: string;
    instruction?: string;
    top_k?: number;
  };
  try {
    input = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const { agent_key, product_id, gtm_record_id, instruction } = input;
  const topK = input.top_k ?? DEFAULT_TOP_K;

  // The propose chain: the first officer AUTHORS the structured proposal; the rest
  // contribute their lens (a joint task — e.g. CPO + Chief Eng, or CCO + CRO).
  const chainKeys = (input.agent_keys?.length ? input.agent_keys : [agent_key]).filter(Boolean) as string[];
  const primaryKey = chainKeys[0];
  const advisorKeys = chainKeys.slice(1);

  if (!primaryKey) return json({ error: "agent_key (or agent_keys) is required" }, 400);
  if ((product_id ? 1 : 0) + (gtm_record_id ? 1 : 0) !== 1) {
    return json({ error: "provide exactly one of product_id or gtm_record_id" }, 400);
  }
  const targetTable = product_id ? "product_records" : "gtm_records";
  const targetId = (product_id ?? gtm_record_id) as string;
  const fieldFk = product_id ? "product_id" : "gtm_record_id";

  // ---- load the agent (RLS-scoped) ------------------------------------------
  const { data: agent, error: agentErr } = await supabase
    .from("agents")
    .select("id, org_id, name, model, system_prompt")
    .eq("key", primaryKey)
    .eq("is_active", true)
    .maybeSingle();
  if (agentErr) return json({ error: `agent lookup failed: ${agentErr.message}` }, 500);
  if (!agent) return json({ error: `no active agent with key '${primaryKey}'` }, 404);

  const orgId = agent.org_id as string;
  const model = (agent.model as string) || DEFAULT_CLAUDE_MODEL;

  // ---- open an agent_runs record (running) ----------------------------------
  const { data: run, error: runErr } = await supabase
    .from("agent_runs")
    .insert({ org_id: orgId, agent_id: agent.id, status: "running", input, model })
    .select("id")
    .single();
  if (runErr) return json({ error: `could not start run: ${runErr.message}` }, 500);
  const runId = run.id as string;

  // From here on, failures are recorded on the run before returning.
  const fail = async (message: string, status = 500) => {
    await supabase
      .from("agent_runs")
      .update({ status: "failed", error: message, finished_at: new Date().toISOString() })
      .eq("id", runId);
    return json({ error: message, run_id: runId }, status);
  };

  try {
    // ---- load the target record + its fields --------------------------------
    const { data: record, error: recErr } = await supabase
      .from(targetTable)
      .select("*")
      .eq("id", targetId)
      .maybeSingle();
    if (recErr) throw new Error(`record lookup failed: ${recErr.message}`);
    if (!record) return await fail(`no ${targetTable} with id '${targetId}'`, 404);

    const { data: fields, error: fieldsErr } = await supabase
      .from("record_fields")
      .select("id, field_key, label, value, position")
      .eq(fieldFk, targetId)
      .order("position", { ascending: true });
    if (fieldsErr) throw new Error(`fields lookup failed: ${fieldsErr.message}`);

    // ---- the agent's skills + connected areas (mirror agent-chat) -----------
    // The officer proposes USING its playbooks, grounded in the intelligence of
    // the areas it's connected to. No connections declared → full access.
    const { data: skillRows } = await supabase
      .from("agent_skills").select("skills ( name, description, instructions, category )").eq("agent_id", agent.id);
    // deno-lint-ignore no-explicit-any
    const skills = (skillRows ?? []).map((r: any) => r.skills).filter(Boolean);
    const { data: connRows } = await supabase
      .from("connections").select("area").eq("agent_id", agent.id).eq("kind", "internal");
    const declaredAreas = [...new Set((connRows ?? []).map((c) => c.area).filter(Boolean))] as string[];
    const areas = declaredAreas.length ? declaredAreas : ["products", "gtm", "signals", "capabilities", "records"];
    const seesSignals = areas.includes("signals") || areas.includes("records");
    const seesCaps = areas.includes("capabilities") || seesSignals;

    // ---- intelligence grounding, scoped to the agent's areas ----------------
    const intel: string[] = [];
    if (gtm_record_id) {
      const { data: gsigs } = await supabase.from("signals").select("title, why").eq("gtm_record_id", targetId).order("observed_at", { ascending: false }).limit(10);
      if ((gsigs ?? []).length) intel.push("SIGNALS ON THIS RECORD:\n" + (gsigs ?? []).map((s) => `• ${s.title}${s.why ? ` (${s.why})` : ""}`).join("\n"));
    }
    if (seesSignals || seesCaps) {
      const [{ data: themes }, { data: rawSigs }] = await Promise.all([
        seesSignals ? supabase.from("signal_themes").select("title, summary, recommendation, state, momentum").order("last_evidence_at", { ascending: false }).limit(8) : Promise.resolve({ data: [] as { title: string; summary: string | null; recommendation: string | null; state: string; momentum: string }[] }),
        supabase.from("signals").select("title, why, metadata").order("observed_at", { ascending: false }).limit(20),
      ]);
      // deno-lint-ignore no-explicit-any
      const caps = (rawSigs ?? []).filter((s: any) => s.metadata?.domain === "capability");
      // deno-lint-ignore no-explicit-any
      const sgs = (rawSigs ?? []).filter((s: any) => s.metadata?.domain !== "capability").slice(0, 12);
      if (seesSignals && (themes ?? []).length) intel.push("ACTIVE THEMES:\n" + (themes ?? []).map((t) => `• [${t.state}/${t.momentum}] ${t.title}${t.summary ? ` — ${t.summary}` : ""}${t.recommendation ? ` → ${t.recommendation}` : ""}`).join("\n"));
      if (seesCaps && caps.length) intel.push("FRONTIER MODEL CAPABILITIES TO LEVERAGE (act on these in your own domain):\n" + caps.map((s) => `• ${s.metadata?.provider ? `[${s.metadata.provider}${s.metadata?.area ? `/${s.metadata.area}` : ""}] ` : ""}${s.title}${s.why ? ` — ${s.why}` : ""}`).join("\n"));
      if (seesSignals && sgs.length) intel.push("RECENT SIGNALS:\n" + sgs.map((s) => `• ${s.title}${s.why ? ` (${s.why})` : ""}`).join("\n"));
    }

    // ---- retrieval (RAG) parked: Anthropic-only ----------------------------
    // RAG needs an embedding model and Anthropic has no embeddings API, so the
    // agent reasons from the record + its fields alone. The documents /
    // document_chunks tables and match_document_chunks RPC remain in place, so
    // retrieval can be re-enabled later without schema changes.
    const chunks: Array<Record<string, unknown>> = [];

    // ---- ask Claude for a proposal ------------------------------------------
    const anthropic = new Anthropic({ apiKey: anthropicKey });

    const areaLabels: Record<string, string> = { products: "Product records", gtm: "GTM records", signals: "Signals & intelligence", records: "All records" };
    const skillsBlock = skills.length
      ? "\n\nYOUR SKILLS — apply these playbooks; they are how you do your job:\n" +
        skills.map((s) => `## ${s.name}${s.category ? ` (${s.category})` : ""}${s.description ? `\n${s.description}` : ""}${s.instructions ? `\n${s.instructions}` : ""}`).join("\n\n")
      : "";

    const systemText = [
      agent.system_prompt ?? `You are ${agent.name}, an agent that improves records.`,
      "",
      `You are connected to: ${areas.map((a) => areaLabels[a] ?? a).join(", ")}. Ground your proposal in the record and the intelligence provided.`,
      "You propose a concrete, well-grounded change to the record below. Apply your",
      "skills, and in `rationale` cite the signals/themes/capabilities that inform the",
      "change. To revise an existing field, emit an `update_field` change with that",
      "field's `record_field_id` (from the record's fields). To introduce a new field,",
      "emit an `add_field` change with a snake_case `field_key` and a human `label`.",
      "Only propose changes you can justify from the record or the intelligence.",
      "`conf_level` is 0..1.",
      skillsBlock,
    ].join("\n");

    const recordIntelText = [
      "INTELLIGENCE (use as evidence; cite what informs the change in `rationale`):",
      intel.length ? intel.join("\n\n") : "(none in your connected areas yet)",
      "",
      "THE RECORD TO IMPROVE:",
      JSON.stringify({ instruction: instruction ?? null, record: { id: targetId, kind: targetTable, ...record }, fields: fields ?? [] }, null, 2),
    ].join("\n");

    // Joint task: each advisor officer contributes their lens (prose), which the
    // author folds into the structured proposal below. One bounded call per advisor;
    // an advisor failing never sinks the proposal.
    const lenses: string[] = [];
    const advisorNames: string[] = [];
    for (const advKey of advisorKeys) {
      const { data: adv } = await supabase.from("agents").select("id, name, model, system_prompt").eq("key", advKey).eq("is_active", true).maybeSingle();
      if (!adv) continue;
      advisorNames.push(adv.name as string);
      const { data: advSkillRows } = await supabase.from("agent_skills").select("skills ( name, instructions )").eq("agent_id", adv.id);
      // deno-lint-ignore no-explicit-any
      const advSkills = (advSkillRows ?? []).map((r: any) => r.skills).filter(Boolean);
      // deno-lint-ignore no-explicit-any
      const advSkillsBlock = advSkills.length ? "\n\nYOUR SKILLS:\n" + advSkills.map((s: any) => `## ${s.name}${s.instructions ? `\n${s.instructions}` : ""}`).join("\n\n") : "";
      const advSystem = [
        adv.system_prompt ?? `You are ${adv.name}.`,
        "Give your lens on improving this record: 3–6 concrete, specific bullets — what to change and why, grounded in the record + intelligence. No preamble, just the bullets.",
        advSkillsBlock,
      ].join("\n");
      try {
        const advMsg = (await anthropic.messages.create({
          model: (adv.model as string) || DEFAULT_CLAUDE_MODEL,
          max_tokens: 1200,
          thinking: { type: "adaptive" },
          system: [{ type: "text", text: advSystem, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: recordIntelText }],
          // deno-lint-ignore no-explicit-any
        } as any)) as Anthropic.Message;
        const t = advMsg.content.find((b) => b.type === "text");
        if (t && t.type === "text" && t.text.trim()) lenses.push(`### ${adv.name}'s lens\n${t.text.trim()}`);
      } catch { /* skip a failed advisor */ }
    }

    const userText = [
      recordIntelText,
      lenses.length ? `\nFELLOW OFFICERS' INPUT — co-authors' lenses; weigh them and fold the right parts into your proposal:\n${lenses.join("\n\n")}` : "",
    ].join("\n");

    const requestBody = {
      model,
      max_tokens: 24000,
      thinking: { type: "adaptive", display: "summarized" }, // summarized → reasoning text is populated on Opus 4.8
      output_config: { effort: "high", format: { type: "json_schema", schema: PROPOSAL_SCHEMA } },
      system: [{ type: "text", text: systemText, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userText }],
    };
    const jointBy = [agent.name, ...advisorNames].join(" + ");

    // Autonomy dial — 'records' surface. autonomous ⇒ ratify the agent's
    // proposal immediately via the SAME accept path a human uses (audited),
    // instead of leaving it in the review queue. Default propose_only ⇒ pending.
    // (review_policies; absent row = propose_only.)
    let autoAccepted = false;
    async function maybeAutoAccept(pid: string) {
      const { data: pol } = await supabase.from("review_policies").select("mode").eq("org_id", orgId).eq("surface", "records").maybeSingle();
      if (pol?.mode === "autonomous") {
        const { error } = await supabase.rpc("accept_proposal", { p_proposal: pid, p_ratifier: `${agent.name} (autonomous policy)` });
        if (!error) autoAccepted = true;
      }
    }

    // Persist a parsed proposal + its field changes; returns a compact summary
    // (including a readable change list) used by both the streaming and JSON paths.
    // deno-lint-ignore no-explicit-any
    async function persist(proposal: any, usage: { input_tokens: number; output_tokens: number }) {
      const confLevel = Math.min(1, Math.max(0, Number(proposal.conf_level) || 0));
      const { data: createdProposal, error: propErr } = await supabase
        .from("proposals").insert({
          org_id: orgId, product_id: product_id ?? null, gtm_record_id: gtm_record_id ?? null,
          title: proposal.title, rationale: proposal.rationale, conf_level: confLevel,
          conf_label: proposal.conf_label, proposed_by: jointBy,
        }).select("id").single();
      if (propErr) throw new Error(`could not create proposal: ${propErr.message}`);
      const pid = createdProposal.id as string;
      const known = new Set((fields ?? []).map((f) => f.id));
      // deno-lint-ignore no-explicit-any
      const rows: any[] = []; const display: { label: string; kind: string; proposed_value: string }[] = [];
      for (const c of (proposal.changes ?? [])) {
        if (c.change_kind === "update_field" && c.record_field_id && known.has(c.record_field_id)) {
          const ex = (fields ?? []).find((f) => f.id === c.record_field_id);
          rows.push({ org_id: orgId, proposal_id: pid, change_kind: "update_field", record_field_id: c.record_field_id, old_value: ex?.value ?? null, field_key: null, label: null, proposed_value: c.proposed_value });
          display.push({ label: ex?.label ?? "Field", kind: "update", proposed_value: c.proposed_value });
        } else if (c.change_kind === "add_field" && c.field_key && c.label) {
          rows.push({ org_id: orgId, proposal_id: pid, change_kind: "add_field", record_field_id: null, old_value: null, field_key: c.field_key, label: c.label, proposed_value: c.proposed_value });
          display.push({ label: c.label, kind: "add", proposed_value: c.proposed_value });
        }
      }
      if (rows.length > 0) {
        const { error: chErr } = await supabase.from("proposal_changes").insert(rows);
        if (chErr) { await supabase.from("proposals").delete().eq("id", pid); throw new Error(`could not save changes: ${chErr.message}`); }
      }
      await maybeAutoAccept(pid);
      const price = PRICING[model];
      const cost = price ? (usage.input_tokens * price.input + usage.output_tokens * price.output) / 1_000_000 : null;
      await supabase.from("agent_runs").update({ status: "succeeded", output: JSON.stringify(proposal), input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, cost_usd: cost, finished_at: new Date().toISOString() }).eq("id", runId);
      return { run_id: runId, proposal_id: pid, auto_accepted: autoAccepted, proposal: { title: proposal.title, rationale: proposal.rationale, conf_level: confLevel, conf_label: proposal.conf_label, proposed_by: jointBy, changes: display } };
    }

    // Streaming path: emit the author's REAL reasoning, then a marker, then the
    // persisted proposal as JSON. (Advisor lenses above already ran.)
    if (input.stream) {
      const enc = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          try {
            // deno-lint-ignore no-explicit-any
            const s = anthropic.messages.stream(requestBody as any);
            // deno-lint-ignore no-explicit-any
            for await (const ev of s as any) {
              if (ev.type === "content_block_delta" && ev.delta?.type === "thinking_delta" && ev.delta.thinking) {
                controller.enqueue(enc.encode(ev.delta.thinking));
              }
            }
            const message = await s.finalMessage();
            const tb = message.content.find((b: { type: string }) => b.type === "text");
            if (!tb || tb.type !== "text") throw new Error(`no proposal returned (stop_reason: ${message.stop_reason})`);
            if (message.stop_reason === "max_tokens") throw new Error("The proposal ran out of room before finishing (hit the token cap). Try again, or narrow what you asked for.");
            let parsed;
            try { parsed = JSON.parse(tb.text); } catch { throw new Error("The proposal came back malformed — likely truncated. Try again, or narrow what you asked for."); }
            const summary = await persist(parsed, message.usage);
            controller.enqueue(enc.encode(ANSWER_MARK + JSON.stringify(summary)));
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            await supabase.from("agent_runs").update({ status: "failed", error: msg, finished_at: new Date().toISOString() }).eq("id", runId);
            controller.enqueue(enc.encode(ANSWER_MARK + JSON.stringify({ error: msg })));
          } finally { controller.close(); }
        },
      });
      return new Response(stream, { headers: { ...CORS, "content-type": "text/plain; charset=utf-8", "cache-control": "no-cache" } });
    }

    // Cast the body to `any`: adaptive thinking / output_config / effort may be
    // newer than the pinned SDK's request types, but the SDK forwards the body
    // verbatim, so the API receives them. Response is a (non-streaming) Message.
    const message = (await anthropic.messages.create({
      model,
      max_tokens: 24000,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "high",
        format: { type: "json_schema", schema: PROPOSAL_SCHEMA },
      },
      system: [{ type: "text", text: systemText, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userText }],
      // deno-lint-ignore no-explicit-any
    } as any)) as Anthropic.Message;

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error(`Claude returned no text (stop_reason: ${message.stop_reason})`);
    }
    if (message.stop_reason === "max_tokens") throw new Error("The proposal ran out of room before finishing (hit the token cap). Try again, or narrow what you asked for.");
    const proposal = JSON.parse(textBlock.text) as {
      title: string;
      rationale: string;
      conf_level: number;
      conf_label: string;
      changes: Array<{
        change_kind: "update_field" | "add_field";
        record_field_id: string | null;
        field_key: string | null;
        label: string | null;
        proposed_value: string;
      }>;
    };

    // ---- persist the proposal + its field-level changes ---------------------
    const confLevel = Math.min(1, Math.max(0, Number(proposal.conf_level) || 0));
    const { data: createdProposal, error: propErr } = await supabase
      .from("proposals")
      .insert({
        org_id: orgId,
        product_id: product_id ?? null,
        gtm_record_id: gtm_record_id ?? null,
        title: proposal.title,
        rationale: proposal.rationale,
        conf_level: confLevel,
        conf_label: proposal.conf_label,
        proposed_by: [agent.name, ...advisorNames].join(" + "), // joint authorship
      })
      .select("id")
      .single();
    if (propErr) throw new Error(`could not create proposal: ${propErr.message}`);
    const proposalId = createdProposal.id as string;

    type ChangeRow = {
      org_id: string;
      proposal_id: string;
      change_kind: "update_field" | "add_field";
      record_field_id: string | null;
      old_value: string | null;
      field_key: string | null;
      label: string | null;
      proposed_value: string;
    };

    const knownFieldIds = new Set((fields ?? []).map((f) => f.id));
    const changeRows: ChangeRow[] = (proposal.changes ?? [])
      .map((c): ChangeRow | null => {
        if (c.change_kind === "update_field" && c.record_field_id && knownFieldIds.has(c.record_field_id)) {
          const existing = (fields ?? []).find((f) => f.id === c.record_field_id);
          return {
            org_id: orgId,
            proposal_id: proposalId,
            change_kind: "update_field",
            record_field_id: c.record_field_id,
            old_value: existing?.value ?? null,
            field_key: null,
            label: null,
            proposed_value: c.proposed_value,
          };
        }
        if (c.change_kind === "add_field" && c.field_key && c.label) {
          return {
            org_id: orgId,
            proposal_id: proposalId,
            change_kind: "add_field",
            record_field_id: null,
            old_value: null,
            field_key: c.field_key,
            label: c.label,
            proposed_value: c.proposed_value,
          };
        }
        return null; // drop changes that don't satisfy the table's shape constraint
      })
      .filter((r): r is ChangeRow => r !== null);

    if (changeRows.length > 0) {
      const { error: changesErr } = await supabase.from("proposal_changes").insert(changeRows);
      if (changesErr) {
        // Compensating cleanup: don't leave an orphaned proposal with no changes.
        await supabase.from("proposals").delete().eq("id", proposalId);
        throw new Error(`could not save changes: ${changesErr.message}`);
      }
    }
    await maybeAutoAccept(proposalId);

    // ---- close out the run --------------------------------------------------
    const usage = message.usage;
    const price = PRICING[model];
    const cost = price
      ? (usage.input_tokens * price.input + usage.output_tokens * price.output) / 1_000_000
      : null;

    await supabase
      .from("agent_runs")
      .update({
        status: "succeeded",
        output: JSON.stringify(proposal),
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cost_usd: cost,
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);

    return json({
      run_id: runId,
      proposal_id: proposalId,
      auto_accepted: autoAccepted,
      retrieved: (chunks ?? []).length,
      proposal: { ...proposal, conf_level: confLevel, changes_saved: changeRows.length },
    });
  } catch (e) {
    return await fail(e instanceof Error ? e.message : String(e));
  }
});
