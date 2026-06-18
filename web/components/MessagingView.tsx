"use client";

// Messaging — the GTM-strategy ROOT workbench. Two motions in one surface:
//   ABSORB    — pull what's new (gtm/living-memory themes + shipped releases) into
//               a brief rail, reflected against the existing messaging FRAMEWORK.
//   TRANSFORM — the framework is record_fields grouped by section on the active GTM
//               record. Per element we surface ONLY the actionable delta ("stale —
//               N themes + M releases moved since last update"); a GTM officer drafts
//               a focused update the human ratifies FIELD BY FIELD. Reflect deltas,
//               don't regenerate.
//
// Layout: left = framework canvas (the star); right = collapsible brief/reasoning
// rail. Writes go through the HITL gate only — human_set_field_value for hand edits,
// agent-propose → accept_proposal for agent drafts. Never a wholesale approve.
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useProductScope } from "@/lib/ProductContext";
import { Chip, SourceChip, Empty, Banner } from "@/components/ui";
import { PulseDots, streamStructured } from "@/components/alive";
import {
  fetchOfficerKey, deltaSince, deltaLine, buildInstruction, fmtWhen,
  type ThemeRow, type ReleaseRow, type FieldDelta,
} from "@/lib/messaging";

type Field = { id: string; field_key: string; label: string; value: string | null; section: string | null; position: number };
type Gtm = { id: string; name: string; product_id: string | null };
type Status = "idle" | "working" | "blocked" | "done";

// Section order from GTM_TEMPLATE (templates.ts) so the canvas reads top-down.
const SECTION_ORDER = ["Positioning", "Messaging", "Buyer", "Motion", "Battlecard"];
const UNGROUPED = "Details";
const sectionRank = (s: string) => { const i = SECTION_ORDER.indexOf(s); return i === -1 ? 99 : i; };

