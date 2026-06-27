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

import RecordRefine from "@/components/RecordRefine";

// "Make it full & current" runs as ONE edge call that returns when the whole
// sweep is done — there are no server-sent progress events. So this is an honest
// CLIENT-SIDE estimate: staged phases + an eased bar that approaches (never
// reaches) 100% on a typical-duration curve, then snaps to done when the call
// actually returns. The ETA is labelled "~" and gracefully holds if it overruns.
const SWEEP_PHASES = [
  "Reading the whole record",
  "Reading modules & features",
  "Reading your signals",
  "Drafting field updates — full & current",
  "Saving proposals to your review queue",
];
const SWEEP_EST_S = 45; // typical full sweep; the bar eases and waits if it runs long

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
  // Estimated-progress UI for the sweep (client-side; see SWEEP_PHASES note).
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  // Refine with AI — the HITL chat: marketplace + company-grounded refinements,
  // each an editable proposition through the proposals trail.
  const [refining, setRefining] = useState(false);

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

  // Tick the estimated progress while the sweep runs. Eases toward ~96% on a
  // (1 - e^-t) curve so it reaches ~90% around the typical duration and keeps
  // inching after — it never claims "done" until the call actually returns.
  useEffect(() => {
    if (!importing) { setProgress(0); setElapsed(0); return; }
    const started = Date.now();
    const id = setInterval(() => {
      const s = (Date.now() - started) / 1000;
      setElapsed(s);
      setProgress(Math.min(96, 96 * (1 - Math.exp(-s / (SWEEP_EST_S / 3)))));
    }, 200);
    return () => clearInterval(id);
  }, [importing]);
  const phaseIdx = progress < 12 ? 0 : progress < 30 ? 1 : progress < 50 ? 2 : progress < 80 ? 3 : 4;

  // Drawer actions (accept / reject / hide) call this: refresh proposal counts and,
  // since an accept changes field values, re-mount the content panels.
  const refresh = useCallback(() => { load(); setFieldsNonce((n) => n + 1); }, [load]);

  // Set up with AI = fill the blanks. Source is OPTIONAL — it fills this record's
  // EMPTY fields from what's known (the record + modules/features + signals); a
  // paste/URL is extra grounding when you have it.
  async function runImport() {
    setImporting(true); setError(null); setImpNote(null);
    try {
      const body: Record<string, unknown> = target.kind === "product" ? { product_id: target.id } : { gtm_record_id: target.id };
      if (src.mode === "url" && src.url.trim()) body.url = src.url.trim();
      else if (src.content.trim()) body.content = src.content.trim();
      if (src.guidance.trim()) body.guidance = src.guidance.trim();
      const { data, error } = await supabase.functions.invoke("import-record", { body });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (!data?.changes_saved) {
        setImpNote(data?.message || "Nothing could be grounded for the blank fields yet.");
      } else {
        setImpNote(`Proposed ${data.changes_saved} field improvement${data.changes_saved === 1 ? "" : "s"} (gaps, thin, or stale) — review them in Advisors (the “waiting” pill).`);
        setSrc({ mode: src.mode, content: "", url: "", guidance: "" });
        refresh();
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Set up failed."); }
    finally { setImporting(false); }
  }

  const pending = proposals.filter((p) => p.status === "pending");
  const resolved = proposals.filter((p) => p.status !== "pending");
  const pendingByName = pending.reduce<Record<string, number>>((acc, p) => { acc[p.proposed_by] = (acc[p.proposed_by] ?? 0) + 1; return acc; }, {});

  return (
    <div>
      <Banner>{error}</Banner>

      {/* Set up with AI = whole-record completeness sweep · Refine = a chat, field by field */}
      <div className="card card-pad row-between" style={{ marginBottom: "var(--sp-4)", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 640, fontSize: 13.5 }}>Set up with AI <span className="t-mono-xs t-muted" style={{ fontWeight: 400 }}>— full &amp; current</span></div>
          <div className="t-sub t-muted" style={{ fontSize: 12.5, marginTop: 2 }}>Sweeps the <strong>whole</strong> record and proposes whatever makes every field full and current — fills gaps, completes thin fields, refreshes stale ones (not just the empty ones). Grounded in your modules &amp; features + signals, optionally a doc/URL. Lands in your review queue.</div>
        </div>
        <span className="row gap-2" style={{ flexShrink: 0 }}>
          <button className="btn btn-sm" onClick={() => { setImpNote(null); setImp(true); }} style={{ background: "var(--ac)", color: "#fff" }} title="Make the whole record full and current in one pass — fills, completes, and refreshes every field (a source is optional)">Set up with AI</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setRefining(true)}
            title="A chat to work fields one at a time — you steer the true-update, grounded in your signals, edited before it lands">✦ Refine with AI</button>
        </span>
      </div>

      {refining && <RecordRefine target={target} recordName={recordName} onApplied={refresh} onClose={() => setRefining(false)} />}

      <Modal open={imp} onClose={() => setImp(false)} title="Set up with AI — make it full & current" width={620}>
        <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>Sweeps <strong>every</strong> field and proposes what it takes to make the record full and current — fills gaps, completes thin fields, refreshes stale ones — grounded in the record itself, its modules &amp; features, and your signals. Add an optional source for extra grounding. Proposals land in your <strong>review queue</strong>; nothing is applied until you accept it.</div>
        <div className="t-label" style={{ marginBottom: 6 }}>Optional source <span className="t-muted" style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— extra grounding; not required</span></div>
        <div className="row gap-2" style={{ marginBottom: 10 }}>
          <button type="button" className={`btn btn-sm ${src.mode === "paste" ? "" : "btn-secondary"}`} onClick={() => setSrc({ ...src, mode: "paste" })}>Paste text</button>
          <button type="button" className={`btn btn-sm ${src.mode === "url" ? "" : "btn-secondary"}`} onClick={() => setSrc({ ...src, mode: "url" })}>From a URL</button>
        </div>
        {src.mode === "paste"
          ? <label className="field"><span className="t-label">Source content <span className="t-muted" style={{ fontWeight: 400 }}>— optional</span></span><textarea className="textarea" rows={6} value={src.content} onChange={(e) => setSrc({ ...src, content: e.target.value })} placeholder="Optional — paste a brief, positioning, value prop, ICP… or leave blank to fill from what's already known." /></label>
          : <label className="field"><span className="t-label">Public URL <span className="t-muted" style={{ fontWeight: 400 }}>— optional</span></span><input className="input" value={src.url} onChange={(e) => setSrc({ ...src, url: e.target.value })} placeholder="https://yourcompany.com/product" /></label>}
        <label className="field"><span className="t-label">Focus <span className="t-muted" style={{ fontWeight: 400 }}>— optional</span></span><input className="input" value={src.guidance} onChange={(e) => setSrc({ ...src, guidance: e.target.value })} placeholder="e.g. prioritize the Technical and Positioning fields" /></label>
        {impNote && <div className="banner" style={{ marginBottom: 12 }}>{impNote}</div>}

        {importing && (
          <div className="card card-pad" style={{ marginBottom: 12, borderLeft: "3px solid var(--ac)" }}>
            <div className="row-between" style={{ alignItems: "baseline", marginBottom: 8 }}>
              <span className="t-label" style={{ color: "var(--tm)" }}>{SWEEP_PHASES[phaseIdx]}…</span>
              <span className="t-mono-xs t-muted">{elapsed < SWEEP_EST_S ? `~${Math.max(1, Math.ceil(SWEEP_EST_S - elapsed))}s left` : "Wrapping up…"}</span>
            </div>
            <div style={{ height: 6, borderRadius: 99, background: "var(--fill)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${progress}%`, background: "var(--ac)", borderRadius: 99, transition: "width 0.2s linear" }} />
            </div>
            <div className="stack-1" style={{ marginTop: 10 }}>
              {SWEEP_PHASES.map((p, i) => (
                <div key={i} className={i === phaseIdx ? "t-sub" : "t-muted"} style={{ fontSize: 12, display: "flex", gap: 8, alignItems: "center", opacity: i <= phaseIdx ? 1 : 0.45 }}>
                  <span style={{ width: 12, display: "inline-block", fontWeight: 700 }}>{i < phaseIdx ? "✓" : i === phaseIdx ? "→" : "·"}</span>
                  <span>{p}</span>
                </div>
              ))}
            </div>
            <div className="t-sub t-muted" style={{ fontSize: 11, marginTop: 8 }}>Elapsed {Math.floor(elapsed)}s · the time shown is an estimate — a full sweep can run longer when grounding is rich. Safe to leave this open.</div>
          </div>
        )}

        <div className="row gap-2"><button className="btn" disabled={importing} onClick={runImport}>{importing ? "Making it full & current…" : "✦ Make it full & current → review queue"}</button><button className="btn btn-secondary" disabled={importing} onClick={() => setImp(false)}>Close</button></div>
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
                  <span className="row gap-2" style={{ alignItems: "center" }}>
                    <span className="t-mono-xs t-muted" title={new Date(p.created_at).toLocaleString()}>{new Date(p.created_at).toLocaleDateString()}</span>
                    <Chip tone={p.status === "accepted" ? "green" : p.status === "conflicted" ? "amber" : "default"}>{p.status}</Chip>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
