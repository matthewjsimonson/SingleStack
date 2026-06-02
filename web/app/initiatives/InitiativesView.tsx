"use client";

// Initiatives — the cross-functional spine. Initiatives (efforts) grouped by the
// strategic Objective they serve, each showing its Build/GTM workstream progress
// and owner. A "Needs attention" governor flags efforts that are unaligned (no
// objective), unowned, or have no workstreams — so it stays coherent at scale.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useProductScope } from "@/lib/ProductContext";
import { PageHeader, Section, Chip, Banner } from "@/components/ui";

type Objective = { id: string; title: string; pillar: string | null; status: string };
type Initiative = { id: string; title: string; kind: string | null; lane: string; stage: string; priority: string | null; objective_id: string | null; assignee_id: string | null; product_id: string | null; gtm_record_id: string | null };
type Ws = { initiative_id: string; area: string; stage: string };
type Person = { id: string; name: string };

const KIND_TONE: Record<string, "accent" | "violet" | "green" | "default"> = { module: "accent", product: "accent", feature: "green", enhancement: "default", bugfix: "default" };

export default function InitiativesView() {
  const supabase = createClient();
  const { matches } = useProductScope();
  const [objs, setObjs] = useState<Objective[]>([]);
  const [inits, setInits] = useState<Initiative[]>([]);
  const [ws, setWs] = useState<Ws[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: o }, { data: i }, { data: w }, { data: p }] = await Promise.all([
      supabase.from("objectives").select("id, title, pillar, status").order("created_at"),
      supabase.from("initiatives").select("id, title, kind, lane, stage, priority, objective_id, assignee_id, product_id, gtm_record_id").is("parent_id", null).order("created_at", { ascending: false }),
      supabase.from("initiative_workstreams").select("initiative_id, area, stage"),
      supabase.from("people").select("id, name"),
    ]);
    setObjs(o ?? []); setInits((i ?? []) as Initiative[]); setWs((w ?? []) as Ws[]); setPeople(p ?? []); setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const owner = (id: string | null) => people.find((p) => p.id === id)?.name ?? null;
  const wsFor = (id: string) => ws.filter((x) => x.initiative_id === id);
  const prog = (id: string, area: string) => { const list = wsFor(id).filter((x) => x.area === area); return { done: list.filter((x) => x.stage === "done").length, total: list.length }; };

  const scoped = inits.filter(matches);
  // governor: efforts that need attention
  const flags = scoped.filter((i) => !i.objective_id || !i.assignee_id || wsFor(i.id).length === 0)
    .map((i) => ({ i, why: [!i.objective_id ? "no objective" : null, !i.assignee_id ? "unowned" : null, wsFor(i.id).length === 0 ? "no workstreams" : null].filter(Boolean).join(" · ") }));

  function Card({ i }: { i: Initiative }) {
    const b = prog(i.id, "build"), g = prog(i.id, "gtm");
    return (
      <a href={`/initiatives/${i.id}`} className="card card-link card-pad" style={{ display: "block" }}>
        <div className="row-between" style={{ gap: 8, marginBottom: 6, alignItems: "flex-start" }}>
          <span style={{ fontSize: 14, fontWeight: 640 }}>{i.title}</span>
          <Chip tone={i.stage === "done" ? "green" : i.stage === "active" ? "accent" : "default"}>{i.stage}</Chip>
        </div>
        <div className="row gap-2" style={{ flexWrap: "wrap", marginBottom: 8 }}>
          {i.kind && <Chip tone={KIND_TONE[i.kind] ?? "default"}>{i.kind}</Chip>}
          {owner(i.assignee_id) ? <Chip>👤 {owner(i.assignee_id)}</Chip> : <Chip tone="amber">unowned</Chip>}
        </div>
        <div className="row gap-2" style={{ flexWrap: "wrap" }}>
          <span className="t-mono-xs" style={{ color: "var(--ac-text)" }}>Build {b.done}/{b.total}</span>
          <span className="t-mono-xs" style={{ color: "var(--vl-text)" }}>GTM {g.done}/{g.total}</span>
        </div>
      </a>
    );
  }

  return (
    <div>
      <PageHeader title="Initiatives" meta="Your product-led growth motion — cross-functional efforts recommended by signals, each spanning Build and GTM, tied to an objective and an owner. Build & GTM are where the work gets done." />
      <Banner>{error}</Banner>

      {loading ? <div className="t-sub t-muted">Loading…</div> : scoped.length === 0 ? (
        <div className="empty">
          <div className="t-body" style={{ fontWeight: 600, marginBottom: 6 }}>No initiatives yet</div>
          <div className="t-sub" style={{ maxWidth: 480, marginInline: "auto" }}>Make a decision on a theme and <strong>Route it to action</strong> — it becomes an initiative here, spanning Build and GTM.</div>
        </div>
      ) : (
        <>
          {flags.length > 0 && (
            <Section label={`Needs attention · ${flags.length}`}>
              <div className="stack-3">
                {flags.map(({ i, why }) => (
                  <a key={i.id} href={`/initiatives/${i.id}`} className="card card-link card-pad row-between" style={{ borderLeft: "3px solid var(--am-text)" }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>{i.title}</span>
                    <Chip tone="amber">{why}</Chip>
                  </a>
                ))}
              </div>
            </Section>
          )}

          {objs.map((o) => {
            const list = scoped.filter((i) => i.objective_id === o.id);
            if (list.length === 0) return null;
            return (
              <Section key={o.id} label={`${o.title}${o.pillar ? ` · ${o.pillar}` : ""}`}>
                <div className="grid-cards">{list.map((i) => <Card key={i.id} i={i} />)}</div>
              </Section>
            );
          })}

          {(() => {
            const unaligned = scoped.filter((i) => !i.objective_id);
            return unaligned.length > 0 ? (
              <Section label="Unaligned · no objective">
                <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 10 }}>Efforts not tied to a strategic objective — align or prune them.</div>
                <div className="grid-cards">{unaligned.map((i) => <Card key={i.id} i={i} />)}</div>
              </Section>
            ) : null;
          })()}
        </>
      )}
    </div>
  );
}
