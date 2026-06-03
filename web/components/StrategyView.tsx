"use client";

// Product Strategy — the funnel UPSTREAM of Build. Signals are triaged here
// before any build work exists: stage → verify → bundle → ship to Build.
//   Staged    raw signals; a human VERIFIES the real ones.
//   Verified  verified signals; select related ones and BUNDLE them.
//   Bundles   a candidate Build Item; SHIP it to spawn an initiative at Plan.
// Nothing reaches the Build workflow without this explicit choice — "if it's in
// Ship, it's been approved" means approved here.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { PageHeader, Chip, Banner } from "@/components/ui";
import { spawnInitiative } from "@/lib/routing";

type Signal = { id: string; title: string; why: string | null; conf_level: number | null; conf_label: string | null; strategy_state: string; bundle_id: string | null };
type Bundle = { id: string; title: string; rationale: string | null; state: string };

export default function StrategyView() {
  const supabase = createClient();
  const [signals, setSignals] = useState<Signal[]>([]);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bundleTitle, setBundleTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data: s }, { data: b }] = await Promise.all([
      supabase.from("signals").select("id, title, why, conf_level, conf_label, strategy_state, bundle_id").neq("strategy_state", "promoted").order("created_at", { ascending: false }),
      supabase.from("strategy_bundles").select("id, title, rationale, state").eq("state", "open").order("created_at", { ascending: false }),
    ]);
    setSignals((s ?? []) as Signal[]); setBundles((b ?? []) as Bundle[]); setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const errText = (e: unknown, f: string) => (e && typeof e === "object" && "message" in e ? String((e as { message: string }).message) : e instanceof Error ? e.message : f);

  async function verify(id: string) {
    setError(null);
    const { error } = await supabase.from("signals").update({ strategy_state: "verified", verified_at: new Date().toISOString() }).eq("id", id);
    if (error) { setError(error.message); return; }
    await load();
  }
  async function unverify(id: string) {
    setError(null);
    const { error } = await supabase.from("signals").update({ strategy_state: "staged", verified_at: null }).eq("id", id);
    if (error) { setError(error.message); return; }
    await load();
  }

  const toggle = (id: string) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function createBundle() {
    if (!bundleTitle.trim() || sel.size === 0) return;
    setBusy(true); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      const { data: bundle, error } = await supabase.from("strategy_bundles").insert({ org_id: orgId, title: bundleTitle.trim() }).select("id").single();
      if (error) throw error;
      const { error: e2 } = await supabase.from("signals").update({ bundle_id: bundle.id, strategy_state: "bundled" }).in("id", [...sel]);
      if (e2) throw e2;
      setSel(new Set()); setBundleTitle(""); await load();
    } catch (e) { setError(errText(e, "Could not create the bundle.")); }
    finally { setBusy(false); }
  }

  async function removeFromBundle(id: string) {
    setError(null);
    const { error } = await supabase.from("signals").update({ bundle_id: null, strategy_state: "verified" }).eq("id", id);
    if (error) { setError(error.message); return; }
    await load();
  }

  // The decision: ship a bundle into the Build workflow. Spawns a Build Item
  // (initiative) at Plan, links the bundle's signals, marks them promoted.
  async function shipToBuild(b: Bundle, sigs: Signal[]) {
    setBusy(true); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      const initiativeId = await spawnInitiative(supabase, orgId, {
        title: b.title, description: b.rationale ?? null, scope: "product", lifecycle: "plan", kind: "feature",
        signalIds: sigs.map((s) => s.id),
      });
      await supabase.from("initiatives").update({ build_state: "scoped" }).eq("id", initiativeId);
      await supabase.from("strategy_bundles").update({ state: "promoted", initiative_id: initiativeId, promoted_at: new Date().toISOString() }).eq("id", b.id);
      await supabase.from("signals").update({ strategy_state: "promoted" }).eq("bundle_id", b.id);
      setNotice(`“${b.title}” shipped to Build — scope it in Ship.`);
      await load();
    } catch (e) { setError(errText(e, "Could not ship to Build.")); }
    finally { setBusy(false); }
  }

  const staged = signals.filter((s) => s.strategy_state === "staged");
  const verified = signals.filter((s) => s.strategy_state === "verified" && !s.bundle_id);
  const sigsOf = (bundleId: string) => signals.filter((s) => s.bundle_id === bundleId);
  const conf = (s: Signal) => s.conf_label || (s.conf_level != null ? `${Math.round(s.conf_level * 100)}%` : null);

  return (
    <div>
      <PageHeader title="Product strategy" meta="Triage signals before they become build work: verify what's real, bundle what's related, and choose what ships to Build." />
      <Banner>{error}</Banner>
      {notice && <div className="banner" style={{ marginBottom: "var(--sp-4)", background: "var(--gn-fill)", color: "var(--gn-text)" }}>{notice} <a href="/ship" style={{ fontWeight: 700, color: "inherit" }}>Open Ship →</a></div>}

      {loading ? <div className="t-sub t-muted">Loading…</div> : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--sp-4)", alignItems: "start" }}>

          {/* Staged */}
          <Column label="Staged" count={staged.length} blurb="Raw signals. Verify the ones that are real.">
            {staged.map((s) => (
              <div key={s.id} className="card card-pad">
                <div className="row-between" style={{ alignItems: "flex-start", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 620 }}>{s.title}</span>
                  {conf(s) && <Chip tone="amber">{conf(s)}</Chip>}
                </div>
                {s.why && <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 8 }}>{s.why}</div>}
                <button className="btn btn-sm" onClick={() => verify(s.id)}>Verify →</button>
              </div>
            ))}
            {staged.length === 0 && <Empty>No staged signals.</Empty>}
          </Column>

          {/* Verified */}
          <Column label="Verified" count={verified.length} blurb="Select related signals and bundle them into a candidate.">
            {verified.map((s) => (
              <label key={s.id} className="card card-pad" style={{ display: "block", cursor: "pointer", borderColor: sel.has(s.id) ? "var(--ac)" : undefined }}>
                <div className="row gap-2" style={{ alignItems: "flex-start" }}>
                  <input type="checkbox" checked={sel.has(s.id)} onChange={() => toggle(s.id)} style={{ marginTop: 3 }} />
                  <div style={{ flex: 1 }}>
                    <div className="row-between" style={{ gap: 8 }}><span style={{ fontSize: 13.5, fontWeight: 620 }}>{s.title}</span>{conf(s) && <Chip tone="green">{conf(s)}</Chip>}</div>
                    {s.why && <div className="t-sub t-muted" style={{ fontSize: 12.5, marginTop: 3 }}>{s.why}</div>}
                    <button className="btn btn-secondary btn-sm" style={{ marginTop: 6 }} onClick={(e) => { e.preventDefault(); unverify(s.id); }}>↩ Unverify</button>
                  </div>
                </div>
              </label>
            ))}
            {verified.length === 0 && <Empty>Verify signals to bundle them.</Empty>}
            {sel.size > 0 && (
              <div className="card card-pad" style={{ borderColor: "var(--ac)" }}>
                <div className="t-label" style={{ marginBottom: 6 }}>Bundle {sel.size} signal{sel.size === 1 ? "" : "s"}</div>
                <input className="input" autoFocus placeholder="Name this bundle (the candidate Build Item)" value={bundleTitle} onChange={(e) => setBundleTitle(e.target.value)} style={{ marginBottom: 8 }} />
                <div className="row gap-2"><button className="btn btn-sm" disabled={busy || !bundleTitle.trim()} onClick={createBundle}>Create bundle</button><button className="btn btn-secondary btn-sm" onClick={() => setSel(new Set())}>Clear</button></div>
              </div>
            )}
          </Column>

          {/* Bundles */}
          <Column label="Bundles" count={bundles.length} blurb="Candidate Build Items. Ship one to start building it.">
            {bundles.map((b) => {
              const sigs = sigsOf(b.id);
              return (
                <div key={b.id} className="card card-pad" style={{ borderLeft: "3px solid var(--ac)" }}>
                  <div style={{ fontSize: 14, fontWeight: 660, marginBottom: 6 }}>{b.title}</div>
                  <div className="stack-2" style={{ marginBottom: 8 }}>
                    {sigs.map((s) => (
                      <div key={s.id} className="row-between" style={{ fontSize: 12.5, gap: 6 }}>
                        <span className="t-sub" style={{ color: "var(--tp)" }}>• {s.title}</span>
                        <button className="btn btn-secondary btn-sm" title="Remove from bundle" onClick={() => removeFromBundle(s.id)}>✕</button>
                      </div>
                    ))}
                    {sigs.length === 0 && <div className="t-sub t-muted" style={{ fontSize: 12 }}>Empty — add verified signals.</div>}
                  </div>
                  <button className="btn btn-sm" disabled={busy || sigs.length === 0} onClick={() => shipToBuild(b, sigs)}>Ship to Build →</button>
                </div>
              );
            })}
            {bundles.length === 0 && <Empty>No bundles yet.</Empty>}
          </Column>
        </div>
      )}
    </div>
  );
}

function Column({ label, count, blurb, children }: { label: string; count: number; blurb: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="t-label" style={{ marginBottom: 2 }}>{label} · {count}</div>
      <div className="t-sub t-muted" style={{ fontSize: 11.5, marginBottom: "var(--sp-3)" }}>{blurb}</div>
      <div className="stack-3">{children}</div>
    </div>
  );
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>{children}</div>;
}
