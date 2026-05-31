// ============================================================================
// draft-how — Edge Function. The "build-architect" agent (slice 2).
//
// Plain English: given a build item's intent (its What), the product's technical
// foundation, and the org's capability_notes (what's buildable right now), it
// asks the model to draft the HOW — approach / dependencies / risks / effort —
// each grounded in and CITING a capability note. It writes NOTHING: it returns
// drafts the human accepts/edits/rejects in the workspace. Human in the loop.
//
// Runs as the caller (JWT forwarded) → RLS scopes reads to their org.
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

// The How fields the architect drafts (keys match BUILD_ITEM_TEMPLATE 'How').
const HOW = [
  { key: "approach", label: "Technical approach" },
  { key: "dependencies", label: "Dependencies" },
  { key: "risks", label: "Risks & unknowns" },
  { key: "effort", label: "Effort / confidence" },
];

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    fields: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          key: { type: "string", enum: HOW.map((h) => h.key) },
          value: { type: "string" },
          cites: { type: "array", items: { type: "integer" } }, // indices into the capability list
        },
        required: ["key", "value", "cites"],
      },
    },
  },
  required: ["fields"],
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
    const { initiative_id } = await req.json().catch(() => ({}));
    if (!initiative_id) return json({ error: "initiative_id required" }, 400);

    const { data: orgId } = await supabase.rpc("current_org_id");
    if (!orgId) return json({ error: "could not resolve org" }, 400);

    // The build item + its current fields (the What is the input to the How).
    const { data: item } = await supabase
      .from("initiatives").select("id, title, description, product_id")
      .eq("id", initiative_id).single();
    if (!item) return json({ error: "Build item not found" }, 404);

    const { data: fields } = await supabase
      .from("initiative_fields").select("label, value, section").eq("initiative_id", initiative_id);
    const fieldText = (fields ?? [])
      .filter((f) => f.value && f.value.trim())
      .map((f) => `- ${f.label} (${f.section ?? "?"}): ${f.value}`)
      .join("\n") || "(no fields filled yet)";

    // Product technical foundation grounds the approach in the real stack.
    let techText = "(no product technical context)";
    if (item.product_id) {
      const { data: pf } = await supabase
        .from("record_fields").select("label, value").eq("product_id", item.product_id).eq("section", "Technical");
      const t = (pf ?? []).filter((f) => f.value && f.value.trim()).map((f) => `- ${f.label}: ${f.value}`).join("\n");
      if (t) techText = t;
    }

    // Capabilities — what's buildable now. The architect must cite these by [n].
    const { data: caps } = await supabase
      .from("capability_notes").select("title, content").order("observed_at", { ascending: false }).limit(40);
    if (!caps || caps.length === 0) {
      return json({ error: "no_capabilities", message: "No capability notes yet. Add a few (what's newly buildable) so the architect can ground and cite the How." });
    }
    const capText = caps.map((c, i) => `[${i}] ${c.title} — ${c.content}`).join("\n");

    const system = [
      "You are a senior build architect for SingleStack, an AI-native product & GTM platform.",
      "You draft the HOW of a build item: technical approach, dependencies, risks & unknowns, and a rough effort/confidence.",
      "Ground every choice in the CAPABILITIES provided — prefer the newest capability that makes the build simpler — and CITE the capabilities you lean on by their [n] index in the 'cites' array.",
      "Be concrete and concise. Return one entry per How field (approach, dependencies, risks, effort).",
    ].join("\n");

    const userMsg = [
      `BUILD ITEM: ${item.title}${item.description ? ` — ${item.description}` : ""}`,
      "",
      "WHAT (intent & scope):",
      fieldText,
      "",
      "PRODUCT TECHNICAL FOUNDATION:",
      techText,
      "",
      "CAPABILITIES (what's buildable now — cite by [n]):",
      capText,
      "",
      "Draft the How now.",
    ].join("\n");

    const anthropic = new Anthropic({ apiKey: key });
    const resp = (await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2500,
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userMsg }],
      // deno-lint-ignore no-explicit-any
    } as any)) as Anthropic.Message;

    const block = resp.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new Error("no draft returned");
    const parsed = JSON.parse(block.text) as { fields?: { key: string; value: string; cites?: number[] }[] };

    const labelOf = (k: string) => HOW.find((h) => h.key === k)?.label ?? k;
    const drafts = (parsed.fields ?? [])
      .filter((f) => f && f.key && f.value)
      .map((f) => ({
        key: f.key,
        label: labelOf(f.key),
        section: "How",
        value: f.value,
        cites: (f.cites ?? []).map((i) => caps[i]?.title).filter(Boolean),
      }));

    return json({ drafts });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
