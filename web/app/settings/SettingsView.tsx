"use client";

// Settings — Sources library lives here (it's setup/plumbing, not daily work).
// Register internal/external sources; manual today, live connectors (MCP) later.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Section, Chip, Banner, ConfirmDialog } from "@/components/ui";
import { SOURCE_CATALOG, type SourceDef } from "@/lib/sources";
import { loadDemoData, clearDemoIntel } from "@/lib/demoSeed";
import TeamManager from "@/components/TeamManager";

type Source = { id: string; label: string; icon: string; origin: string; kind: string; status: string };

const SETTINGS_SECTIONS = [
  { key: "org", label: "Workspace" },
  { key: "team", label: "Team & access" },
  { key: "sources", label: "Sources & connectors" },
  { key: "hitl", label: "Review & autonomy" },
  { key: "security", label: "Security & audit" },
] as const;

// The autonomy dial — one governable policy per HITL surface.
const AUTONOMY_SURFACES = [
  { key: "records", label: "Records", blurb: "Agent proposals on product / GTM records.", enforced: true },
  { key: "intelligence", label: "Intelligence", blurb: "Synthesized theme changes from signals.", enforced: true },
  { key: "automations", label: "Automations", blurb: "Workflow runs fired by events.", enforced: false },
] as const;
const AUTONOMY_MODES = [
  { key: "propose_only", label: "Propose only", hint: "Everything waits for you to ratify — the safe default." },
  { key: "auto_low", label: "Auto low-risk", hint: "Low-risk maintenance applies; judgment calls still queue." },
  { key: "autonomous", label: "Autonomous", hint: "The AI acts (auto-ratify proposals, auto-create themes), with a full audit trail; you review after." },
] as const;

