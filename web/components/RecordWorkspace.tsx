"use client";

// Shared working surface for both record types: run agents, structured field
// content (delegated to SectionedFields), and proposals to review/accept.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Section, Chip, Banner, Modal } from "@/components/ui";
import SectionedFields from "@/components/SectionedFields";
import RecordAdvisors from "@/components/RecordAdvisors";

export type Target = { kind: "product" | "gtm"; id: string };

type Agent = { id: string; key: string; name: string; role: string | null };
type Proposal = {
  id: string; title: string; rationale: string | null; conf_label: string | null;
  conf_level: number | null; proposed_by: string; status: string; created_at: string;
};

const fkCol = (t: Target) => (t.kind === "product" ? "product_id" : "gtm_record_id");

export default function RecordWorkspace({ target, recordName }: { target: Target; recordName?: string }) {
  const supabase = createClient();
  const fk = fkCol(target);

  const [agents, setAgents] = useState<Agent[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fieldsNonce, setFieldsNonce] = useState(0); // bump to refresh SectionedFields after accept
  // "Set up with AI" — import existing content into the review queue.
  const [imp, setImp] = useState(false);
  const [src, setSrc] = useState({ mode: "paste" as "paste" | "url", content: "", url: "", guidance: "" });
  const [importing, setImporting] = useState(false);
  const [impNote, setImpNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [{ data: ags }, { data: props }] = await Promise.all([
      supabase.from("agents").select("id, key, name, role").eq("is_active", true).order("name"),
      supabase.from("proposals").select("id, title, rationale, conf_label, conf_level, proposed_by, status, created_at").eq(fk, target.id).order("created_at", { ascending: false }),
    ]);
    setAgents(ags ?? []);
    setProposals(props ?? []);
    setLoading(false);
  }, [supabase, fk, target.id]);

  useEffect(() => { load(); }, [load]);

  // Drawer actions (accept / reject / hide) call this: refresh proposal counts and,
  // since an accept changes field values, re-mount the content panels.
  const refresh = useCallback(() => { load(); setFieldsNonce((n) => n + 1); }, [load]);

  async function runImport() {
    const hasInput = src.mode === "url" ? src.url.trim() : src.content.trim();
    if (!hasInput) { setError(src.mode === "url" ? "Enter a public URL." : "Paste some content."); return; }
    setImporting(true); setError(null); setImpNote(null);
    try {
      const body: Record<string, unknown> = target.kind === "product" ? { product_id: target.id } : { gtm_record_id: target.id };
      if (src.mode === "url") body.url = src.url.trim(); else body.content = src.content.trim();
      if (src.guidance.trim()) body.guidance = src.guidance.trim();
      const { data, error } = await supabase.functions.invoke("import-record", { body });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (!data?.changes_saved) {
        setImpNote(data?.message || "Nothing groundable was found to propose — try a richer source.");
      } else {
        setImpNote(`Proposed ${data.changes_saved} field${data.changes_saved === 1 ? "" : "s"} — review them in Advisors (the “waiting” pill).`);
        setSrc({ mode: src.mode, content: "", url: "", guidance: "" });
        refresh();
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Import failed."); }
    finally { setImporting(false); }
  }

  const pending = proposals.filter((p) => p.status === "pending");
  const resolved = proposals.filter((p) => p.status !== "pending");
  const pendingByName = pending.reduce<Record<string, number>>((acc, p) => { acc[p.proposed_by] = (acc[p.proposed_by] ?? 0) + 1; return acc; }, {});

  return (
    <div>
      <Banner>{error}</Banner>

      {/* Set up with AI — import existing content into the review queue */}
      <div className="card card-pad row-between" style={{ marginBottom: "var(--sp-4)", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 640, fontSize: 13.5 }}>Set up with AI</div>
          <div className="t-sub t-muted" style={{ fontSize: 12.5, marginTop: 2 }}>Already have this written down? Import a doc or a public URL — AI drafts fields into your review queue; you accept what&rsquo;s right.</div>
        </div>
        <button className="btn btn-sm" onClick={() => { setImpNote(null); setImp(true); }} style={{ background: "var(--ac)", color: "#fff", flexShrink: 0 }}>Set up with AI</button>
      </div>

      <Modal open={imp} onClose={() => setImp(false)} title="Set up this record with AI" width={620}>
        <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>Paste content you already have (a brief, a doc, your website/positioning copy) or point at a public URL. AI proposes fields into your <strong>review queue</strong> — nothing is applied until you accept it. Imported content is treated as untrusted and screened.</div>
        <div className="row gap-2" style={{ marginBottom: 10 }}>
          <button type="button" className={`btn btn-sm ${src.mode === "paste" ? "" : "btn-secondary"}`} onClick={() => setSrc({ ...src, mode: "paste" })}>Paste text</button>
          <button type="button" className={`btn btn-sm ${src.mode === "url" ? "" : "btn-secondary"}`} onClick={() => setSrc({ ...src, mode: "url" })}>From a URL</button>
        </div>
        {src.mode === "paste"
          ? <label className="field"><span className="t-label">Source content</span><textarea className="textarea" rows={8} value={src.content} onChange={(e) => setSrc({ ...src, content: e.target.value })} placeholder="Paste your overview, positioning, value prop, ICP — whatever you have." /></label>
          : <label className="field"><span className="t-label">Public URL</span><input className="input" value={src.url} onChange={(e) => setSrc({ ...src, url: e.target.value })} placeholder="https://yourcompany.com/product" /></label>}
        <label className="field"><span className="t-label">Focus <span className="t-muted" style={{ fontWeight: 400 }}>— optional</span></span><input className="input" value={src.guidance} onChange={(e) => setSrc({ ...src, guidance: e.target.value })} placeholder="e.g. emphasize positioning and ICP; ignore pricing" /></label>
        {impNote && <div className="banner" style={{ marginBottom: 12 }}>{impNote}</div>}
        <div className="row gap-2"><button className="btn" disabled={importing} onClick={runImport}>{importing ? "Reading & drafting…" : "Import → review queue"}</button><button className="btn btn-secondary" onClick={() => setImp(false)}>Close</button></div>
      </Modal>

      {/* Advisors — the agents that live on this record, aligned to its area */}
      {loading ? <div className="t-sub t-muted" style={{ marginBottom: "var(--sp-6)" }}>Loading…</div>
        : <RecordAdvisors target={target} recordName={recordName} agents={agents} pendingByName={pendingByName} onRan={refresh} />}

      {/* Structured content */}
      <SectionedFields key={fieldsNonce} target={target} />

      {/* Pending proposals live in the Advisors' side drawer (the "N waiting" pill).
          Only resolved proposals are logged here, as history. */}
      {resolved.length > 0 && (
        <Section label="History">
          <div className="stack-3">
            {resolved.map((p) => (
              <div key={p.id} className="card" style={{ padding: "12px 16px" }}>
                <div className="row-between">
                  <span className="t-body">{p.title}</span>
                  <Chip tone={p.status === "accepted" ? "green" : "default"}>{p.status}</Chip>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
