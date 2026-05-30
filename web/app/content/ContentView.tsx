"use client";

// Content (consolidates Recording Studio) — in-module sub-tabs:
//   • Thought leadership — articles/POV pieces.
//   • Product content    — docs, one-pagers, feature content.
//   • Videos             — the big one: video projects with a Descript flow
//     (hook → script → prompts → produce), drafted from GTM + product info.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { PageHeader, Section, Chip, Banner, SubTabs } from "@/components/ui";

type Kind = "thought_leadership" | "product_content" | "video";
type Piece = { id: string; kind: string; title: string; status: string; body: string | null; gtm_record_id: string | null; product_id: string | null; video: VideoFlow | null };
type VideoFlow = { hook?: string; script?: string; prompts?: string[]; descript_steps?: string[] };
type Rec = { id: string; name: string };

const STATUS_TONE: Record<string, "default" | "violet" | "green"> = { draft: "default", in_review: "violet", published: "green" };

export default function ContentView() {
  const supabase = createClient();
  const [tab, setTab] = useState<Kind>("thought_leadership");
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [products, setProducts] = useState<Rec[]>([]);
  const [gtm, setGtm] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [openVideo, setOpenVideo] = useState<Piece | null>(null);

  const load = useCallback(async () => {
    const [{ data: ps }, { data: prods }, { data: gtms }] = await Promise.all([
      supabase.from("content_pieces").select("id, kind, title, status, body, gtm_record_id, product_id, video").order("created_at", { ascending: false }),
      supabase.from("product_records").select("id, name"),
      supabase.from("gtm_records").select("id, name"),
    ]);
    setPieces(ps ?? []); setProducts(prods ?? []); setGtm(gtms ?? []); setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault(); if (!title.trim()) return;
    setBusy(true); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      const video = tab === "video" ? { hook: "", script: "", prompts: [], descript_steps: [] } : null;
      const { data, error } = await supabase.from("content_pieces").insert({ org_id: orgId, kind: tab, title: title.trim(), status: "draft", video }).select("*").single();
      if (error) throw error;
      setCreating(false); setTitle(""); await load();
      if (tab === "video" && data) setOpenVideo(data as Piece);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create."); }
    finally { setBusy(false); }
  }
  async function remove(id: string) { setError(null); await supabase.from("content_pieces").delete().eq("id", id); await load(); }

  const list = pieces.filter((p) => p.kind === tab);
  const TABS = [{ key: "thought_leadership" as Kind, label: "Thought leadership" }, { key: "product_content" as Kind, label: "Product content" }, { key: "video" as Kind, label: "Videos" }];

  return (
    <div>
      <PageHeader title="Content" meta="Thought leadership, product content, and videos — drafted from your GTM & product records." actions={!creating ? <button className="btn" onClick={() => setCreating(true)}>+ New {tab === "video" ? "video" : "piece"}</button> : undefined} />
      <Banner>{error}</Banner>
      <SubTabs<Kind> tabs={TABS} active={tab} onChange={(k) => { setTab(k); setCreating(false); }} />

      {creating && (
        <form onSubmit={create} className="card card-pad" style={{ marginBottom: "var(--sp-5)" }}>
          <label className="field"><span className="t-label">Title</span><input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tab === "video" ? "e.g. 90s explainer — explainable AI" : "Title"} /></label>
          <div className="row gap-2"><button className="btn" type="submit" disabled={busy}>{busy ? "Creating…" : "Create"}</button><button className="btn btn-secondary" type="button" onClick={() => setCreating(false)}>Cancel</button></div>
        </form>
      )}

      {loading ? <div className="t-sub t-muted">Loading…</div> : list.length === 0 && !creating ? (
        <div className="empty"><div className="t-body" style={{ fontWeight: 600, marginBottom: 6 }}>Nothing here yet</div><div className="t-sub">{tab === "video" ? "Create a video project — build the script and Descript flow from your product & GTM info." : "Create your first piece."}</div></div>
      ) : (
        <div className="grid-cards">
          {list.map((p) => (
            <div key={p.id} className="card card-pad">
              <div className="row-between" style={{ alignItems: "flex-start", marginBottom: 8 }}>
                <span style={{ fontSize: 14.5, fontWeight: 620, lineHeight: 1.3 }}>{p.title}</span>
                <button className="t-muted" onClick={() => remove(p.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15 }}>×</button>
              </div>
              <div className="row gap-2" style={{ marginBottom: 10 }}><Chip tone={STATUS_TONE[p.status]}>{p.status.replace("_", " ")}</Chip>{p.kind === "video" && <Chip tone="violet">🎬 Descript flow</Chip>}</div>
              {tab === "video" ? <button className="btn btn-secondary btn-sm" onClick={() => setOpenVideo(p)}>Open studio →</button> : <PieceEditor piece={p} reload={load} />}
            </div>
          ))}
        </div>
      )}

      {openVideo && <VideoStudio piece={openVideo} products={products} gtm={gtm} onClose={() => setOpenVideo(null)} reload={load} />}
    </div>
  );
}

