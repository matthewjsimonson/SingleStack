// ============================================================================
// score-accounts — the Sell loop's synthesis. Rolls account_events into
// activation / expansion / churn scores, derives a PQL state, and — only when
// an account CROSSES into qualified / expansion / at_risk — emits an internal
// signal on the GTM lens. Deterministic and explainable by design: usage
// qualification should be auditable, not a black box (and cheap — no model).
//
// Scoring contract (documented so customers know what to send as event.kind):
//   activation : activation | feature_adopt | key_action | onboarding_complete
//   expansion  : seat_add | expansion_intent | limit_hit | upgrade_view
//   risk       : churn_risk | downgrade | error_spike | inactivity
// Each contributes its `value` (default 1) over a 35-day window; scores are
// weighted sums clamped to 0..1. Plus inactivity: no events in 21d lifts risk.
//
// Modes:
//   • machine sweep (service-role bearer, {}): all orgs, accounts touched or
//     unscored recently, capped per tick (cron at :42).
//   • org rescore (user JWT, {}): the caller's org — RLS-scoped.
//   • one account (user JWT, { account_id }).
// Signals emitted under the same auth (user insert is RLS-fenced; machine sets
// org_id explicitly). Transition-only, so re-runs don't duplicate.
// ============================================================================

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "content-type": "application/json" } });

const WINDOW_DAYS = 35;
const MAX_ACCOUNTS_PER_TICK = 500;
const clamp = (n: number) => Math.max(0, Math.min(1, n));

const ACTIVATION = new Set(["activation", "feature_adopt", "key_action", "onboarding_complete"]);
const EXPANSION = new Set(["seat_add", "expansion_intent", "limit_hit", "upgrade_view"]);
const RISK = new Set(["churn_risk", "downgrade", "error_spike", "inactivity"]);

type Ev = { account_id: string; kind: string; value: number | null; occurred_at: string };
type Acct = { id: string; org_id: string; name: string; status: string; pql_state: string };

function scoreAccount(a: Acct, evs: Ev[]): { activation: number; expansion: number; churn: number; state: string; reason: string } {
  const now = Date.now();
  const recent = evs.filter((e) => now - new Date(e.occurred_at).getTime() <= WINDOW_DAYS * 86400_000);
  const sum = (set: Set<string>) => recent.filter((e) => set.has(e.kind)).reduce((t, e) => t + (typeof e.value === "number" && isFinite(e.value) ? e.value : 1), 0);
  const lastEvAgeDays = recent.length ? (now - Math.max(...recent.map((e) => new Date(e.occurred_at).getTime()))) / 86400_000 : Infinity;

  const act = sum(ACTIVATION), exp = sum(EXPANSION), rsk = sum(RISK);
  const activation = clamp(act / 5);                 // ~5 weighted activation actions ⇒ activated
  const expansion = clamp(exp / 3);
  const inactivityBump = lastEvAgeDays > 21 ? 0.5 : 0;
  const churn = clamp(rsk / 3 + inactivityBump);

  // Precedence: risk > expansion > qualified > activating > none.
  let state = "none";
  if (a.status !== "churned") {
    if (churn >= 0.6) state = "at_risk";
    else if (expansion >= 0.6) state = "expansion";
    else if (activation >= 0.6) state = "qualified";
    else if (activation >= 0.3) state = "activating";
  } else state = "at_risk";

  const pct = (n: number) => Math.round(n * 100);
  const reasonByState: Record<string, string> = {
    at_risk: `Churn risk ${pct(churn)}% — ${rsk ? `${rsk} risk event(s)` : "no activity"}${lastEvAgeDays > 21 && lastEvAgeDays !== Infinity ? `, last seen ${Math.round(lastEvAgeDays)}d ago` : ""}.`,
    expansion: `Expansion ${pct(expansion)}% — ${exp} expansion signal(s) (seats / limits / upgrade intent).`,
    qualified: `Activation ${pct(activation)}% — ${act} activation action(s) in ${WINDOW_DAYS}d. Product-qualified.`,
    activating: `Activation ${pct(activation)}% — onboarding underway (${act} action(s)).`,
    none: recent.length ? `Low engagement — ${recent.length} event(s), activation ${pct(activation)}%.` : "No recent usage.",
  };
  return { activation, expansion, churn, state, reason: reasonByState[state] };
}

const EMIT_STATES = new Set(["qualified", "expansion", "at_risk"]);

