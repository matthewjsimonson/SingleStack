// ============================================================================
// synthesize-signals — RECONCILIATION engine for compounding intelligence.
//
// Plain English: themes are LIVING entities now. This no longer wipes and
// regenerates — it reconciles. It loads the org's existing themes (with their
// evidence) and the signals not yet attached to any theme, then asks the model
// for a DIFF against stable theme IDs:
//   • attach   — new signals that belong to an existing theme
//   • escalate / restate — an existing theme's state or summary should change
//   • merge    — two themes are really one
//   • decay    — a theme has gone quiet (no recent evidence)
//   • new      — genuinely new emerging themes
// It also classifies each unsorted signal's lens (product/gtm/both), as before.
//
// Graduated HITL: low-judgment maintenance (attach evidence, bump freshness,
// recompute momentum) is APPLIED automatically to keep intelligence fresh.
// High-judgment changes (new theme, escalation, merge, recommendation change)
// are applied but logged as theme_events with actor='synthesis' so the UI can
// surface them for review. Every change writes an append-only theme_event — the
// theme's memory. Nothing is ever silently deleted.
//
// Runs as the caller (JWT forwarded) → RLS scopes everything to their org.
// Secret: ANTHROPIC_API_KEY.
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

// The reconciliation diff the model returns. Indices reference the input lists.
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    // Attach unsorted signals (by [n] index) to an EXISTING theme (by id).
    attach: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: { theme_id: { type: "string" }, signal_indices: { type: "array", items: { type: "integer" } } },
        required: ["theme_id", "signal_indices"],
      },
    },
    // Update an existing theme's lifecycle state and/or summary/recommendation.
    updates: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          theme_id: { type: "string" },
          state: { type: "string", enum: ["emerging", "active", "escalating", "steady", "fading", "dormant"] },
          summary: { type: "string" },
          recommendation: { type: "string" },
        },
        required: ["theme_id"],
      },
    },
    // Merge `from` theme into `into` theme (evidence re-pointed, `from` dissolved).
    merges: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: { into: { type: "string" }, from: { type: "string" } },
        required: ["into", "from"],
      },
    },
    // Themes with no recent evidence that should decay (state -> fading/dormant).
    decays: { type: "array", items: { type: "string" } },
    // Genuinely NEW themes not covered by any existing theme.
    new_themes: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          category: { type: "string", enum: ["product", "gtm"] },
          title: { type: "string" },
          summary: { type: "string" },
          recommendation: { type: "string" },
          conf_level: { type: "number" },
          signal_indices: { type: "array", items: { type: "integer" } },
        },
        required: ["category", "title", "summary", "recommendation", "conf_level", "signal_indices"],
      },
    },
    // Lens classification for unsorted signals (product/gtm/both), as before.
    signal_categories: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: { index: { type: "integer" }, category: { type: "string", enum: ["product", "gtm", "both"] } },
        required: ["index", "category"],
      },
    },
  },
  required: ["attach", "updates", "merges", "decays", "new_themes", "signal_categories"],
};

