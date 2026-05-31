// ============================================================================
// distill-lessons — turn the feedback corpus into durable, plain-language
// lessons the synthesis engine follows.
//
// Plain English: every resolved intel_update carries a verdict (accepted /
// edited / rejected) + the human's rationale + reason tags. This reads that
// corpus and asks the model to distill a short set of GENERAL preferences
// ("don't open a GTM theme from a single call"), which it writes to
// agent_lessons. Active lessons are injected into the next synthesis prompt and
// shown in the Learning panel (each dismissable). That's the compounding loop.
//
// Runs as the caller (JWT forwarded) → RLS scopes everything to their org.
// Secret: ANTHROPIC_API_KEY. Mirrors synthesize-signals conventions.
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

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    lessons: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: { lesson: { type: "string" }, supported_by: { type: "integer" } },
        required: ["lesson", "supported_by"],
      },
    },
  },
  required: ["lessons"],
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

  try {
    const { data: orgId } = await supabase.rpc("current_org_id");
    if (!orgId) return json({ error: "could not resolve org" }, 400);

    // The feedback corpus: resolved updates that carry human context.
    const { data: resolved } = await supabase
      .from("intel_updates")
      .select("kind, summary, status, rationale, reason_tags, payload, edited_payload")
      .neq("status", "pending")
      .order("decided_at", { ascending: false })
      .limit(80);

    const withContext = (resolved ?? []).filter((r) => (r.rationale && r.rationale.trim()) || (r.reason_tags && r.reason_tags.length));
    if (withContext.length === 0) {
      return json({ lessons: 0, message: "No feedback with context yet — review updates and add a 'why' first." });
    }

    const corpus = withContext.map((r, i) => {
      const verdict = r.status;
      const tags = (r.reason_tags ?? []).join(", ");
      const edited = r.edited_payload ? ` | human rewrote to: ${JSON.stringify(r.edited_payload)}` : "";
      return `[${i}] (${r.kind}) "${r.summary}" → ${verdict}${tags ? ` [${tags}]` : ""}${r.rationale ? ` — "${r.rationale}"` : ""}${edited}`;
    }).join("\n");

    // Existing active lessons so we consolidate rather than duplicate.
    const { data: existing } = await supabase
      .from("agent_lessons").select("lesson").eq("scope", "synthesis").eq("status", "active");
    const existingText = (existing ?? []).map((l) => `- ${l.lesson}`).join("\n") || "(none)";

    const system = [
      "You distill an org's review feedback into a SHORT set of durable, general lessons that guide how the synthesis engine should reconcile signals into themes.",
      "Each lesson is one imperative sentence in plain language (e.g. \"Don't open a GTM theme from a single call — wait for 3+ corroborating signals\").",
      "Generalize across multiple feedback items; do not restate one-offs. Prefer 3–8 high-signal lessons total. Consolidate with the EXISTING lessons (refine/merge rather than duplicate).",
      "supported_by = how many feedback items back each lesson.",
    ].join("\n");

    const userMsg = `EXISTING LESSONS:\n${existingText}\n\nFEEDBACK CORPUS:\n${corpus}\n\nDistill the consolidated lesson set.`;

    const anthropic = new Anthropic({ apiKey: key });
    const resp = (await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userMsg }],
      // deno-lint-ignore no-explicit-any
    } as any)) as Anthropic.Message;

    const block = resp.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new Error("no lessons returned");
    const parsed = JSON.parse(block.text) as { lessons?: { lesson: string; supported_by: number }[] };
    const lessons = (parsed.lessons ?? []).filter((l) => l.lesson && l.lesson.trim());

    // Replace the distilled set: retire prior distilled lessons, insert the fresh
    // consolidated set. Human-added lessons (source='human') are left untouched.
    await supabase.from("agent_lessons").update({ status: "dismissed" })
      .eq("scope", "synthesis").eq("status", "active").eq("source", "distilled");
    if (lessons.length) {
      await supabase.from("agent_lessons").insert(lessons.map((l) => ({
        org_id: orgId, scope: "synthesis", lesson: l.lesson.trim(),
        status: "active", derived_count: Math.max(1, Number(l.supported_by) || 1), source: "distilled",
      })));
    }

    return json({ lessons: lessons.length });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