export default function SettingsView() {
  const supabase = createClient();
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<string>("org");
  const [policies, setPolicies] = useState<Record<string, string>>({});
  const [savingPolicy, setSavingPolicy] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("review_policies").select("surface, mode").then(({ data }) => {
      const m: Record<string, string> = {};
      for (const r of data ?? []) m[r.surface] = r.mode;
      setPolicies(m);
    });
  }, [supabase]);

  async function setMode(surface: string, mode: string) {
    setSavingPolicy(surface); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      const { error } = await supabase.from("review_policies").upsert({ org_id: orgId, surface, mode, updated_at: new Date().toISOString(), updated_by: "web" }, { onConflict: "org_id,surface" });
      if (error) throw error;
      setPolicies((p) => ({ ...p, [surface]: mode }));
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update the policy."); }
    finally { setSavingPolicy(null); }
  }

  const load = useCallback(async () => {
    const { data } = await supabase.from("sources").select("id, label, icon, origin, kind, status").order("created_at");
    setSources(data ?? []);
    setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  async function addSource(def: SourceDef) {
    setError(null);
    try {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization.");
      const { error } = await supabase.from("sources").insert({
        org_id: orgId, label: def.label, icon: def.icon, origin: def.origin, kind: def.kind,
        status: def.live ? "connected" : "manual",
      });
      if (error) throw error;
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not add source."); }
  }

  async function removeSource(id: string) {
    setError(null);
    const { error } = await supabase.from("sources").delete().eq("id", id);
    if (error) setError(error.message);
    await load();
  }

  const registered = new Set(sources.map((s) => s.kind));
  const internal = sources.filter((s) => s.origin === "internal");
  const external = sources.filter((s) => s.origin === "external");

  const [seeding, setSeeding] = useState(false);
  const [seedNote, setSeedNote] = useState<string | null>(null);
  async function seed() {
    setSeeding(true); setError(null); setSeedNote(null);
    try {
      const orgId = await getOrgId();
      if (!orgId) throw new Error("Could not resolve your organization.");
      const res = await loadDemoData(supabase, orgId);
      setSeedNote(res.message);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load sample data."); }
    finally { setSeeding(false); }
  }

  // The broom: removes the demo INTEL (signals, themes, battle cards, accounts,
  // outcomes) so the workspace runs on legit data only. Records/competitors/
  // configuration stay. Guarded by an explicit confirm.
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  async function clearDemo() {
    setConfirmClear(false); setClearing(true); setError(null); setSeedNote(null);
    try {
      const res = await clearDemoIntel(supabase);
      setSeedNote(res.message);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not clear demo intel."); }
    finally { setClearing(false); }
  }

  // Reset the competitive board for a clean, legit re-run of the guided setup:
  // competitors (cascades sources, scores, battlecards, profiles), their
  // signals, and the matrix rows. Records, agents, skills, workflows stay.
  const [clearingComp, setClearingComp] = useState(false);
  const [confirmComp, setConfirmComp] = useState(false);
  async function clearCompetitive() {
    setConfirmComp(false); setClearingComp(true); setError(null); setSeedNote(null);
    try {
      const { data: comps } = await supabase.from("competitors").select("id");
      const ids = (comps ?? []).map((c) => c.id);
      if (ids.length) await supabase.from("signals").delete().in("competitor_id", ids);
      const { count: cDel } = await supabase.from("competitors").delete({ count: "exact" }).gte("created_at", "1970-01-01");
      const { count: kDel } = await supabase.from("capabilities").delete({ count: "exact" }).gte("created_at", "1970-01-01");
      setSeedNote(`Competitive board cleared — ${cDel ?? 0} competitors (with their sources, scores, battlecards, profiles) and ${kDel ?? 0} matrix rows removed. Run ✦ Guided setup on Competitive to rebuild it legit.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not clear the competitive board."); }
    finally { setClearingComp(false); }
  }

  return (
    <div>
      <h1 className="t-page" style={{ marginBottom: "var(--sp-4)" }}>Settings</h1>
      <div className="settings-grid" style={{ display: "grid", gridTemplateColumns: "210px 1fr", gap: "var(--sp-5)", alignItems: "start" }}>
        {/* Left rail — focused panels, no endless scroll */}
        <nav className="card card-pad" style={{ position: "sticky", top: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          {SETTINGS_SECTIONS.map((s) => {
            const on = section === s.key;
            return (
              <button key={s.key} onClick={() => setSection(s.key)} style={{ textAlign: "left", background: on ? "var(--ac-fill)" : "transparent", color: on ? "var(--ac-text)" : "var(--ts)", border: "none", borderRadius: 7, padding: "8px 10px", fontSize: 13, fontWeight: on ? 680 : 600, cursor: "pointer" }}>
                {s.label}
              </button>
            );
          })}
        </nav>

        <div style={{ minWidth: 0 }}>
          <Banner>{error}</Banner>

          {section === "org" && (
            <Section label="Workspace">
              <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
                Load SingleStack&apos;s own workspace — we use SingleStack to build SingleStack: the product &amp; a GTM record, <strong>signals</strong> (GTM + market), real <strong>competitors</strong>, <strong>frontier-model capabilities</strong>, durable themes, and skills wired to your executive agents. Data only — the platform stays product-agnostic. Writes to your workspace; safe to run once.
              </div>
              {seedNote && <div className="banner" style={{ marginBottom: 12 }}>{seedNote}</div>}
              {confirmComp && (
                <ConfirmDialog
                  title="Clear the competitive board?"
                  message={<>Removes <b>every competitor</b> — with their monitored sources, capability scores, battlecards, signal profiles, and competitor-tagged signals — plus all matrix rows. Records, agents, skills, and workflows stay. Use this for a clean re-run of the guided setup. This can&rsquo;t be undone.</>}
                  confirmLabel="Clear the board" onConfirm={clearCompetitive} onCancel={() => setConfirmComp(false)}
                />
              )}
              {confirmClear && (
                <ConfirmDialog
                  title="Clear demo intel?"
                  message={<>Deletes the demo <b>signals, themes, battle cards, accounts, outcomes, and the seeded matrix rows</b> (their scores go with them — matrix and grid empty together) — matched precisely, so intel you logged yourself survives. Your product &amp; GTM records, competitors, and agents/skills/workflows stay. This can&rsquo;t be undone.</>}
                  confirmLabel="Clear demo intel" onConfirm={clearDemo} onCancel={() => setConfirmClear(false)}
                />
              )}
              <div className="row gap-2" style={{ flexWrap: "wrap", alignItems: "center" }}>
                <button className="btn" onClick={seed} disabled={seeding}>{seeding ? "Loading…" : "Load SingleStack workspace"}</button>
                <button className="btn btn-secondary" onClick={() => setConfirmComp(true)} disabled={clearingComp}
                  title="Remove all competitors (their sources, scores, battlecards, profiles, signals) and matrix rows — for a clean re-run of the guided setup.">
                  {clearingComp ? "Clearing…" : "⌫ Clear competitive board"}
                </button>
                <button className="btn btn-secondary" onClick={() => setConfirmClear(true)} disabled={clearing}
                  title="Remove the demo intel (signals, themes, battle cards, accounts, outcomes) — your records, competitors, and configuration stay.">
                  {clearing ? "Clearing…" : "⌫ Clear demo intel"}
                </button>
                {seedNote && <><a className="btn btn-secondary btn-sm" href="/products">Product →</a><a className="btn btn-secondary btn-sm" href="/competitive">Competitors →</a><a className="btn btn-secondary btn-sm" href="/frontier">Frontier models →</a><a className="btn btn-secondary btn-sm" href="/agents">Run agent review →</a></>}
              </div>
            </Section>
          )}

          {section === "team" && <TeamManager />}

          {section === "sources" && (<>
            <Section label="Connected sources">
              {loading ? <div className="t-sub t-muted">Loading…</div>
                : sources.length === 0 ? <div className="t-sub t-muted">No sources yet. Add some below.</div>
                : (
                  <div className="stack-3">
                    {[["Internal", internal], ["External", external]].map(([label, list]) => (list as Source[]).length > 0 && (
                      <div key={label as string}>
                        <div className="t-label" style={{ marginBottom: 8 }}>{label as string}</div>
                        <div className="row gap-2" style={{ flexWrap: "wrap" }}>
                          {(list as Source[]).map((s) => (
                            <span key={s.id} className="card" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "7px 11px" }}>
                              <span>{s.icon}</span>
                              <span style={{ fontSize: 13, fontWeight: 600 }}>{s.label}</span>
                              <span className="chip" style={{ fontSize: 9.5, background: s.status === "connected" ? "var(--gn-fill)" : "var(--fill-2)", color: s.status === "connected" ? "var(--gn-text)" : "var(--tm)" }}>{s.status === "connected" ? "LIVE" : "MANUAL"}</span>
                              <button onClick={() => removeSource(s.id)} className="t-muted" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15, lineHeight: 1, padding: "0 2px" }} title="Remove">×</button>
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
            </Section>

            <Section label="Add a source">
              <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
                Manual sources let you log signals by hand now. Sources marked “live later” pull automatically as MCP connectors ship. To point a connected source at specifics (and curate it), use the Sources panel in Signals / Competitive / Market.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "var(--sp-3)" }}>
                {SOURCE_CATALOG.filter((d) => !registered.has(d.kind)).map((d) => (
                  <button key={d.kind} className="card card-pad pop" style={{ textAlign: "left" }} onClick={() => addSource(d)}>
                    <div className="row-between" style={{ marginBottom: 6 }}>
                      <span className="row gap-2"><span style={{ fontSize: 16 }}>{d.icon}</span><span style={{ fontSize: 13.5, fontWeight: 620 }}>{d.label}</span></span>
                      <Chip tone={d.origin === "internal" ? "accent" : "violet"}>{d.origin}</Chip>
                    </div>
                    <div className="t-sub t-muted" style={{ fontSize: 12, lineHeight: 1.45 }}>{d.blurb}</div>
                    <div style={{ marginTop: 8, fontSize: 11, fontWeight: 700, color: d.live ? "var(--gn-text)" : "var(--tm)" }}>{d.live ? "+ Add" : "+ Add · live later"}</div>
                  </button>
                ))}
                {SOURCE_CATALOG.filter((d) => !registered.has(d.kind)).length === 0 && <div className="t-sub t-muted">All catalog sources added.</div>}
              </div>
            </Section>
          </>)}

          {section === "hitl" && (
            <Section label="Review & autonomy">
              <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>How much each part of the platform may do before you ratify. SingleStack runs on <strong>graduated autonomy</strong> — these dials set where the line sits, per surface. Everything is audited regardless of mode.</div>
              <div className="stack-3">
                {AUTONOMY_SURFACES.map((s) => {
                  const cur = policies[s.key] ?? "propose_only";
                  return (
                    <div key={s.key} className="card card-pad">
                      <div className="row-between" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                        <div style={{ minWidth: 0 }}>
                          <div className="row gap-2" style={{ alignItems: "center" }}><span style={{ fontWeight: 640 }}>{s.label}</span>{!s.enforced && <Chip>policy</Chip>}</div>
                          <div className="t-sub t-muted" style={{ fontSize: 12 }}>{s.blurb}</div>
                        </div>
                        <div className="row" style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", flexShrink: 0 }}>
                          {AUTONOMY_MODES.map((m) => (
                            <button key={m.key} disabled={savingPolicy === s.key} onClick={() => setMode(s.key, m.key)} title={m.hint}
                              className="btn-sm" style={{ border: "none", background: cur === m.key ? "var(--ac)" : "var(--panel)", color: cur === m.key ? "#fff" : "var(--ts)", fontWeight: 600, padding: "6px 11px", cursor: "pointer" }}>{m.label}</button>
                          ))}
                        </div>
                      </div>
                      <div className="t-sub t-muted" style={{ fontSize: 11.5, marginTop: 6 }}>{AUTONOMY_MODES.find((m) => m.key === cur)?.hint}</div>
                    </div>
                  );
                })}
              </div>
              <div className="t-sub t-muted" style={{ fontSize: 11.5, marginTop: 12 }}><strong>Records</strong> &amp; <strong>Intelligence</strong> are enforced now — on Autonomous, agent proposals auto-ratify and synthesis auto-creates themes (audited). <strong>Automations</strong> is recorded and honored as it rolls out. Untrusted / imported content is always screened and queued, regardless of mode.</div>
            </Section>
          )}

          {section === "security" && (
            <Section label="Security & audit">
              <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>The posture connectivity rides on.</div>
              <div className="stack-3">
                {[
                  ["Org isolation", "Every table is row-level-security fenced to your organization; functions run as the calling user."],
                  ["Secret vault", "Connector tokens are encrypted at rest, never returned to the client, and passed to a model only at run time."],
                  ["Safe fetch (SSRF)", "URL fetches are https-only and refuse private/loopback/metadata addresses; size- and time-capped; no redirects."],
                  ["Injection screening", "Fetched & pasted content is screened for prompt-injection and framed as inert data the model must not obey."],
                  ["Audit trail", "Connector runs, security events, and theme changes are recorded append-only."],
                ].map(([t, d]) => (
                  <div key={t} className="card card-pad"><div style={{ fontWeight: 640, marginBottom: 4 }}>{t}</div><div className="t-sub t-muted" style={{ fontSize: 12.5 }}>{d}</div></div>
                ))}
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