// Inline editor for article/product content
function PieceEditor({ piece, reload }: { piece: Piece; reload: () => void }) {
  const supabase = createClient();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(piece.body ?? "");
  async function save() { await supabase.from("content_pieces").update({ body }).eq("id", piece.id); setEditing(false); reload(); }
  if (!editing) return <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(true); setBody(piece.body ?? ""); }}>{piece.body ? "Edit" : "Write"}</button>;
  return (
    <div>
      <textarea className="textarea" rows={4} autoFocus value={body} onChange={(e) => setBody(e.target.value)} style={{ marginBottom: 8 }} />
      <div className="row gap-2"><button className="btn btn-sm" onClick={save}>Save</button><button className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}>Cancel</button></div>
    </div>
  );
}

// Video studio — the Descript flow: hook → script → prompts → produce.
function VideoStudio({ piece, products, gtm, onClose, reload }: { piece: Piece; products: Rec[]; gtm: Rec[]; onClose: () => void; reload: () => void }) {
  const supabase = createClient();
  const [flow, setFlow] = useState<VideoFlow>(piece.video ?? { hook: "", script: "", prompts: [], descript_steps: [] });
  const [recordId, setRecordId] = useState(piece.gtm_record_id ?? piece.product_id ?? "");
  const [saving, setSaving] = useState(false);
  const [newPrompt, setNewPrompt] = useState("");

  async function save() {
    setSaving(true);
    await supabase.from("content_pieces").update({ video: flow }).eq("id", piece.id);
    setSaving(false); reload();
  }
  const addPrompt = () => { if (!newPrompt.trim()) return; setFlow({ ...flow, prompts: [...(flow.prompts ?? []), newPrompt.trim()] }); setNewPrompt(""); };
  const removePrompt = (i: number) => setFlow({ ...flow, prompts: (flow.prompts ?? []).filter((_, x) => x !== i) });

  const STARTER_STEPS = ["Import script to Descript", "Record/generate voiceover", "Add B-roll & screen capture", "Auto-caption & trim filler words", "Export & publish"];

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(11,12,14,0.32)", zIndex: 40 }} />
      <aside style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: 560, maxWidth: "94vw", background: "var(--panel)", borderLeft: "1px solid var(--border)", boxShadow: "var(--shadow-md)", zIndex: 41, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--border)" }} className="row-between">
          <div className="row gap-2"><Chip tone="violet">🎬 Video studio</Chip><span style={{ fontSize: 15, fontWeight: 640 }}>{piece.title}</span></div>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Close</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px" }}>
          <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 14 }}>Build the video from your product & GTM info, then run the Descript flow. (AI drafting of the hook/script from the linked record arrives with the agent runtime.)</div>

          <label className="field"><span className="t-label">Source record (product or GTM)</span>
            <select className="select" value={recordId} onChange={async (e) => { setRecordId(e.target.value); }}>
              <option value="">— none —</option>
              <optgroup label="Products">{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
              <optgroup label="GTM records">{gtm.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</optgroup>
            </select>
          </label>

          <label className="field"><span className="t-label">Hook</span><textarea className="textarea" rows={2} value={flow.hook ?? ""} onChange={(e) => setFlow({ ...flow, hook: e.target.value })} placeholder="The opening that earns the next 5 seconds." /></label>
          <label className="field"><span className="t-label">Script</span><textarea className="textarea" rows={6} value={flow.script ?? ""} onChange={(e) => setFlow({ ...flow, script: e.target.value })} placeholder="The full script / talk track." /></label>

          <div className="field">
            <span className="t-label">Shot / prompt list</span>
            <div className="stack-3" style={{ marginTop: 6, marginBottom: 8 }}>
              {(flow.prompts ?? []).map((p, i) => (
                <div key={i} className="card" style={{ padding: "8px 12px" }}>
                  <div className="row-between"><span className="t-sub" style={{ fontSize: 13 }}>{i + 1}. {p}</span><button className="t-muted" onClick={() => removePrompt(i)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14 }}>×</button></div>
                </div>
              ))}
            </div>
            <div className="row gap-2"><input className="input" value={newPrompt} onChange={(e) => setNewPrompt(e.target.value)} placeholder="Add a shot or prompt" style={{ flex: 1 }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPrompt(); } }} /><button className="btn btn-sm" onClick={addPrompt}>Add</button></div>
          </div>

          <div className="field">
            <span className="t-label">Descript flow</span>
            <div className="stack-3" style={{ marginTop: 6 }}>
              {(flow.descript_steps && flow.descript_steps.length ? flow.descript_steps : STARTER_STEPS).map((s, i) => (
                <div key={i} className="card" style={{ padding: "9px 12px" }}>
                  <div className="row gap-2"><span style={{ width: 20, height: 20, borderRadius: 999, background: "var(--vl-fill)", color: "var(--vl-text)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{i + 1}</span><span className="t-sub" style={{ fontSize: 13 }}>{s}</span></div>
                </div>
              ))}
            </div>
            {(!flow.descript_steps || !flow.descript_steps.length) && <button className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={() => setFlow({ ...flow, descript_steps: STARTER_STEPS })}>Use this flow</button>}
          </div>
        </div>
        <div style={{ padding: "12px 18px", borderTop: "1px solid var(--border)" }} className="row gap-2">
          <button className="btn" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
          <a className="btn btn-secondary" href="https://www.descript.com" target="_blank" rel="noreferrer">Open Descript ↗</a>
        </div>
      </aside>
    </>
  );
}
