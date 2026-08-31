"use client";

// Product-qualified leads — the Sell loop's surface. Usage flows in (usage-ingest),
// gets scored (score-accounts), and surfaces here: which accounts activated, are
// expanding, or are at risk — each with its evidence trail. Crossing into a PQL
// state emits a GTM-lens signal, so the sell motion the product generates feeds
// the same strategy engine as everything else.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Chip, Banner, Modal } from "@/components/ui";
import { Markdown } from "@/components/Markdown";
import { errText, authHeader, fetchAgentKey, accessToken } from "@/lib/strategy";
import { askAgent } from "@/components/alive";
import AgentActivity from "@/components/AgentActivity";
import { emptyActivity, type Activity } from "@/lib/agentStream";

type Account = {
  id: string; external_ref: string; name: string; domain: string | null; plan: string | null; status: string;
  metrics: Record<string, unknown> | null; last_seen_at: string | null;
  activation_score: number | null; expansion_score: number | null; churn_risk: number | null;
  pql_state: string; score_reason: string | null; scored_at: string | null;
};
type Key = { id: string; label: string; last_used_at: string | null; revoked: boolean; created_at: string };
type Ev = { id: string; kind: string; value: number | null; occurred_at: string };
type Sig = { id: string; title: string; why: string | null; observed_at: string | null };

