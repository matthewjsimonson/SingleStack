// ============================================================================
// draft-how — Edge Function. The "build-architect" agent for slice 2.
// Plain English: given a build item's intent (its What), the product's technical
// foundation, and the org's capability_notes (what's buildable right now), it
// asks the LLM to draft the HOW — approach / dependencies / risks / effort —
// each grounded in and CITING a capability note. It does NOT write anything: it
// returns drafts the human accepts/edits/rejects in the workspace. Human in the
// loop. The model id is read from a secret (DRAFT_MODEL) so no model identifier
// lives in the repo and it stays configurable.
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// The How fields the agent drafts (keys match BUILD_ITEM_TEMPLATE 'How').
const HOW_FIELDS = [
  { key: "approach", label: "Technical approach" },
  { key: "dependencies", label: "Dependencies" },
  { key: "risks", label: "Risks & unknowns" },
  { key: "effort", label: "Effort / confidence" },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { data: mem } = await supabase.from("memberships").select("org_id").eq("user_id", user.id).limit(1).maybeSingle();
    const orgId = mem?.org_id;
    if (!orgId) return json({ error: "No org" }, 400);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    const model = Deno.env.get("DRAFT_MODEL");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY secret is not set on this project." }, 500);
    if (!model) return json({ error: "DRAFT_MODEL secret is not set. Add it (Edge Functions → Secrets) so the architect knows which model to use." }, 500);

    const { initiative_id } = await req.json().catch(() => ({}));
    if (!initiative_id) return json({ error: "initiative_id required" }, 400);

    // Load the build item + its current fields (the What is the input to the How).
    const { data: item } = await supabase
      .from("initiatives").select("id, title, description, product_id")
      .eq("id", initiative_id).single();
    if (!item) return json({ error: "Build item not found" }, 404);

    const { data: fields } = await supabase
      .from("initiative_fields").select("field_key, label, value, section")
      .eq("initiative_id", initiative_id);
    const fieldText = (fields ?? [])
      .filter((f) => f.value && f.value.trim())
      .map((f) => `- ${f.label} (${f.section ?? "?"}): ${f.value}`)
      .join("\n") || "(no fields filled yet)";

    // Product technical foundation — grounds the approach in the real stack.
    let techText = "(no product technical context)";
    if (item.product_id) {
      const { data: pf } = await supabase
        .from("record_fields").select("label, value")
        .eq("product_id", item.product_id).eq("section", "Technical");
      const t = (pf ?? []).filter((f) => f.value && f.value.trim()).map((f) => `- ${f.label}: ${f.value}`).join("\n");
      if (t) techText = t;
    }

    // Capability notes — what's buildable right now. The agent must cite these.
    const { data: caps } = await supabase
      .from("capability_notes").select("title, content, category, observed_at")
      .order("observed_at", { ascending: false }).limit(40);
    if (!caps || caps.length === 0) {
      return json({ error: "no_capabilities", message: "No capability notes yet. Add a few (what's newly buildable) so the architect can ground and cite the How." }, 200);
    }
    const capText = caps.map((c, i) => `[C${i + 1}] ${c.title} — ${c.content}`).join("\n");

    const prompt = [
      "You are a senior build architect. Draft the HOW for a build item: the technical approach, dependencies, risks, and a rough effort/confidence.",
      "Ground every choice in the CAPABILITIES below — prefer the newest capability that makes the build simpler — and CITE which capability you leaned on by its [C#] tag.",
      "",
      `BUILD ITEM: ${item.title}${item.description ? ` — ${item.description}` : ""}`,
      "",
      "WHAT (intent & scope):",
      fieldText,
      "",
      "PRODUCT TECHNICAL FOUNDATION:",
      techText,
      "",
      "CAPABILITIES (what's buildable now — cite these):",
      capText,
      "",
      "Return STRICT JSON only, no prose, in this exact shape:",
      `{"fields":[{"key":"approach","value":"...","cites":["C1"]},{"key":"dependencies","value":"...","cites":[]},{"key":"risks","value":"...","cites":[]},{"key":"effort","value":"...","cites":[]}]}`,
      "Keep each value concise and concrete. 'cites' lists the [C#] tags (without brackets) you relied on.",
    ].join("\n");

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 1500, messages: [{ role: "user", content: prompt }] }),
    });
    if (!resp.ok) return json({ error: `LLM error ${resp.status}`, detail: await resp.text() }, 502);
    const data = await resp.json();
    const raw: string = data?.content?.[0]?.text ?? "";

    // Tolerant JSON extraction (strip code fences / surrounding prose).
    let parsed: { fields?: { key: string; value: string; cites?: string[] }[] } = {};
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : {};
    } catch { /* fall through to empty */ }

    const labelOf = (k: string) => HOW_FIELDS.find((f) => f.key === k)?.label ?? k;
    const capTitle = (tag: string) => {
      const n = parseInt(tag.replace(/[^0-9]/g, ""), 10);
      return Number.isFinite(n) && caps[n - 1] ? caps[n - 1].title : tag;
    };
    const drafts = (parsed.fields ?? [])
      .filter((f) => f && f.key && f.value)
      .map((f) => ({
        key: f.key,
        label: labelOf(f.key),
        section: "How",
        value: f.value,
        cites: (f.cites ?? []).map(capTitle),
      }));

    return json({ drafts });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
