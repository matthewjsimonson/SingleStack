"use client";

// Settings — Sources library lives here (it's setup/plumbing, not daily work).
// Register internal/external sources; manual today, live connectors (MCP) later.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { PageHeader, Section, Chip, Banner } from "@/components/ui";
import { SOURCE_CATALOG, type SourceDef } from "@/lib/sources";

type Source = { id: string; label: string; icon: string; origin: string; kind: string; status: string };

export default function SettingsView() {
  const supabase = createClient();
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div>
      <PageHeader title="Settings" meta="Connect the sources that feed your signals. Manual today; live connectors arrive with MCP." />
      <Banner>{error}</Banner>

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
          Manual sources let you log signals by hand now. Sources marked “live later” will pull automatically once MCP connectors ship.
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
    </div>
  );
}