const STATE: Record<string, { label: string; tone: "green" | "violet" | "amber" | "accent" | "default"; rank: number }> = {
  qualified:  { label: "PQL · qualified", tone: "green",   rank: 0 },
  expansion:  { label: "Expansion",        tone: "violet",  rank: 1 },
  at_risk:    { label: "At risk",          tone: "amber",   rank: 2 },
  activating: { label: "Activating",       tone: "accent",  rank: 3 },
  none:       { label: "—",                tone: "default", rank: 4 },
};
const FILTERS = [["all", "All"], ["qualified", "PQLs"], ["expansion", "Expansion"], ["at_risk", "At risk"], ["activating", "Activating"]] as const;

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function PqlBoard() {
  const supabase = createClient();
  const ingestUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? "<your-project>.supabase.co"}/functions/v1/usage-ingest`;
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activity, setActivity] = useState<Activity>(emptyActivity());
  const [keys, setKeys] = useState<Key[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [keysOpen, setKeysOpen] = useState(false);
  const [keyLabel, setKeyLabel] = useState("");
  const [minted, setMinted] = useState<string | null>(null); // raw token, shown once

  const [openAcct, setOpenAcct] = useState<Account | null>(null);
  const [events, setEvents] = useState<Ev[]>([]);
  const [signals, setSignals] = useState<Sig[]>([]);
  const [outreach, setOutreach] = useState<string | null>(null);
  const [draftingOut, setDraftingOut] = useState(false);

  const load = useCallback(async () => {
    const [{ data: a }, { data: k }] = await Promise.all([
      supabase.from("accounts").select("id, external_ref, name, domain, plan, status, metrics, last_seen_at, activation_score, expansion_score, churn_risk, pql_state, score_reason, scored_at"),
      supabase.from("ingest_keys").select("id, label, last_used_at, revoked, created_at").order("created_at", { ascending: false }),
    ]);
    setAccounts((a ?? []) as Account[]); setKeys((k ?? []) as Key[]); setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  async function mintKey() {
    if (!keyLabel.trim()) { setError("Name the key (e.g. 'PostHog webhook')."); return; }
    setBusy("mint"); setError(null); setMinted(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      const bytes = crypto.getRandomValues(new Uint8Array(24));
      const token = "ssk_" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
      const token_hash = await sha256Hex(token);
      const { error } = await supabase.from("ingest_keys").insert({ org_id: orgId, label: keyLabel.trim(), token_hash });
      if (error) throw error;
      setMinted(token); setKeyLabel(""); await load();
    } catch (e) { setError(errText(e, "Could not create the key.")); }
    finally { setBusy(null); }
  }
  async function revokeKey(id: string) {
    setError(null);
    const { error } = await supabase.from("ingest_keys").update({ revoked: true }).eq("id", id);
    if (error) setError(error.message); else load();
  }

  async function rescore() {
    setBusy("rescore"); setError(null); setNote(null);
    try {
      const { data, error } = await supabase.functions.invoke("score-accounts", { body: {}, headers: await authHeader(supabase) });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setNote(`Scored ${data.scored ?? 0} account(s)${data.signals ? `, ${data.signals} new PQL signal(s)` : ""}.`);
      await load();
    } catch (e) { setError(errText(e, "Could not rescore.")); }
    finally { setBusy(null); }
  }

  async function draftOutreach(a: Account) {
    setDraftingOut(true); setOutreach(null); setError(null);
    try {
      const agentKey = await fetchAgentKey(supabase);
      if (!agentKey) throw new Error("No officer available (seed agents first).");
      const recent = events.slice(0, 8).map((e) => `${e.kind}${e.value != null ? ` ×${e.value}` : ""}`).join(", ");
      const motion = a.pql_state === "at_risk" ? "retention / save" : a.pql_state === "expansion" ? "expansion" : "activation→sales";
      const prompt = `Account "${a.name}"${a.plan ? ` (${a.plan} plan)` : ""} just reached state: ${a.pql_state}. ${a.score_reason ?? ""} Recent usage: ${recent || "n/a"}.\nDraft a ${motion} outreach: (1) the play in one line, then (2) a 3–4 sentence email a rep can send, referencing the actual usage. Be concrete and specific. No preamble.`;
      const { text } = await askAgent({ agentKey, messages: [{ role: "user", content: prompt }], token: await accessToken(supabase), onActivity: setActivity });
      setOutreach(text);
    } catch (e) { setError(errText(e, "Could not draft outreach.")); }
    finally { setDraftingOut(false); }
  }

  async function openEvidence(a: Account) {
    setOpenAcct(a); setEvents([]); setSignals([]); setOutreach(null);
    const [{ data: ev }, { data: sg }] = await Promise.all([
      supabase.from("account_events").select("id, kind, value, occurred_at").eq("account_id", a.id).order("occurred_at", { ascending: false }).limit(40),
      supabase.from("signals").select("id, title, why, observed_at").contains("metadata", { account_id: a.id }).order("observed_at", { ascending: false }).limit(20),
    ]);
    setEvents((ev ?? []) as Ev[]); setSignals((sg ?? []) as Sig[]);
  }

  if (loading) return <div className="t-sub t-muted">Loading…</div>;

  const ranked = [...accounts].sort((x, y) => {
    const r = (STATE[x.pql_state]?.rank ?? 9) - (STATE[y.pql_state]?.rank ?? 9);
    if (r !== 0) return r;
    const mx = Math.max(x.activation_score ?? 0, x.expansion_score ?? 0, x.churn_risk ?? 0);
    const my = Math.max(y.activation_score ?? 0, y.expansion_score ?? 0, y.churn_risk ?? 0);
    return my - mx;
  });
  const shown = ranked.filter((a) => filter === "all" || a.pql_state === filter);
  const counts = accounts.reduce<Record<string, number>>((m, a) => { m[a.pql_state] = (m[a.pql_state] ?? 0) + 1; return m; }, {});
  const bar = (n: number | null, color: string) => (
    <span title={n != null ? `${Math.round(n * 100)}%` : "—"} style={{ display: "inline-block", width: 40, height: 5, borderRadius: 3, background: "var(--fill)", overflow: "hidden", verticalAlign: "middle" }}>
      <span style={{ display: "block", height: "100%", width: `${Math.round((n ?? 0) * 100)}%`, background: color }} />
    </span>
  );

  return (
    <div>
      <div style={{ marginBottom: "var(--sp-3)" }}>
        <h1 className="t-page">Product-qualified leads</h1>
        <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>The sell motion your product generates — who activated, who&rsquo;s expanding, who&rsquo;s at risk. Crossing into a PQL state emits a GTM signal that feeds strategy.</div>
      </div>

      <Banner>{error}</Banner>
      {note && <div className="banner" style={{ marginBottom: 12 }}>{note}</div>}

      <div className="row gap-2" style={{ marginBottom: "var(--sp-4)", alignItems: "center", flexWrap: "wrap" }}>
        <div className="row" style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
          {FILTERS.map(([k, label]) => (
            <button key={k} onClick={() => setFilter(k)} className="btn-sm" style={{ border: "none", background: filter === k ? "var(--ac)" : "var(--panel)", color: filter === k ? "#fff" : "var(--ts)", fontWeight: 600, padding: "6px 12px", cursor: "pointer" }}>
              {label}{k !== "all" && counts[k] ? ` · ${counts[k]}` : ""}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn btn-secondary btn-sm" onClick={() => { setKeysOpen(true); setMinted(null); }}>Ingest keys</button>
        <button className="btn btn-sm" disabled={busy === "rescore"} onClick={rescore} style={{ background: "var(--ac)", color: "#fff" }}>{busy === "rescore" ? "Scoring…" : "↻ Rescore now"}</button>
      </div>

      {accounts.length === 0 ? (
        <div className="empty">
          <div className="t-body" style={{ fontWeight: 600, marginBottom: 6 }}>No usage flowing in yet</div>
          <div className="t-sub" style={{ maxWidth: 560, marginInline: "auto", marginBottom: 12 }}>Mint an ingest key, then have your product (PostHog/Amplitude webhook, a warehouse job, or your own pipeline) POST aggregated usage. Accounts and PQLs appear here automatically.</div>
          <button className="btn" onClick={() => { setKeysOpen(true); setMinted(null); }}>Mint an ingest key →</button>
        </div>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead><tr style={{ textAlign: "left", color: "var(--tm)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              <th style={{ padding: "10px 14px" }}>Account</th><th style={{ padding: "10px 8px" }}>State</th>
              <th style={{ padding: "10px 8px" }}>Activation</th><th style={{ padding: "10px 8px" }}>Expansion</th><th style={{ padding: "10px 8px" }}>Risk</th>
              <th style={{ padding: "10px 14px" }}>Why</th>
            </tr></thead>
            <tbody>
              {shown.map((a) => {
                const st = STATE[a.pql_state] ?? STATE.none;
                return (
                  <tr key={a.id} className="card-link" style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }} onClick={() => openEvidence(a)}>
                    <td style={{ padding: "10px 14px" }}><span style={{ fontWeight: 620 }}>{a.name}</span>{a.plan && <span className="t-mono-xs t-muted" style={{ marginLeft: 6 }}>{a.plan}</span>}{a.domain && <div className="t-mono-xs t-muted">{a.domain}</div>}</td>
                    <td style={{ padding: "10px 8px" }}><Chip tone={st.tone}>{st.label}</Chip></td>
                    <td style={{ padding: "10px 8px" }}>{bar(a.activation_score, "var(--gn)")}</td>
                    <td style={{ padding: "10px 8px" }}>{bar(a.expansion_score, "var(--vl)")}</td>
                    <td style={{ padding: "10px 8px" }}>{bar(a.churn_risk, "var(--am-text)")}</td>
                    <td style={{ padding: "10px 14px", maxWidth: 320 }}><span className="t-sub t-muted" style={{ fontSize: 12 }}>{a.score_reason ?? "Not scored yet — Rescore now."}</span></td>
                  </tr>
                );
              })}
              {shown.length === 0 && <tr><td colSpan={6} style={{ padding: "14px", color: "var(--tm)" }} className="t-sub">No accounts in this state.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* Evidence drawer */}
      <Modal open={!!openAcct} onClose={() => setOpenAcct(null)} title={openAcct ? `${openAcct.name} — evidence` : ""} width={620}>
        {openAcct && (<>
          <div className="row gap-2" style={{ flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
            <Chip tone={(STATE[openAcct.pql_state] ?? STATE.none).tone}>{(STATE[openAcct.pql_state] ?? STATE.none).label}</Chip>
            {openAcct.last_seen_at && <span className="t-mono-xs t-muted">last seen {new Date(openAcct.last_seen_at).toLocaleDateString()}</span>}
            <span style={{ flex: 1 }} />
            <button className="btn btn-sm" disabled={draftingOut} onClick={() => draftOutreach(openAcct)} style={{ background: "var(--ac)", color: "#fff" }}>{draftingOut ? "Drafting…" : "✦ Draft outreach"}</button>
            <button className="btn btn-secondary btn-sm" disabled={busy === openAcct.id} onClick={async () => { setBusy(openAcct.id); await supabase.functions.invoke("score-accounts", { body: { account_id: openAcct.id }, headers: await authHeader(supabase) }); setBusy(null); await load(); const fresh = (await supabase.from("accounts").select("id, external_ref, name, domain, plan, status, metrics, last_seen_at, activation_score, expansion_score, churn_risk, pql_state, score_reason, scored_at").eq("id", openAcct.id).maybeSingle()).data as Account | null; if (fresh) openEvidence(fresh); }}>↻ Rescore</button>
          </div>
          {openAcct.score_reason && <div className="card card-pad" style={{ background: "var(--panel-2)", marginBottom: 12 }}><div className="t-sub" style={{ fontSize: 12.5 }}>{openAcct.score_reason}</div></div>}
          {draftingOut && <div style={{ marginBottom: 12 }}><AgentActivity activity={activity} busy={draftingOut} who="The officer" /></div>}
          {outreach && <div className="card card-pad" style={{ borderLeft: "3px solid var(--ac)", marginBottom: 12 }}><div className="t-label" style={{ marginBottom: 4 }}>Drafted outreach</div><Markdown className="t-sub" style={{ fontSize: 12.5, lineHeight: 1.55 }} text={outreach} /></div>}

          <div className="t-label" style={{ marginBottom: 6 }}>PQL signals · {signals.length}</div>
          <div className="stack-2" style={{ marginBottom: 14 }}>
            {signals.length === 0 ? <div className="t-sub t-muted" style={{ fontSize: 12 }}>No PQL signals emitted yet — appears when the account crosses into qualified / expansion / at-risk.</div>
              : signals.map((s) => <div key={s.id} className="card card-pad" style={{ padding: "8px 12px" }}><span style={{ fontSize: 12.5, fontWeight: 600 }}>{s.title}</span>{s.why && <div className="t-sub t-muted" style={{ fontSize: 11.5, marginTop: 2 }}>{s.why}</div>}</div>)}
          </div>

          <div className="t-label" style={{ marginBottom: 6 }}>Usage events · {events.length}</div>
          <div className="stack-2" style={{ maxHeight: 260, overflowY: "auto" }}>
            {events.length === 0 ? <div className="t-sub t-muted" style={{ fontSize: 12 }}>No events yet.</div>
              : events.map((e) => (
                <div key={e.id} className="row-between" style={{ fontSize: 12, padding: "4px 0", alignItems: "center" }}>
                  <span className="row gap-2" style={{ alignItems: "center" }}><Chip>{e.kind}</Chip>{e.value != null && <span className="t-mono-xs">×{e.value}</span>}</span>
                  <span className="t-mono-xs t-muted">{new Date(e.occurred_at).toLocaleDateString()}</span>
                </div>
              ))}
          </div>
        </>)}
      </Modal>

      {/* Ingest keys */}
      <Modal open={keysOpen} onClose={() => setKeysOpen(false)} title="Ingest keys" width={620}>
        <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>Keys authenticate the usage webhook. Only a hash is stored — the raw key is shown <strong>once</strong>. Point your product analytics (or pipeline) at the endpoint with the key in <code>x-ingest-key</code>.</div>
        <div className="row gap-2" style={{ marginBottom: 12 }}>
          <input className="input" value={keyLabel} onChange={(e) => setKeyLabel(e.target.value)} placeholder="Key name — e.g. PostHog webhook" style={{ flex: 1 }} />
          <button className="btn btn-sm" disabled={busy === "mint"} onClick={mintKey}>{busy === "mint" ? "Minting…" : "Mint key"}</button>
        </div>
        {minted && (
          <div className="card card-pad" style={{ background: "var(--gn-fill)", marginBottom: 12 }}>
            <div className="t-label" style={{ color: "var(--gn-text)", marginBottom: 4 }}>Copy this now — it won&rsquo;t be shown again</div>
            <code style={{ fontSize: 12, wordBreak: "break-all", display: "block", marginBottom: 8 }}>{minted}</code>
            <div className="t-mono-xs t-muted" style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{`curl -X POST ${ingestUrl} \\\n  -H "x-ingest-key: ${minted}" -H "content-type: application/json" \\\n  -d '{"accounts":[{"external_ref":"acme","name":"Acme Inc","plan":"team"}],"events":[{"external_ref":"acme","kind":"activation","value":3}]}'`}</div>
          </div>
        )}
        <div className="stack-2">
          {keys.length === 0 ? <div className="t-sub t-muted" style={{ fontSize: 12 }}>No keys yet.</div>
            : keys.map((k) => (
              <div key={k.id} className="card card-pad row-between" style={{ alignItems: "center", gap: 8, padding: "8px 12px", opacity: k.revoked ? 0.55 : 1 }}>
                <span><span style={{ fontSize: 13, fontWeight: 600 }}>{k.label}</span><span className="t-mono-xs t-muted" style={{ marginLeft: 8 }}>{k.last_used_at ? `last used ${new Date(k.last_used_at).toLocaleDateString()}` : "never used"}</span></span>
                {k.revoked ? <Chip>revoked</Chip> : <button className="btn btn-secondary btn-sm" onClick={() => revokeKey(k.id)} style={{ color: "var(--rd-text)" }}>Revoke</button>}
              </div>
            ))}
        </div>
      </Modal>
    </div>
  );
}
