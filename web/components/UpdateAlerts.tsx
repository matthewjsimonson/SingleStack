"use client";

// Homepage update alerts — the command-center loop. For each user-set watch
// (update_alerts, e.g. "battlecard_refresh on Acme"), triggered state is
// computed LIVE: cards whose competitor has signals newer than the card's
// updated_at. Clicking an alert opens the act-here panel: the stale cards +
// the new evidence, with actions — run the analyst refresh (workflow step 1,
// through review) or jump to the battlecard. Nothing to act on = no alerts.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Section, Chip, Banner } from "@/components/ui";

type Alert = { id: string; competitor_id: string | null; name: string; staleCards: { id: string; kind: string; title: string; updated_at: string }[]; newSignals: { title: string; observed_at: string | null }[] };

export default function UpdateAlerts() {
  const supabase = createClient();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [open, setOpen] = useState<Alert | null>(null);
  const [wfId, setWfId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: watches } = await supabase.from("update_alerts").select("id, competitor_id").eq("kind", "battlecard_refresh").eq("is_active", true);
    if (!watches?.length) { setAlerts([]); return; }
    const compIds = watches.map((w) => w.competitor_id).filter(Boolean) as string[];
    const [{ data: comps }, { data: cards }, { data: sigs }, { data: wfs }] = await Promise.all([
      supabase.from("competitors").select("id, name").in("id", compIds),
      supabase.from("battlecard_items").select("id, competitor_id, kind, title, updated_at").in("competitor_id", compIds),
      supabase.from("signals").select("competitor_id, title, observed_at").in("competitor_id", compIds).order("observed_at", { ascending: false, nullsFirst: false }).limit(100),
      supabase.from("workflows").select("id, steps").eq("is_active", true).order("created_at"),
    ]);
    // first workflow whose step 1 is runnable powers the refresh action
    const wf = ((wfs ?? []) as { id: string; steps: { agent_id?: string; skill_id?: string | null }[] }[]).find((w) => Array.isArray(w.steps) && w.steps[0]?.agent_id && w.steps[0]?.skill_id);
    setWfId(wf?.id ?? null);
    const name = (id: string | null) => (comps ?? []).find((c) => c.id === id)?.name ?? "Competitor";
    setAlerts(watches.map((w) => {
      const mine = (cards ?? []).filter((c) => c.competitor_id === w.competitor_id);
      const mySigs = (sigs ?? []).filter((s) => s.competitor_id === w.competitor_id);
      // stale = the card predates at least one signal on its competitor
      const stale = mine.filter((c) => mySigs.some((s) => s.observed_at && s.observed_at > c.updated_at));
      const newest = mine.length ? mine.map((c) => c.updated_at).sort()[0] : null;
      const fresh = mySigs.filter((s) => s.observed_at && (!newest || s.observed_at > newest)).slice(0, 6);
      return { id: w.id, competitor_id: w.competitor_id, name: name(w.competitor_id), staleCards: stale, newSignals: fresh };
    }).filter((a) => a.staleCards.length > 0));
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  async function refresh(a: Alert) {
    if (!wfId || busy) return;
    setBusy(true); setError(null); setNote(null);
    try {
      const { data, error } = await supabase.functions.invoke("battlecard-analyst", {
        body: { competitor_id: a.competitor_id, workflow_id: wfId, item_ids: a.staleCards.map((c) => c.id) },
      });
      if (error) throw error;
      setNote((data as { message?: string })?.message ?? "Done.");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Refresh failed."); }
    finally { setBusy(false); }
  }

  if (alerts.length === 0) return null;

  return (
    <>
      <Section label={`Update alerts · ${alerts.length}`}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "var(--sp-3)" }}>
          {alerts.map((a) => (
            <button key={a.id} className="card card-pad pop" style={{ textAlign: "left", cursor: "pointer", borderLeft: "3px solid var(--am-text)" }} onClick={() => { setOpen(a); setNote(null); setError(null); }}>
              <div className="row gap-2" style={{ marginBottom: 6, alignItems: "center" }}>
                <span style={{ fontSize: 14 }}>🔔</span>
                <span style={{ fontSize: 13.5, fontWeight: 640 }}>{a.name} battlecard</span>
              </div>
              <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>
                {a.staleCards.length} card{a.staleCards.length === 1 ? "" : "s"} may be stale — new evidence landed since the last update.
              </div>
              <span style={{ color: "var(--ac-text)", fontSize: 12.5, fontWeight: 600, marginTop: 6, display: "inline-block" }}>Review &amp; update →</span>
            </button>
          ))}
        </div>
      </Section>

      {open && (
        <>
          <div onClick={() => setOpen(null)} style={{ position: "fixed", inset: 0, background: "rgba(11,12,14,0.32)", zIndex: 40 }} />
          <aside style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: 480, maxWidth: "94vw", background: "var(--panel)", borderLeft: "1px solid var(--border)", boxShadow: "var(--shadow-md)", zIndex: 41, display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }} className="row-between">
              <span className="t-h2" style={{ fontSize: 15 }}>🔔 {open.name} — what needs updating</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setOpen(null)}>Close</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }} className="stack-3">
              <Banner>{error}</Banner>
              {note && <div className="card card-pad" style={{ background: "var(--panel-2)", fontSize: 12.5 }}>{note}</div>}

              <div>
                <div className="t-label" style={{ marginBottom: 6 }}>Possibly stale cards · {open.staleCards.length}</div>
                <div className="stack-2">
                  {open.staleCards.map((c) => (
                    <div key={c.id} className="card card-pad">
                      <div className="row gap-2" style={{ alignItems: "center" }}>
                        <Chip tone="accent">{c.kind}</Chip>
                        <span style={{ fontSize: 13, fontWeight: 620 }}>{c.title}</span>
                      </div>
                      <span className="t-mono-xs t-muted" style={{ marginTop: 4, display: "inline-block" }}>last updated {new Date(c.updated_at).toLocaleDateString()}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="t-label" style={{ marginBottom: 6 }}>New evidence since</div>
                <div className="stack-2">
                  {open.newSignals.map((s, i) => (
                    <div key={i} className="card card-pad" style={{ borderLeft: "3px solid var(--vl)", fontSize: 12.5 }}>{s.title}</div>
                  ))}
                  {open.newSignals.length === 0 && <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Evidence list unavailable — open the battlecard for the full feed.</div>}
                </div>
              </div>

              <div className="row gap-2">
                <button className="btn btn-sm" disabled={!wfId || busy} onClick={() => refresh(open)}
                  title={wfId ? "Your analyst (workflow step 1) re-examines each stale card — changes go through review" : "Attach a workflow with step 1 = agent × analyst skill first"}>
                  {busy ? "Re-examining…" : "✦ Re-examine stale cards"}
                </button>
                <a className="btn btn-secondary btn-sm" href="/competitive">Open battlecard →</a>
              </div>
            </div>
          </aside>
        </>
      )}
    </>
  );
}