// Momentum from evidence arrival rate: recent (7d) vs prior (8–30d).
function momentumFor(addedAts: string[]): "accelerating" | "steady" | "fading" {
  const now = Date.now();
  const d = (iso: string) => (now - new Date(iso).getTime()) / 86400000;
  const recent = addedAts.filter((a) => d(a) <= 7).length;
  const prior = addedAts.filter((a) => d(a) > 7 && d(a) <= 30).length;
  if (recent > prior) return "accelerating";
  if (recent === 0 && prior === 0) return "fading"; // nothing in 30d
  if (recent < prior) return "fading";
  return "steady";
}

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

  const ev = (theme_id: string, kind: string, detail: Record<string, unknown>, orgId: string) =>
    supabase.from("theme_events").insert({ org_id: orgId, theme_id, kind, detail, actor: "synthesis" });

  try {
    const { data: orgId } = await supabase.rpc("current_org_id");
    if (!orgId) return json({ error: "could not resolve org" }, 400);

    // Existing living themes + their attached signal ids (what reconciliation updates).
    const { data: themes } = await supabase
      .from("signal_themes").select("id, title, summary, recommendation, category, state, conf_level");
    const { data: links } = await supabase.from("theme_signals").select("theme_id, signal_id, added_at");
    const attachedIds = new Set((links ?? []).map((l) => l.signal_id));

    // Candidate signals to reconcile = those not yet attached to any theme.
    const { data: allSignals } = await supabase
      .from("signals")
      .select("id, title, why, conf_level, scope, category, origin, observed_at, sources(label, origin)")
      .order("observed_at", { ascending: false, nullsFirst: false })
      .limit(200);
    const candidates = (allSignals ?? []).filter((s) => !attachedIds.has(s.id));

    // First run with no themes and no signals: nothing to do.
    if ((themes ?? []).length === 0 && candidates.length === 0) {
      return json({ themes: 0, message: "No signals to synthesize yet." });
    }

    const sigList = candidates.map((s, i) => {
      // deno-lint-ignore no-explicit-any
      const sig = s as any;
      const origin = sig.origin ?? sig.sources?.origin ?? "internal";
      const label = sig.sources?.label ?? "unattributed";
      return `[${i}] (${origin} · ${label} · scope:${s.scope}) ${s.title}${s.why ? " — " + s.why : ""}`;
    }).join("\n") || "(no new unattributed signals)";

    const themeList = (themes ?? []).map((t) =>
      `{id:${t.id}} [${t.category}/${t.state}] ${t.title} — ${t.summary ?? ""}`
    ).join("\n") || "(no existing themes)";

    // Active distilled lessons from past human feedback — injected so the engine
    // applies what this org has taught it. The compounding loop, made real.
    const { data: lessons } = await supabase
      .from("agent_lessons").select("lesson").eq("scope", "synthesis").eq("status", "active")
      .order("derived_count", { ascending: false }).limit(20);
    const lessonText = (lessons ?? []).map((l, i) => `${i + 1}. ${l.lesson}`).join("\n");
    const appliedLessons = (lessons ?? []).length;

    const system = [
      "You are the compounding intelligence engine for SingleStack, an AI-native product & GTM platform.",
      "Themes are LIVING entities with stable ids and a lifecycle (emerging|active|escalating|steady|fading|dormant). You RECONCILE — you never wipe and rebuild.",
      "You receive the EXISTING themes (with ids) and NEW unattributed signals. Produce a DIFF:",
      "• attach: new signals (by [n] index) that clearly belong to an EXISTING theme (by id). Prefer attaching over creating duplicates.",
      "• updates: an existing theme whose state should change (e.g. escalate when evidence is mounting) and/or whose summary/recommendation should be refreshed.",
      "• merges: two existing themes that are really the same pattern (keep the better-named as `into`).",
      "• decays: existing theme ids with no fresh evidence that should wind down.",
      "• new_themes: genuinely NEW patterns not covered by any existing theme, each with supporting signal_indices.",
      "Also classify each unsorted signal's lens in signal_categories: product | gtm | both.",
      "Be conservative: only create a new theme when no existing theme fits. Prefer accretion. Set conf_level 0..1 by evidence strength.",
      lessonText ? `\nLESSONS FROM THIS ORG'S PAST FEEDBACK — follow these, they reflect how this team wants intelligence synthesized:\n${lessonText}` : "",
    ].filter(Boolean).join("\n");

    const anthropic = new Anthropic({ apiKey: key });
    const resp = (await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `EXISTING THEMES:\n${themeList}\n\nNEW SIGNALS:\n${sigList}\n\nReconcile.` }],
      // deno-lint-ignore no-explicit-any
    } as any)) as Anthropic.Message;

    const block = resp.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new Error("no reconciliation returned");
    const diff = JSON.parse(block.text) as {
      attach: { theme_id: string; signal_indices: number[] }[];
      updates: { theme_id: string; state?: string; summary?: string; recommendation?: string }[];
      merges: { into: string; from: string }[];
      decays: string[];
      new_themes: { category: string; title: string; summary: string; recommendation: string; conf_level: number; signal_indices: number[] }[];
      signal_categories?: { index: number; category: string }[];
    };

    const themeById = new Map((themes ?? []).map((t) => [t.id, t]));
    const validId = (id: string) => themeById.has(id);
    const sigIdAt = (i: number) => candidates[i]?.id;
    const now = new Date().toISOString();
    let attached = 0;

    // Helper: attach signals to a theme via theme_signals (idempotent), log event.
    async function attachSignals(themeId: string, signalIds: string[]) {
      const ids = signalIds.filter(Boolean);
      if (!ids.length) return;
      await supabase.from("theme_signals")
        .upsert(ids.map((sid) => ({ org_id: orgId, theme_id: themeId, signal_id: sid, added_at: now })), { onConflict: "theme_id,signal_id", ignoreDuplicates: true });
      attached += ids.length;
      await ev(themeId, "evidence_added", { added: ids.length }, orgId);
    }

    // 1) attach
    for (const a of diff.attach ?? []) {
      if (!validId(a.theme_id)) continue;
      await attachSignals(a.theme_id, (a.signal_indices ?? []).map(sigIdAt));
    }

    // High-judgment deltas are NOT applied here — they QUEUE into intel_updates
    // for human review (with context that becomes the learning corpus). Only the
    // low-judgment maintenance above (attach evidence) and momentum below auto-
    // apply. Resolving a queued update (accept/edit/reject) is what applies it.
    const queued: { org_id: string; kind: string; theme_id: string | null; payload: Record<string, unknown>; summary: string }[] = [];
    const titleOf = (id: string) => themeById.get(id)?.title ?? "a theme";

    for (const u of diff.updates ?? []) {
      if (!validId(u.theme_id)) continue;
      const cur = themeById.get(u.theme_id)!;
      const p: Record<string, unknown> = {};
      if (u.state && u.state !== cur.state) p.state = u.state;
      if (u.summary && u.summary !== cur.summary) p.summary = u.summary;
      if (u.recommendation && u.recommendation !== cur.recommendation) p.recommendation = u.recommendation;
      if (Object.keys(p).length === 0) continue;
      const kind = p.state === "escalating" ? "escalate" : "restate";
      const bits = [p.state ? `state → ${p.state}` : "", p.summary ? "refine summary" : "", p.recommendation ? "update recommendation" : ""].filter(Boolean).join(", ");
      queued.push({ org_id: orgId, kind, theme_id: u.theme_id, payload: { ...p, from_state: cur.state }, summary: `${titleOf(u.theme_id)}: ${bits}` });
    }
    for (const m of diff.merges ?? []) {
      if (!validId(m.into) || !validId(m.from) || m.into === m.from) continue;
      queued.push({ org_id: orgId, kind: "merge", theme_id: m.into, payload: { into: m.into, from: m.from, from_title: titleOf(m.from) }, summary: `Merge "${titleOf(m.from)}" into "${titleOf(m.into)}"` });
    }
    for (const id of diff.decays ?? []) {
      if (!validId(id)) continue;
      const cur = themeById.get(id)!;
      if (cur.state === "fading" || cur.state === "dormant") continue;
      queued.push({ org_id: orgId, kind: "decay", theme_id: id, payload: { from_state: cur.state }, summary: `Let "${titleOf(id)}" fade — no recent evidence` });
    }
    for (const t of diff.new_themes ?? []) {
      const sigIds = (t.signal_indices ?? []).map(sigIdAt).filter(Boolean);
      queued.push({ org_id: orgId, kind: "new_theme", theme_id: null,
        payload: { category: t.category === "gtm" ? "gtm" : "product", title: t.title, summary: t.summary, recommendation: t.recommendation, conf_level: Math.min(1, Math.max(0, Number(t.conf_level) || 0)), signal_ids: sigIds },
        summary: `New ${t.category} theme: "${t.title}" (${sigIds.length} signal${sigIds.length === 1 ? "" : "s"})` });
    }
    if (queued.length) {
      await supabase.from("intel_updates").insert(queued.map((q) => ({ ...q, scope: "synthesis", status: "pending" })));
    }
    const proposed = queued.length;

    // 6) lens classification for unsorted signals (only those the user hasn't set).
    const unsorted = new Set(candidates.filter((s) => !s.category).map((s) => s.id));
    const byCat: Record<string, string[]> = { product: [], gtm: [], both: [] };
    for (const c of diff.signal_categories ?? []) {
      const id = sigIdAt(c.index);
      if (id && unsorted.has(id) && byCat[c.category]) byCat[c.category].push(id);
    }
    let categorized = 0;
    for (const [category, ids] of Object.entries(byCat)) {
      if (!ids.length) continue;
      const { error } = await supabase.from("signals").update({ category }).in("id", ids);
      if (!error) categorized += ids.length;
    }

    // 7) recompute momentum + last_evidence + keep signal_ids[] in sync, per theme.
    const { data: liveThemes } = await supabase.from("signal_themes").select("id");
    for (const t of liveThemes ?? []) {
      const { data: ts } = await supabase.from("theme_signals").select("signal_id, added_at").eq("theme_id", t.id);
      const rows = ts ?? [];
      const mo = momentumFor(rows.map((r) => r.added_at));
      const last = rows.length ? rows.map((r) => r.added_at).sort().slice(-1)[0] : null;
      await supabase.from("signal_themes").update({
        momentum: mo,
        last_evidence_at: last,
        signal_ids: rows.map((r) => r.signal_id),
      }).eq("id", t.id);
    }

    return json({
      themes: (liveThemes ?? []).length,
      attached, categorized,
      proposed,          // high-judgment changes queued for review
      appliedLessons,    // lessons from past feedback applied this run
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
