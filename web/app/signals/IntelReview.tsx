"use client";

// Intel review + learning. Two restrained surfaces, house style:
//  • Review queue — synthesis's high-judgment proposals (new theme / escalate /
//    merge / decay / restate). Each gets Accept / Edit / Reject PLUS context: a
//    free-text "why" and quick reason tags. Editing a recommendation and adding
//    a why is the real teaching — that verdict+context is the learning corpus.
//  • Learning — the active lessons distilled from that feedback, in plain
//    language, each dismissable (you correct the teacher), plus an accept rate.
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Section, Chip, Banner } from "@/components/ui";

type Update = {
  id: string; kind: string; summary: string | null; theme_id: string | null;
  payload: Record<string, unknown>; status: string;
};
type Lesson = { id: string; lesson: string; derived_count: number; source: string };

const REASON_TAGS = ["evidence_thin", "wrong_lens", "not_actionable", "tone", "duplicate", "other"];
const TAG_LABEL: Record<string, string> = {
  evidence_thin: "evidence too thin", wrong_lens: "wrong lens", not_actionable: "not actionable",
  tone: "tone/wording", duplicate: "duplicate", other: "other",
};
const KIND_TONE: Record<string, "default" | "accent" | "violet" | "amber" | "green"> = {
  new_theme: "accent", escalate: "amber", merge: "violet", decay: "default", restate: "default",
};

