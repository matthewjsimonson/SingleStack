"use client";

// Settings — Sources library lives here (it's setup/plumbing, not daily work).
// Register internal/external sources; manual today, live connectors (MCP) later.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Section, Chip, Banner } from "@/components/ui";
import { SOURCE_CATALOG, type SourceDef } from "@/lib/sources";
import { loadDemoData } from "@/lib/demoSeed";
import TeamManager from "@/components/TeamManager";

type Source = { id: string; label: string; icon: string; origin: string; kind: string; status: string };

const SETTINGS_SECTIONS = [
  { key: "org", label: "Workspace" },
  { key: "team", label: "Team & access" },
  { key: "sources", label: "Sources & connectors" },
  { key: "hitl", label: "Review & autonomy" },
  { key: "security", label: "Security & audit" },
] as const;

export default function SettingsView() {
  const supabase = createClient();
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<string>("org");

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
              <div className="row gap-2" style={{ flexWrap: "wrap", alignItems: "center" }}>
                <button className="btn" onClick={seed} disabled={seeding}>{seeding ? "Loading…" : "Load SingleStack workspace"}</button>
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
              <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>How humans and agents share the work. SingleStack runs on <strong>graduated autonomy</strong>: agents draft, humans ratify.</div>
              <div className="stack-3">
                <div className="card card-pad"><div style={{ fontWeight: 640, marginBottom: 4 }}>Proposals → records</div><div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Agents and imports never edit a record directly — they queue proposals you accept or reject. <a href="/agents" className="t-sub" style={{ color: "var(--ac-text)", fontWeight: 600 }}>Agents →</a></div></div>
                <div className="card card-pad"><div style={{ fontWeight: 640, marginBottom: 4 }}>Intel review</div><div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Low-judgment moves (attach evidence, momentum) auto-apply; high-judgment ones (new themes, escalations) queue for review, and your verdicts train the system. <a href="/signals" className="t-sub" style={{ color: "var(--ac-text)", fontWeight: 600 }}>Signals →</a></div></div>
                <div className="card card-pad"><div style={{ fontWeight: 640, marginBottom: 4 }}>Untrusted input</div><div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Imported / fetched content is treated as untrusted, injection-screened, and always lands in a review queue — never applied automatically.</div></div>
              </div>
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
