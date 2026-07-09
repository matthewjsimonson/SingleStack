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
import { Section, Chip, Banner, Modal } from "@/components/ui";
import { useAgentRun, AgentProgress } from "@/components/AgentProgress";
import { useProductScope } from "@/lib/ProductContext";

type Update = {
  id: string; kind: string; summary: string | null; theme_id: string | null;
  payload: Record<string, unknown>; status: string;
};
type Lesson = { id: string; lesson: string; derived_count: number; source: string };
type Miss = { theme_id: string; title: string; category: string; new_support_signals: number; new_support_sources: number; product_id: string | null };

const REASON_TAGS = ["evidence_thin", "wrong_lens", "not_actionable", "tone", "duplicate", "other"];
const TAG_LABEL: Record<string, string> = {
  evidence_thin: "evidence too thin", wrong_lens: "wrong lens", not_actionable: "not actionable",
  tone: "tone/wording", duplicate: "duplicate", other: "other",
};
const KIND_TONE: Record<string, "default" | "accent" | "violet" | "amber" | "green"> = {
  new_theme: "accent", escalate: "amber", merge: "violet", decay: "default", restate: "default", battlecard_item: "green", capability_score: "accent",
};
const SCORE_LEVELS = [["—", 0], ["Partial", 1], ["Good", 2], ["Strong", 3]] as const;

// Map a human-chosen set of product lines → the scope shape the data model uses
// (matches inferScope + the co_products CHECK invariant): none → company-wide;
// one → that line; ≥2 → cross-product (first selected is the primary).
function scopeFromLines(lines: string[]): { product_id: string | null; co_product_ids: string[] } {
  if (lines.length === 0) return { product_id: null, co_product_ids: [] };
  return { product_id: lines[0], co_product_ids: lines.slice(1) };
}
// The lines a proposal currently spans (primary first), from its payload.
function linesOf(payload: Record<string, unknown>): string[] {
  const co = (payload.co_product_ids as string[] | undefined) ?? [];
  return [payload.product_id as string | null, ...co].filter(Boolean) as string[];
}
const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");

