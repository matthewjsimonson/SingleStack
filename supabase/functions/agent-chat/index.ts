// ============================================================================
// agent-chat — conversational endpoint for an executive agent.
//
// Plain English: powers the command-center drawer. Given an agent_key, the
// conversation so far, and (optionally) what the operator is currently looking
// at, it loads that agent and reasons AS that agent — using:
//   • the agent's SKILLS (attached playbooks) injected as how-to-think guidance,
//   • the agent's CONNECTIONS (internal areas: products|gtm|signals|records),
//     which SCOPE what org data the agent can see — so a CPO agent connected to
//     "products" reasons over the product foundation, a CRO over GTM, etc.
//     (Aligning agents to a module/function.) Agents with no connections
//     declared default to full Foundation access (backward compatible.)
//   • CONTEXT: when the drawer is opened on a specific record/module, that
//     record's fields + related signals/themes/proposals are pulled in so the
//     reply is grounded in exactly what the operator is looking at.
// Returns the agent's reply and logs the turn in agent_runs.
//
// This is structured cross-module grounding (no embeddings). True semantic RAG
// over document_chunks is an optional upgrade once an embedding key exists.
//
// Runs as the caller (JWT forwarded) so all reads are org-scoped by RLS.
// Secret: ANTHROPIC_API_KEY.
// ============================================================================

import Anthropic from "npm:@anthropic-ai/sdk@0.69.0";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { resolveModelPolicy } from "../_shared/ai_policy.ts";
import { PRICING } from "../_shared/ai_usage.ts";

const DEFAULT_MODEL = "claude-opus-5";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Marker the streaming response uses to separate the reasoning trace from the
// answer. A Record-Separator glyph — won't occur in normal model output. The
// client splits on the same constant.
const ANSWER_MARK = "␞";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });
}

type ChatMsg = { role: "user" | "assistant"; content: string };
type Area = "products" | "gtm" | "signals" | "capabilities" | "records";
type Ctx = {
  area?: Area;
  record_id?: string;
  record_type?: "product" | "gtm";
  record_name?: string;
  module?: string;
};

