"use client";

// Initiatives board — the whole product-led-growth motion as one board, starting
// at PLAN (Signal lives in Product Strategy). Columns ARE the motion:
// Plan → Build → Launch → Live. An item's column is DERIVED from where its real
// build + GTM work actually are (derivePlgStage) — you don't drag cards. Each
// card shows that real progress. Click through to the cockpit to do the work.
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useProductScope } from "@/lib/ProductContext";
import { Chip, Banner } from "@/components/ui";
import { buildReadiness, deriveBuildStage, derivePlgStage, PLG_STAGES, STAGE_LABEL, type BuildStage, type PlgStage } from "@/lib/buildStage";

type Init = { id: string; title: string; kind: string | null; scope: string; build_state: string | null; assignee_id: string | null; product_id: string | null; gtm_record_id: string | null; co_product_ids: string[] | null };
type FieldRow = { initiative_id: string; field_key: string; value: string | null };
type LinkRow = { initiative_id: string; kind: string };
type Ws = { initiative_id: string; area: string; stage: string };

const SCOPE_LABEL: Record<string, string> = { product: "Product", gtm: "GTM", both: "Product + GTM" };
const KIND_LABEL: Record<string, string> = { bugfix: "Fix", enhancement: "Enhancement", feature: "New Feature", module: "New Module", product: "Product" };
const STAGE_TONE: Record<BuildStage, "amber" | "accent" | "green"> = { scoped: "amber", ready_for_agent: "accent", in_build: "accent", shipped: "green" };

export default function InitiativeLifecycleBoard() {
  const supabase = createClient();
  const { matches } = useProductScope();
  const [inits, setInits] = useState<Init[]>([]);
  const [fields, setFields] = useState<FieldRow[]>([]);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [ws, setWs] = useState<Ws[]>([]);
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: i }, { data: fl }, { data: lk }, { data: w }, { data: p }] = await Promise.all([
      supabase.from("initiatives").select("id, title, kind, scope, build_state, assignee_id, product_id, gtm_record_id, co_product_ids").is("parent_id", null).order("created_at", { ascending: false }),
      supabase.from("initiative_fields").select("initiative_id, field_key, value"),
      supabase.from("build_context_links").select("initiative_id, kind"),
      supabase.from("initiative_workstreams").select("initiative_id, area, stage"),
      supabase.from("people").select("id, name"),
    ]);
    setInits((i ?? []) as Init[]); setFields((fl ?? []) as FieldRow[]); setLinks((lk ?? []) as LinkRow[]); setWs((w ?? []) as Ws[]); setPeople(p ?? []); setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const owner = (id: string | null) => people.find((p) => p.id === id)?.name ?? null;

  // Derive each initiative's PLG stage + the build/GTM progress shown on its card.
  const derived = useMemo(() => {
    const m = new Map<string, { plg: PlgStage; buildStage: BuildStage; hasBuild: boolean; hasGtm: boolean; b: [number, number]; g: [number, number] }>();
    for (const it of inits) {
      const fv = new Map(fields.filter((f) => f.initiative_id === it.id).map((f) => [f.field_key, (f.value ?? "").trim()]));
      const lk = links.filter((l) => l.initiative_id === it.id);
      const bt = ws.filter((x) => x.initiative_id === it.id && x.area === "build");
      const gt = ws.filter((x) => x.initiative_id === it.id && x.area === "gtm");
      const { ready } = buildReadiness(fv, lk);
      const buildStage = deriveBuildStage({ buildState: it.build_state, ready, buildTasks: bt });
      const plg = derivePlgStage({ scope: it.scope, buildStage, gtmTasks: gt });
      m.set(it.id, {
        plg, buildStage,
        hasBuild: it.scope === "product" || it.scope === "both",
        hasGtm: it.scope === "gtm" || it.scope === "both",
        b: [bt.filter((t) => t.stage === "done").length, bt.length],
        g: [gt.filter((t) => t.stage === "done").length, gt.length],
      });
    }
    return m;
  }, [inits, fields, links, ws]);

  const scoped = inits.filter(matches);
  if (loading) return <div className="t-sub t-muted">Loading…</div>;

  return (
    <div>
      <Banner>{error}</Banner>
      {scoped.length === 0 ? (
        <div className="empty">
          <div className="t-body" style={{ fontWeight: 600, marginBottom: 6 }}>No initiatives yet</div>
          <div className="t-sub" style={{ maxWidth: 480, marginInline: "auto" }}>Ship a thesis from <a href="/strategy" style={{ color: "var(--ac-text)", fontWeight: 600 }}>Product strategy</a> — it lands here in Plan and moves across the motion as its build and GTM work actually progress.</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${PLG_STAGES.length}, minmax(200px, 1fr))`, gap: "var(--sp-3)", overflowX: "auto" }}>
          {PLG_STAGES.map((col) => {
            const list = scoped.filter((i) => derived.get(i.id)!.plg === col.key);
            return (
              <div key={col.key} className="card" style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}>
                <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", borderTop: `2px solid ${col.tone}` }}>
                  <div className="row-between"><span style={{ fontSize: 13, fontWeight: 680 }}>{col.label}</span><span className="t-mono-xs">{list.length}</span></div>
                  <div className="t-sub t-muted" style={{ fontSize: 11 }}>{col.hint}</div>
                </div>
                <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 8, minHeight: 90 }}>
                  {list.length === 0 ? <div className="t-sub t-muted" style={{ fontSize: 11.5, padding: "6px 4px" }}>—</div> : list.map((i) => {
                    const d = derived.get(i.id)!;
                    return (
                      <div key={i.id} className="card card-pad" style={{ padding: 10 }}>
                        <a href={`/initiatives/${i.id}`} style={{ fontSize: 13, fontWeight: 620, color: "inherit", textDecoration: "none", display: "block", marginBottom: 6 }}>{i.title}</a>
                        <div className="row gap-2" style={{ flexWrap: "wrap", marginBottom: 6 }}>
                          {i.kind && <Chip>{KIND_LABEL[i.kind] ?? i.kind}</Chip>}
                          <Chip tone={i.scope === "gtm" ? "violet" : "default"}>{SCOPE_LABEL[i.scope] ?? i.scope}</Chip>
                          {owner(i.assignee_id) ? <Chip tone="green">{owner(i.assignee_id)}</Chip> : <Chip tone="amber">unowned</Chip>}
                        </div>
                        <div className="row gap-2" style={{ flexWrap: "wrap", alignItems: "center" }}>
                          {d.hasBuild && <Chip tone={STAGE_TONE[d.buildStage]}>{STAGE_LABEL[d.buildStage]}</Chip>}
                          <span className="t-mono-xs">
                            {d.hasBuild && <span style={{ color: "var(--ac-text)" }}>B {d.b[0]}/{d.b[1]}</span>}
                            {d.hasBuild && d.hasGtm && " · "}
                            {d.hasGtm && <span style={{ color: "var(--vl-text)" }}>G {d.g[0]}/{d.g[1]}</span>}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