export default function IntelReview({ onApplied, productFilter = "all" }: { onApplied?: () => void; productFilter?: string }) {
  const supabase = createClient();
  const { products } = useProductScope(); // line names + the set the human can re-attribute a cross-sell theme across
  const [updates, setUpdates] = useState<Update[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [acceptRate, setAcceptRate] = useState<{ rate: number; n: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The review pop-up pans through the queue one proposal at a time.
  const [reviewIdx, setReviewIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ rationale: string; tags: string[]; edit: string; lines: string[]; score: number | null }>({ rationale: "", tags: [], edit: "", lines: [], score: null });
  const [busy, setBusy] = useState(false);
  const distillRun = useAgentRun("distill");
  const [misses, setMisses] = useState<Miss[]>([]);
  const lineName = (id: string) => products.find((p) => p.id === id)?.name ?? "a line";

  const load = useCallback(async () => {
    const [{ data: ups }, { data: les }, { data: decided }, { data: mis }] = await Promise.all([
      supabase.from("intel_updates").select("id, kind, summary, theme_id, payload, status").eq("status", "pending").order("created_at", { ascending: false }),
      supabase.from("agent_lessons").select("id, lesson, derived_count, source").eq("scope", "synthesis").eq("status", "active").order("derived_count", { ascending: false }),
      supabase.from("intel_updates").select("status").neq("status", "pending"),
      supabase.from("theme_misses").select("theme_id, title, category, new_support_signals, new_support_sources, product_id").order("new_support_sources", { ascending: false }),
    ]);
    setUpdates(ups ?? []);
    setLessons(les ?? []);
    const missScoped = (mis ?? []).filter((m: { product_id?: string | null }) =>
      productFilter === "all" ? true : productFilter === "company" ? !m.product_id : m.product_id === productFilter);
    setMisses(missScoped);
    const d = decided ?? [];
    if (d.length) {
      const accepted = d.filter((x) => x.status === "accepted" || x.status === "edited").length;
      setAcceptRate({ rate: Math.round((accepted / d.length) * 100), n: d.length });
    } else setAcceptRate(null);
  }, [supabase, productFilter]);
  useEffect(() => { load(); }, [load]);

  // Seed the working draft from a proposal — the line attribution comes from
  // the payload so the human can confirm or correct which lines it spans.
  const seedDraft = useCallback((u: Update | undefined) => {
    if (!u) return;
    setDraft({ rationale: "", tags: [], edit: typeof u.payload?.recommendation === "string" ? (u.payload.recommendation as string) : "", lines: linesOf(u.payload ?? {}), score: typeof u.payload?.score === "number" ? (u.payload.score as number) : null });
  }, []);
  function openAt(idx: number) { setReviewIdx(idx); seedDraft(updates[idx]); }
  function panTo(idx: number) { setReviewIdx(idx); seedDraft(updates[idx]); }
  const toggleTag = (t: string) => setDraft((d) => ({ ...d, tags: d.tags.includes(t) ? d.tags.filter((x) => x !== t) : [...d.tags, t] }));
  // Toggle a product line in the attribution; first selected stays the primary.
  const toggleLine = (id: string) => setDraft((d) => ({ ...d, lines: d.lines.includes(id) ? d.lines.filter((x) => x !== id) : [...d.lines, id] }));

  async function resolve(u: Update, verdict: "accept" | "edit" | "reject") {
    setBusy(true); setError(null);
    try {
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      // Assemble the human's corrections into edited_payload. Two things can be
      // taught: a better recommendation, and — for a new theme — the right line
      // attribution (confirm/correct which lines a cross-sell theme spans). If
      // the human re-attributed lines, that scope rides along even on "accept".
      const edited: Record<string, unknown> = {};
      if (draft.edit.trim() && draft.edit.trim() !== (u.payload?.recommendation ?? "")) edited.recommendation = draft.edit.trim();
      const linesChanged = u.kind === "new_theme" && !sameSet(draft.lines, linesOf(u.payload ?? {}));
      if (linesChanged) Object.assign(edited, scopeFromLines(draft.lines));
      // Capability score: a human override of the proposed rating is a teaching edit.
      if (u.kind === "capability_score" && draft.score !== null && draft.score !== (u.payload?.score ?? null)) edited.score = draft.score;
      const hasEdit = Object.keys(edited).length > 0;
      const effectiveVerdict = verdict === "accept" && hasEdit ? "edit" : verdict;
      const { data, error } = await supabase.functions.invoke("resolve-intel-update", {
        body: { update_id: u.id, verdict: effectiveVerdict, rationale: draft.rationale.trim() || null, reason_tags: draft.tags, edited_payload: hasEdit ? edited : undefined },
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      // Pan to the next pending proposal (the resolved one leaves the queue).
      const remaining = updates.filter((x) => x.id !== u.id);
      if (!remaining.length) setReviewIdx(null);
      else {
        const next = Math.min(reviewIdx ?? 0, remaining.length - 1);
        setReviewIdx(next); seedDraft(remaining[next]);
      }
      await load(); onApplied?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not resolve."); }
    finally { setBusy(false); }
  }

  async function distill() {
    setError(null);
    try {
      await distillRun.go(async () => {
        const { data: s } = await supabase.auth.getSession();
        const token = s.session?.access_token;
        const { data, error } = await supabase.functions.invoke("distill-lessons", {
          body: {}, headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        await load();
      });
    } catch (e) { setError(e instanceof Error ? e.message : "Could not distill lessons."); }
  }

  // Teach directly: a human-stated preference becomes an active lesson the
  // synthesis engine carries from the next run on (source='human').
  const [teach, setTeach] = useState("");
  const [teaching, setTeaching] = useState(false);
  async function teachLesson(e: React.FormEvent) {
    e.preventDefault(); if (!teach.trim()) return;
    setTeaching(true); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("No org.");
      const { error } = await supabase.from("agent_lessons").insert({ org_id: orgId, scope: "synthesis", lesson: teach.trim(), status: "active", source: "human" });
      if (error) throw error;
      setTeach(""); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save the lesson."); }
    finally { setTeaching(false); }
  }

  async function dismissLesson(id: string) {
    setError(null);
    await supabase.from("agent_lessons").update({ status: "dismissed" }).eq("id", id);
    await load();
  }

  // Reconsider a miss: bring a faded theme back to active and log it.
  async function reconsider(m: Miss) {
    setError(null);
    const orgId = await getOrgId(); if (!orgId) return;
    await supabase.from("signal_themes").update({ state: "active" }).eq("id", m.theme_id);
    await supabase.from("theme_events").insert({ org_id: orgId, theme_id: m.theme_id, kind: "state_changed", detail: { from: "fading", to: "active", reason: "reconsidered — new evidence" }, actor: "human" });
    await load(); onApplied?.();
  }

  // Nothing to show at all — stay quiet.
  if (updates.length === 0 && lessons.length === 0 && !acceptRate && misses.length === 0) return null;

  return (
    <div style={{ display: "grid", gap: "var(--sp-5)", marginBottom: "var(--sp-6)" }}>
      <Banner>{error}</Banner>

      {misses.length > 0 && (
        <Section label={`Worth reconsidering · ${misses.length}`}>
          <div className="t-sub t-muted" style={{ marginBottom: "var(--sp-3)" }}>
            You let these fade — but fresh, independent evidence has come in since. The system flags its own misses.
          </div>
          <div className="stack-3">
            {misses.map((m) => (
              <div key={m.theme_id} className="card card-pad row-between" style={{ alignItems: "flex-start", gap: 10, borderLeft: "2px solid var(--am-text)" }}>
                <div style={{ minWidth: 0 }}>
                  <a href={`/signals/themes/${m.theme_id}`} style={{ fontSize: 13.5, fontWeight: 640, color: "inherit", textDecoration: "none" }}>{m.title}</a>
                  <div className="t-mono-xs" style={{ marginTop: 3 }}>+{m.new_support_signals} signal{m.new_support_signals === 1 ? "" : "s"} across {m.new_support_sources} independent source{m.new_support_sources === 1 ? "" : "s"} since it faded</div>
                </div>
                <button className="btn btn-sm" style={{ flexShrink: 0 }} onClick={() => reconsider(m)}>Reconsider</button>
              </div>
            ))}
          </div>
        </Section>
      )}

      {updates.length > 0 && (
        <Section label={`Review intelligence updates · ${updates.length}`}>
          <div className="t-sub t-muted" style={{ marginBottom: "var(--sp-3)" }}>
            The engine proposes these. Accept, edit, or reject — and tell it why. Your context teaches it.
          </div>
          <div className="stack-3">
            {updates.map((u, idx) => (
              <div key={u.id} className="card card-pad row-between" style={{ alignItems: "baseline", gap: 10 }}>
                <div className="row gap-2" style={{ alignItems: "baseline", minWidth: 0, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{u.summary}</span>
                  {/* Scope is visible up front so the reviewer can supervise the
                      line attribution — especially cross-sell themes. */}
                  {u.kind === "new_theme" && (() => {
                    const ls = linesOf(u.payload ?? {});
                    return ls.length >= 2
                      ? <Chip tone="green">cross-sell · {ls.map(lineName).join(" + ")}</Chip>
                      : ls.length === 1
                        ? <Chip tone="default">{lineName(ls[0])}</Chip>
                        : <Chip tone="default">company-wide</Chip>;
                  })()}
                  <Chip tone={KIND_TONE[u.kind] ?? "default"}>{u.kind.replace("_", " ")}</Chip>
                </div>
                <button className="btn btn-sm" style={{ flexShrink: 0 }} onClick={() => openAt(idx)}>Review</button>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ---- REVIEW pop-up — a tall centered rectangle you PAN through ---- */}
      {reviewIdx != null && updates[reviewIdx] && (() => {
        const u = updates[reviewIdx];
        return (
          <Modal open onClose={() => setReviewIdx(null)} width={640} tall
            title={`Review intelligence — ${reviewIdx + 1} of ${updates.length}`}>
            <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
              <div className="stack-3" style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: 2 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 640, lineHeight: 1.45 }}>{u.summary}</div>
                  <div className="row gap-2" style={{ marginTop: 6, flexWrap: "wrap" }}>
                    <Chip tone={KIND_TONE[u.kind] ?? "default"}>{u.kind.replace("_", " ")}</Chip>
                    {u.kind === "new_theme" && (() => {
                      const ls = linesOf(u.payload ?? {});
                      return ls.length >= 2 ? <Chip tone="green">cross-sell</Chip> : null;
                    })()}
                  </div>
                </div>
                {/* Line attribution — only for a new theme, and only when the
                    org runs >1 line. The human owns this call. */}
                {u.kind === "new_theme" && products.length > 1 && (
                  <div className="field">
                    <span className="t-label">Which product line(s)? {draft.lines.length >= 2 && <span style={{ color: "var(--gn-text)" }}>· cross-sell</span>}</span>
                    <div className="row gap-2" style={{ flexWrap: "wrap", marginTop: 4 }}>
                      {products.map((p) => {
                        const on = draft.lines.includes(p.id);
                        const primary = draft.lines[0] === p.id && draft.lines.length >= 2;
                        return (
                          <button key={p.id} type="button" className="chip" onClick={() => toggleLine(p.id)}
                            style={{ cursor: "pointer", background: on ? "var(--ac)" : "var(--fill)", color: on ? "#fff" : "var(--ts)" }}
                            title={primary ? "primary line" : on ? "spanned line" : "not included"}>
                            {primary ? "★ " : ""}{p.name}
                          </button>
                        );
                      })}
                    </div>
                    <span className="t-mono-xs" style={{ marginTop: 4 }}>
                      {draft.lines.length === 0 ? "company-wide (applies to all)" : draft.lines.length === 1 ? `${lineName(draft.lines[0])} only` : `cross-sell: ${draft.lines.map(lineName).join(" + ")}`}
                    </span>
                  </div>
                )}
                {/* Capability score: the rationale + evidence behind the rating,
                    and a score override (the human owns the final number). */}
                {u.kind === "capability_score" && (
                  <div className="card card-pad" style={{ background: "var(--panel-2)" }}>
                    {typeof u.payload?.rationale === "string" && u.payload.rationale && <div className="t-sub" style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 8 }}>{u.payload.rationale as string}</div>}
                    <span className="t-label" style={{ display: "block", marginBottom: 6 }}>Score <span className="t-sub t-muted" style={{ textTransform: "none", letterSpacing: 0 }}>— agent proposes, you decide</span></span>
                    <div className="row gap-2" style={{ flexWrap: "wrap" }}>
                      {SCORE_LEVELS.map(([label, val]) => {
                        const on = (draft.score ?? u.payload?.score) === val;
                        return (
                          <button key={val} type="button" onClick={() => setDraft({ ...draft, score: val })}
                            className="chip" style={{ cursor: "pointer", padding: "6px 12px", background: on ? "var(--ac)" : "var(--fill)", color: on ? "#fff" : "var(--ts)", fontWeight: 600 }}>
                            {label}
                          </button>
                        );
                      })}
                    </div>
                    {typeof u.payload?.prev_score === "number" && (
                      <div className="t-mono-xs" style={{ marginTop: 6 }}>currently {String(u.payload.prev_score)}/3 in the matrix · {(u.payload?.signal_ids as string[] | undefined)?.length ?? 0} signal{((u.payload?.signal_ids as string[] | undefined)?.length ?? 0) === 1 ? "" : "s"} cited</div>
                    )}
                  </div>
                )}
                {/* Battlecard item: the analyst's substantiation + why it proposed it. */}
                {u.kind === "battlecard_item" && (
                  <div className="card card-pad" style={{ background: "var(--panel-2)" }}>
                    {typeof u.payload?.detail === "string" && u.payload.detail && <div className="t-sub" style={{ fontSize: 13, lineHeight: 1.6 }}>{u.payload.detail as string}</div>}
                    {typeof u.payload?.rationale === "string" && u.payload.rationale && <div className="t-sub t-muted" style={{ fontSize: 12.5, marginTop: 6 }}>Analyst: {u.payload.rationale as string}</div>}
                  </div>
                )}
                {typeof u.payload?.recommendation === "string" && (
                  <label className="field"><span className="t-label">Recommendation (edit to teach a better one)</span>
                    <textarea className="textarea" rows={6} value={draft.edit} onChange={(e) => setDraft({ ...draft, edit: e.target.value })} /></label>
                )}
                <label className="field"><span className="t-label">Why? (this is what it learns from)</span>
                  <textarea className="textarea" rows={3} placeholder="e.g. one call isn't a pattern — wait for 3+ before opening a theme" value={draft.rationale} onChange={(e) => setDraft({ ...draft, rationale: e.target.value })} /></label>
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
              </div>
              {/* Pan + verdict — fixed to the bottom of the rectangle */}
              <div className="row-between" style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 12, alignItems: "center" }}>
                <div className="row gap-2">
                  <button className="btn btn-secondary btn-sm" onClick={() => panTo(Math.max(0, reviewIdx - 1))} disabled={reviewIdx === 0}>‹ Prev</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => panTo(Math.min(updates.length - 1, reviewIdx + 1))} disabled={reviewIdx >= updates.length - 1}>Next ›</button>
                </div>
                <div className="row gap-2">
                  <button className="btn btn-secondary" disabled={busy} onClick={() => resolve(u, "reject")} style={{ color: "var(--rd-text)" }}>Reject</button>
                  {typeof u.payload?.recommendation === "string" && <button className="btn btn-secondary" disabled={busy} onClick={() => resolve(u, "edit")}>Accept edit</button>}
                  <button className="btn" disabled={busy} onClick={() => resolve(u, "accept")}>Accept</button>
                </div>
              </div>
            </div>
          </Modal>
        );
      })()}

      {(lessons.length > 0 || acceptRate || updates.length === 0) && (
        <Section
          label="Learning"
          action={distillRun.active ? <AgentProgress run={distillRun} compact /> : <button className="btn btn-secondary btn-sm" onClick={distill}>Distill lessons</button>}
        >
          <div className="t-sub t-muted" style={{ marginBottom: "var(--sp-3)" }}>
            {acceptRate ? `${acceptRate.rate}% of proposals accepted · ${acceptRate.n} reviewed.` : "No reviewed proposals yet."} What the engine has learned from your feedback:
          </div>
          {/* Teach it directly — no need to wait for distillation. */}
          <form onSubmit={teachLesson} className="row gap-2" style={{ marginBottom: "var(--sp-3)" }}>
            <input className="input" value={teach} onChange={(e) => setTeach(e.target.value)} placeholder='Teach a rule directly — e.g. "never open a theme from a single Reddit thread"' style={{ flex: 1 }} />
            <button className="btn btn-sm" type="submit" disabled={teaching || !teach.trim()}>{teaching ? "Saving…" : "Teach"}</button>
          </form>
          {lessons.length === 0 ? (
            <p className="t-muted" style={{ margin: 0 }}>No lessons yet. Teach one above, or review a few updates with context, then “Distill lessons”.</p>
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