async function scoreOrg(db: SupabaseClient, orgId: string, accountId?: string): Promise<{ scored: number; signals: number }> {
  let q = db.from("accounts").select("id, org_id, name, status, pql_state").eq("org_id", orgId);
  if (accountId) q = q.eq("id", accountId);
  const { data: accts } = await q.limit(MAX_ACCOUNTS_PER_TICK);
  if (!accts?.length) return { scored: 0, signals: 0 };

  const ids = accts.map((a) => a.id);
  const sinceIso = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString();
  const { data: events } = await db.from("account_events").select("account_id, kind, value, occurred_at").in("account_id", ids).gte("occurred_at", sinceIso).order("occurred_at", { ascending: false }).limit(20000);
  const byAccount = new Map<string, Ev[]>();
  for (const e of (events ?? []) as Ev[]) { (byAccount.get(e.account_id) ?? byAccount.set(e.account_id, []).get(e.account_id)!).push(e); }

  const nowIso = new Date().toISOString();
  // deno-lint-ignore no-explicit-any
  const signalRows: any[] = [];
  // deno-lint-ignore no-explicit-any
  const acctUpdates: { id: string; patch: Record<string, any> }[] = [];
  for (const a of accts as Acct[]) {
    const s = scoreAccount(a, byAccount.get(a.id) ?? []);
    // Stage the update — don't write yet. State must advance only AFTER the
    // signal/workflow side effects succeed, or a transition can be lost.
    acctUpdates.push({ id: a.id, patch: {
      activation_score: s.activation, expansion_score: s.expansion, churn_risk: s.churn,
      pql_state: s.state, score_reason: s.reason, scored_at: nowIso, updated_at: nowIso,
    } });
    // Emit a signal ONLY on a transition INTO an actionable state (no spam).
    if (s.state !== a.pql_state && EMIT_STATES.has(s.state)) {
      const titleByState: Record<string, string> = {
        qualified: `PQL: ${a.name} is product-qualified`,
        expansion: `Expansion signal: ${a.name}`,
        at_risk: `Churn risk: ${a.name}`,
      };
      signalRows.push({
        org_id: orgId, scope: "org", origin: "internal", category: "gtm",
        title: titleByState[s.state].slice(0, 280), why: s.reason.slice(0, 1000),
        conf_level: clamp(s.state === "at_risk" ? s.churn : s.state === "expansion" ? s.expansion : s.activation),
        conf_label: "High", observed_at: nowIso,
        metadata: { domain: "usage", account_id: a.id, pql_state: s.state },
      });
    }
  }
  // Emit signals + fire workflows BEFORE advancing pql_state, so a failure here
  // doesn't silently consume the transition — it retries on the next run.
  if (signalRows.length) {
    const { data: createdSigs, error: sigErr } = await db.from("signals").insert(signalRows).select("id, title, metadata");
    if (sigErr) throw sigErr;
    // Extend the automation spine to the Sell loop: fire on_pql workflows when an
    // account crosses into a PQL state. Propose-only; one pending run per account.
    try {
      const { data: wfs } = await db.from("workflows").select("id, name").eq("org_id", orgId).eq("trigger", "on_pql").eq("is_active", true);
      if (wfs?.length) {
        const { data: open } = await db.from("workflow_runs").select("workflow_id, context").in("workflow_id", wfs.map((w) => w.id)).eq("status", "pending");
        // deno-lint-ignore no-explicit-any
        const wfRows: any[] = [];
        for (const sig of (createdSigs ?? [])) {
          // deno-lint-ignore no-explicit-any
          const accId = (sig.metadata as any)?.account_id;
          for (const w of wfs) {
            // deno-lint-ignore no-explicit-any
            if ((open ?? []).some((r) => r.workflow_id === w.id && (r.context as any)?.accountId === accId)) continue;
            wfRows.push({ org_id: orgId, workflow_id: w.id, trigger: "on_pql", status: "pending",
              context: { label: sig.title, signalId: sig.id, accountId: accId },
              summary: `${w.name} — ${sig.title}`, proposed_action: `Draft a sell play (outreach / expansion) for “${sig.title}”.` });
          }
        }
        if (wfRows.length) { await db.from("workflow_runs").insert(wfRows); await db.from("workflows").update({ last_run_at: nowIso }).in("id", [...new Set(wfRows.map((r) => r.workflow_id))]); }
      }
    } catch { /* firing is best-effort — never fail scoring */ }
  }
  // Persist scores + states only now — after the signal/workflow side effects.
  for (const u of acctUpdates) await db.from("accounts").update(u.patch).eq("id", u.id);
  return { scored: acctUpdates.length, signals: signalRows.length };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing Authorization header" }, 401);
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const isMachine = serviceKey !== "" && authHeader.replace(/^Bearer\s+/i, "") === serviceKey;

  try {
    const { account_id } = await req.json().catch(() => ({}));

    if (isMachine && !account_id) {
      // Sweep all orgs that have accounts (bounded by per-org cap inside scoreOrg).
      const db = createClient(url, serviceKey);
      const { data: orgs } = await db.from("accounts").select("org_id").limit(5000);
      const orgIds = [...new Set((orgs ?? []).map((o) => o.org_id))];
      let scored = 0, signals = 0;
      for (const orgId of orgIds) { const r = await scoreOrg(db, orgId, undefined); scored += r.scored; signals += r.signals; }
      return json({ orgs: orgIds.length, scored, signals });
    }

    // User mode: RLS-scoped to the caller's org.
    const db = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: orgId } = await db.rpc("current_org_id");
    if (!orgId) return json({ error: "could not resolve org" }, 400);
    const r = await scoreOrg(db, orgId as string, account_id);
    return json(r);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
