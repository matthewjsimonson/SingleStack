// ============================================================================
// scheduled-pulls — the platform's heartbeat for ingestion.
//
// Sources have had a `cadence` column (manual | daily | weekly) since
// source_connect, but nothing ever read it: every pull was hand-cranked.
// This function, invoked on a schedule (pg_cron → see migration
// 20260609000001, or any external scheduler), finds sources that are DUE —
// live kind, non-manual cadence, last pull older than the cadence window —
// and runs each through the connector-runner (same budgets, same injection
// screening, same audit trail; connector_runs.trigger = 'scheduled').
//
// Auth: requires the SERVICE ROLE key as the Bearer token — this is a
// machine-only endpoint; a user JWT is rejected. The runner takes each
// source's org from the source row itself, so every write stays correctly
// org-fenced even without a user.
// Caps: at most MAX_PULLS_PER_TICK sources per invocation, oldest-pull first —
// a bounded, predictable spend per tick rather than an unbounded fan-out.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "content-type": "application/json" } });

const LIVE_KINDS = new Set(["website", "youtube", "web_search", "mcp", "linkedin_posts", "linkedin_jobs", "press", "reviews", "social", "github"]);
const MAX_PULLS_PER_TICK = 12;
// Due = last pull older than the window (with slack so a daily source pulled
// at 09:00 is still picked up by the 08:00 tick the next day).
const WINDOW_MS: Record<string, number> = { daily: 20 * 3600_000, weekly: 6.5 * 86400_000 };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const url = Deno.env.get("SUPABASE_URL");
  if (!serviceKey || !url) return json({ error: "server missing service configuration" }, 500);

  // Machine-only: the caller must present the service role key itself.
  const auth = req.headers.get("Authorization") ?? "";
  if (auth.replace(/^Bearer\s+/i, "") !== serviceKey) return json({ error: "service role required" }, 401);

  const supabase = createClient(url, serviceKey);

  try {
    const { data: sources, error } = await supabase
      .from("sources")
      .select("id, org_id, label, kind, cadence, last_pull_at")
      .neq("cadence", "manual")
      .order("last_pull_at", { ascending: true, nullsFirst: true })
      .limit(200);
    if (error) throw error;

    const nowMs = Date.now();
    const due = (sources ?? [])
      .filter((s) => LIVE_KINDS.has(s.kind))
      .filter((s) => {
        const win = WINDOW_MS[s.cadence];
        if (!win) return false;
        return !s.last_pull_at || nowMs - new Date(s.last_pull_at).getTime() >= win;
      })
      .slice(0, MAX_PULLS_PER_TICK);

    const results: { source_id: string; label: string; ok: boolean; created?: number; error?: string }[] = [];
    for (const s of due) {
      try {
        // Same function, same pipeline — just machine-triggered.
        const resp = await fetch(`${url}/functions/v1/connector-runner`, {
          method: "POST",
          headers: { "content-type": "application/json", Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({ source_id: s.id, trigger: "scheduled" }),
        });
        const body = await resp.json().catch(() => ({}));
        results.push({ source_id: s.id, label: s.label, ok: resp.ok, created: body.created, error: resp.ok ? undefined : (body.error ?? `HTTP ${resp.status}`) });
      } catch (e) {
        results.push({ source_id: s.id, label: s.label, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }

    return json({ checked: (sources ?? []).length, due: due.length, results });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
