"use client";

// Messaging — the GTM-strategy ROOT workbench, reimagined as a TASK LIST + a
// Word-like EDITOR + on-demand AI. Not a long scroll: the left column is a
// dynamic task list (one row per stale framework element, current ones below a
// divider); selecting a task opens that element in a TipTap editor. AI is on tap:
//   - "Draft with AI"  → a popup chat (Modal) where the officer synthesizes an
//     update for THIS element; "Use this draft" loads it into the editor.
//   - Highlight → Agent → an agent-picker popup → a right context sidebar that
//     rewrites JUST the selection (Apply to selection).
// Writes go through the HITL gate only — the human reviews in the editor, then
// Saves via human_set_field_value. Reflect deltas, don't regenerate.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { createClient } from "@/lib/supabase/client";
import { useProductScope } from "@/lib/ProductContext";
import { Chip, SourceChip, Empty, Banner } from "@/components/ui";
import {
  fetchOfficerKey, deltaSince, deltaLine, briefText, fmtWhen,
  type ThemeRow, type ReleaseRow, type FieldDelta,
} from "@/lib/messaging";
import RichEditor, { editorMarkdown, type SelectionInfo } from "@/components/messaging/RichEditor";
import DraftChatModal from "@/components/messaging/DraftChatModal";
import AgentPickerModal, { type RosterAgent } from "@/components/messaging/AgentPickerModal";
import ContextSidebar from "@/components/messaging/ContextSidebar";

