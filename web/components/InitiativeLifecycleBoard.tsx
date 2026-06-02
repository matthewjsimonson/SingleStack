"use client";

// Initiatives lifecycle board — the whole product-led-growth motion as one
// dynamic board. Columns ARE the motion: Signal → Plan (roadmap + campaign) →
// Build/Ship → Launch (GTM) → Live (measuring, loops back to signals). Cards are
// initiatives spanning Build + GTM; advance them across the lifecycle. This is
// the PLG cockpit; the Build & GTM areas are where each card's workstreams ship.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useProductScope } from "@/lib/ProductContext";
import { Chip, Banner } from "@/components/ui";

type Init = { id: string; title: string; kind: string | null; lifecycle: string; stage: string; assignee_id: string | null; product_id: string | null; gtm_record_id: string | null; co_product_ids: string[] | null };
type Ws = { initiative_id: string; area: string; stage: string };

const STAGES: { key: string; label: string; hint: string; tone: string }[] = [
  { key: "signal", label: "Signal", hint: "Sourced from intel", tone: "var(--tm)" },
  { key: "plan", label: "Plan", hint: "Roadmap + campaign", tone: "var(--ac)" },
  { key: "build", label: "Build / Ship", hint: "Product execution", tone: "var(--ac)" },
  { key: "launch", label: "Launch", hint: "Go-to-market", tone: "var(--vl)" },
  { key: "live", label: "Live", hint: "Measuring → loops back", tone: "var(--gn)" },
];
const ORDER = STAGES.map((s) => s.key);

export default function InitiativeLifecycleBoard() {
  const supabase = createClient();
  const { matches } = useProductScope();
  const [inits, setInits] = useState<Init[]>([]);
  const [ws, setWs] = useState<Ws[]>([]);
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: i }, { data: w }, { data: p }] = await Promise.all([
      supabase.from("initiatives").select("id, title, kind, lifecycle, stage, assignee_id, product_id, gtm_record_id, co_product_ids").is("parent_id", null).order("created_at", { ascending: false }),
      supabase.from("initiative_workstreams").select("initiative_id, area, stage"),
      supabase.from("people").select("id, name"),
    ]);
    setInits((i ?? []) as Init[]); setWs((w ?? []) as Ws[]); setPeople(p ?? []); setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const owner = (id: string | null) => people.find((p) => p.id === id)?.name ?? null;
  const prog = (id: string, area: string) => { const l = ws.filter((x) => x.initiative_id === id && x.area === area); return `${l.filter((x) => x.stage === "done").length}/${l.length}`; };
  async function move(i: Init, dir: number) {
    const idx = Math.max(0, Math.min(ORDER.length - 1, ORDER.indexOf(i.lifecycle) + dir));
    setError(null);
    const { error } = await supabase.from("initiatives").update({ lifecycle: ORDER[idx] }).eq("id", i.id);
    if (error) setError(error.message); else load();
  }

  const scoped = inits.filter(matches);
  if (loading) return <div className="t-sub t-muted">Loading…</div>;

  return (
    <div>
      <Banner>{error}</Banner>
      {scoped.length === 0 ? (
        <div className="empty">
          <div className="t-body" style={{ fontWeight: 600, marginBottom: 6 }}>No initiatives yet</div>
          <div className="t-sub" style={{ maxWidth: 480, marginInline: "auto" }}>Open a signal theme (Signals) and <strong>✦ Recommend an initiative</strong> — it lands here and moves across the lifecycle as you plan, ship, and launch it.</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${STAGES.length}, minmax(180px, 1fr))`, gap: "var(--sp-3)", overflowX: "auto" }}>
          {STAGES.map((col) => {
            const list = scoped.filter((i) => i.lifecycle === col.key);
            return (
              <div key={col.key} className="card" style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}>
                <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", borderTop: `2px solid ${col.tone}` }}>
                  <div className="row-between"><span style={{ fontSize: 13, fontWeight: 680 }}>{col.label}</span><span className="t-mono-xs">{list.length}</span></div>
                  <div className="t-sub t-muted" style={{ fontSize: 11 }}>{col.hint}</div>
                </div>
                <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 8, minHeight: 90 }}>
                  {list.length === 0 ? <div className="t-sub t-muted" style={{ fontSize: 11.5, padding: "6px 4px" }}>—</div> : list.map((i) => (
                    <div key={i.id} className="card card-pad" style={{ padding: 10 }}>
                      <a href={`/ship/${i.id}`} style={{ fontSize: 13, fontWeight: 620, color: "inherit", textDecoration: "none", display: "block", marginBottom: 6 }}>{i.title}</a>
                      <div className="row gap-2" style={{ flexWrap: "wrap", marginBottom: 6 }}>
                        {i.kind && <Chip tone={i.kind === "module" ? "accent" : "green"}>{i.kind}</Chip>}
                        {owner(i.assignee_id) ? <Chip>👤 {owner(i.assignee_id)}</Chip> : <Chip tone="amber">unowned</Chip>}
                      </div>
                      <div className="row-between" style={{ alignItems: "center" }}>
                        <span className="t-mono-xs"><span style={{ color: "var(--ac-text)" }}>B {prog(i.id, "build")}</span> · <span style={{ color: "var(--vl-text)" }}>G {prog(i.id, "gtm")}</span></span>
                        <span className="row gap-2">
                          {ORDER.indexOf(i.lifecycle) > 0 && <button className="btn btn-secondary btn-sm" onClick={() => move(i, -1)} style={{ padding: "2px 7px" }}>←</button>}
                          {ORDER.indexOf(i.lifecycle) < ORDER.length - 1 && <button className="btn btn-secondary btn-sm" onClick={() => move(i, 1)} style={{ padding: "2px 7px" }}>→</button>}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
