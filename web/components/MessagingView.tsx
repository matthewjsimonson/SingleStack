"use client";

// Messaging — the REVIEW surface of the GTM workflow (also at /messaging). It is a
// PRODUCTION surface, not a GTM-record editor: it takes a NEW input — a product
// RELEASE (new feature/module/tool) or a SIGNAL-THEME — and molds it into a
// messaging BRIEF, GROUNDED in the framework (the GTM record + product record).
// The framework is read-only CONTEXT the AI drafts from; it is never edited here.
// The brief is the seed downstream content/video/enablement/competitive execute
// from. It lives in messaging_artifacts (one brief per input).
//
// A 3-zone studio (full width):
//   - LEFT rail (sticky): the inputs list — releases + gtm signal-themes, grouped
//     by brief status (Needs messaging → Draft → Ratified), filterable.
//   - CENTER (the star): the review workspace for the selected input —
//       (A) "Under review" — rich, NO-AI context: the input's genuine guts
//           (release changelog / signal evidence) + a collapsible "Grounded in …"
//           framework section. Pure data display; expand/collapse is local state.
//       (B) "Messaging brief" — the authoring canvas: a markdown textarea with a
//           live Markdown preview (side-by-side on wide screens, Write/Preview
//           toggle on narrow). Save → upsert messaging_artifacts; Ratify locks it.
//           "Draft with AI" (officer chat) and "Refine with agent" (context
//           sidebar) assist; writes go through the HITL gate (human Saves).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useProductScope } from "@/lib/ProductContext";
import { getOrgId } from "@/lib/org";
import { Chip, Empty, Banner } from "@/components/ui";
import { Markdown } from "@/components/Markdown";
import {
  fetchOfficerKey, fmtWhen, buildGrounding, buildDraftContext,
  type ThemeRow, type ReleaseRow, type GroundingField,
} from "@/lib/messaging";
import DraftChatModal from "@/components/messaging/DraftChatModal";
import AgentPickerModal, { type RosterAgent } from "@/components/messaging/AgentPickerModal";
import ContextSidebar from "@/components/messaging/ContextSidebar";

type Gtm = { id: string; name: string; product_id: string | null };
type Status = "idle" | "working" | "blocked" | "done";
type BriefStatus = "draft" | "ratified" | "live";

// An existing messaging brief, mapped by its input (release_id / theme_id).
type Brief = {
  id: string;
  release_id: string | null;
  theme_id: string | null;
  body: string;
  status: BriefStatus;
  updated_at: string | null;
  title: string | null;
};

// One row in the inputs list — an input (release or theme) that needs messaging.
type Task =
  | { kind: "release"; id: string; row: ReleaseRow; brief: Brief | null }
  | { kind: "theme"; id: string; row: ThemeRow; brief: Brief | null };

// A release's changelog item (initiative_workstreams, area=build, by release_id).
type ChangelogItem = { id: string; title: string; change_type: string | null; stage: string | null };
// A signal-theme's supporting evidence (signals by signal_ids).
type EvidenceItem = { id: string; title: string; why: string | null; observed_at: string | null };

const STATUS_TONE: Record<Status, "default" | "accent" | "amber" | "green"> = {
  idle: "default", working: "accent", blocked: "amber", done: "green",
};
const STATUS_LABEL: Record<Status, string> = { idle: "Idle", working: "Working", blocked: "Blocked", done: "Done" };

// Release stages that need messaging now (planned shown below the others).
const RELEASE_STAGE_RANK: Record<string, number> = { in_dev: 0, released: 1, planned: 2 };
type Filter = "all" | "releases" | "signals";

// A task's messaging state drives its grouping in the list.
type Bucket = "needs" | "draft" | "ratified";
const bucketOf = (b: Brief | null): Bucket =>
  !b ? "needs" : b.status === "draft" ? "draft" : "ratified";
const BUCKET_LABEL: Record<Bucket, string> = { needs: "Needs messaging", draft: "Draft", ratified: "Ratified" };
const BUCKET_ORDER: Bucket[] = ["needs", "draft", "ratified"];

// change_type labels for a release's changelog rows.
const CHANGE_LABEL: Record<string, string> = {
  feature: "Feature", feature_update: "Feature update", module_update: "Module update",
  bug_fix: "Bug fix", enhancement: "Enhancement",
};

// Relative "Nh ago" for signal evidence.
function relTime(ts: string | null): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return fmtWhen(ts);
}

