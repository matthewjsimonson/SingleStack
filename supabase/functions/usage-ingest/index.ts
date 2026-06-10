// ============================================================================
// usage-ingest — the Sell loop's inbound webhook. A customer's product pushes
// aggregated usage here (from a PostHog/Amplitude webhook, a warehouse job, or
// their own pipeline); it lands as accounts + account_events, the evidence the
// PQL scorer reads. Inbound by design — no outbound credential or secret store,
// so it ships before the connector secret store does.
//
// AUTH: a per-org ingest key. The caller presents the RAW key in `x-ingest-key`
// (or Authorization: Bearer); we SHA-256 it and resolve the org from
// ingest_keys (only the hash is stored). No user JWT. Writes use the service
// role and are fenced to the resolved org_id.
//
// PAYLOAD (POST JSON):
//   {
//     "accounts": [{ "external_ref","name?","domain?","plan?","status?","metrics?" }],
//     "events":   [{ "external_ref","kind","value?","occurred_at?","properties?" }]
//   }
// Accounts are upserted by (org, external_ref); events are appended and linked
// by external_ref. Batches are capped. Scoring is NOT done here — score-accounts
// (P2) runs on the heartbeat and on demand, keeping ingest cheap and fast.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ingest-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "content-type": "application/json" } });

const MAX_ACCOUNTS = 2000;
const MAX_EVENTS = 5000;
const ALLOWED_STATUS = new Set(["prospect", "active", "churned"]);

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "server misconfigured" }, 500);

  // ---- authenticate the webhook by ingest key -------------------------------
  const raw = (req.headers.get("x-ingest-key") || req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!raw) return json({ error: "missing ingest key (x-ingest-key header)" }, 401);

  const supabase = createClient(url, serviceKey); // service role: resolve an anonymous webhook to its org
  const tokenHash = await sha256Hex(raw);
  const { data: keyRow } = await supabase.from("ingest_keys").select("id, org_id, revoked").eq("token_hash", tokenHash).maybeSingle();
  if (!keyRow || keyRow.revoked) return json({ error: "invalid or revoked ingest key" }, 401);
  const orgId = keyRow.org_id as string;

  let body: { accounts?: unknown[]; events?: unknown[] };
  try { body = await req.json(); } catch { return json({ error: "invalid JSON body" }, 400); }

  // deno-lint-ignore no-explicit-any
  const inAccounts = (Array.isArray(body.accounts) ? body.accounts : []) as any[];
  // deno-lint-ignore no-explicit-any
  const inEvents = (Array.isArray(body.events) ? body.events : []) as any[];
  if (inAccounts.length > MAX_ACCOUNTS) return json({ error: `too many accounts (max ${MAX_ACCOUNTS})` }, 413);
  if (inEvents.length > MAX_EVENTS) return json({ error: `too many events (max ${MAX_EVENTS})` }, 413);
  if (inAccounts.length === 0 && inEvents.length === 0) return json({ error: "nothing to ingest — provide accounts and/or events" }, 400);

  const nowIso = new Date().toISOString();
  try {
    // ---- upsert accounts ----------------------------------------------------
    let accountsWritten = 0;
    if (inAccounts.length) {
      const rows = inAccounts
        .filter((a) => a && typeof a.external_ref === "string" && a.external_ref.trim() && typeof a.name === "string" && a.name.trim())
        .map((a) => ({
          org_id: orgId, external_ref: String(a.external_ref).slice(0, 200), name: String(a.name).slice(0, 280),
          domain: a.domain ? String(a.domain).slice(0, 200) : null,
          plan: a.plan ? String(a.plan).slice(0, 100) : null,
          status: ALLOWED_STATUS.has(a.status) ? a.status : "active",
          metrics: a.metrics && typeof a.metrics === "object" ? a.metrics : null,
          last_seen_at: nowIso, updated_at: nowIso,
        }));
      if (rows.length) {
        const { error } = await supabase.from("accounts").upsert(rows, { onConflict: "org_id,external_ref" });
        if (error) throw error;
        accountsWritten = rows.length;
      }
    }

    // ---- resolve account ids for events (create stubs for unseen refs) ------
    const refs = [...new Set(inEvents.map((e) => e && typeof e.external_ref === "string" ? e.external_ref.trim() : "").filter(Boolean))];
    const idByRef = new Map<string, string>();
    if (refs.length) {
      // Ensure an account exists for every event ref (stub if the caller sent
      // events without a matching account in this batch).
      const stub = refs.map((r) => ({ org_id: orgId, external_ref: r.slice(0, 200), name: r.slice(0, 280), last_seen_at: nowIso, updated_at: nowIso }));
      await supabase.from("accounts").upsert(stub, { onConflict: "org_id,external_ref", ignoreDuplicates: true });
      const { data: accts } = await supabase.from("accounts").select("id, external_ref").eq("org_id", orgId).in("external_ref", refs);
      for (const a of accts ?? []) idByRef.set(a.external_ref, a.id);
    }

    // ---- append events ------------------------------------------------------
    let eventsWritten = 0;
    if (inEvents.length) {
      const rows = inEvents
        .filter((e) => e && typeof e.kind === "string" && e.kind.trim() && idByRef.has(String(e.external_ref).trim()))
        .map((e) => ({
          org_id: orgId, account_id: idByRef.get(String(e.external_ref).trim()),
          kind: String(e.kind).slice(0, 80),
          value: typeof e.value === "number" && isFinite(e.value) ? e.value : null,
          occurred_at: e.occurred_at && !isNaN(Date.parse(e.occurred_at)) ? new Date(e.occurred_at).toISOString() : nowIso,
          properties: e.properties && typeof e.properties === "object" ? e.properties : null,
          ingest_key_id: keyRow.id,
        }));
      if (rows.length) {
        const { error } = await supabase.from("account_events").insert(rows);
        if (error) throw error;
        eventsWritten = rows.length;
      }
    }

    await supabase.from("ingest_keys").update({ last_used_at: nowIso }).eq("id", keyRow.id);
    return json({ ok: true, accounts: accountsWritten, events: eventsWritten });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
