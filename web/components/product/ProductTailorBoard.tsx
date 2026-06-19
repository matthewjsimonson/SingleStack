"use client";

// Product Tailor — the middle step of the PRODUCT workflow. Take a ratified (or
// draft) SPEC (product_specs) and produce downstream BUILD work from it,
// organized by area via PLAYBOOKS (spec-driven / prototype / technical /
// validation). Each playbook's `key` becomes the item's content_type; its `setup`
// is the step-by-step guide shown in the editor. Produced items are
// initiative_workstreams { area:'build', spec_id: spec.id } — they carry NO
// release yet (that's chosen in Assign). Mirrors gtm/TailorBoard.tsx.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Chip, Banner, Section, Empty } from "@/components/ui";
import { Modal } from "@/components/ui";
import {
  PRODUCT_AREAS, PRODUCT_PLAYBOOKS, PLAYBOOK_BY_KEY, areaForContentType,
  type ProductPlaybook, type ProductPlaybookArea,
} from "@/lib/productPlaybooks";

type Spec = { id: string; theme_id: string | null; title: string | null; body: string | null; status: string; updated_at: string | null; org_id: string | null };
type Theme = { id: string; title: string };
type Item = { id: string; title: string; stage: string; content_type: string | null; body: string | null; spec_id: string | null };

const STATUS_TONE: Record<string, "default" | "violet" | "green"> = { draft: "default", ratified: "violet", live: "green" };
const STAGE_TONE: Record<string, "default" | "violet" | "green"> = { backlog: "default", active: "violet", done: "green" };
const STAGE_LABEL: Record<string, string> = { backlog: "Backlog", active: "Active", done: "Done" };

