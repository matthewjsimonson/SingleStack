"use client";

// Messaging — a PRODUCTION surface, not a GTM-record editor. It takes a NEW input
// — a product RELEASE (new feature/module/tool) or a SIGNAL-THEME — and molds it
// into a messaging BRIEF for that input, GROUNDED in the framework (the GTM record
// + product record). The framework is read-only CONTEXT the AI drafts from; it is
// never edited here. The brief is the seed downstream content/video/enablement/
// competitive execute from. It lives in messaging_artifacts (one brief per input).
//   - Left: a TASK LIST of inputs that need messaging (Needs messaging → Draft →
//     Ratified), filterable (All / Releases / Signals).
//   - Center: the input shown as read context + a "Grounded in …" provenance line,
//     then the brief in a TipTap editor.
//       · "Draft with AI"  → a popup chat where the officer synthesizes the brief
//         for THIS input, grounded in the framework; "Use this draft" loads it.
//       · Highlight → Agent → an agent-picker popup → a right context sidebar that
//         rewrites JUST the selection, grounded in the same framework.
//   - Writes go through the HITL gate only — the human reviews, then Saves (upsert
//     into messaging_artifacts) and can Ratify.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { createClient } from "@/lib/supabase/client";
import { useProductScope } from "@/lib/ProductContext";
import { getOrgId } from "@/lib/org";
import { Chip, Empty, Banner } from "@/components/ui";
import {
  fetchOfficerKey, fmtWhen, buildGrounding, buildDraftContext,
  type ThemeRow, type ReleaseRow, type GroundingField,
} from "@/lib/messaging";
import RichEditor, { editorMarkdown, type SelectionInfo } from "@/components/messaging/RichEditor";
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

