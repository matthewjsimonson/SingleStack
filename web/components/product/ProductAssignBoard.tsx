"use client";

// Product Assign — the last step of the PRODUCT workflow. Route produced BUILD
// items (initiative_workstreams, area='build', tailored from a spec) to RELEASES
// to ship, split by release stage: Upcoming (planned / in_dev) vs Shipped
// (released). Assigning sets workstreams.release_id (mirrors AssignBoard setting
// campaign_id). New releases can be spun up inline. Mirrors gtm/AssignBoard.tsx.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Chip, Banner, Section, Empty } from "@/components/ui";
import { PLAYBOOK_BY_KEY } from "@/lib/productPlaybooks";

type Item = { id: string; title: string; stage: string; content_type: string | null; release_id: string | null };
type Release = { id: string; name: string; version: string | null; stage: string | null };

// The two release-stage columns: what's coming vs what's shipped.
const COLS: { id: "upcoming" | "shipped"; label: string; blurb: string; stages: string[] }[] = [
  { id: "upcoming", label: "Upcoming", blurb: "Releases in planning or in development — where build work ships next.", stages: ["planned", "in_dev"] },
  { id: "shipped", label: "Shipped", blurb: "Released — the build work that has already shipped.", stages: ["released"] },
];
const STAGE_TONE: Record<string, "default" | "violet" | "green"> = { backlog: "default", active: "violet", done: "green" };
const RELEASE_STAGE_LABEL: Record<string, string> = { planned: "planned", in_dev: "in dev", released: "released" };

export default function ProductAssignBoard() {
  const supabase = createClient();
  const [items, setItems] = useState<Item[]>([]);
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  // Load build workstreams scoped to spec-derived work: area='build' AND a spec_id
  // is present, so unrelated build tasks (standalone module work) aren't swept in.
  const load = useCallback(async () => {
    const [{ data: w }, { data: r }] = await Promise.all([
      supabase.from("initiative_workstreams").select("id, title, stage, content_type, release_id, spec_id").eq("area", "build").not("spec_id", "is", null).order("created_at", { ascending: false }),
      supabase.from("releases").select("id, name, version, stage").order("created_at", { ascending: false }),
    ]);
    setItems((w ?? []) as Item[]); setReleases((r ?? []) as Release[]); setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  async function assign(itemId: string, releaseId: string | null) {
    setError(null);
    const { error } = await supabase.from("initiative_workstreams").update({ release_id: releaseId }).eq("id", itemId);
    if (error) { setError(error.message); return; }
    await load();
  }

  async function createRelease(e: React.FormEvent) {
    e.preventDefault(); if (!name.trim()) return;
    setBusy(true); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      const { error } = await supabase.from("releases").insert({ org_id: orgId, name: name.trim(), stage: "planned" });
      if (error) throw error;
      setCreating(false); setName(""); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create the release."); }
    finally { setBusy(false); }
  }

  const typeLabel = (ct: string | null) => (ct && PLAYBOOK_BY_KEY[ct]?.name) || ct || "Item";
  const releaseLabel = (r: Release) => (r.version ? `${r.version} · ${r.name}` : r.name);
  const unassigned = items.filter((i) => !i.release_id);
  const itemsFor = (rid: string) => items.filter((i) => i.release_id === rid);
  const stageCol = (s: string | null) => (s === "released" ? "shipped" : "upcoming");

  return (
    <div>
      <Banner>{error}</Banner>

      <div className="row-between" style={{ marginBottom: "var(--sp-4)", alignItems: "center" }}>
        <span className="t-label">Route build work to releases</span>
        {!creating && <button className="btn btn-sm" onClick={() => setCreating(true)}>+ New release</button>}
      </div>

      {creating && (
        <form onSubmit={createRelease} className="card card-pad" style={{ marginBottom: "var(--sp-5)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "var(--sp-3)" }}>
            <label className="field"><span className="t-label">Name</span><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. v4.4 — Spec-driven build" /></label>
          </div>
          <div className="row gap-2"><button className="btn" type="submit" disabled={busy}>{busy ? "Creating…" : "Create"}</button><button className="btn btn-secondary" type="button" onClick={() => setCreating(false)}>Cancel</button></div>
        </form>
      )}

      {loading ? <div className="t-sub t-muted">Loading…</div> : (
        <>
          <Section label={`Unassigned · ${unassigned.length}`}>
            {unassigned.length === 0 ? (
              <Empty title="Everything is routed" hint="Produce build work in Tailor, then assign it to a release here." />
            ) : (
              <div className="stack-3">
                {unassigned.map((it) => (
                  <div key={it.id} className="card card-pad row-between" style={{ alignItems: "center", gap: 12 }}>
                    <div className="row gap-2" style={{ alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600 }}>{it.title}</span>
                      <Chip>{typeLabel(it.content_type)}</Chip>
                      <Chip tone={STAGE_TONE[it.stage] ?? "default"}>{it.stage}</Chip>
                    </div>
                    <select className="select" style={{ maxWidth: 240 }} value="" onChange={(e) => e.target.value && assign(it.id, e.target.value)}>
                      <option value="">Assign to…</option>
                      {COLS.map((k) => {
                        const opts = releases.filter((r) => k.stages.includes(r.stage ?? "planned"));
                        if (opts.length === 0) return null;
                        return <optgroup key={k.id} label={k.label}>{opts.map((r) => <option key={r.id} value={r.id}>{releaseLabel(r)}</option>)}</optgroup>;
                      })}
                    </select>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-4)" }}>
            {COLS.map((k) => {
              const cols = releases.filter((r) => stageCol(r.stage) === k.id);
              return (
                <div key={k.id}>
                  <Section label={k.label}>
                    <div className="t-sub t-muted" style={{ fontSize: 12, marginBottom: 8 }}>{k.blurb}</div>
                    {cols.length === 0 ? (
                      <Empty title="No releases" hint={`Create a release to route build work into it.`} />
                    ) : (
                      <div className="stack-3">
                        {cols.map((r) => {
                          const assigned = itemsFor(r.id);
                          return (
                            <div key={r.id} className="card card-pad">
                              <div className="row-between" style={{ alignItems: "center", marginBottom: assigned.length ? 10 : 0 }}>
                                <span style={{ fontSize: 14, fontWeight: 640 }}>{releaseLabel(r)}</span>
                                <Chip>{RELEASE_STAGE_LABEL[r.stage ?? "planned"] ?? r.stage}</Chip>
                              </div>
                              {assigned.length === 0 ? (
                                <div className="t-sub t-muted" style={{ fontSize: 12 }}>No items yet.</div>
                              ) : (
                                <div className="stack-3">
                                  {assigned.map((it) => (
                                    <div key={it.id} className="row-between" style={{ alignItems: "center", gap: 8, padding: "6px 0", borderTop: "1px solid var(--border)" }}>
                                      <div className="row gap-2" style={{ alignItems: "center", flexWrap: "wrap" }}>
                                        <span className="t-sub" style={{ fontSize: 13 }}>{it.title}</span>
                                        <Chip tone={STAGE_TONE[it.stage] ?? "default"}>{it.stage}</Chip>
                                      </div>
                                      <button className="btn btn-secondary btn-sm" onClick={() => assign(it.id, null)}>Unassign</button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </Section>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
