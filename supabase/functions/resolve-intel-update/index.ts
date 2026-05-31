// ============================================================================
// resolve-intel-update — apply (or reject) a queued synthesis delta, and record
// the human's verdict + context as the learning corpus.
//
// Plain English: synthesis queues high-judgment changes into intel_updates. The
// human reviews each with a verdict (accept | edit | reject), a free-text
// rationale, and reason tags. This function:
//   • accept / edit → APPLIES the change to the living themes (writing
//     theme_events), using the edited payload when provided;
//   • reject        → applies nothing;
//   • always        → records status + rationale + reason_tags on the row, so
//     the feedback becomes the corpus that distills into agent_lessons.
//
// Runs as the caller (JWT forwarded) → RLS scopes everything to their org.
// ============================================================================

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "content-type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing Authorization header" }, 401);

  const supabase: SupabaseClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  try {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: orgId } = await supabase.rpc("current_org_id");
    if (!orgId) return json({ error: "could not resolve org" }, 400);

    const body = await req.json().catch(() => ({}));
    const { update_id, verdict, rationale, reason_tags, edited_payload } = body as {
      update_id?: string; verdict?: "accept" | "edit" | "reject";
      rationale?: string; reason_tags?: string[]; edited_payload?: Record<string, unknown>;
    };
    if (!update_id || !verdict) return json({ error: "update_id and verdict required" }, 400);

    const { data: upd } = await supabase.from("intel_updates").select("*").eq("id", update_id).single();
    if (!upd) return json({ error: "update not found" }, 404);
    if (upd.status !== "pending") return json({ error: "already resolved" }, 409);

    const decided_by = user?.email ?? "human";
    const now = new Date().toISOString();
    const ev = (theme_id: string, kind: string, detail: Record<string, unknown>) =>
      supabase.from("theme_events").insert({ org_id: orgId, theme_id, kind, detail, actor: decided_by });

    // The payload to apply: the human's edits when provided, else the original.
    const p = { ...(upd.payload ?? {}), ...(verdict === "edit" ? (edited_payload ?? {}) : {}) } as Record<string, unknown>;

    if (verdict !== "reject") {
      switch (upd.kind) {
        case "new_theme": {
          const sigIds = (p.signal_ids as string[] | undefined) ?? [];
          const { data: row } = await supabase.from("signal_themes").insert({
            org_id: orgId, category: p.category === "gtm" ? "gtm" : "product",
            title: p.title, summary: p.summary, recommendation: p.recommendation,
            conf_level: Math.min(1, Math.max(0, Number(p.conf_level) || 0)),
            state: "emerging", momentum: "accelerating", first_seen_at: now, last_evidence_at: now,
            signal_ids: sigIds, position: 0,
          }).select("id").single();
          if (row) {
            await ev(row.id, "created", { signals: sigIds.length });
            if (sigIds.length) {
              await supabase.from("theme_signals").upsert(
                sigIds.map((sid) => ({ org_id: orgId, theme_id: row.id, signal_id: sid, added_at: now })),
                { onConflict: "theme_id,signal_id", ignoreDuplicates: true },
              );
              await supabase.from("signal_themes").update({ last_evidence_at: now }).eq("id", row.id);
            }
          }
          break;
        }
        case "escalate":
        case "restate": {
          if (upd.theme_id) {
            const patch: Record<string, unknown> = {};
            if (p.state) patch.state = p.state;
            if (p.summary) patch.summary = p.summary;
            if (p.recommendation) patch.recommendation = p.recommendation;
            if (Object.keys(patch).length) {
              await supabase.from("signal_themes").update(patch).eq("id", upd.theme_id);
              if (patch.state) await ev(upd.theme_id as string, "state_changed", { from: p.from_state, to: patch.state });
              if (patch.summary || patch.recommendation) await ev(upd.theme_id as string, patch.recommendation ? "recommendation_changed" : "summary_updated", {});
            }
          }
          break;
        }
        case "merge": {
          const into = p.into as string, from = p.from as string;
          if (into && from && into !== from) {
            const { data: fromLinks } = await supabase.from("theme_signals").select("signal_id").eq("theme_id", from);
            const ids = (fromLinks ?? []).map((l) => l.signal_id);
            if (ids.length) {
              await supabase.from("theme_signals").upsert(
                ids.map((sid) => ({ org_id: orgId, theme_id: into, signal_id: sid, added_at: now })),
                { onConflict: "theme_id,signal_id", ignoreDuplicates: true },
              );
            }
            await ev(into, "merged_in", { from, from_title: p.from_title });
            await supabase.from("signal_themes").delete().eq("id", from);
          }
          break;
        }
        case "decay": {
          if (upd.theme_id) {
            await supabase.from("signal_themes").update({ state: "fading" }).eq("id", upd.theme_id);
            await ev(upd.theme_id as string, "state_changed", { from: p.from_state, to: "fading", reason: "no recent evidence" });
          }
          break;
        }
      }
      // Keep momentum/last_evidence/signal_ids[] consistent for any touched theme.
      const touched = upd.theme_id ?? (p.into as string | undefined);
      if (touched) {
        const { data: ts } = await supabase.from("theme_signals").select("signal_id, added_at").eq("theme_id", touched);
        const rows = ts ?? [];
        const last = rows.length ? rows.map((r) => r.added_at).sort().slice(-1)[0] : null;
        await supabase.from("signal_themes").update({ last_evidence_at: last, signal_ids: rows.map((r) => r.signal_id) }).eq("id", touched);
      }
    }

    await supabase.from("intel_updates").update({
      status: verdict === "accept" ? "accepted" : verdict === "edit" ? "edited" : "rejected",
      rationale: rationale ?? null, reason_tags: reason_tags ?? [],
      edited_payload: verdict === "edit" ? (edited_payload ?? null) : null,
      decided_by, decided_at: now,
    }).eq("id", update_id);

    return json({ ok: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