type Field = { id: string; field_key: string; label: string; value: string | null; section: string | null; position: number };
type Gtm = { id: string; name: string; product_id: string | null };
type Status = "idle" | "working" | "blocked" | "done";

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
  const [lastUpdated, setLastUpdated] = useState<Record<string, string | null>>({});
  const [themes, setThemes] = useState<ThemeRow[]>([]);
  const [thisWeek, setThisWeek] = useState<Record<string, number>>({});
  const [releases, setReleases] = useState<ReleaseRow[]>([]);
  const [officerKey, setOfficerKey] = useState<string | null>(null);
  const [roster, setRoster] = useState<RosterAgent[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ---- AI action status (drives the Status pill) -----------------------------
  const [status, setStatus] = useState<Status>("idle");
  const [statusStr, setStatusStr] = useState("");

  // ---- task selection + editor state -----------------------------------------
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [seed, setSeed] = useState("");                 // current editor seed (markdown/plain)
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const pendingRange = useRef<{ from: number; to: number } | null>(null); // selection captured for the sidebar

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
      setGtmCreatedAt(pick.created_at);
    } else {
      const cur = pool.find((g) => g.id === gtmId);
      if (cur) setGtmCreatedAt(cur.created_at);
    }
  }, [supabase, matches, active, gtmId]);

  useEffect(() => { loadGtms(); }, [loadGtms]);

  // ---- load framework + brief streams + deltas + roster ----------------------
  const load = useCallback(async () => {
    if (!gtmId) { setFields([]); setLoading(false); return; }
    setLoading(true); setError(null);
    const weekAgo = new Date(Date.now() - WEEK_MS).toISOString();
    const [{ data: fl }, { data: th }, { data: rl }, { data: tw }, { data: ag }] = await Promise.all([
      supabase.from("record_fields").select("id, field_key, label, value, section, position").eq("gtm_record_id", gtmId).order("position"),
      supabase.from("signal_themes")
        .select("id, title, summary, recommendation, conf_level, category, state, last_evidence_at, signal_ids")
        .in("category", ["gtm", "both"]).neq("state", "dormant")
        .order("last_evidence_at", { ascending: false, nullsFirst: false }),
      supabase.from("releases")
        .select("id, name, version, summary, stage, target_date, product_id")
        .eq("stage", "released").order("target_date", { ascending: false, nullsFirst: false }),
      supabase.from("theme_signals").select("theme_id, added_at").gte("added_at", weekAgo),
      supabase.from("agents").select("id, key, name, role").eq("is_active", true),
    ]);
    const fieldRows = (fl ?? []) as Field[];
    setFields(fieldRows);
    setThemes((th ?? []) as ThemeRow[]);
    setReleases(((rl ?? []) as ReleaseRow[]).filter((r) => matches(r)));
    setRoster((ag ?? []) as RosterAgent[]);

    const counts: Record<string, number> = {};
    for (const r of (tw ?? []) as { theme_id: string }[]) counts[r.theme_id] = (counts[r.theme_id] ?? 0) + 1;
    setThisWeek(counts);

    const ids = fieldRows.map((f) => f.id);
    if (ids.length) {
      const { data: rev } = await supabase.from("field_revisions")
        .select("record_field_id, created_at").in("record_field_id", ids)
        .order("created_at", { ascending: false });
      const lu: Record<string, string | null> = {};
      for (const r of (rev ?? []) as { record_field_id: string; created_at: string }[]) {
        if (!(r.record_field_id in lu)) lu[r.record_field_id] = r.created_at;
      }
      setLastUpdated(lu);
    } else setLastUpdated({});

    setOfficerKey(await fetchOfficerKey(supabase));
    setLoading(false);
  }, [supabase, gtmId, matches]);

  useEffect(() => { load(); }, [load]);

  const deltaFor = useCallback((f: Field): FieldDelta => {
    const since = lastUpdated[f.id] ?? gtmCreatedAt;
    return deltaSince(since, themes, releases);
  }, [lastUpdated, gtmCreatedAt, themes, releases]);

  // ---- task list: stale (with delta) first, current below a divider ----------
  const tasks = useMemo(() => {
    const withDelta = fields.map((f) => ({ f, d: deltaFor(f), section: f.section || UNGROUPED }));
    const stale = withDelta.filter((t) => t.d.stale)
      .sort((a, b) => sectionRank(a.section) - sectionRank(b.section) || a.f.position - b.f.position);
    const current = withDelta.filter((t) => !t.d.stale)
      .sort((a, b) => sectionRank(a.section) - sectionRank(b.section) || a.f.position - b.f.position);
    return { stale, current };
  }, [fields, deltaFor]);

  const selectedField = useMemo(() => fields.find((f) => f.id === selectedId) ?? null, [fields, selectedId]);
  const selectedDelta = useMemo(() => (selectedField ? deltaFor(selectedField) : null), [selectedField, deltaFor]);
  const selectedBrief = useMemo(() => (selectedDelta ? briefText(selectedDelta) : ""), [selectedDelta]);

  // Auto-select the first stale task (else first current) when the record loads.
  useEffect(() => {
    if (!fields.length) { setSelectedId(null); return; }
    if (selectedId && fields.some((f) => f.id === selectedId)) return;
    const first = tasks.stale[0]?.f ?? tasks.current[0]?.f ?? null;
    setSelectedId(first?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, tasks]);

  // Seed the editor whenever the selected element changes.
  useEffect(() => {
    setSeed(selectedField?.value ?? "");
    setDirty(false); setSelection(null);
    setSidebarAgent(null); setStatus("idle"); setStatusStr("");
  }, [selectedId, selectedField]);

  function selectTask(id: string) {
    if (dirty && id !== selectedId && !confirm("Discard unsaved edits to this element?")) return;
    setSelectedId(id);
  }

  // ---- Save (the ratification moment) ----------------------------------------
  async function save() {
    if (!selectedField || !editor) return;
    setSaving(true); setError(null);
    const value = editorMarkdown(editor);
    const { error } = await supabase.rpc("human_set_field_value", { p_field: selectedField.id, p_value: value });
    setSaving(false);
    if (error) { setError(error.message || "Could not save."); setStatus("blocked"); setStatusStr(error.message); return; }
    setDirty(false);
    setJustSaved(selectedField.id);
    setStatus("done"); setStatusStr("");
    await load();
  }

  // ---- Draft with AI (popup chat) --------------------------------------------
  function openDraft() {
    if (!officerKey) { setError("No officer available — seed agents first."); return; }
    setDraftAgentKey(draftAgentKey ?? officerKey);
    setDraftOpen(true);
  }
  function useDraft(markdown: string) {
    setSeed(markdown);                 // loads into the editor (re-seed)
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
      // whole-element help → replace the document
      editor.commands.setContent(text, { emitUpdate: true });
    }
    setDirty(true);
    setSidebarAgent(null);
  }

  // ---- render ----------------------------------------------------------------
  const movedThemeCount = themes.length;
  const movedReleaseCount = releases.length;
  const whatsNew = movedThemeCount + movedReleaseCount;
  const sidebarOpen = !!sidebarAgent;
  const gridCols = sidebarOpen
    ? "320px minmax(0,1fr) 360px"
    : "320px minmax(0,1fr)";

  return (
    <div>
      {/* header: record selector (only if >1 in scope) + What's new + status pill */}
      <div className="row-between" style={{ marginBottom: "var(--sp-4)", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div className="row gap-2" style={{ alignItems: "center", minWidth: 0 }}>
          <span className="t-label">Messaging framework</span>
          {gtms.length > 1 ? (
            <select className="select" value={gtmId} onChange={(e) => setGtmId(e.target.value)} style={{ maxWidth: 280 }}>
              {gtms.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          ) : gtms.length === 1 ? (
            <span className="t-sub t-muted" style={{ fontSize: 12.5 }}>{gtms[0].name}</span>
          ) : null}
        </div>
        <div className="row gap-2" style={{ alignItems: "center" }}>
          <span className="t-mono-xs" style={{ color: "var(--tm)" }}>What&apos;s new · {whatsNew}</span>
          <StatusPill status={status} note={statusStr} />
        </div>
      </div>

      <Banner>{error}</Banner>

      {loading ? (
        <div className="t-sub t-muted">Loading…</div>
      ) : !gtmId ? (
        <Empty title="No GTM record in scope" hint="Create a GTM record to build its messaging framework." />
      ) : fields.length === 0 ? (
        <Empty title="No framework captured yet" hint="Fill in the GTM record's structured fields, then reflect the brief against them here." />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: gridCols, gap: "var(--sp-5)", alignItems: "start" }}>
          {/* ---------- TASK LIST ---------- */}
          <aside style={{ position: "sticky", top: 12, alignSelf: "start" }}>
            <div className="card" style={{ overflow: "hidden" }}>
              <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", background: "var(--panel-2)" }}>
                <div className="row-between" style={{ alignItems: "center" }}>
                  <span className="t-label">Work items</span>
                  <span className="t-mono-xs" style={{ color: "var(--tm)" }}>{tasks.stale.length} stale</span>
                </div>
              </div>
              <div style={{ maxHeight: "72vh", overflowY: "auto" }}>
                {tasks.stale.length === 0 && (
                  <div className="t-sub t-muted" style={{ fontSize: 12, padding: "12px 14px" }}>Nothing stale — every element is current.</div>
                )}
                {tasks.stale.map(({ f, d, section }) => (
                  <TaskRow key={f.id} label={f.label} section={section}
                    status={`${d.themes.length} themes + ${d.releases.length} releases moved`}
                    tone="stale" active={f.id === selectedId} onClick={() => selectTask(f.id)} />
                ))}
                {tasks.current.length > 0 && (
                  <div className="t-mono-xs" style={{ color: "var(--tm)", padding: "10px 14px 4px", borderTop: "1px solid var(--border)", textTransform: "uppercase", letterSpacing: 0.4 }}>Current</div>
                )}
                {tasks.current.map(({ f, section }) => (
                  <TaskRow key={f.id} label={f.label} section={section} status="Current"
                    tone="current" active={f.id === selectedId} onClick={() => selectTask(f.id)} />
                ))}
              </div>
            </div>
          </aside>

          {/* ---------- EDITOR PANE ---------- */}
          <div style={{ minWidth: 0 }}>
            {!selectedField ? (
              <Empty title="Select a work item" hint="Pick an element on the left to open it in the editor." />
            ) : (
              <div>
                {/* provenance: delta line + the themes/releases driving it */}
                <div className="row-between" style={{ alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="row gap-2" style={{ alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                      <span className="t-h2" style={{ fontSize: 15 }}>{selectedField.label}</span>
                      <Chip tone="default">{selectedField.section || UNGROUPED}</Chip>
                      {selectedDelta?.stale
                        ? <Chip tone="amber">{selectedDelta.themes.length + selectedDelta.releases.length} moved</Chip>
                        : <Chip tone="green">Current</Chip>}
                    </div>
                    <div className="t-sub" style={{ fontSize: 12, color: selectedDelta?.stale ? "var(--am-text)" : "var(--tm)" }}>{selectedDelta ? deltaLine(selectedDelta) : ""}</div>
                  </div>
                  <div className="row gap-2" style={{ flexShrink: 0 }}>
                    <button className="btn btn-accent btn-sm" onClick={openDraft}>✦ Draft with AI</button>
                    <button className="btn btn-sm" disabled={saving || !dirty} onClick={save}>{saving ? "Saving…" : "Save"}</button>
                  </div>
                </div>

                {selectedDelta?.stale && (
                  <div className="row gap-2" style={{ flexWrap: "wrap", marginBottom: 10 }}>
                    {selectedDelta.themes.slice(0, 4).map((t) => (
                      <SourceChip key={t.id} icon="◆" label={t.title} when={fmtWhen(t.last_evidence_at)} />
                    ))}
                    {selectedDelta.releases.slice(0, 4).map((r) => (
                      <SourceChip key={r.id} icon="▲" label={r.version ? `${r.version} ${r.name}` : r.name} when={fmtWhen(r.target_date)} />
                    ))}
                  </div>
                )}

                <RichEditor
                  key={selectedField.id}
                  value={seed}
                  onReady={setEditor}
                  onSelection={setSelection}
                  onAgent={openAgentForSelection}
                />

                <div className="row-between" style={{ marginTop: 8, alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <div className="row gap-2" style={{ alignItems: "center" }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => (selection ? openAgentForSelection(selection) : openAgentForElement())}>
                      {selection ? "✦ Agent on selection" : "✦ Agent on element"}
                    </button>
                    <span className="t-sub t-muted" style={{ fontSize: 11.5 }}>Highlight text in the editor for a targeted rewrite.</span>
                  </div>
                  {justSaved === selectedField.id && !dirty
                    ? <span className="t-mono-xs" style={{ color: "var(--gn)" }}>ratified · just now</span>
                    : dirty ? <span className="t-mono-xs" style={{ color: "var(--am-text)" }}>unsaved edits</span>
                    : lastUpdated[selectedField.id] || gtmCreatedAt
                      ? <span className="t-mono-xs" style={{ color: "var(--tm)" }}>updated {fmtWhen(lastUpdated[selectedField.id] ?? gtmCreatedAt)}</span>
                      : null}
                </div>
              </div>
            )}
          </div>

          {/* ---------- CONTEXT SIDEBAR ---------- */}
          {sidebarAgent && selectedField && (
            <ContextSidebar
              agent={sidebarAgent}
              elementLabel={selectedField.label}
              elementValue={editor ? editorMarkdown(editor) : (selectedField.value ?? "")}
              brief={selectedBrief}
              selection={sidebarSelText}
              onApply={applyRewrite}
              onClose={() => setSidebarAgent(null)}
            />
          )}
        </div>
      )}

      {/* ---------- Draft-with-AI popup chat ---------- */}
      {selectedField && (
        <DraftChatModal
          open={draftOpen}
          onClose={() => setDraftOpen(false)}
          elementLabel={selectedField.label}
          currentValue={editor ? editorMarkdown(editor) : (selectedField.value ?? "")}
          brief={selectedBrief}
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
          : "The agent will help with this whole element in a context sidebar."}
      />
    </div>
  );
}

function TaskRow({ label, section, status, tone, active, onClick }: {
  label: string; section: string; status: string; tone: "stale" | "current"; active: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick} style={{
      display: "block", width: "100%", textAlign: "left", cursor: "pointer", border: "none",
      borderTop: "1px solid var(--border)", borderLeft: `2px solid ${active ? "var(--ac)" : "transparent"}`,
      background: active ? "var(--ac-fill, var(--fill))" : "transparent",
      padding: "10px 12px", opacity: tone === "current" && !active ? 0.72 : 1,
    }}>
      <div className="row gap-2" style={{ alignItems: "center", flexWrap: "wrap", marginBottom: 3 }}>
        <span style={{ fontSize: 12.5, fontWeight: active ? 660 : 600, color: "var(--tp)" }}>{label}</span>
        <span className="chip" style={{ fontSize: 9.5 }}>{section}</span>
      </div>
      <div className="t-mono-xs" style={{ color: tone === "stale" ? "var(--am-text)" : "var(--tm)" }}>{status}</div>
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
