"use client";

// Enablement = the GTM workflow board, the go-to-market counterpart to Ship.
// Cards are initiatives with a GTM side (scope gtm | both), placed in the column
// of their DERIVED stage (deriveGtmStage: Brief → In production → Launched) — the
// same stage the cockpit shows. Product-only items are NOT here (they're in Ship).
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { PageHeader, Chip, Banner, ConfirmDialog } from "@/components/ui";
import { GTM_STAGES, deriveGtmStage, type GtmStage } from "@/lib/buildStage";

type Item = { id: string; title: string; kind: string | null; scope: string; assignee_id: string | null };
type Task = { initiative_id: string | null; stage: string; content_type: string | null };

const SCOPE_LABEL: Record<string, string> = { gtm: "GTM", both: "Product + GTM" };
const KIND_LABEL: Record<string, string> = { bugfix: "Fix", enhancement: "Enhancement", feature: "New Feature", module: "New Module", product: "Product" };

export default function EnablementBoard() {
  const supabase = createClient();
  const [items, setItems] = useState<Item[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [delId, setDelId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: it }, { data: tk }, { data: p }] = await Promise.all([
      supabase.from("initiatives").select("id, title, kind, scope, assignee_id").is("parent_id", null).in("scope", ["gtm", "both"]).order("created_at", { ascending: false }),
      supabase.from("initiative_workstreams").select("initiative_id, stage, content_type").eq("area", "gtm"),
      supabase.from("people").select("id, name"),
    ]);
    setItems((it ?? []) as Item[]); setTasks((tk ?? []) as Task[]); setPeople(p ?? []); setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const owner = (id: string | null) => people.find((p) => p.id === id)?.name ?? null;
  const derived = useMemo(() => {
    const m = new Map<string, { stage: GtmStage; done: number; total: number }>();
    for (const it of items) {
      const t = tasks.filter((x) => x.initiative_id === it.id);
      m.set(it.id, { stage: deriveGtmStage(t), done: t.filter((x) => x.stage === "done").length, total: t.length });
    }
    return m;
  }, [items, tasks]);

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return; setError(null);
    const orgId = await getOrgId(); if (!orgId) { setError("Could not resolve your organization."); return; }
    const { error } = await supabase.from("initiatives").insert({ org_id: orgId, lane: "enablement", scope: "gtm", lifecycle: "plan", stage: "active", priority: "high", title: title.trim() });
    if (error) { setError(error.message); return; } setAdding(false); setTitle(""); load();
  }

  return (
    <div>
      <PageHeader title="Go-to-market" meta="The GTM workflow. Each card sits in the stage its real content work puts it in — open one to do that stage's work."
        actions={!adding ? <button className="btn" onClick={() => setAdding(true)}>+ GTM item</button> : undefined} />
      <Banner>{error}</Banner>

      {adding && (
        <form onSubmit={addItem} className="card card-pad" style={{ marginBottom: "var(--sp-5)" }}>
          <label className="field"><span className="t-label">What are you taking to market?</span><input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Pricing page refresh launch" /></label>
          <div className="row gap-2"><button className="btn btn-sm" type="submit">Create</button><button className="btn btn-secondary btn-sm" type="button" onClick={() => setAdding(false)}>Cancel</button></div>
        </form>
      )}

      {loading ? <div className="t-sub t-muted">Loading…</div> : items.length === 0 && !adding ? (
        <div className="empty">
          <div className="t-body" style={{ fontWeight: 600, marginBottom: 6 }}>No GTM items yet</div>
          <div className="t-sub" style={{ maxWidth: 480, marginInline: "auto" }}>GTM items arrive when a build ships with a GTM side, or create a standalone one here.</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--sp-4)", alignItems: "start" }}>
          {GTM_STAGES.map((st) => {
            const col = items.filter((it) => derived.get(it.id)!.stage === st.key);
            return (
              <div key={st.key}>
                <div className="t-label" style={{ marginBottom: 2 }}>{st.label} · {col.length}</div>
                <div className="t-sub t-muted" style={{ fontSize: 11, marginBottom: "var(--sp-3)" }}>{st.blurb}</div>
                <div className="stack-3">
                  {col.length === 0 && <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>—</div>}
                  {col.map((it) => {
                    const d = derived.get(it.id)!;
                    return (
                      <div key={it.id} className="card card-pad" style={{ borderLeft: "3px solid var(--vl)" }}>
                        <a href={`/initiatives/${it.id}?from=enablement`} title="Open the GTM item" style={{ display: "block", fontSize: 13.5, fontWeight: 640, marginBottom: 8, color: "var(--tp)", textDecoration: "none" }} onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")} onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}>{it.title}</a>
                        <div className="row gap-2" style={{ flexWrap: "wrap", marginBottom: 6 }}>
                          {it.kind && <Chip>{KIND_LABEL[it.kind] ?? it.kind}</Chip>}
                          <Chip tone="violet">{SCOPE_LABEL[it.scope] ?? it.scope}</Chip>
                          {owner(it.assignee_id) ? <Chip tone="green">{owner(it.assignee_id)}</Chip> : <Chip tone="amber">unowned</Chip>}
                        </div>
                        <div className="row-between" style={{ alignItems: "center" }}>
                          <span className="t-mono-xs" style={{ color: "var(--vl-text)" }}>Content {d.done}/{d.total}</span>
                          <button className="btn btn-secondary btn-sm" title="Delete" onClick={() => setDelId(it.id)} style={{ color: "var(--rd-text)" }}>✕</button>
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

      {delId && (
        <ConfirmDialog title="Delete GTM item?" message="This removes the item and its content tasks. This can't be undone." confirmLabel="Delete"
          onConfirm={async () => { const id = delId; setDelId(null); setError(null); const { error } = await supabase.from("initiatives").delete().eq("id", id); if (error) setError(error.message); await load(); }}
          onCancel={() => setDelId(null)} />
      )}
    </div>
  );
}
