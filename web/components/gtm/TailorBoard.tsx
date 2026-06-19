"use client";

// Tailor — the middle step. Take a messaging BRIEF (messaging_artifacts) and
// produce downstream GTM items from it, organized by area via PLAYBOOKS. Each
// playbook's `key` becomes the item's content_type; its `setup` is the
// step-by-step guide shown in the editor. Produced items are
// initiative_workstreams { area:'gtm', release_id: brief.release_id }.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Chip, Banner, Section, Empty } from "@/components/ui";
import { Modal } from "@/components/ui";
import {
  GTM_AREAS, GTM_PLAYBOOKS, PLAYBOOK_BY_KEY, areaForContentType,
  type GtmPlaybook, type GtmPlaybookArea,
} from "@/lib/gtmPlaybooks";

type Brief = { id: string; release_id: string | null; theme_id: string | null; title: string | null; body: string | null; status: string; updated_at: string | null; org_id: string | null };
type Named = { id: string; name: string; version?: string | null };
type Theme = { id: string; title: string };
type VideoFlow = { hook?: string; script?: string; prompts?: string[]; descript_steps?: string[] };
type Item = { id: string; title: string; stage: string; content_type: string | null; body: string | null; details: VideoFlow | null; release_id: string | null };

const STATUS_TONE: Record<string, "default" | "violet" | "green"> = { draft: "default", ratified: "violet", live: "green" };
const STAGE_TONE: Record<string, "default" | "violet" | "green"> = { backlog: "default", active: "violet", done: "green" };
const STAGE_LABEL: Record<string, string> = { backlog: "Backlog", active: "Active", done: "Done" };

