"use client";

// Homepage Initiatives band — the PLG motion up top. A toggle between the active
// efforts and the ones that need attention, each with Build/GTM progress + owner.
// Build & GTM are where the work gets done; this is the motion that drives them.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Section, Chip } from "@/components/ui";

type Init = { id: string; title: string; kind: string | null; stage: string; objective_id: string | null; assignee_id: string | null };
type Ws = { initiative_id: string; area: string; stage: string };

export default function HomeInitiatives() {
  const supabase = createClient();
  const [inits, setInits] = useState<Init[]>([]);
  const [ws, setWs] = useState<Ws[]>([]);
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [view, setView] = useState<"active" | "attention">("active");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [{ data: i }, { data: w }, { data: p }] = await Promise.all([
      supabase.from("initiatives").select("id, title, kind, stage, objective_id, assignee_id").is("parent_id", null).order("created_at", { ascending: false }),
      supabase.from("initiative_workstreams").select("initiative_id, area, stage"),
      supabase.from("people").select("id, name"),
    ]);
    setInits((i ?? []) as Init[]); setWs((w ?? []) as Ws[]); setPeople(p ?? []); setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const owner = (id: string | null) => people.find((p) => p.id === id)?.name ?? null;
  const wsFor = (id: string) => ws.filter((x) => x.initiative_id === id);
  const prog = (id: string, area: string) => { const l = wsFor(id).filter((x) => x.area === area); return `${l.filter((x) => x.stage === "done").length}/${l.length}`; };

  const attention = inits.filter((i) => !i.objective_id || !i.assignee_id || wsFor(i.id).length === 0);
  const active = inits.filter((i) => i.stage !== "done");
  const list = (view === "active" ? active : attention).slice(0, 4);

  if (loading) return null;

  return (
    <Section label="Initiatives — your growth motion" action={
      <div className="row gap-2" style={{ alignItems: "center" }}>
        <div className="row" style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
          {([["active", `Active · ${active.length}`], ["attention", `Needs attention · ${attention.length}`]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setView(k)} style={{ border: "none", background: view === k ? "var(--ac)" : "var(--panel)", color: view === k ? "#fff" : "var(--ts)", fontWeight: 600, fontSize: 12.5, padding: "6px 12px", cursor: "pointer" }}>{label}</button>
          ))}
        </div>
        <a href="/initiatives" className="btn btn-secondary btn-sm">View all →</a>
      </div>
    }>
      {inits.length === 0 ? (
        <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No initiatives yet. Open a signal theme and <strong>✦ Recommend an initiative</strong> to start your motion.</div>
      ) : list.length === 0 ? (
        <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>{view === "attention" ? "Nothing needs attention — every effort is aligned, owned, and has workstreams." : "No active initiatives."}</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "var(--sp-3)" }}>
          {list.map((i) => (
            <a key={i.id} href={`/ship/${i.id}`} className="card card-link card-pad" style={{ display: "block", borderLeft: view === "attention" ? "3px solid var(--am-text)" : "3px solid var(--ac)" }}>
              <div style={{ fontSize: 13.5, fontWeight: 640, marginBottom: 6 }}>{i.title}</div>
              <div className="row gap-2" style={{ flexWrap: "wrap", marginBottom: 6 }}>
                {i.kind && <Chip tone={i.kind === "module" ? "accent" : "green"}>{i.kind}</Chip>}
                {owner(i.assignee_id) ? <Chip>👤 {owner(i.assignee_id)}</Chip> : <Chip tone="amber">unowned</Chip>}
              </div>
              <div className="row gap-2"><span className="t-mono-xs" style={{ color: "var(--ac-text)" }}>Build {prog(i.id, "build")}</span><span className="t-mono-xs" style={{ color: "var(--vl-text)" }}>GTM {prog(i.id, "gtm")}</span></div>
            </a>
          ))}
        </div>
      )}
    </Section>
  );
}