export default function ProductTailorBoard() {
  const supabase = createClient();
  const [specs, setSpecs] = useState<Spec[]>([]);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [openItem, setOpenItem] = useState<Item | null>(null);

  // Load specs (+ themes for labels). Prefer ratified specs first (the ones build
  // work should be tailored from), then drafts, by recency.
  const loadSpecs = useCallback(async () => {
    const [{ data: s }, { data: th }] = await Promise.all([
      supabase.from("product_specs").select("id, theme_id, title, body, status, updated_at, org_id").order("updated_at", { ascending: false }),
      supabase.from("signal_themes").select("id, title").order("created_at"),
    ]);
    const rank = (st: string) => (st === "ratified" || st === "live" ? 0 : 1);
    const list = ((s ?? []) as Spec[]).sort((a, b) => rank(a.status) - rank(b.status));
    setSpecs(list); setThemes((th ?? []) as Theme[]);
    setSelectedId((prev) => prev || list[0]?.id || "");
    setLoading(false);
  }, [supabase]);
  useEffect(() => { loadSpecs(); }, [loadSpecs]);

  const selected = specs.find((s) => s.id === selectedId) || null;

  const specLabel = useCallback((s: Spec | null): string => {
    if (!s) return "";
    if (s.title) return s.title;
    if (s.theme_id) { const t = themes.find((x) => x.id === s.theme_id); return t ? t.title : "Theme spec"; }
    return "Untitled spec";
  }, [themes]);

  // Items produced from the selected spec — by its spec_id, build area.
  const loadItems = useCallback(async (specId: string | null) => {
    if (!specId) { setItems([]); return; }
    const { data } = await supabase.from("initiative_workstreams")
      .select("id, title, stage, content_type, body, spec_id")
      .eq("area", "build").eq("spec_id", specId).order("created_at", { ascending: false });
    setItems((data ?? []) as Item[]);
  }, [supabase]);
  useEffect(() => { loadItems(selected?.id ?? null); }, [loadItems, selected?.id]);

  async function start(playbook: ProductPlaybook) {
    if (!selected) return;
    setBusyKey(playbook.key); setError(null);
    try {
      const orgId = selected.org_id ?? (await getOrgId());
      if (!orgId) throw new Error("Could not resolve your organization.");
      const { data, error } = await supabase.from("initiative_workstreams").insert({
        org_id: orgId, area: "build", title: `${playbook.name} — ${specLabel(selected)}`,
        content_type: playbook.key, spec_id: selected.id, lifecycle_stage: "plan", body: "",
      }).select("id, title, stage, content_type, body, spec_id").single();
      if (error) throw error;
      await loadItems(selected.id);
      if (data) setOpenItem(data as Item);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create the item."); }
    finally { setBusyKey(null); }
  }

  // Group already-produced items by their playbook area.
  const itemsByArea: Record<ProductPlaybookArea, Item[]> = { spec: [], prototype: [], technical: [], validation: [] };
  for (const it of items) itemsByArea[areaForContentType(it.content_type)].push(it);

  return (
    <div>
      <Banner>{error}</Banner>

      {/* Spec selector */}
      <Section label="Spec to tailor">
        {loading ? <div className="t-sub t-muted">Loading…</div> : specs.length === 0 ? (
          <Empty title="No specs yet" hint="Produce a spec in Review first — tailoring works from a ratified spec." />
        ) : (
          <div className="card card-pad">
            <label className="field" style={{ marginBottom: selected ? 12 : 0 }}>
              <span className="t-label">Spec</span>
              <select className="select" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
                {specs.map((s) => <option key={s.id} value={s.id}>{specLabel(s)} · {s.status}</option>)}
              </select>
            </label>
            {selected && (
              <div>
                <div className="row gap-2" style={{ alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 14.5, fontWeight: 640 }}>{specLabel(selected)}</span>
                  <Chip tone={STATUS_TONE[selected.status] ?? "default"}>{selected.status}</Chip>
                  {selected.status === "draft" && <Chip tone="amber">Draft — ratify in Review to lock</Chip>}
                </div>
                {selected.body && <div className="t-sub" style={{ fontSize: 12.5, color: "var(--tm)", lineHeight: 1.5 }}>{snippet(selected.body)}</div>}
              </div>
            )}
          </div>
        )}
      </Section>

      {selected && (
        <>
          {/* Per-area playbook board */}
          {PRODUCT_AREAS.map((area) => {
            const plays = PRODUCT_PLAYBOOKS.filter((p) => p.area === area.id);
            const made = itemsByArea[area.id];
            return (
              <Section key={area.id} label={`${area.label}`}>
                <div className="grid-cards" style={{ marginBottom: made.length ? "var(--sp-4)" : 0 }}>
                  {plays.map((p) => (
                    <div key={p.key} className="card card-pad">
                      <div style={{ fontSize: 14, fontWeight: 640, marginBottom: 4 }}>{p.name}</div>
                      <div className="t-sub" style={{ fontSize: 12.5, color: "var(--tm)", lineHeight: 1.45, marginBottom: 12 }}>{p.purpose}</div>
                      <button className="btn btn-secondary btn-sm" disabled={busyKey === p.key} onClick={() => start(p)}>{busyKey === p.key ? "Starting…" : "Start"}</button>
                    </div>
                  ))}
                </div>
                {made.length > 0 && (
                  <div className="stack-3">
                    <div className="t-label" style={{ marginBottom: 4 }}>Produced</div>
                    {made.map((it) => (
                      <button key={it.id} className="card card-pad" onClick={() => setOpenItem(it)}
                        style={{ display: "flex", width: "100%", textAlign: "left", alignItems: "center", justifyContent: "space-between", cursor: "pointer", gap: 12 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{it.title}</span>
                        <Chip tone={STAGE_TONE[it.stage] ?? "default"}>{STAGE_LABEL[it.stage] ?? it.stage}</Chip>
                      </button>
                    ))}
                  </div>
                )}
              </Section>
            );
          })}
        </>
      )}

      {openItem && (
        <ItemEditor
          item={openItem}
          onClose={() => setOpenItem(null)}
          onSaved={async () => { await loadItems(selected?.id ?? null); }}
        />
      )}
    </div>
  );
}

function snippet(body: string): string {
  const text = body.replace(/[#*_>`-]/g, " ").replace(/\s+/g, " ").trim();
  return text.length > 220 ? text.slice(0, 220) + "…" : text;
}

// Item editor — a Modal showing the playbook's SETUP as a numbered guide, a body
// textarea (plain, no TipTap for v1), plus a stage advance. Save updates the row
// by id. Mirrors gtm/TailorBoard's ItemEditor (no video branch — build work
// carries no Descript flow).
function ItemEditor({ item, onClose, onSaved }: { item: Item; onClose: () => void; onSaved: () => Promise<void> }) {
  const supabase = createClient();
  const playbook: ProductPlaybook | undefined = item.content_type ? PLAYBOOK_BY_KEY[item.content_type] : undefined;
  const [body, setBody] = useState(item.body ?? "");
  const [stage, setStage] = useState(item.stage);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true); setErr(null);
    try {
      const { error } = await supabase.from("initiative_workstreams").update({ body, stage }).eq("id", item.id);
      if (error) throw error;
      await onSaved();
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not save."); setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title={item.title} width={680}>
      <Banner>{err}</Banner>

      {playbook && (
        <div className="field">
          <span className="t-label">Setup</span>
          <div className="stack-3" style={{ marginTop: 6 }}>
            {playbook.setup.map((s, i) => (
              <div key={i} className="card" style={{ padding: "9px 12px" }}>
                <div className="row gap-2" style={{ alignItems: "center" }}>
                  <span style={{ width: 20, height: 20, borderRadius: 999, background: "var(--vl-fill)", color: "var(--vl-text)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{i + 1}</span>
                  <span className="t-sub" style={{ fontSize: 13 }}>{s}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <label className="field"><span className="t-label">Body</span><textarea className="textarea" rows={10} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Produce the artifact here, following the setup above." /></label>

      <div className="row-between" style={{ marginTop: "var(--sp-4)", alignItems: "flex-end" }}>
        <label className="field" style={{ marginBottom: 0 }}>
          <span className="t-label">Stage</span>
          <select className="select" value={stage} onChange={(e) => setStage(e.target.value)}>
            <option value="backlog">Backlog</option>
            <option value="active">Active</option>
            <option value="done">Done</option>
          </select>
        </label>
        <div className="row gap-2">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </Modal>
  );
}