const ALL_AREAS: Area[] = ["products", "gtm", "signals", "capabilities", "records"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing Authorization header" }, 401);
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) return json({ error: "server missing ANTHROPIC_API_KEY" }, 500);

  const supabase: SupabaseClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  let input: { agent_key?: string; messages?: ChatMsg[]; context?: Ctx; stream?: boolean };
  try { input = await req.json(); } catch { return json({ error: "invalid JSON body" }, 400); }
  const { agent_key, messages, context, stream } = input;
  if (!agent_key) return json({ error: "agent_key is required" }, 400);
  if (!Array.isArray(messages) || messages.length === 0) return json({ error: "messages required" }, 400);

  // Load the agent (RLS-scoped).
  const { data: agent, error: aErr } = await supabase
    .from("agents").select("id, org_id, name, role, model, system_prompt").eq("key", agent_key).eq("is_active", true).maybeSingle();
  if (aErr) return json({ error: `agent lookup failed: ${aErr.message}` }, 500);
  if (!agent) return json({ error: `no active agent with key '${agent_key}'` }, 404);

  const pol = await resolveModelPolicy(supabase, { task: "agent_chat", agentId: agent.id as string, fallback: { model: (agent.model as string) || DEFAULT_MODEL, effort: "high" } });
  const model = pol.model;
  const orgId = agent.org_id as string;

  try {
    // ---- Skills: the agent's attached, tailorable playbooks. -----------------
    const { data: skillRows } = await supabase
      .from("agent_skills")
      .select("is_cornerstone, skills ( name, description, instructions, category )")
      .eq("agent_id", agent.id);
    // deno-lint-ignore no-explicit-any
    const skills = (skillRows ?? []).map((r: any) => r.skills).filter(Boolean);
    // Identity unification: when a cornerstone is attached, IT is the identity (its
    // instructions are in the skills block below); the legacy 4-window system_prompt
    // is ignored so the two can't contradict. Fallback to system_prompt only when no
    // cornerstone exists.
    // deno-lint-ignore no-explicit-any
    const hasCornerstone = (skillRows ?? []).some((r: any) => r.is_cornerstone);
    const neutralIdentity = `You are ${agent.name}${agent.role ? `, ${agent.role}` : ""}, an executive agent in SingleStack.`;

    // ---- Connections: the internal areas this agent is allowed to see. -------
    const { data: connRows } = await supabase
      .from("connections")
      .select("kind, area, label, status, guidance, targets")
      .eq("agent_id", agent.id)
      .eq("kind", "internal");
    const declaredAreas = [...new Set((connRows ?? []).map((c) => c.area).filter(Boolean))] as Area[];
    // Human curation: what the operator told this agent to watch/prioritize per area.
    const curation = (connRows ?? [])
      // deno-lint-ignore no-explicit-any
      .filter((c: any) => c.guidance || (Array.isArray(c.targets) && c.targets.length))
      // deno-lint-ignore no-explicit-any
      .map((c: any) => `  • ${c.label}${c.guidance ? `: ${c.guidance}` : ""}${Array.isArray(c.targets) && c.targets.length ? ` (watch: ${c.targets.map((t: any) => t.ref).join(", ")})` : ""}`)
      .join("\n");
    // No connections declared → full access (so existing agents keep working).
    const areas = declaredAreas.length ? declaredAreas : ALL_AREAS;
    const can = (a: Area) => areas.includes(a) || areas.includes("records");

    // The operator's current focus (drawer opened on a record/module) gives
    // access to that record regardless of declared areas — you can ask about
    // what you're looking at.
    const focus = context && context.record_id && context.record_type
      ? { id: context.record_id, type: context.record_type, name: context.record_name, module: context.module }
      : null;

    // ---- Alignment: the concrete WORK this agent is responsible for. ----------
    // An explicit human assignment (agent_alignments) — surfaced regardless of
    // area gating, because the operator pointed this agent here on purpose. We
    // pull the aligned initiatives + tasks + the signals tied to those
    // initiatives, so the agent reasons over its actual remit, not the whole org.
    let alignBlock = "";
    {
      const { data: alignRows } = await supabase
        .from("agent_alignments")
        .select("role, guidance, initiative_id, workstream_id, initiatives(id, title, stage, description), initiative_workstreams(title, area, stage)")
        .eq("agent_id", agent.id);
      // deno-lint-ignore no-explicit-any
      const rows = (alignRows ?? []) as any[];
      if (rows.length) {
        const initIds = [...new Set(rows.map((r) => r.initiative_id).filter(Boolean))] as string[];
        const sigByInit: Record<string, string[]> = {};
        if (initIds.length) {
          const { data: links } = await supabase.from("initiative_signals").select("initiative_id, signals(title, why)").in("initiative_id", initIds);
          // deno-lint-ignore no-explicit-any
          for (const l of (links ?? []) as any[]) {
            if (!l.signals) continue;
            (sigByInit[l.initiative_id] ??= []).push(`${l.signals.title}${l.signals.why ? ` (${l.signals.why})` : ""}`);
          }
        }
        // deno-lint-ignore no-explicit-any
        const lines = rows.map((r: any) => {
          if (r.workstream_id && r.initiative_workstreams) {
            const w = r.initiative_workstreams;
            return `  • [${r.role}] TASK: ${w.title} (${w.area}${w.stage ? `, ${w.stage}` : ""})${r.guidance ? ` — focus: ${r.guidance}` : ""}`;
          }
          const i = r.initiatives;
          if (!i) return "";
          const sigs = sigByInit[r.initiative_id] ?? [];
          return `  • [${r.role}] INITIATIVE: ${i.title}${i.stage ? ` (${i.stage})` : ""}${i.description ? ` — ${i.description}` : ""}${r.guidance ? `\n      focus: ${r.guidance}` : ""}${sigs.length ? `\n      signals tied to it: ${sigs.slice(0, 6).join("; ")}` : ""}`;
        }).filter(Boolean);
        alignBlock = `WORK YOU ARE ALIGNED TO — you are accountable for items marked [owner] (proactively flag issues + recommend next steps on them); keep an eye on [watcher] items:\n${lines.join("\n")}`;
      }
    }

    // ---- Outcome feedback: how the operator rated your recent answers. --------
    let feedbackBlock = "";
    {
      const { data: fb } = await supabase
        .from("agent_runs").select("rating, feedback, reason_tags")
        .eq("agent_id", agent.id).not("rating", "is", null)
        .order("rated_at", { ascending: false }).limit(8);
      const rows = (fb ?? []) as { rating: string; feedback: string | null; reason_tags: string[] | null }[];
      if (rows.length) {
        const fmt = (r: typeof rows[number]) => `  • ${r.rating === "helpful" ? "helpful" : "NOT helpful"}${r.reason_tags?.length ? ` [${r.reason_tags.join(", ")}]` : ""}${r.feedback ? `: ${r.feedback}` : ""}`;
        feedbackBlock = `OPERATOR FEEDBACK ON YOUR RECENT ANSWERS — lean into what was helpful, fix what wasn't:\n${rows.map(fmt).join("\n")}`;
      }
    }

    // ---- Build grounding context, scoped to the agent's areas + focus. -------
    const grounding: string[] = [];

    if (can("products") || focus?.type === "product") {
      const { data: prods } = await supabase.from("product_records").select("name").limit(25);
      grounding.push(`Products: ${(prods ?? []).map((p) => p.name).join(", ") || "none yet"}`);
    }
    if (can("gtm") || focus?.type === "gtm") {
      const { data: gtms } = await supabase.from("gtm_records").select("name").limit(25);
      grounding.push(`GTM records: ${(gtms ?? []).map((g) => g.name).join(", ") || "none yet"}`);
    }
    const seesCaps = areas.includes("capabilities") || can("signals");
    if (can("signals") || seesCaps) {
      const [{ data: rawSigs }, { data: themes }] = await Promise.all([
        supabase.from("signals").select("title, why, conf_label, observed_at, metadata").order("observed_at", { ascending: false }).limit(24),
        can("signals")
          ? supabase.from("signal_themes").select("title, summary, recommendation, state, momentum").order("last_evidence_at", { ascending: false }).limit(6)
          : Promise.resolve({ data: [] as { title: string; summary: string | null; recommendation: string | null; state: string; momentum: string }[] }),
      ]);
      // deno-lint-ignore no-explicit-any
      const caps = (rawSigs ?? []).filter((s: any) => s.metadata?.domain === "capability");
      // deno-lint-ignore no-explicit-any
      const sgs = (rawSigs ?? []).filter((s: any) => s.metadata?.domain !== "capability").slice(0, 10);
      if (can("signals")) {
        grounding.push(`Recent signals: ${sgs.map((s) => s.title).join("; ") || "none yet"}`);
        // The SIGNALS PROFILE — the node hierarchy that aims every pull. This
        // is what the operator sets up on /signals; ground the agent in the
        // actual nodes so it can reason about coverage, weights, and gaps.
        const { data: prof } = await supabase.from("signal_profiles").select("id").eq("scope", "landscape").is("competitor_id", null).maybeSingle();
        if (prof) {
          const { data: nodes } = await supabase.from("signal_profile_fields")
            .select("label, value, vector, weight").eq("profile_id", prof.id).neq("vector", "meta")
            .order("vector").order("weight", { ascending: false });
          const real = (nodes ?? []).filter((n) => (n.value ?? "").trim());
          if (real.length) {
            const byVec: Record<string, string[]> = {};
            for (const n of real) {
              const w = n.weight ?? 2;
              const lvl = w >= 3 ? "direct" : w <= 1 ? "indirect" : "adjacent";
              (byVec[n.vector ?? "core"] ??= []).push(`  - [${lvl}] ${n.label}: ${(n.value ?? "").slice(0, 220)}`);
            }
            grounding.push("Signals profile — the node hierarchy that aims every pull (the operator edits this on /signals):\n" +
              Object.entries(byVec).map(([v, ls]) => `${v}:\n${ls.join("\n")}`).join("\n"));
          }
        }
        // Pending RECOMMENDATIONS from what the pulls brought back — the queue
        // the operator accepts/dismisses inside each node.
        const { data: recs } = await supabase.from("intel_updates").select("kind, summary").eq("status", "pending").limit(20);
        if ((recs ?? []).length) {
          grounding.push(`Pending recommendations (${recs!.length}) from signals, awaiting accept/dismiss in their nodes:\n` +
            recs!.map((r) => `  - [${(r.kind ?? "").replace(/_/g, " ")}] ${r.summary ?? ""}`).join("\n"));
        }
        if ((themes ?? []).length) {
          grounding.push(
            "Active intelligence themes:\n" +
            (themes ?? []).map((t) => `  • [${t.state}/${t.momentum}] ${t.title}${t.summary ? ` — ${t.summary}` : ""}${t.recommendation ? ` → ${t.recommendation}` : ""}`).join("\n"),
          );
        }
      }
      if (seesCaps && caps.length) {
        grounding.push(
          "FRONTIER MODEL CAPABILITIES you can leverage (what's now possible — act on these in your own domain, not just engineering):\n" +
          // deno-lint-ignore no-explicit-any
          caps.map((c: any) => `  • ${c.metadata?.provider ? `[${c.metadata.provider}${c.metadata?.area ? `/${c.metadata.area}` : ""}] ` : ""}${c.title}${c.why ? ` — ${c.why}` : ""}`).join("\n"),
        );
      }
    }

    // Pending proposals count is always useful (the operator's queue).
    const { count: pending } = await supabase.from("proposals").select("id", { count: "exact", head: true }).eq("status", "pending");
    grounding.push(`Pending proposals awaiting review: ${pending ?? 0}`);

    // ---- Deep focus: the exact record the operator is looking at. ------------
    if (focus) {
      const col = focus.type === "product" ? "product_id" : "gtm_record_id";
      const [{ data: fields }, { data: props }] = await Promise.all([
        supabase.from("record_fields").select("label, value").eq(col, focus.id).order("position").limit(40),
        supabase.from("proposals").select("title, rationale, status").eq(col, focus.id).eq("status", "pending").limit(10),
      ]);
      const fieldText = (fields ?? []).filter((f) => f.value && f.value.trim())
        .map((f) => `  - ${f.label}: ${f.value}`).join("\n");
      const focusLines = [
        `\nCURRENT FOCUS — the operator is viewing this ${focus.type === "product" ? "Product" : "GTM"} record${focus.name ? ` "${focus.name}"` : ""}${focus.module ? ` (module: ${focus.module})` : ""}:`,
        fieldText ? `Record fields:\n${fieldText}` : "  (no fields filled yet)",
      ];
      if (focus.type === "gtm") {
        const { data: gsigs } = await supabase.from("signals").select("title, why, conf_label").eq("gtm_record_id", focus.id).order("observed_at", { ascending: false }).limit(8);
        if ((gsigs ?? []).length) focusLines.push(`Signals on this record:\n${(gsigs ?? []).map((s) => `  - ${s.title}${s.why ? ` (${s.why})` : ""}`).join("\n")}`);
      }
      if ((props ?? []).length) focusLines.push(`Pending proposals on this record:\n${(props ?? []).map((p) => `  - ${p.title}`).join("\n")}`);
      grounding.push(focusLines.join("\n"));
    }

    // ---- Assemble the system prompt. ----------------------------------------
    const areaLabels: Record<Area, string> = { products: "Product records", gtm: "GTM records", signals: "Signals & intelligence", capabilities: "Frontier models & capabilities", records: "All records" };
    const accessLine = `You are connected to these areas of SingleStack and should ground answers in them: ${areas.map((a) => areaLabels[a]).join(", ")}. If asked about an area you are not connected to, say you don't have access to it rather than guessing.`;

    const skillsBlock = skills.length
      ? [
          "",
          "YOUR SKILLS — apply these playbooks when relevant. They are how you do your job:",
          ...skills.map((s) => `\n## ${s.name}${s.category ? ` (${s.category})` : ""}${s.description ? `\n${s.description}` : ""}${s.instructions ? `\n${s.instructions}` : ""}`),
        ].join("\n")
      : "";

    const system = [
      hasCornerstone ? neutralIdentity : (agent.system_prompt || neutralIdentity),
      "",
      "You advise the operator on this organization's product and go-to-market. Be concise, specific, and action-oriented. When asked for a daily briefing, give a tight summary of what needs attention and 2–3 concrete recommended next steps. Ground everything in the data below; if data is missing, say so plainly.",
      "",
      accessLine,
      curation ? `\nYOUR CURATION — the operator has told you what to watch/prioritize/ignore. Honor it:\n${curation}` : "",
      alignBlock ? `\n${alignBlock}` : "",
      skillsBlock,
      feedbackBlock ? `\n${feedbackBlock}` : "",
      "",
      "ORGANIZATION CONTEXT:",
      grounding.join("\n"),
    ].join("\n");

    const anthropic = new Anthropic({ apiKey: anthropicKey });

    // Streaming path: emit the model's REAL reasoning (extended-thinking deltas)
    // first, then an ANSWER_MARK separator, then the answer deltas — so the UI can show
    // actual work as it forms, then type the answer. Logs the run when done.
    if (stream) {
      const encoder = new TextEncoder();
      const body = new ReadableStream({
        async start(controller) {
          let full = "";
          let inAnswer = false;
          try {
            const s = anthropic.messages.stream({
              model,
              max_tokens: 2000,
              thinking: { type: "adaptive", display: "summarized" }, // summarized → reasoning text is populated on Opus 4.8
              output_config: { effort: pol.effort },
              system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
              messages: messages.map((m) => ({ role: m.role, content: m.content })),
              // deno-lint-ignore no-explicit-any
            } as any);
            // deno-lint-ignore no-explicit-any
            for await (const ev of s as any) {
              if (ev.type !== "content_block_delta") continue;
              if (ev.delta?.type === "thinking_delta" && ev.delta.thinking) {
                controller.enqueue(encoder.encode(ev.delta.thinking)); // reasoning trace
              } else if (ev.delta?.type === "text_delta" && ev.delta.text) {
                if (!inAnswer) { inAnswer = true; controller.enqueue(encoder.encode(ANSWER_MARK)); } // marks reasoning -> answer
                full += ev.delta.text;
                controller.enqueue(encoder.encode(ev.delta.text));
              }
            }
            if (!inAnswer) controller.enqueue(encoder.encode(ANSWER_MARK)); // ensure marker even with no thinking
            const finalMsg = await s.finalMessage();
            const u = finalMsg.usage;
            const price = PRICING[model];
            const cost = price ? (u.input_tokens * price.input + u.output_tokens * price.output) / 1_000_000 : null;
            await supabase.from("agent_runs").insert({
              org_id: orgId, agent_id: agent.id, status: "succeeded",
              input: { kind: "chat", messages, context: context ?? null, skills: skills.length, areas }, output: full, model,
              input_tokens: u.input_tokens, output_tokens: u.output_tokens, cost_usd: cost,
              finished_at: new Date().toISOString(),
            });
          } catch (e) {
            controller.enqueue(encoder.encode(ANSWER_MARK + `[error: ${e instanceof Error ? e.message : String(e)}]`));
          } finally {
            controller.close();
          }
        },
      });
      return new Response(body, { headers: { ...CORS, "content-type": "text/plain; charset=utf-8", "cache-control": "no-cache" } });
    }

    const resp = (await anthropic.messages.create({
      model,
      max_tokens: 2000,
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: pol.effort },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      // deno-lint-ignore no-explicit-any
    } as any)) as Anthropic.Message;

    const text = resp.content.find((b) => b.type === "text");
    const reply = text && text.type === "text" ? text.text : "(no response)";

    // Log the turn.
    const price = PRICING[model];
    const cost = price ? (resp.usage.input_tokens * price.input + resp.usage.output_tokens * price.output) / 1_000_000 : null;
    const { data: run } = await supabase.from("agent_runs").insert({
      org_id: orgId, agent_id: agent.id, status: "succeeded",
      input: { kind: "chat", messages, context: context ?? null, skills: skills.length, areas }, output: reply, model,
      input_tokens: resp.usage.input_tokens, output_tokens: resp.usage.output_tokens, cost_usd: cost,
      finished_at: new Date().toISOString(),
    }).select("id").single();

    // run_id lets the client attach a helpful/not-helpful verdict (the outcome loop).
    return json({ reply, run_id: run?.id ?? null });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