// One row in the task list — an input (release or theme) that needs messaging.
type Task =
  | { kind: "release"; id: string; row: ReleaseRow; brief: Brief | null }
  | { kind: "theme"; id: string; row: ThemeRow; brief: Brief | null };

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

  // ---- AI action status (drives the Status pill) -----------------------------
  const [status, setStatus] = useState<Status>("idle");
  const [statusStr, setStatusStr] = useState("");

  // ---- task selection + editor state -----------------------------------------
  const [selectedKey, setSelectedKey] = useState<string | null>(null); // `${kind}:${id}`
  const [filter, setFilter] = useState<Filter>("all");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [seed, setSeed] = useState("");                 // current editor seed (markdown)
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const pendingRange = useRef<{ from: number; to: number } | null>(null);

  // ---- AI surfaces -----------------------------------------------------------
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftAgentKey, setDraftAgentKey] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sidebarAgent, setSidebarAgent] = useState<RosterAgent | null>(null);
  const [sidebarSelText, setSidebarSelText] = useState<string | null>(null);

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

  // ---- load inputs + briefs + grounding + roster -----------------------------
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const [{ data: rl }, { data: th }, { data: ma }, { data: ag }] = await Promise.all([
      supabase.from("releases")
        .select("id, name, version, summary, stage, target_date, product_id, org_id")
        .in("stage", ["in_dev", "released", "planned"])
        .order("target_date", { ascending: false, nullsFirst: false }),
      supabase.from("signal_themes")
        .select("id, title, summary, recommendation, conf_level, category, state, org_id")
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

  // ---- map briefs onto their inputs + assemble the task list -----------------
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
    // keep planned releases below in_dev/released; signals after their bucket peers
    const relRank = (t: Task) => t.kind === "release" ? (RELEASE_STAGE_RANK[t.row.stage ?? ""] ?? 3) : 1;
    return [...base].sort((a, b) => relRank(a) - relRank(b));
  }, [allTasks, filter]);

  // Group the (filtered) task list by messaging state.
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

  // Auto-select the first task that needs messaging (else first available).
  useEffect(() => {
    if (!filteredTasks.length) { setSelectedKey(null); return; }
    if (selectedKey && filteredTasks.some((t) => keyOf(t) === selectedKey)) return;
    const first = grouped.needs[0] ?? grouped.draft[0] ?? grouped.ratified[0] ?? filteredTasks[0];
    setSelectedKey(first ? keyOf(first) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredTasks, grouped]);

  // Seed the editor whenever the selected input changes (from its brief body).
  useEffect(() => {
    setSeed(selectedTask?.brief?.body ?? "");
    setDirty(false); setSelection(null);
    setSidebarAgent(null); setStatus("idle"); setStatusStr("");
  }, [selectedKey, selectedTask]);

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
    if (!selectedTask || !editor) return;
    setSaving(true); setError(null);
    const body = editorMarkdown(editor);
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
      setDirty(false);
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
    setSeed(markdown);
    editor?.commands.setContent(markdown, { emitUpdate: false });
    setDirty(true);
    setDraftOpen(false);
    setStatus("idle"); setStatusStr("");
  }

  // ---- Highlight → Agent → picker → sidebar ----------------------------------
  function openAgentForSelection(sel: SelectionInfo) {
    pendingRange.current = { from: sel.from, to: sel.to };
    setSidebarSelText(sel.text);
    setPickerOpen(true);
  }
  function openAgentForElement() {
    pendingRange.current = null;
    setSidebarSelText(null);
    setPickerOpen(true);
  }
  function pickAgent(a: RosterAgent) {
    setPickerOpen(false);
    setSidebarAgent(a);
  }
  function applyRewrite(text: string) {
    if (!editor) return;
    if (pendingRange.current) {
      const { from, to } = pendingRange.current;
      editor.chain().focus().insertContentAt({ from, to }, text).run();
    } else {
      editor.commands.setContent(text, { emitUpdate: true });
    }
    setDirty(true);
    setSidebarAgent(null);
  }

  // ---- render ----------------------------------------------------------------
  const needsCount = grouped.needs.length;
  const selectedBrief = selectedTask?.brief ?? null;
  const isRatified = selectedBrief?.status === "ratified" || selectedBrief?.status === "live";
  const elementLabel = selectedTask ? taskTitle(selectedTask) : "";
  const sidebarOpen = !!sidebarAgent;
  const gridCols = sidebarOpen
    ? "320px minmax(0,1fr) 360px"
    : "320px minmax(0,1fr)";

  const FILTERS: { id: Filter; label: string }[] = [
    { id: "all", label: "All" }, { id: "releases", label: "Releases" }, { id: "signals", label: "Signals" },
  ];

  return (
    <div>
      {/* header: record selector (only if >1 in scope) + needs count + status pill */}
      <div className="row-between" style={{ marginBottom: "var(--sp-4)", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div className="row gap-2" style={{ alignItems: "center", minWidth: 0 }}>
          <span className="t-label">Messaging</span>
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
          {/* ---------- TASK LIST ---------- */}
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
              <div style={{ maxHeight: "72vh", overflowY: "auto" }}>
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

          {/* ---------- EDITOR PANE ---------- */}
          <div style={{ minWidth: 0 }}>
            {!selectedTask ? (
              <Empty title="Select an input" hint="Pick a release or signal on the left to mold its messaging brief." />
            ) : (
              <div>
                {/* WHAT we're messaging (read context) + grounding provenance */}
                <div className="row-between" style={{ alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="row gap-2" style={{ alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                      <span className="t-h2" style={{ fontSize: 15 }}>{elementLabel}</span>
                      {selectedTask.kind === "release" ? (
                        <>
                          <Chip tone="default">{selectedTask.row.stage ?? "release"}</Chip>
                          {selectedTask.row.target_date && <Chip tone="default">{fmtWhen(selectedTask.row.target_date)}</Chip>}
                        </>
                      ) : (
                        <Chip tone="accent">signal</Chip>
                      )}
                      {isRatified
                        ? <Chip tone="green">Ratified</Chip>
                        : selectedBrief ? <Chip tone="amber">Draft</Chip>
                        : <Chip tone="default">Needs messaging</Chip>}
                    </div>
                    {/* the input's own details, as read context */}
                    {selectedTask.kind === "release"
                      ? selectedTask.row.summary && <div className="t-sub" style={{ fontSize: 12, color: "var(--tm)", lineHeight: 1.5 }}>{selectedTask.row.summary}</div>
                      : (
                        <div className="t-sub" style={{ fontSize: 12, color: "var(--tm)", lineHeight: 1.5 }}>
                          {selectedTask.row.summary}
                          {selectedTask.row.recommendation && <span style={{ display: "block", marginTop: 2 }}>Recommendation: {selectedTask.row.recommendation}</span>}
                        </div>
                      )}
                    {/* provenance: the framework this brief is grounded in (context, not edited) */}
                    <div className="t-mono-xs" style={{ color: "var(--tm)", marginTop: 6 }}>
                      Grounded in: {activeGtmName ?? "GTM record"}{productName ? ` · ${productName}` : ""}
                    </div>
                  </div>
                  <div className="row gap-2" style={{ flexShrink: 0 }}>
                    <button className="btn btn-accent btn-sm" onClick={openDraft}>✦ Draft with AI</button>
                    <button className="btn btn-sm" disabled={saving || !dirty} onClick={save}>{saving ? "Saving…" : "Save"}</button>
                    <button className="btn btn-secondary btn-sm" disabled={saving || !selectedBrief || isRatified || dirty} onClick={ratify}>
                      {isRatified ? "Ratified" : "Ratify"}
                    </button>
                  </div>
                </div>

                <RichEditor
                  key={selectedKey ?? "none"}
                  value={seed}
                  onReady={setEditor}
                  onSelection={setSelection}
                  onAgent={openAgentForSelection}
                />

                <div className="row-between" style={{ marginTop: 8, alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <div className="row gap-2" style={{ alignItems: "center" }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => (selection ? openAgentForSelection(selection) : openAgentForElement())}>
                      {selection ? "✦ Agent on selection" : "✦ Agent on brief"}
                    </button>
                    <span className="t-sub t-muted" style={{ fontSize: 11.5 }}>Highlight text in the editor for a targeted rewrite.</span>
                  </div>
                  {dirty ? <span className="t-mono-xs" style={{ color: "var(--am-text)" }}>unsaved edits</span>
                    : justSaved === selectedKey ? <span className="t-mono-xs" style={{ color: "var(--gn)" }}>saved · just now</span>
                    : isRatified ? <span className="t-mono-xs" style={{ color: "var(--gn)" }}>ratified{selectedBrief?.updated_at ? ` · ${fmtWhen(selectedBrief.updated_at)}` : ""}</span>
                    : selectedBrief?.updated_at ? <span className="t-mono-xs" style={{ color: "var(--tm)" }}>updated {fmtWhen(selectedBrief.updated_at)}</span>
                    : null}
                </div>
              </div>
            )}
          </div>

          {/* ---------- CONTEXT SIDEBAR ---------- */}
          {sidebarAgent && selectedTask && (
            <ContextSidebar
              agent={sidebarAgent}
              elementLabel={elementLabel}
              elementValue={editor ? editorMarkdown(editor) : (selectedBrief?.body ?? "")}
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
          currentValue={editor ? editorMarkdown(editor) : (selectedBrief?.body ?? "")}
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