export default function IntelReview({ onApplied }: { onApplied?: () => void }) {
  const supabase = createClient();
  const [updates, setUpdates] = useState<Update[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [acceptRate, setAcceptRate] = useState<{ rate: number; n: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ rationale: string; tags: string[]; edit: string }>({ rationale: "", tags: [], edit: "" });
  const [busy, setBusy] = useState(false);
  const [distilling, setDistilling] = useState(false);

  const load = useCallback(async () => {
    const [{ data: ups }, { data: les }, { data: decided }] = await Promise.all([
      supabase.from("intel_updates").select("id, kind, summary, theme_id, payload, status").eq("status", "pending").order("created_at", { ascending: false }),
      supabase.from("agent_lessons").select("id, lesson, derived_count, source").eq("scope", "synthesis").eq("status", "active").order("derived_count", { ascending: false }),
      supabase.from("intel_updates").select("status").neq("status", "pending"),
    ]);
    setUpdates(ups ?? []);
    setLessons(les ?? []);
    const d = decided ?? [];
    if (d.length) {
      const accepted = d.filter((x) => x.status === "accepted" || x.status === "edited").length;
      setAcceptRate({ rate: Math.round((accepted / d.length) * 100), n: d.length });
    } else setAcceptRate(null);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  function openItem(u: Update) {
    setOpenId(u.id);
    setDraft({ rationale: "", tags: [], edit: typeof u.payload?.recommendation === "string" ? (u.payload.recommendation as string) : "" });
  }
  const toggleTag = (t: string) => setDraft((d) => ({ ...d, tags: d.tags.includes(t) ? d.tags.filter((x) => x !== t) : [...d.tags, t] }));

  async function resolve(u: Update, verdict: "accept" | "edit" | "reject") {
    setBusy(true); setError(null);
    try {
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      const edited = verdict === "edit" && draft.edit.trim() ? { recommendation: draft.edit.trim() } : undefined;
      const { data, error } = await supabase.functions.invoke("resolve-intel-update", {
        body: { update_id: u.id, verdict, rationale: draft.rationale.trim() || null, reason_tags: draft.tags, edited_payload: edited },
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setOpenId(null); setDraft({ rationale: "", tags: [], edit: "" });
      await load(); onApplied?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not resolve."); }
    finally { setBusy(false); }
  }

  async function distill() {
    setDistilling(true); setError(null);
    try {
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      const { data, error } = await supabase.functions.invoke("distill-lessons", {
        body: {}, headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not distill lessons."); }
    finally { setDistilling(false); }
  }

  async function dismissLesson(id: string) {
    setError(null);
    await supabase.from("agent_lessons").update({ status: "dismissed" }).eq("id", id);
    await load();
  }

  // Nothing to show at all — stay quiet.
  if (updates.length === 0 && lessons.length === 0 && !acceptRate) return null;

  return (
    <div style={{ display: "grid", gap: "var(--sp-5)", marginBottom: "var(--sp-6)" }}>
      <Banner>{error}</Banner>

      {updates.length > 0 && (
        <Section label={`Review intelligence updates · ${updates.length}`}>
          <div className="t-sub t-muted" style={{ marginBottom: "var(--sp-3)" }}>
            The engine proposes these. Accept, edit, or reject — and tell it why. Your context teaches it.
          </div>
          <div className="stack-3">
            {updates.map((u) => (
              <div key={u.id} className="card card-pad">
                <div className="row-between" style={{ alignItems: "baseline", gap: 10 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{u.summary}</span>
                  <Chip tone={KIND_TONE[u.kind] ?? "default"}>{u.kind.replace("_", " ")}</Chip>
                </div>

                {openId === u.id ? (
                  <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                    {typeof u.payload?.recommendation === "string" && (
                      <label className="field"><span className="t-label">Recommendation (edit to teach a better one)</span>
                        <textarea className="textarea" rows={2} value={draft.edit} onChange={(e) => setDraft({ ...draft, edit: e.target.value })} /></label>
                    )}
                    <label className="field"><span className="t-label">Why? (this is what it learns from)</span>
                      <textarea className="textarea" rows={2} placeholder="e.g. one call isn't a pattern — wait for 3+ before opening a theme" value={draft.rationale} onChange={(e) => setDraft({ ...draft, rationale: e.target.value })} /></label>
                    <div>
                      <span className="t-label" style={{ display: "block", marginBottom: 6 }}>Reason</span>
                      <div className="row gap-2" style={{ flexWrap: "wrap" }}>
                        {REASON_TAGS.map((t) => (
                          <button key={t} type="button" className="chip" onClick={() => toggleTag(t)}
                            style={{ cursor: "pointer", background: draft.tags.includes(t) ? "var(--ac)" : "var(--fill)", color: draft.tags.includes(t) ? "#fff" : "var(--ts)" }}>
                            {TAG_LABEL[t]}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="row gap-2" style={{ marginTop: 2 }}>
                      <button className="btn btn-sm" disabled={busy} onClick={() => resolve(u, "accept")}>Accept</button>
                      {typeof u.payload?.recommendation === "string" && <button className="btn btn-sm btn-secondary" disabled={busy} onClick={() => resolve(u, "edit")}>Accept edit</button>}
                      <button className="btn btn-sm btn-secondary" disabled={busy} onClick={() => resolve(u, "reject")}>Reject</button>
                      <button className="btn btn-sm btn-secondary" disabled={busy} onClick={() => setOpenId(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="row gap-2" style={{ marginTop: 10 }}>
                    <button className="btn btn-sm" onClick={() => openItem(u)}>Review</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {(lessons.length > 0 || acceptRate || updates.length === 0) && (
        <Section
          label="Learning"
          action={<button className="btn btn-secondary btn-sm" disabled={distilling} onClick={distill}>{distilling ? "Distilling…" : "Distill lessons"}</button>}
        >
          <div className="t-sub t-muted" style={{ marginBottom: "var(--sp-3)" }}>
            {acceptRate ? `${acceptRate.rate}% of proposals accepted · ${acceptRate.n} reviewed.` : "No reviewed proposals yet."} What the engine has learned from your feedback:
          </div>
          {lessons.length === 0 ? (
            <p className="t-muted" style={{ margin: 0 }}>No lessons yet. Review a few updates with context, then “Distill lessons”.</p>
          ) : (
            <div className="stack-3">
              {lessons.map((l) => (
                <div key={l.id} className="card card-pad row-between" style={{ alignItems: "flex-start", gap: 10, padding: "10px 12px" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, lineHeight: 1.5 }}>{l.lesson}</div>
                    <div className="t-mono-xs" style={{ marginTop: 3 }}>{l.source === "human" ? "added by you" : `from ${l.derived_count} item${l.derived_count === 1 ? "" : "s"} of feedback`}</div>
                  </div>
                  <button className="btn btn-secondary btn-sm" style={{ flexShrink: 0 }} onClick={() => dismissLesson(l.id)}>Dismiss</button>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