const STATUS_TONE: Record<Status, "default" | "accent" | "amber" | "green"> = {
  idle: "default", working: "accent", blocked: "amber", done: "green",
};
const STATUS_LABEL: Record<Status, string> = { idle: "Idle", working: "Working", blocked: "Blocked", done: "Done" };

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export default function MessagingView() {
  const supabase = createClient();
  const { active, matches } = useProductScope();

  const [gtms, setGtms] = useState<Gtm[]>([]);
  const [gtmId, setGtmId] = useState<string>("");
  const [gtmCreatedAt, setGtmCreatedAt] = useState<string | null>(null);

  const [fields, setFields] = useState<Field[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Record<string, string | null>>({}); // record_field_id -> last revision ts
  const [themes, setThemes] = useState<ThemeRow[]>([]);
  const [thisWeek, setThisWeek] = useState<Record<string, number>>({}); // theme_id -> +N this week
  const [releases, setReleases] = useState<ReleaseRow[]>([]);
  const [officerKey, setOfficerKey] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(true);

  // ---- pick the active GTM record (scope-aware) ------------------------------
  const loadGtms = useCallback(async () => {
    const { data } = await supabase.from("gtm_records").select("id, name, product_id, created_at").order("created_at");
    const rows = (data ?? []) as (Gtm & { created_at: string })[];
    const scoped = rows.filter((r) => matches(r));
    const pool = scoped.length ? scoped : rows;
    setGtms(pool.map(({ id, name, product_id }) => ({ id, name, product_id })));
    if (pool.length && !pool.some((g) => g.id === gtmId)) {
      // active product → its record; else first in scope
      const pick = active !== "all" && active !== "company"
        ? pool.find((g) => g.product_id === active) ?? pool[0]
        : pool[0];
      setGtmId(pick.id);
      setGtmCreatedAt(pick.created_at);
    } else {
      const cur = pool.find((g) => g.id === gtmId);
      if (cur) setGtmCreatedAt(cur.created_at);
    }
  }, [supabase, matches, active, gtmId]);

  useEffect(() => { loadGtms(); }, [loadGtms]);

  // ---- load framework + brief streams + deltas -------------------------------
  const load = useCallback(async () => {
    if (!gtmId) { setFields([]); setLoading(false); return; }
    setLoading(true); setError(null);
    const weekAgo = new Date(Date.now() - WEEK_MS).toISOString();
    const [{ data: fl }, { data: th }, { data: rl }, { data: tw }] = await Promise.all([
      supabase.from("record_fields").select("id, field_key, label, value, section, position").eq("gtm_record_id", gtmId).order("position"),
      supabase.from("signal_themes")
        .select("id, title, summary, recommendation, conf_level, category, state, last_evidence_at, signal_ids")
        .in("category", ["gtm", "both"]).neq("state", "dormant")
        .order("last_evidence_at", { ascending: false, nullsFirst: false }),
      supabase.from("releases")
        .select("id, name, version, summary, stage, target_date, product_id")
        .eq("stage", "released").order("target_date", { ascending: false, nullsFirst: false }),
      supabase.from("theme_signals").select("theme_id, added_at").gte("added_at", weekAgo),
    ]);
    const fieldRows = (fl ?? []) as Field[];
    setFields(fieldRows);
    setThemes((th ?? []) as ThemeRow[]);
    setReleases(((rl ?? []) as ReleaseRow[]).filter((r) => matches(r)));

    // +N this week per theme
    const counts: Record<string, number> = {};
    for (const r of (tw ?? []) as { theme_id: string }[]) counts[r.theme_id] = (counts[r.theme_id] ?? 0) + 1;
    setThisWeek(counts);

    // last-updated per field, from field_revisions (fallback handled at delta time)
    const ids = fieldRows.map((f) => f.id);
    if (ids.length) {
      const { data: rev } = await supabase.from("field_revisions")
        .select("record_field_id, created_at").in("record_field_id", ids)
        .order("created_at", { ascending: false });
      const lu: Record<string, string | null> = {};
      for (const r of (rev ?? []) as { record_field_id: string; created_at: string }[]) {
        if (!(r.record_field_id in lu)) lu[r.record_field_id] = r.created_at; // first seen = newest (ordered desc)
      }
      setLastUpdated(lu);
    } else setLastUpdated({});

    setOfficerKey(await fetchOfficerKey(supabase));
    setLoading(false);
  }, [supabase, gtmId, matches]);

  useEffect(() => { load(); }, [load]);

  // delta for a field: revision ts, else the record's created_at as a floor.
  const deltaFor = useCallback((f: Field): FieldDelta => {
    const since = lastUpdated[f.id] ?? gtmCreatedAt;
    return deltaSince(since, themes, releases);
  }, [lastUpdated, gtmCreatedAt, themes, releases]);

  // ---- agent draft state (one element at a time) -----------------------------
  const [status, setStatus] = useState<Status>("idle");
  const [statusStr, setStatusStr] = useState("");
  const [draftFieldId, setDraftFieldId] = useState<string | null>(null);
  const [thinking, setThinking] = useState("");
  const [showReason, setShowReason] = useState(false);
  const [proposal, setProposal] = useState<{ id: string; value: string; label: string } | null>(null);
  const [acting, setActing] = useState(false);
  const stopRef = useRef(false);
  const traceRef = useRef<HTMLDivElement>(null);
  useEffect(() => { traceRef.current?.scrollTo({ top: traceRef.current.scrollHeight }); }, [thinking]);

  // human Edit channel
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [justSaved, setJustSaved] = useState<string | null>(null); // field id → "ratified · just now"

  async function saveHuman(id: string) {
    setError(null);
    const { error } = await supabase.rpc("human_set_field_value", { p_field: id, p_value: editDraft });
    if (error) { setError(error.message || "Could not save."); return; }
    setEditId(null);
    setJustSaved(id);
    await load();
  }

  // Draft an update for ONE element via the GTM officer (agent-propose).
  async function draft(f: Field) {
    if (!officerKey) { setError("No officer available — seed agents first."); return; }
    setError(null); setProposal(null); setThinking(""); setShowReason(false);
    setDraftFieldId(f.id); setStatus("working"); setStatusStr(`Drafting ${f.label}…`);
    stopRef.current = false;
    const d = deltaFor(f);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const res = await streamStructured<{ proposal_id?: string }>({
        fnName: "agent-propose",
        token: sess.session?.access_token,
        body: {
          agent_key: officerKey,
          gtm_record_id: gtmId,
          instruction: buildInstruction({ fieldKey: f.field_key, label: f.label, currentValue: f.value, delta: d }),
        },
        onThinking: (s) => { if (!stopRef.current) setThinking((p) => p + s); },
      });
      if (stopRef.current) { setStatus("idle"); setStatusStr(""); setDraftFieldId(null); return; }
      if (!res?.proposal_id) throw new Error("The officer returned no proposal.");
      // pull the proposed value for THIS field from the landed proposal
      const { data: pc } = await supabase.from("proposal_changes")
        .select("record_field_id, label, proposed_value, change_kind")
        .eq("proposal_id", res.proposal_id);
      const mine = (pc ?? []).find((c) => c.record_field_id === f.id) ?? (pc ?? [])[0];
      if (!mine) throw new Error("The proposal had no change for this element.");
      setProposal({ id: res.proposal_id, value: mine.proposed_value ?? "", label: mine.label ?? f.label });
      setStatus("done"); setStatusStr("");
    } catch (e) {
      setStatus("blocked"); setStatusStr(e instanceof Error ? e.message : "Draft failed.");
      setError(e instanceof Error ? e.message : "Draft failed.");
    }
  }

  function stop() {
    stopRef.current = true;
    setStatus("idle"); setStatusStr(""); setDraftFieldId(null); setProposal(null);
  }

  // Ratify the drafted proposal (field-level moment).
  async function approveDraft() {
    if (!proposal || !draftFieldId) return;
    setActing(true); setError(null);
    const { data: result, error } = await supabase.rpc("accept_proposal", { p_proposal: proposal.id, p_ratifier: "web" });
    setActing(false);
    if (error) { setStatus("blocked"); setStatusStr(error.message); setError(error.message); return; }
    if (result === "conflicted") {
      setStatus("blocked");
      setStatusStr("The record moved since this draft — re-run against the current value.");
      return;
    }
    const fid = draftFieldId;
    setProposal(null); setDraftFieldId(null); setThinking(""); setStatus("idle"); setStatusStr("");
    setJustSaved(fid);
    await load();
  }

  // Edit-then-ratify: human takes the agent's draft into the editor.
  function editDraftValue() {
    if (!proposal || !draftFieldId) return;
    setEditId(draftFieldId);
    setEditDraft(proposal.value);
    setProposal(null);
  }

  async function discardDraft() {
    if (proposal) await supabase.from("proposals").delete().eq("id", proposal.id);
    setProposal(null); setDraftFieldId(null); setThinking(""); setStatus("idle"); setStatusStr("");
  }

  // ---- render ----------------------------------------------------------------
  const filled = fields.filter((f) => f.value && f.value.trim());
  const order: string[] = [];
  const bySection: Record<string, Field[]> = {};
  for (const f of filled) {
    const s = f.section || UNGROUPED;
    if (!bySection[s]) { bySection[s] = []; order.push(s); }
    bySection[s].push(f);
  }
  order.sort((a, b) => sectionRank(a) - sectionRank(b));

  const briefThemes = themes.slice(0, 12);
  const briefReleases = releases.slice(0, 8);
  const movedThemeCount = themes.length;
  const movedReleaseCount = releases.length;

  return (
    <div>
      {/* header: record selector (only if >1 in scope) + status pill */}
      <div className="row-between" style={{ marginBottom: "var(--sp-4)", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div className="row gap-2" style={{ alignItems: "center", minWidth: 0 }}>
          <span className="t-label">Messaging framework</span>
          {gtms.length > 1 ? (
            <select className="select" value={gtmId} onChange={(e) => { setGtmId(e.target.value); }} style={{ maxWidth: 280 }}>
              {gtms.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          ) : gtms.length === 1 ? (
            <span className="t-sub t-muted" style={{ fontSize: 12.5 }}>{gtms[0].name}</span>
          ) : null}
        </div>
        <div className="row gap-2" style={{ alignItems: "center" }}>
          <StatusPill status={status} note={statusStr} />
          <button className="btn btn-secondary btn-sm" onClick={() => setRailOpen((v) => !v)}>
            {railOpen ? "Hide brief" : "Show brief"}
          </button>
        </div>
      </div>

      <Banner>{error}</Banner>

      {loading ? (
        <div className="t-sub t-muted">Loading…</div>
      ) : !gtmId ? (
        <Empty title="No GTM record in scope" hint="Create a GTM record to build its messaging framework." />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: railOpen ? "minmax(0,1fr) 340px" : "minmax(0,1fr)", gap: "var(--sp-5)", alignItems: "start" }}>
          {/* ---------- CANVAS ---------- */}
          <div>
            {filled.length === 0 ? (
              <Empty title="No framework captured yet" hint="Fill in the GTM record's structured fields, then reflect the brief against them here." />
            ) : (
              order.map((sName) => (
                <section className="section" key={sName}>
                  <div className="section-head">
                    <div className="row gap-2"><span className="t-h2" style={{ fontSize: 14.5 }}>{sName}</span><span className="chip">{bySection[sName].length}</span></div>
                  </div>
                  <div className="card" style={{ overflow: "hidden" }}>
                    {bySection[sName].map((f, i) => {
                      const d = deltaFor(f);
                      const updatedTs = lastUpdated[f.id] ?? gtmCreatedAt;
                      const isDrafting = draftFieldId === f.id && status === "working";
                      const hasDraft = draftFieldId === f.id && proposal != null;
                      const editing = editId === f.id;
                      return (
                        <div key={f.id} style={{ padding: "16px 18px", borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                          <div className="row-between" style={{ marginBottom: 6, alignItems: "flex-start", gap: 10 }}>
                            <div className="row gap-2" style={{ alignItems: "center", flexWrap: "wrap" }}>
                              <span className="t-h2" style={{ fontSize: 13, fontWeight: 620 }}>{f.label}</span>
                              {d.stale
                                ? <Chip tone="amber">{d.themes.length + d.releases.length} moved</Chip>
                                : <Chip tone="green">Current</Chip>}
                            </div>
                            {!editing && !hasDraft && (
                              <div className="row gap-2" style={{ flexShrink: 0 }}>
                                <button className="btn btn-secondary btn-sm" onClick={() => { setEditId(f.id); setEditDraft(f.value ?? ""); }}>Edit</button>
                                <button className="btn btn-accent btn-sm" disabled={status === "working"} onClick={() => draft(f)}>
                                  {isDrafting ? "Drafting…" : "✦ Draft update"}
                                </button>
                              </div>
                            )}
                          </div>

                          {/* delta line + provenance */}
                          <div className="t-sub" style={{ fontSize: 12, color: d.stale ? "var(--am-text)" : "var(--tm)", marginBottom: d.stale ? 6 : 8 }}>{deltaLine(d)}</div>
                          {d.stale && (
                            <div className="row gap-2" style={{ flexWrap: "wrap", marginBottom: 8 }}>
                              {d.themes.slice(0, 3).map((t) => (
                                <SourceChip key={t.id} icon="◆" label={t.title} when={fmtWhen(t.last_evidence_at)} />
                              ))}
                              {d.releases.slice(0, 3).map((r) => (
                                <SourceChip key={r.id} icon="▲" label={r.version ? `${r.version} ${r.name}` : r.name} when={fmtWhen(r.target_date)} />
                              ))}
                            </div>
                          )}

                          {/* the value, or the editor, or the agent draft to ratify */}
                          {editing ? (
                            <div>
                              <textarea className="textarea" rows={4} autoFocus value={editDraft} onChange={(e) => setEditDraft(e.target.value)} style={{ marginBottom: 8 }} />
                              <div className="row gap-2">
                                <button className="btn btn-sm" onClick={() => saveHuman(f.id)}>Save</button>
                                <button className="btn btn-secondary btn-sm" onClick={() => setEditId(null)}>Cancel</button>
                              </div>
                            </div>
                          ) : hasDraft && proposal ? (
                            <div className="card card-pad reveal-up" style={{ borderLeft: "2px solid var(--vl)", background: "var(--fill)" }}>
                              <div className="t-label" style={{ marginBottom: 6, color: "var(--vl-text, var(--vl))" }}>Officer draft — ratify or edit</div>
                              <div className="t-body" style={{ lineHeight: 1.6, whiteSpace: "pre-wrap", marginBottom: 10 }}>{proposal.value}</div>
                              <div className="row gap-2" style={{ alignItems: "center" }}>
                                <button className="btn btn-success btn-sm" disabled={acting} onClick={approveDraft}>{acting ? "…" : "Approve"}</button>
                                <button className="btn btn-secondary btn-sm" disabled={acting} onClick={editDraftValue}>Edit</button>
                                <button className="btn btn-secondary btn-sm" disabled={acting} onClick={discardDraft}>Discard</button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="t-body" style={{ lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{f.value}</div>
                              {justSaved === f.id ? (
                                <div className="t-mono-xs" style={{ color: "var(--gn)", marginTop: 6 }}>ratified · just now</div>
                              ) : updatedTs ? (
                                <div className="t-mono-xs" style={{ color: "var(--tm)", marginTop: 6 }}>updated {fmtWhen(updatedTs)}</div>
                              ) : null}
                            </>
                          )}

                          {/* live reasoning while THIS element drafts */}
                          {isDrafting && (
                            <div style={{ marginTop: 10 }}>
                              <div className="t-label" style={{ color: "var(--ac)", marginBottom: 6 }}>Officer is working<PulseDots /></div>
                              <div ref={traceRef} style={{ fontSize: 11.5, lineHeight: 1.5, fontStyle: "italic", whiteSpace: "pre-wrap", color: "var(--tm)", borderLeft: "2px solid var(--border)", paddingLeft: 10, maxHeight: 160, overflowY: "auto" }}>
                                {thinking || "Reflecting the delta…"}
                              </div>
                              <button className="btn btn-secondary btn-sm" onClick={stop} style={{ marginTop: 8, color: "var(--rd-text)" }}>Stop</button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))
            )}
          </div>

          {/* ---------- BRIEF / REASONING RAIL ---------- */}
          {railOpen && (
            <aside style={{ position: "sticky", top: 12, alignSelf: "start" }}>
              <div className="card card-pad" style={{ marginBottom: "var(--sp-4)" }}>
                <div className="row-between" style={{ marginBottom: 4 }}>
                  <span className="t-label">What's new</span>
                  <span className="t-mono-xs" style={{ color: "var(--tm)" }}>{movedThemeCount} themes · {movedReleaseCount} shipped</span>
                </div>
                <div className="t-sub t-muted" style={{ fontSize: 12 }}>Reflect these against the framework. Each element shows only its own delta.</div>
              </div>

              {/* collapsible reasoning (one click away, not a modal) */}
              {thinking && status !== "working" && (
                <div className="card card-pad" style={{ marginBottom: "var(--sp-4)" }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => setShowReason((v) => !v)}>{showReason ? "Hide reasoning" : "Show reasoning"}</button>
                  {showReason && (
                    <div style={{ fontSize: 11.5, lineHeight: 1.5, fontStyle: "italic", whiteSpace: "pre-wrap", color: "var(--tm)", borderLeft: "2px solid var(--border)", paddingLeft: 10, marginTop: 8 }}>{thinking}</div>
                  )}
                </div>
              )}

              <div className="t-label" style={{ marginBottom: 8 }}>Themes moving</div>
              {briefThemes.length === 0 ? (
                <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 16 }}>No GTM themes in motion.</div>
              ) : (
                <div className="stack-2" style={{ marginBottom: 16 }}>
                  {briefThemes.map((t) => (
                    <div key={t.id} className="card card-pad" style={{ borderLeft: "2px solid var(--ac)" }}>
                      <div className="row-between" style={{ gap: 8, alignItems: "flex-start", marginBottom: 3 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 620, lineHeight: 1.35 }}>{t.title}</span>
                        {thisWeek[t.id] ? <Chip tone="accent">+{thisWeek[t.id]} this week</Chip> : null}
                      </div>
                      {(t.recommendation || t.summary) && (
                        <div className="t-sub" style={{ fontSize: 11.5, lineHeight: 1.5, marginBottom: 5 }}>{t.recommendation || t.summary}</div>
                      )}
                      <SourceChip icon="◆" label={t.state ?? "theme"} when={fmtWhen(t.last_evidence_at)} />
                    </div>
                  ))}
                </div>
              )}

              <div className="t-label" style={{ marginBottom: 8 }}>Shipped</div>
              {briefReleases.length === 0 ? (
                <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Nothing shipped in scope.</div>
              ) : (
                <div className="stack-2">
                  {briefReleases.map((r) => (
                    <div key={r.id} className="card card-pad" style={{ borderLeft: "2px solid var(--gn)" }}>
                      <div style={{ fontSize: 12.5, fontWeight: 620, lineHeight: 1.35, marginBottom: 3 }}>{r.version ? `${r.version} · ` : ""}{r.name}</div>
                      {r.summary && <div className="t-sub" style={{ fontSize: 11.5, lineHeight: 1.5, marginBottom: 5 }}>{r.summary}</div>}
                      <SourceChip icon="▲" label="released" when={fmtWhen(r.target_date)} />
                    </div>
                  ))}
                </div>
              )}
            </aside>
          )}
        </div>
      )}
    </div>
  );
}

function StatusPill({ status, note }: { status: Status; note: string }) {
  const tone = STATUS_TONE[status];
  return (
    <span className="row gap-2" style={{ alignItems: "center" }}>
      <Chip tone={tone}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", display: "inline-block" }} />
          {STATUS_LABEL[status]}
        </span>
      </Chip>
      {status === "working" && note && <span className="t-sub t-muted" style={{ fontSize: 11.5 }}>{note}</span>}
      {status === "blocked" && note && <span className="t-sub" style={{ fontSize: 11.5, color: "var(--am-text)" }}>{note}</span>}
    </span>
  );
}