export default function TailorBoard() {
  const supabase = createClient();
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [releases, setReleases] = useState<Named[]>([]);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [openItem, setOpenItem] = useState<Item | null>(null);

  const loadBriefs = useCallback(async () => {
    const [{ data: b }, { data: rel }, { data: th }] = await Promise.all([
      supabase.from("messaging_artifacts").select("id, release_id, theme_id, title, body, status, updated_at, org_id").order("updated_at", { ascending: false }),
      supabase.from("releases").select("id, name, version").order("created_at"),
      supabase.from("signal_themes").select("id, title").order("created_at"),
    ]);
    const list = (b ?? []) as Brief[];
    setBriefs(list); setReleases((rel ?? []) as Named[]); setThemes((th ?? []) as Theme[]);
    setSelectedId((prev) => prev || list[0]?.id || "");
    setLoading(false);
  }, [supabase]);
  useEffect(() => { loadBriefs(); }, [loadBriefs]);

  const selected = briefs.find((b) => b.id === selectedId) || null;

  const briefLabel = useCallback((b: Brief | null): string => {
    if (!b) return "";
    if (b.title) return b.title;
    if (b.release_id) { const r = releases.find((x) => x.id === b.release_id); return r ? (r.version ? `${r.version} · ${r.name}` : r.name) : "Release brief"; }
    if (b.theme_id) { const t = themes.find((x) => x.id === b.theme_id); return t ? t.title : "Theme brief"; }
    return "Untitled brief";
  }, [releases, themes]);

  // Items produced from the selected brief — by its release_id, GTM area.
  const loadItems = useCallback(async (relId: string | null) => {
    if (!relId) { setItems([]); return; }
    const { data } = await supabase.from("initiative_workstreams")
      .select("id, title, stage, content_type, body, details, release_id")
      .eq("area", "gtm").eq("release_id", relId).order("created_at", { ascending: false });
    setItems((data ?? []) as Item[]);
  }, [supabase]);
  useEffect(() => { loadItems(selected?.release_id ?? null); }, [loadItems, selected?.release_id]);

  async function start(playbook: GtmPlaybook) {
    if (!selected) return;
    if (!selected.release_id) { setError("This brief has no release. Tailoring produces release-scoped items, so pick a release-backed brief."); return; }
    setBusyKey(playbook.key); setError(null);
    try {
      const orgId = selected.org_id ?? (await getOrgId());
      if (!orgId) throw new Error("Could not resolve your organization.");
      const details = playbook.isVideo ? { hook: "", script: "", prompts: [], descript_steps: [] } : null;
      const { data, error } = await supabase.from("initiative_workstreams").insert({
        org_id: orgId, area: "gtm", title: `${playbook.name} — ${briefLabel(selected)}`,
        content_type: playbook.key, release_id: selected.release_id, lifecycle_stage: "launch", body: "", details,
      }).select("id, title, stage, content_type, body, details, release_id").single();
      if (error) throw error;
      await loadItems(selected.release_id);
      if (data) setOpenItem(data as Item);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create the item."); }
    finally { setBusyKey(null); }
  }

  // Group already-produced items by their playbook area.
  const itemsByArea: Record<GtmPlaybookArea, Item[]> = { content: [], video: [], enablement: [], competitive: [] };
  for (const it of items) itemsByArea[areaForContentType(it.content_type)].push(it);

  return (
    <div>
      <Banner>{error}</Banner>

      {/* Brief selector */}
      <Section label="Brief to tailor">
        {loading ? <div className="t-sub t-muted">Loading…</div> : briefs.length === 0 ? (
          <Empty title="No briefs yet" hint="Produce a messaging brief in Review first — tailoring works from a brief." />
        ) : (
          <div className="card card-pad">
            <label className="field" style={{ marginBottom: selected ? 12 : 0 }}>
              <span className="t-label">Brief</span>
              <select className="select" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
                {briefs.map((b) => <option key={b.id} value={b.id}>{briefLabel(b)} · {b.status}</option>)}
              </select>
            </label>
            {selected && (
              <div>
                <div className="row gap-2" style={{ alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 14.5, fontWeight: 640 }}>{briefLabel(selected)}</span>
                  <Chip tone={STATUS_TONE[selected.status] ?? "default"}>{selected.status}</Chip>
                  {!selected.release_id && <Chip tone="amber">No release</Chip>}
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
          {GTM_AREAS.map((area) => {
            const plays = GTM_PLAYBOOKS.filter((p) => p.area === area.id);
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
          onSaved={async () => { await loadItems(selected?.release_id ?? null); }}
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
// textarea (plain, no TipTap for v1), video details for isVideo playbooks, plus
// a stage advance. Save updates the row by id.
function ItemEditor({ item, onClose, onSaved }: { item: Item; onClose: () => void; onSaved: () => Promise<void> }) {
  const supabase = createClient();
  const playbook: GtmPlaybook | undefined = item.content_type ? PLAYBOOK_BY_KEY[item.content_type] : undefined;
  const isVideo = !!playbook?.isVideo;
  const [body, setBody] = useState(item.body ?? "");
  const [stage, setStage] = useState(item.stage);
  const [flow, setFlow] = useState<VideoFlow>(item.details ?? { hook: "", script: "", prompts: [], descript_steps: [] });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true); setErr(null);
    try {
      const fields: Record<string, unknown> = { body, stage };
      if (isVideo) fields.details = flow;
      const { error } = await supabase.from("initiative_workstreams").update(fields).eq("id", item.id);
      if (error) throw error;
      await onSaved();
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not save."); setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title={<span className="row gap-2" style={{ alignItems: "center" }}>{isVideo && <Chip tone="violet">Video</Chip>}{item.title}</span>} width={680}>
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

      {isVideo ? (
        <>
          <label className="field"><span className="t-label">Hook</span><textarea className="textarea" rows={2} value={flow.hook ?? ""} onChange={(e) => setFlow({ ...flow, hook: e.target.value })} placeholder="The opening that earns the next 5 seconds." /></label>
          <label className="field"><span className="t-label">Script</span><textarea className="textarea" rows={6} value={flow.script ?? ""} onChange={(e) => setFlow({ ...flow, script: e.target.value })} placeholder="The full script / talk track." /></label>
          <label className="field"><span className="t-label">Shots / prompts (one per line)</span><textarea className="textarea" rows={4} value={(flow.prompts ?? []).join("\n")} onChange={(e) => setFlow({ ...flow, prompts: splitLines(e.target.value) })} placeholder="One shot or prompt per line" /></label>
          <label className="field"><span className="t-label">Descript steps (one per line)</span><textarea className="textarea" rows={4} value={(flow.descript_steps ?? []).join("\n")} onChange={(e) => setFlow({ ...flow, descript_steps: splitLines(e.target.value) })} placeholder="One step per line" /></label>
        </>
      ) : (
        <label className="field"><span className="t-label">Body</span><textarea className="textarea" rows={10} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Produce the artifact here, following the setup above." /></label>
      )}

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

function splitLines(v: string): string[] {
  return v.split("\n").map((l) => l.trim()).filter(Boolean);
}
