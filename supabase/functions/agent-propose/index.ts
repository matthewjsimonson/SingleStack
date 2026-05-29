// ============================================================================
// agent-propose — the first working agent: embed → retrieve → Claude → propose.
//
// Plain English: this is the loop the prototype demoed, made real. Given an
// agent and a target record, it:
//   1. builds a query from the record + an optional instruction,
//   2. embeds it and retrieves the most relevant document chunks (RAG),
//   3. asks Claude to propose a concrete change to the record, citing why,
//   4. writes that as a `proposal` (+ `proposal_changes`) for human approval,
//   5. logs the whole invocation in `agent_runs`.
//
// Runs as the caller (the user's JWT is forwarded to Supabase), so every read
// and write is fenced to their org by RLS. Provider keys come from secrets:
//   ANTHROPIC_API_KEY  — Claude (the reasoning)
//   OPENAI_API_KEY     — embeddings (text-embedding-3-small, 1536-dim)
// ============================================================================

import Anthropic from "npm:@anthropic-ai/sdk@0.69.0";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const EMBEDDING_MODEL = "text-embedding-3-small"; // 1536 dims — matches document_chunks
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
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

async function embed(text: string, apiKey: string): Promise<number[]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
  });
  if (!res.ok) throw new Error(`embedding failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return data.data[0].embedding;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing Authorization header" }, 401);

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!anthropicKey || !openaiKey) {
    return json({ error: "server missing ANTHROPIC_API_KEY or OPENAI_API_KEY" }, 500);
  }

  // Caller-scoped client: forwarding the JWT makes RLS apply as the user.
  const supabase: SupabaseClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  // ---- parse + validate input ------------------------------------------------
  let input: {
    agent_key?: string;
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

  if (!agent_key) return json({ error: "agent_key is required" }, 400);
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
    .eq("key", agent_key)
    .eq("is_active", true)
    .maybeSingle();
  if (agentErr) return json({ error: `agent lookup failed: ${agentErr.message}` }, 500);
  if (!agent) return json({ error: `no active agent with key '${agent_key}'` }, 404);

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

    // ---- embed a query built from the record + instruction ------------------
    const queryText = [
      instruction,
      `Record: ${record.name ?? targetId}`,
      ...(fields ?? []).map((f) => `${f.label}: ${f.value ?? ""}`),
    ]
      .filter(Boolean)
      .join("\n");

    const queryEmbedding = await embed(queryText, openaiKey);

    // ---- retrieve relevant chunks (RAG) -------------------------------------
    const { data: chunks, error: matchErr } = await supabase.rpc("match_document_chunks", {
      query_embedding: queryEmbedding,
      match_count: topK,
    });
    if (matchErr) throw new Error(`retrieval failed: ${matchErr.message}`);

    // ---- ask Claude for a proposal ------------------------------------------
    const anthropic = new Anthropic({ apiKey: anthropicKey });

    const systemText = [
      agent.system_prompt ?? `You are ${agent.name}, an agent that improves records.`,
      "",
      "You propose a concrete, well-grounded change to the record below. Use the",
      "retrieved source excerpts as evidence and explain in `rationale` which",
      "sources informed the change. To revise an existing field, emit an",
      "`update_field` change with that field's `record_field_id` (from the record's",
      "fields). To introduce a new field, emit an `add_field` change with a",
      "snake_case `field_key` and a human `label`. Only propose changes you can",
      "justify from the record or the sources. `conf_level` is 0..1.",
    ].join("\n");

    const userText = JSON.stringify(
      {
        instruction: instruction ?? null,
        record: { id: targetId, kind: targetTable, ...record },
        fields: fields ?? [],
        retrieved_sources: (chunks ?? []).map((c: Record<string, unknown>) => ({
          document_title: c.document_title,
          content: c.content,
          similarity: c.similarity,
        })),
      },
      null,
      2,
    );

    // Cast the body to `any`: adaptive thinking / output_config / effort may be
    // newer than the pinned SDK's request types, but the SDK forwards the body
    // verbatim, so the API receives them. Response is a (non-streaming) Message.
    const message = (await anthropic.messages.create({
      model,
      max_tokens: 16000,
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
        proposed_by: agent.name,
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
      if (changesErr) throw new Error(`could not save changes: ${changesErr.message}`);
    }

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
      retrieved: (chunks ?? []).length,
      proposal: { ...proposal, conf_level: confLevel, changes_saved: changeRows.length },
    });
  } catch (e) {
    return await fail(e instanceof Error ? e.message : String(e));
  }
});