export default function MessagingView() {
  const supabase = createClient();
  const { active, matches } = useProductScope();

  const [gtms, setGtms] = useState<Gtm[]>([]);
  const [gtmId, setGtmId] = useState<string>("");

  const [releases, setReleases] = useState<ReleaseRow[]>([]);
  const [themes, setThemes] = useState<ThemeRow[]>([]);
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [gtmFields, setGtmFields] = useState<GroundingField[]>([]);
  const [productFields, setProductFields] = useState<GroundingField[]>([]);
  const [productName, setProductName] = useState<string | null>(null);
  const [officerKey, setOfficerKey] = useState<string | null>(null);
  const [roster, setRoster] = useState<RosterAgent[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ---- AI action status (drives the Status pill — secondary now) -------------
  const [status, setStatus] = useState<Status>("idle");
  const [statusStr, setStatusStr] = useState("");

  // ---- task selection + editor state -----------------------------------------
  const [selectedKey, setSelectedKey] = useState<string | null>(null); // `${kind}:${id}`
  const [filter, setFilter] = useState<Filter>("all");
  const [body, setBody] = useState("");                 // the brief markdown
  const [savedBody, setSavedBody] = useState("");       // last persisted body (for dirty)
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ---- "Under review" expand/collapse (NO AI — pure local state) -------------
  const [groundedOpen, setGroundedOpen] = useState(false);
  const [changelog, setChangelog] = useState<ChangelogItem[]>([]);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [ctxLoading, setCtxLoading] = useState(false);

  // ---- narrow-screen Write/Preview toggle ------------------------------------
  const [mobileTab, setMobileTab] = useState<"write" | "preview">("write");

  // ---- AI surfaces -----------------------------------------------------------
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftAgentKey, setDraftAgentKey] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sidebarAgent, setSidebarAgent] = useState<RosterAgent | null>(null);
  const [sidebarSelText, setSidebarSelText] = useState<string | null>(null);
  const pendingRange = useRef<{ from: number; to: number } | null>(null);

  const dirty = body !== savedBody;

  // ---- pick the active GTM record (scope-aware) ------------------------------
  const loadGtms = useCallback(async () => {
    const { data } = await supabase.from("gtm_records").select("id, name, product_id, created_at").order("created_at");
    const rows = (data ?? []) as (Gtm & { created_at: string })[];
    const scoped = rows.filter((r) => matches(r));
    const pool = scoped.length ? scoped : rows;
    setGtms(pool.map(({ id, name, product_id }) => ({ id, name, product_id })));
    if (pool.length && !pool.some((g) => g.id === gtmId)) {
      const pick = active !== "all" && active !== "company"
        ? pool.find((g) => g.product_id === active) ?? pool[0]
        : pool[0];
      setGtmId(pick.id);
    }
  }, [supabase, matches, active, gtmId]);

  useEffect(() => { loadGtms(); }, [loadGtms]);

  // The product the active GTM record is grounded in (for product_id + fields).
  const activeProductId = useMemo(
    () => gtms.find((g) => g.id === gtmId)?.product_id ?? null,
    [gtms, gtmId],
  );
  const activeGtmName = useMemo(() => gtms.find((g) => g.id === gtmId)?.name ?? null, [gtms, gtmId]);

  // ---- load inputs + briefs + roster + officer -------------------------------
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const [{ data: rl }, { data: th }, { data: ma }, { data: ag }] = await Promise.all([
      supabase.from("releases")
        .select("id, name, version, summary, stage, target_date, product_id, org_id")
        .in("stage", ["in_dev", "released", "planned"])
        .order("target_date", { ascending: false, nullsFirst: false }),
      supabase.from("signal_themes")
        .select("id, title, summary, recommendation, conf_level, category, state, org_id, signal_ids")
        .in("category", ["gtm", "both"]).neq("state", "dormant"),
      supabase.from("messaging_artifacts")
        .select("id, release_id, theme_id, body, status, updated_at, title"),
      supabase.from("agents").select("id, key, name, role").eq("is_active", true),
    ]);
    setReleases(((rl ?? []) as ReleaseRow[]).filter((r) => matches(r)));
    setThemes((th ?? []) as ThemeRow[]);
    setBriefs((ma ?? []) as Brief[]);
    setRoster((ag ?? []) as RosterAgent[]);
    setOfficerKey(await fetchOfficerKey(supabase));
    setLoading(false);
  }, [supabase, matches]);

  useEffect(() => { load(); }, [load]);

  // ---- load the read-only GROUNDING (GTM record + product record fields) ------
  useEffect(() => {
    let alive = true;
    (async () => {
      const gtmReq = gtmId
        ? supabase.from("record_fields").select("field_key, label, value, section").eq("gtm_record_id", gtmId)
        : null;
      const prodReq = activeProductId
        ? supabase.from("record_fields").select("field_key, label, value, section").eq("product_id", activeProductId)
        : null;
      const nameReq = activeProductId
        ? supabase.from("product_records").select("name").eq("id", activeProductId).maybeSingle()
        : null;
      const [g, p, n] = await Promise.all([gtmReq, prodReq, nameReq]);
      if (!alive) return;
      setGtmFields((g?.data ?? []) as GroundingField[]);
      setProductFields((p?.data ?? []) as GroundingField[]);
      setProductName((n?.data as { name?: string } | null)?.name ?? null);
    })();
    return () => { alive = false; };
  }, [supabase, gtmId, activeProductId]);

  // The assembled grounding string the AI drafts from.
  const grounding = useMemo(() => buildGrounding(gtmFields, productFields), [gtmFields, productFields]);

  // ---- map briefs onto their inputs + assemble the inputs list ---------------
  const briefByRelease = useMemo(() => {
    const m = new Map<string, Brief>();
    for (const b of briefs) if (b.release_id) m.set(b.release_id, b);
    return m;
  }, [briefs]);
  const briefByTheme = useMemo(() => {
    const m = new Map<string, Brief>();
    for (const b of briefs) if (b.theme_id) m.set(b.theme_id, b);
    return m;
  }, [briefs]);

  const allTasks = useMemo<Task[]>(() => {
    const rel: Task[] = releases.map((r) => ({ kind: "release", id: r.id, row: r, brief: briefByRelease.get(r.id) ?? null }));
    const sig: Task[] = themes.map((t) => ({ kind: "theme", id: t.id, row: t, brief: briefByTheme.get(t.id) ?? null }));
    return [...rel, ...sig];
  }, [releases, themes, briefByRelease, briefByTheme]);

  const filteredTasks = useMemo(() => {
    const base = filter === "releases" ? allTasks.filter((t) => t.kind === "release")
      : filter === "signals" ? allTasks.filter((t) => t.kind === "theme")
      : allTasks;
    const relRank = (t: Task) => t.kind === "release" ? (RELEASE_STAGE_RANK[t.row.stage ?? ""] ?? 3) : 1;
    return [...base].sort((a, b) => relRank(a) - relRank(b));
  }, [allTasks, filter]);

  // Group the (filtered) inputs list by messaging state.
  const grouped = useMemo(() => {
    const g: Record<Bucket, Task[]> = { needs: [], draft: [], ratified: [] };
    for (const t of filteredTasks) g[bucketOf(t.brief)].push(t);
    return g;
  }, [filteredTasks]);

  const keyOf = (t: Task) => `${t.kind}:${t.id}`;
  const selectedTask = useMemo(
    () => allTasks.find((t) => keyOf(t) === selectedKey) ?? null,
    [allTasks, selectedKey],
  );

  // Auto-select the first input that needs messaging (else first available).
  useEffect(() => {
    if (!filteredTasks.length) { setSelectedKey(null); return; }
    if (selectedKey && filteredTasks.some((t) => keyOf(t) === selectedKey)) return;
    const first = grouped.needs[0] ?? grouped.draft[0] ?? grouped.ratified[0] ?? filteredTasks[0];
    setSelectedKey(first ? keyOf(first) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredTasks, grouped]);

  // Seed the editor whenever the selected input changes (from its brief body).
  useEffect(() => {
    const b = selectedTask?.brief?.body ?? "";
    setBody(b); setSavedBody(b);
    setGroundedOpen(false); setMobileTab("write");
    setSidebarAgent(null); setStatus("idle"); setStatusStr("");
  }, [selectedKey, selectedTask]);

  // ---- (A) "Under review" context — NO AID, loaded when the input changes -----
  // For a RELEASE: its changelog (initiative_workstreams, area=build, by release).
  // For a THEME: its supporting evidence (signals by signal_ids).
  useEffect(() => {
    let alive = true;
    setChangelog([]); setEvidence([]);
    if (!selectedTask) return;
    (async () => {
      setCtxLoading(true);
      try {
        if (selectedTask.kind === "release") {
          const { data } = await supabase.from("initiative_workstreams")
            .select("id, title, change_type, stage")
            .eq("release_id", selectedTask.id).eq("area", "build");
          if (alive) setChangelog((data ?? []) as ChangelogItem[]);
        } else {
          const ids = (selectedTask.row as ThemeRow & { signal_ids?: string[] | null }).signal_ids ?? [];
          if (ids.length) {
            const { data } = await supabase.from("signals")
              .select("id, title, why, observed_at")
              .in("id", ids).order("observed_at", { ascending: false, nullsFirst: false });
            if (alive) setEvidence((data ?? []) as EvidenceItem[]);
          }
        }
      } finally {
        if (alive) setCtxLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [supabase, selectedKey, selectedTask]);

  function selectTask(t: Task) {
    const k = keyOf(t);
    if (dirty && k !== selectedKey && !confirm("Discard unsaved edits to this brief?")) return;
    setSelectedKey(k);
  }

  // ---- the draft context handed to the AI (input + grounding) ----------------
  const draftContext = useMemo(() => {
    if (!selectedTask) return "";
    return selectedTask.kind === "release"
      ? buildDraftContext({ kind: "release", row: selectedTask.row }, grounding)
      : buildDraftContext({ kind: "theme", row: selectedTask.row }, grounding);
  }, [selectedTask, grounding]);

  const taskTitle = (t: Task) =>
    t.kind === "release"
      ? `${t.row.version ? `${t.row.version} ` : ""}${t.row.name}`
      : t.row.title;

  // ---- Save (the HITL write — upsert messaging_artifacts) ---------------------
  async function save() {
    if (!selectedTask) return;
    setSaving(true); setError(null);
    const title = taskTitle(selectedTask);
    const now = new Date().toISOString();
    try {
      if (selectedTask.brief) {
        const { error } = await supabase.from("messaging_artifacts")
          .update({ body, updated_at: now, title }).eq("id", selectedTask.brief.id);
        if (error) throw error;
      } else {
        const orgId = selectedTask.row.org_id ?? (await getOrgId());
        if (!orgId) throw new Error("Could not resolve your organization.");
        const { error } = await supabase.from("messaging_artifacts").insert({
          org_id: orgId,
          release_id: selectedTask.kind === "release" ? selectedTask.id : null,
          theme_id: selectedTask.kind === "theme" ? selectedTask.id : null,
          gtm_record_id: gtmId || null,
          product_id: activeProductId,
          body, status: "draft", title,
        });
        if (error) throw error;
      }
      setSavedBody(body);
      setJustSaved(selectedKey);
      setStatus("done"); setStatusStr("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
      setStatus("blocked"); setStatusStr(e instanceof Error ? e.message : "");
    } finally { setSaving(false); }
  }

  // ---- Ratify (lock the brief as the seed downstream executes from) ----------
  async function ratify() {
    if (!selectedTask?.brief) return;
    setSaving(true); setError(null);
    const now = new Date().toISOString();
    const { error } = await supabase.from("messaging_artifacts")
      .update({ status: "ratified", ratified_at: now, updated_at: now }).eq("id", selectedTask.brief.id);
    setSaving(false);
    if (error) { setError(error.message || "Could not ratify."); setStatus("blocked"); setStatusStr(error.message); return; }
    setStatus("done"); setStatusStr("");
    await load();
  }

  // ---- Draft with AI (popup chat, grounded in the framework) -----------------
  function openDraft() {
    if (!officerKey) { setError("No officer available — seed agents first."); return; }
    setDraftAgentKey(draftAgentKey ?? officerKey);
    setDraftOpen(true);
  }
  function useDraft(markdown: string) {
    setBody(markdown);
    setDraftOpen(false);
    setStatus("idle"); setStatusStr("");
  }

  // ---- Refine with agent → picker → context sidebar --------------------------
  // If text is selected in the textarea, the rewrite splices into that range;
  // otherwise the agent helps with the whole brief and Apply replaces the body.
  function openRefine() {
    const el = textareaRef.current;
    const sel = el && el.selectionEnd > el.selectionStart
      ? { from: el.selectionStart, to: el.selectionEnd, text: body.slice(el.selectionStart, el.selectionEnd) }
      : null;
    pendingRange.current = sel ? { from: sel.from, to: sel.to } : null;
    setSidebarSelText(sel?.text ?? null);
    setPickerOpen(true);
  }
  function pickAgent(a: RosterAgent) {
    setPickerOpen(false);
    setSidebarAgent(a);
  }
  function applyRewrite(text: string) {
    const range = pendingRange.current;
    if (range) {
      setBody((prev) => prev.slice(0, range.from) + text + prev.slice(range.to));
    } else {
      setBody(text);
    }
    setSidebarAgent(null);
  }

  // ---- render ----------------------------------------------------------------
  const needsCount = grouped.needs.length;
  const selectedBrief = selectedTask?.brief ?? null;
  const isRatified = selectedBrief?.status === "ratified" || selectedBrief?.status === "live";
  const elementLabel = selectedTask ? taskTitle(selectedTask) : "";
  const sidebarOpen = !!sidebarAgent;
  // full-width 3-zone studio: left rail · center workspace · (optional) sidebar
  const gridCols = sidebarOpen ? "260px minmax(0,1fr) 360px" : "260px minmax(0,1fr)";

  const FILTERS: { id: Filter; label: string }[] = [
    { id: "all", label: "All" }, { id: "releases", label: "Releases" }, { id: "signals", label: "Signals" },
  ];

  const briefStatusChip = isRatified
    ? <Chip tone="green">Ratified</Chip>
    : selectedBrief ? <Chip tone="amber">Draft</Chip>
    : <Chip tone="default">Needs messaging</Chip>;

  return (
    <div>
      {/* header: record selector (only if >1 in scope) + needs count + status pill */}
      <div className="row-between" style={{ marginBottom: "var(--sp-4)", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div className="row gap-2" style={{ alignItems: "center", minWidth: 0 }}>
          <span className="t-label">Review</span>
          {gtms.length > 1 ? (
            <select className="select" value={gtmId} onChange={(e) => setGtmId(e.target.value)} style={{ maxWidth: 280 }}>
              {gtms.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          ) : gtms.length === 1 ? (
            <span className="t-sub t-muted" style={{ fontSize: 12.5 }}>Grounded in {gtms[0].name}</span>
          ) : null}
        </div>
        <div className="row gap-2" style={{ alignItems: "center" }}>
          <span className="t-mono-xs" style={{ color: "var(--tm)" }}>Needs messaging · {needsCount}</span>
          <StatusPill status={status} note={statusStr} />
        </div>
      </div>

      <Banner>{error}</Banner>

      {loading ? (
        <div className="t-sub t-muted">Loading…</div>
      ) : allTasks.length === 0 ? (
        <Empty title="Nothing to message yet" hint="Releases (in dev or shipped) and gtm signal-themes show up here as inputs to mold messaging for." />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: gridCols, gap: "var(--sp-5)", alignItems: "start" }}>
          {/* ---------- LEFT RAIL · INPUTS ---------- */}
          <aside style={{ position: "sticky", top: 12, alignSelf: "start" }}>
            <div className="card" style={{ overflow: "hidden" }}>
              <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", background: "var(--panel-2)" }}>
                <div className="row-between" style={{ alignItems: "center", marginBottom: 8 }}>
                  <span className="t-label">Inputs</span>
                  <span className="t-mono-xs" style={{ color: "var(--tm)" }}>{filteredTasks.length}</span>
                </div>
                <div className="row gap-2">
                  {FILTERS.map((f) => (
                    <button key={f.id} onClick={() => setFilter(f.id)} className="chip"
                      style={{ cursor: "pointer", fontSize: 11, border: "1px solid " + (filter === f.id ? "var(--ac)" : "var(--border)"), background: filter === f.id ? "var(--ac-fill, var(--fill))" : "transparent", color: filter === f.id ? "var(--ac-text)" : "var(--ts)" }}>
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ maxHeight: "78vh", overflowY: "auto" }}>
                {filteredTasks.length === 0 && (
                  <div className="t-sub t-muted" style={{ fontSize: 12, padding: "12px 14px" }}>No inputs match this filter.</div>
                )}
                {BUCKET_ORDER.map((bucket) => grouped[bucket].length > 0 && (
                  <div key={bucket}>
                    <div className="t-mono-xs" style={{ color: "var(--tm)", padding: "10px 14px 4px", borderTop: "1px solid var(--border)", textTransform: "uppercase", letterSpacing: 0.4 }}>
                      {BUCKET_LABEL[bucket]} · {grouped[bucket].length}
                    </div>
                    {grouped[bucket].map((t) => (
                      <TaskRow key={keyOf(t)} task={t} bucket={bucket}
                        active={keyOf(t) === selectedKey} onClick={() => selectTask(t)} />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </aside>

          {/* ---------- CENTER · REVIEW WORKSPACE ---------- */}
          <div style={{ minWidth: 0 }}>
            {!selectedTask ? (
              <Empty title="Select an input" hint="Pick a release or signal on the left to inspect it and mold its messaging brief." />
            ) : (
              <div className="stack-5" style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
                {/* === (A) UNDER REVIEW — rich context, NO AI ============ */}
                <UnderReview
                  task={selectedTask}
                  changelog={changelog}
                  evidence={evidence}
                  ctxLoading={ctxLoading}
                  gtmName={activeGtmName}
                  productName={productName}
                  gtmFields={gtmFields}
                  productFields={productFields}
                  groundedOpen={groundedOpen}
                  onToggleGrounded={() => setGroundedOpen((v) => !v)}
                />

                {/* === (B) MESSAGING BRIEF — the authoring canvas ========= */}
                <section className="card" style={{ overflow: "hidden" }}>
                  <div className="row-between" style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", alignItems: "center", gap: 12, flexWrap: "wrap", background: "var(--panel-2)" }}>
                    <div className="row gap-2" style={{ alignItems: "center", flexWrap: "wrap" }}>
                      <span className="t-label">Messaging brief</span>
                      {briefStatusChip}
                      {dirty ? <span className="t-mono-xs" style={{ color: "var(--am-text)" }}>unsaved edits</span>
                        : justSaved === selectedKey ? <span className="t-mono-xs" style={{ color: "var(--gn)" }}>saved · just now</span>
                        : isRatified ? <span className="t-mono-xs" style={{ color: "var(--gn)" }}>ratified{selectedBrief?.updated_at ? ` · ${fmtWhen(selectedBrief.updated_at)}` : ""}</span>
                        : selectedBrief?.updated_at ? <span className="t-mono-xs" style={{ color: "var(--tm)" }}>updated {fmtWhen(selectedBrief.updated_at)}</span>
                        : null}
                    </div>
                    <div className="row gap-2" style={{ flexShrink: 0, flexWrap: "wrap" }}>
                      <button className="btn btn-accent btn-sm" onClick={openDraft}>Draft with AI</button>
                      <button className="btn btn-secondary btn-sm" onClick={openRefine}>Refine with agent</button>
                      <button className="btn btn-sm" disabled={saving || !dirty} onClick={save}>{saving ? "Saving…" : "Save"}</button>
                      <button className="btn btn-secondary btn-sm" disabled={saving || !selectedBrief || isRatified || dirty} onClick={ratify}>
                        {isRatified ? "Ratified" : "Ratify"}
                      </button>
                    </div>
                  </div>

                  {/* narrow-screen Write/Preview toggle (hidden on wide via CSS) */}
                  <div className="msg-tabs" style={{ display: "none", padding: "8px 18px 0", gap: 8 }}>
                    {(["write", "preview"] as const).map((t) => (
                      <button key={t} onClick={() => setMobileTab(t)} className="chip"
                        style={{ cursor: "pointer", fontSize: 11.5, textTransform: "capitalize",
                          border: "1px solid " + (mobileTab === t ? "var(--ac)" : "var(--border)"),
                          background: mobileTab === t ? "var(--ac-fill, var(--fill))" : "transparent",
                          color: mobileTab === t ? "var(--ac-text)" : "var(--ts)" }}>
                        {t}
                      </button>
                    ))}
                  </div>

                  {/* side-by-side editor / live preview (wide) → toggled (narrow) */}
                  <div className="msg-split" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-5)", padding: 18 }}>
                    <div className={mobileTab === "preview" ? "msg-pane-hide" : ""} style={{ minWidth: 0 }}>
                      <div className="t-mono-xs" style={{ color: "var(--tm)", marginBottom: 6 }}>Write · markdown</div>
                      <textarea
                        ref={textareaRef}
                        className="textarea"
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        placeholder="Write the messaging brief in markdown — or Draft with AI to seed it, then refine."
                        style={{ width: "100%", minHeight: "52vh", fontSize: 13.5, lineHeight: 1.6 }}
                      />
                    </div>
                    <div className={mobileTab === "write" ? "msg-pane-hide" : ""} style={{ minWidth: 0 }}>
                      <div className="t-mono-xs" style={{ color: "var(--tm)", marginBottom: 6 }}>Preview</div>
                      <div style={{ minHeight: "52vh", padding: "12px 16px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--panel)", overflowY: "auto" }}>
                        {body.trim()
                          ? <Markdown text={body} style={{ fontSize: 13.5, lineHeight: 1.6 }} />
                          : <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Nothing to preview yet.</div>}
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            )}
          </div>

          {/* ---------- CONTEXT SIDEBAR (Refine with agent) ---------- */}
          {sidebarAgent && selectedTask && (
            <ContextSidebar
              agent={sidebarAgent}
              elementLabel={elementLabel}
              elementValue={body}
              brief={draftContext}
              selection={sidebarSelText}
              onApply={applyRewrite}
              onClose={() => setSidebarAgent(null)}
            />
          )}
        </div>
      )}

      {/* ---------- Draft-with-AI popup chat ---------- */}
      {selectedTask && (
        <DraftChatModal
          open={draftOpen}
          onClose={() => setDraftOpen(false)}
          elementLabel={elementLabel}
          currentValue={body}
          brief={draftContext}
          agentKey={draftAgentKey}
          roster={roster}
          onAgentChange={setDraftAgentKey}
          onUseDraft={useDraft}
          onBusyChange={(b) => { setStatus(b ? "working" : "idle"); setStatusStr(b ? "Drafting…" : ""); }}
        />
      )}

      {/* ---------- Agent picker popup ---------- */}
      <AgentPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        roster={roster}
        onPick={pickAgent}
        title="Choose an agent"
        hint={sidebarSelText
          ? "The agent will propose a rewrite of just the highlighted text in a context sidebar."
          : "The agent will help with this whole brief in a context sidebar."}
      />

      {/* responsive: collapse the editor to a single toggled pane on narrow screens */}
      <style jsx>{`
        @media (max-width: 1100px) {
          .msg-split { grid-template-columns: 1fr !important; }
          .msg-tabs { display: flex !important; }
          .msg-pane-hide { display: none !important; }
        }
      `}</style>
    </div>
  );
}

// ---- (A) UNDER REVIEW — rich, NO-AI context for the selected input -----------
function UnderReview({
  task, changelog, evidence, ctxLoading, gtmName, productName,
  gtmFields, productFields, groundedOpen, onToggleGrounded,
}: {
  task: Task;
  changelog: ChangelogItem[];
  evidence: EvidenceItem[];
  ctxLoading: boolean;
  gtmName: string | null;
  productName: string | null;
  gtmFields: GroundingField[];
  productFields: GroundingField[];
  groundedOpen: boolean;
  onToggleGrounded: () => void;
}) {
  const title = task.kind === "release"
    ? `${task.row.version ? `${task.row.version} ` : ""}${task.row.name}`
    : task.row.title;

  return (
    <section className="card" style={{ overflow: "hidden" }}>
      <div style={{ padding: "10px 18px", borderBottom: "1px solid var(--border)", background: "var(--panel-2)" }}>
        <span className="t-label">Under review</span>
      </div>
      <div style={{ padding: 18 }}>
        {/* header */}
        <div className="row gap-2" style={{ alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
          <span className="t-h2" style={{ fontSize: 19 }}>{title}</span>
          {task.kind === "release" ? (
            <>
              <Chip tone="default">{task.row.stage ?? "release"}</Chip>
              {task.row.target_date && <Chip tone="default">{fmtWhen(task.row.target_date)}</Chip>}
              {productName && <Chip tone="default">{productName}</Chip>}
            </>
          ) : (
            <>
              <Chip tone="accent">signal</Chip>
              {task.row.state && <Chip tone="default">{task.row.state}</Chip>}
              {task.row.conf_level != null && <Chip tone="default">{Math.round(task.row.conf_level * 100)}% confidence</Chip>}
            </>
          )}
        </div>

        {/* full summary */}
        {task.row.summary && (
          <div className="t-body" style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--ts)", marginBottom: 14 }}>
            {task.row.summary}
          </div>
        )}

        {/* theme: recommendation callout */}
        {task.kind === "theme" && task.row.recommendation && (
          <div className="card card-pad" style={{ borderLeft: "2px solid var(--ac)", background: "var(--fill)", marginBottom: 14 }}>
            <div className="t-label" style={{ color: "var(--tm)", marginBottom: 4 }}>Recommendation</div>
            <div className="t-body" style={{ fontSize: 13, lineHeight: 1.55 }}>{task.row.recommendation}</div>
          </div>
        )}

        {/* release: "What's in this release" changelog */}
        {task.kind === "release" && (
          <div style={{ marginBottom: 4 }}>
            <div className="t-label" style={{ color: "var(--tm)", marginBottom: 8 }}>What&apos;s in this release</div>
            {ctxLoading ? (
              <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Loading changelog…</div>
            ) : changelog.length === 0 ? (
              <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No changelog items linked to this release yet.</div>
            ) : (
              <div className="stack-2" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {changelog.map((c) => (
                  <div key={c.id} className="row gap-2" style={{ alignItems: "center", padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--panel)" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--tp)", minWidth: 0, flex: 1 }}>{c.title}</span>
                    {c.change_type && <Chip tone="default">{CHANGE_LABEL[c.change_type] ?? c.change_type}</Chip>}
                    {c.stage && <span className="t-mono-xs" style={{ color: "var(--tm)" }}>{c.stage}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* theme: "Evidence" — supporting signals */}
        {task.kind === "theme" && (
          <div style={{ marginBottom: 4 }}>
            <div className="t-label" style={{ color: "var(--tm)", marginBottom: 8 }}>Evidence</div>
            {ctxLoading ? (
              <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Loading evidence…</div>
            ) : evidence.length === 0 ? (
              <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No supporting signals linked.</div>
            ) : (
              <div className="stack-2" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {evidence.map((s) => (
                  <div key={s.id} style={{ padding: "9px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--panel)" }}>
                    <div className="row-between" style={{ alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--tp)", minWidth: 0 }}>{s.title}</span>
                      {relTime(s.observed_at) && <span className="t-mono-xs" style={{ color: "var(--tm)", flexShrink: 0 }}>{relTime(s.observed_at)}</span>}
                    </div>
                    {s.why && <div className="t-sub" style={{ fontSize: 12, lineHeight: 1.5, color: "var(--tm)", marginTop: 3 }}>{s.why}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* collapsible "Grounded in …" framework (read-only context) */}
        <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          <button onClick={onToggleGrounded}
            className="row gap-2"
            style={{ alignItems: "center", background: "none", border: "none", padding: 0, cursor: "pointer", width: "100%", textAlign: "left" }}>
            <span style={{ fontSize: 11, color: "var(--tm)", width: 12, display: "inline-block" }}>{groundedOpen ? "−" : "+"}</span>
            <span className="t-mono-xs" style={{ color: "var(--tm)" }}>
              Grounded in {gtmName ?? "GTM record"}{productName ? ` · ${productName}` : ""}
            </span>
          </button>
          {groundedOpen && (
            <div style={{ marginTop: 10 }}>
              <GroundingList gtmFields={gtmFields} productFields={productFields} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// The key framework fields the brief draws on — read-only, truncated. Context only.
function GroundingList({ gtmFields, productFields }: { gtmFields: GroundingField[]; productFields: GroundingField[] }) {
  const GTM_KEYS: [string, string][] = [
    ["category_pov", "Category POV"], ["positioning", "Positioning"], ["differentiation", "Differentiation"],
    ["value_prop", "Value prop"], ["pillars", "Pillars"],
    ["icp", "ICP"], ["primary_persona", "Primary persona"],
  ];
  const PROD_KEYS: [string, string][] = [
    ["what_it_is", "What it is"], ["who_its_for", "Who it's for"], ["problem", "Problem"],
    ["core_capabilities", "Core capabilities"], ["differentiated_capabilities", "Differentiated capabilities"],
  ];
  const pick = (rows: GroundingField[], keys: [string, string][]) =>
    keys.map(([k, label]) => {
      const f = rows.find((r) => r.field_key === k);
      const v = (f?.value ?? "").trim();
      return v ? { label: f?.label || label, value: v } : null;
    }).filter((x): x is { label: string; value: string } => !!x);

  const gtm = pick(gtmFields, GTM_KEYS);
  const prod = pick(productFields, PROD_KEYS);

  if (!gtm.length && !prod.length) {
    return <div className="t-sub t-muted" style={{ fontSize: 12 }}>No framework fields captured yet.</div>;
  }

  const Row = ({ label, value }: { label: string; value: string }) => (
    <div style={{ display: "grid", gridTemplateColumns: "150px minmax(0,1fr)", gap: 10, padding: "5px 0", borderTop: "1px solid var(--border)" }}>
      <span className="t-mono-xs" style={{ color: "var(--tm)" }}>{label}</span>
      <span className="t-sub" style={{ fontSize: 12, color: "var(--ts)", lineHeight: 1.5, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>{value}</span>
    </div>
  );

  return (
    <div>
      {gtm.length > 0 && (
        <div style={{ marginBottom: prod.length ? 12 : 0 }}>
          <div className="t-mono-xs" style={{ color: "var(--tm)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 2 }}>GTM framework</div>
          {gtm.map((r) => <Row key={r.label} {...r} />)}
        </div>
      )}
      {prod.length > 0 && (
        <div>
          <div className="t-mono-xs" style={{ color: "var(--tm)", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 2 }}>Product record</div>
          {prod.map((r) => <Row key={r.label} {...r} />)}
        </div>
      )}
    </div>
  );
}

function TaskRow({ task, bucket, active, onClick }: {
  task: Task; bucket: Bucket; active: boolean; onClick: () => void;
}) {
  const label = task.kind === "release"
    ? `${task.row.version ? `${task.row.version} ` : ""}${task.row.name}`
    : task.row.title;
  const chip = task.kind === "release" ? (task.row.stage ?? "release") : "signal";
  const when = task.kind === "release" ? fmtWhen(task.row.target_date) : null;
  const dimmed = bucket === "ratified" && !active;
  const dotTone = bucket === "needs" ? "var(--am-text)" : bucket === "draft" ? "var(--ac)" : "var(--gn)";
  return (
    <button onClick={onClick} style={{
      display: "block", width: "100%", textAlign: "left", cursor: "pointer", border: "none",
      borderTop: "1px solid var(--border)", borderLeft: `2px solid ${active ? "var(--ac)" : "transparent"}`,
      background: active ? "var(--ac-fill, var(--fill))" : "transparent",
      padding: "10px 12px", opacity: dimmed ? 0.72 : 1,
    }}>
      <div className="row gap-2" style={{ alignItems: "center", flexWrap: "wrap", marginBottom: 3 }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: dotTone, display: "inline-block", flexShrink: 0 }} />
        <span style={{ fontSize: 12.5, fontWeight: active ? 660 : 600, color: "var(--tp)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
        <span className="chip" style={{ fontSize: 9.5 }}>{chip}</span>
      </div>
      <div className="t-mono-xs" style={{ color: "var(--tm)" }}>
        {task.kind === "release" ? (when ? `release · ${when}` : "release") : "signal-theme"}
      </div>
    </button>
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
