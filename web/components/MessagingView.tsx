"use client";

// Messaging — the REVIEW surface of the GTM workflow (also at /messaging). It is
// a PRODUCTION surface, not a GTM-record editor: it takes a NEW input — a product
// RELEASE (new feature/module/tool) or a SIGNAL-THEME — and molds it into a
// messaging BRIEF, GROUNDED in the framework (the GTM record + product record).
// The framework is read-only CONTEXT the AI drafts from; it is never edited here.
// The brief is the seed downstream content/video/enablement/competitive execute
// from. It lives in messaging_artifacts (one brief per input).
//
// THE PAGE IS JUST A BOARD OF INPUTS. Each input (a release or a gtm signal-
// theme) is a card showing its title, a type chip, and a brief-status dot.
// Clicking a card opens the ReviewPopup — a large Modal that holds ALL the detail
// (Overview · Sources · Supporting details · Actions). There is no on-page editor
// and no long page scroll; authoring happens inside the popup's conversation.
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useProductScope } from "@/lib/ProductContext";
import { Chip, Empty, Banner } from "@/components/ui";
import {
  fetchOfficerKey, fmtWhen,
  type ThemeRow, type ReleaseRow, type GroundingField,
} from "@/lib/messaging";
import type { RosterAgent } from "@/components/messaging/AgentPickerModal";
import ReviewPopup, { type Brief, type Input } from "@/components/messaging/ReviewPopup";

type Gtm = { id: string; name: string; product_id: string | null };

type Filter = "all" | "releases" | "signals";

// A card's brief state drives its status dot/label.
type Bucket = "needs" | "draft" | "ratified";
const bucketOf = (b: Brief | null): Bucket =>
  !b ? "needs" : b.status === "draft" ? "draft" : "ratified";
const BUCKET_LABEL: Record<Bucket, string> = { needs: "Needs messaging", draft: "Draft", ratified: "Ratified" };
const BUCKET_DOT: Record<Bucket, string> = { needs: "var(--am-text)", draft: "var(--ac)", ratified: "var(--gn)" };

// Release stages that need messaging now (planned sorts after the others).
const RELEASE_STAGE_RANK: Record<string, number> = { in_dev: 0, released: 1, planned: 2 };

// Human label for a release stage chip.
const STAGE_LABEL: Record<string, string> = { in_dev: "in dev", released: "released", planned: "planned" };
const stageLabel = (s: string | null | undefined) => (s ? STAGE_LABEL[s] ?? s : "release");

// The grouped-row buckets in triage order.
const BUCKET_ORDER: Bucket[] = ["needs", "draft", "ratified"];

// Status filter (a brief bucket, or "all").
type StatusFilter = "all" | Bucket;

// Sort modes. "needs" groups by bucket; the rest are flat lists.
type SortMode = "needs" | "newest" | "oldest" | "az";
const SORTS: { id: SortMode; label: string }[] = [
  { id: "needs", label: "Needs first" },
  { id: "newest", label: "Newest" },
  { id: "oldest", label: "Oldest" },
  { id: "az", label: "A–Z" },
];

// The display title of an input (release: "version name"; signal: title).
const titleOf = (i: Input): string =>
  i.kind === "release" ? `${i.row.version ? `${i.row.version} ` : ""}${i.row.name}` : i.row.title;

// The recency timestamp an input sorts/reads by (release: target_date; signal:
// brief updated_at — themes carry no observed_at on the board row).
const tsOf = (i: Input): string | null =>
  i.kind === "release" ? (i.row.target_date ?? i.brief?.updated_at ?? null) : (i.brief?.updated_at ?? null);
const tsMs = (i: Input): number => { const t = tsOf(i); const n = t ? Date.parse(t) : NaN; return isNaN(n) ? 0 : n; };

export default function MessagingView() {
  const supabase = createClient();
  const { active, matches } = useProductScope();

  const [gtms, setGtms] = useState<Gtm[]>([]);
  const [gtmId, setGtmId] = useState<string>("");

  const [releases, setReleases] = useState<ReleaseRow[]>([]);
  const [themes, setThemes] = useState<(ThemeRow & { signal_ids?: string[] | null })[]>([]);
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [gtmFields, setGtmFields] = useState<GroundingField[]>([]);
  const [productFields, setProductFields] = useState<GroundingField[]>([]);
  const [productName, setProductName] = useState<string | null>(null);
  const [officerKey, setOfficerKey] = useState<string | null>(null);
  const [roster, setRoster] = useState<RosterAgent[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filter, setFilter] = useState<Filter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortMode>("needs");
  const [openKey, setOpenKey] = useState<string | null>(null); // `${kind}:${id}` of the open popup

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
        .select("id, release_id, theme_id, body, status, updated_at, title, org_id, persona_id"),
      supabase.from("agents").select("id, key, name, role").eq("is_active", true),
    ]);
    setReleases(((rl ?? []) as ReleaseRow[]).filter((r) => matches(r)));
    setThemes((th ?? []) as (ThemeRow & { signal_ids?: string[] | null })[]);
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

  // ---- map briefs onto their inputs + assemble the board ---------------------
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

  const allInputs = useMemo<Input[]>(() => {
    const rel: Input[] = releases.map((r) => ({ kind: "release", id: r.id, row: r, brief: briefByRelease.get(r.id) ?? null }));
    const sig: Input[] = themes.map((t) => ({ kind: "theme", id: t.id, row: t, brief: briefByTheme.get(t.id) ?? null }));
    return [...rel, ...sig];
  }, [releases, themes, briefByRelease, briefByTheme]);

  const keyOf = (i: Input) => `${i.kind}:${i.id}`;

  // ---- filter + search (applied BEFORE grouping/sorting) ---------------------
  const filteredInputs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allInputs.filter((i) => {
      if (filter === "releases" && i.kind !== "release") return false;
      if (filter === "signals" && i.kind !== "theme") return false;
      if (statusFilter !== "all" && bucketOf(i.brief) !== statusFilter) return false;
      if (q && !titleOf(i).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allInputs, filter, statusFilter, search]);

  // ---- sort / group the filtered inputs --------------------------------------
  // "needs" → grouped by bucket (Needs → Draft → Ratified), each group ordered by
  // release-stage urgency then recency. Other sorts → a single flat list.
  const sortedFlat = useMemo(() => {
    const byNewest = (a: Input, b: Input) => tsMs(b) - tsMs(a);
    const byOldest = (a: Input, b: Input) => tsMs(a) - tsMs(b);
    const byAz = (a: Input, b: Input) => titleOf(a).localeCompare(titleOf(b), undefined, { sensitivity: "base" });
    const arr = [...filteredInputs];
    if (sort === "newest") return arr.sort(byNewest);
    if (sort === "oldest") return arr.sort(byOldest);
    if (sort === "az") return arr.sort(byAz);
    return arr; // "needs" → handled by groups
  }, [filteredInputs, sort]);

  const groups = useMemo(() => {
    const stageRank = (i: Input) => i.kind === "release" ? (RELEASE_STAGE_RANK[i.row.stage ?? ""] ?? 3) : 1;
    const within = (a: Input, b: Input) => stageRank(a) - stageRank(b) || tsMs(b) - tsMs(a);
    return BUCKET_ORDER
      .map((bucket) => ({
        bucket,
        items: filteredInputs.filter((i) => bucketOf(i.brief) === bucket).sort(within),
      }))
      .filter((g) => g.items.length > 0);
  }, [filteredInputs]);

  const needsCount = useMemo(() => allInputs.filter((i) => !i.brief).length, [allInputs]);

  const openInput = useMemo(
    () => allInputs.find((i) => keyOf(i) === openKey) ?? null,
    [allInputs, openKey],
  );

  const FILTERS: { id: Filter; label: string }[] = [
    { id: "all", label: "All" }, { id: "releases", label: "Releases" }, { id: "signals", label: "Signals" },
  ];
  const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
    { id: "all", label: "All" }, { id: "needs", label: "Needs messaging" },
    { id: "draft", label: "Draft" }, { id: "ratified", label: "Ratified" },
  ];

  // One uniform control height/typography so the toolbar reads as a single row.
  const CTRL_H = 34;
  const chipStyle = (on: boolean): React.CSSProperties => ({
    cursor: "pointer", fontSize: 13, fontWeight: on ? 600 : 540,
    height: CTRL_H, boxSizing: "border-box", padding: "0 14px", borderRadius: 999, lineHeight: 1,
    display: "inline-flex", alignItems: "center", whiteSpace: "nowrap",
    border: "1px solid " + (on ? "var(--ac)" : "var(--border)"),
    background: on ? "var(--ac-fill, var(--fill))" : "transparent",
    color: on ? "var(--ac-text)" : "var(--ts)",
    transition: "var(--motion)",
  });
  const fieldStyle: React.CSSProperties = { height: CTRL_H, boxSizing: "border-box", fontSize: 13, padding: "0 12px" };

  return (
    <div>
      {/* header: record selector (only if >1 in scope) + filter + counts */}
      <div className="row-between" style={{ marginBottom: "var(--sp-5)", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
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
        </div>
      </div>

      <Banner>{error}</Banner>

      {loading ? (
        <div className="t-sub t-muted">Loading…</div>
      ) : allInputs.length === 0 ? (
        <Empty title="Nothing to message yet" hint="Releases (in dev or shipped) and gtm signal-themes show up here as inputs to mold messaging for." />
      ) : (
        <div>
          {/* sticky triage toolbar: type + status filters, search, sort, count */}
          <div style={{
            position: "sticky", top: 0, zIndex: 2, background: "var(--panel)",
            borderBottom: "1px solid var(--border)", padding: "10px 0", marginBottom: "var(--sp-2)",
            display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10,
          }}>
            <div className="row gap-2">
              {FILTERS.map((f) => (
                <button key={f.id} onClick={() => setFilter(f.id)} className="focus-glow" style={chipStyle(filter === f.id)}>
                  {f.label}
                </button>
              ))}
            </div>
            <span style={{ width: 1, height: 18, background: "var(--border)", alignSelf: "center" }} aria-hidden />
            <div className="row gap-2">
              {STATUS_FILTERS.map((s) => (
                <button key={s.id} onClick={() => setStatusFilter(s.id)} className="focus-glow" style={chipStyle(statusFilter === s.id)}>
                  {s.label}
                </button>
              ))}
            </div>
            <div className="row gap-2" style={{ marginLeft: "auto", alignItems: "center" }}>
              <input
                className="input" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search title…" style={{ ...fieldStyle, width: 240 }}
              />
              <select className="select" value={sort} onChange={(e) => setSort(e.target.value as SortMode)} style={fieldStyle}>
                {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
              <span className="t-mono-xs" style={{ color: "var(--tm)", flexShrink: 0, fontSize: 11.5 }}>
                {filteredInputs.length} input{filteredInputs.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>

          {filteredInputs.length === 0 ? (
            <Empty title="No inputs match these filters." />
          ) : sort === "needs" ? (
            groups.map((g) => (
              <div key={g.bucket} style={{ marginBottom: "var(--sp-4)" }}>
                <div className="row gap-2" style={{ alignItems: "baseline", padding: "8px 14px 4px" }}>
                  <span className="t-label">{BUCKET_LABEL[g.bucket]}</span>
                  <span className="t-mono-xs" style={{ color: "var(--tm)" }}>· {g.items.length}</span>
                </div>
                {g.items.map((i) => (
                  <InputRow key={keyOf(i)} input={i} grouped onOpen={() => setOpenKey(keyOf(i))} />
                ))}
              </div>
            ))
          ) : (
            <div>
              {sortedFlat.map((i) => (
                <InputRow key={keyOf(i)} input={i} grouped={false} onOpen={() => setOpenKey(keyOf(i))} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* The detail surface — a large Modal opened from a card. */}
      <ReviewPopup
        open={!!openInput}
        onClose={() => setOpenKey(null)}
        input={openInput}
        gtmId={gtmId}
        gtmName={activeGtmName}
        activeProductId={activeProductId}
        productName={productName}
        gtmFields={gtmFields}
        productFields={productFields}
        roster={roster}
        officerKey={officerKey}
        supabase={supabase}
        onSaved={load}
      />
    </div>
  );
}

// ---- one dense triage row ----------------------------------------------------
// A full-width clickable row (~44px). LEFT: status dot + title. MIDDLE: a type
// chip (release stage / "signal"), plus a status chip when flat (ungrouped) so
// flat sorts still surface state. RIGHT: recency, right-aligned.
function InputRow({ input, grouped, onOpen }: { input: Input; grouped: boolean; onOpen: () => void }) {
  const title = titleOf(input);
  const typeChip = input.kind === "release" ? stageLabel(input.row.stage) : "signal";
  const bucket = bucketOf(input.brief);
  const when = fmtWhen(tsOf(input));

  return (
    <button onClick={onOpen} className="board-row">
      {/* LEFT: status dot + title (ellipsis) */}
      <div className="row gap-2" style={{ alignItems: "center", flex: 1, minWidth: 0 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: BUCKET_DOT[bucket], display: "inline-block", flexShrink: 0 }} />
        <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--tp)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
      </div>
      {/* MIDDLE: type chip (+ status chip when flat) */}
      <div className="row gap-2" style={{ alignItems: "center", flexShrink: 0 }}>
        <Chip tone={input.kind === "release" ? "default" : "accent"}>{typeChip}</Chip>
        {!grouped && <Chip>{BUCKET_LABEL[bucket]}</Chip>}
      </div>
      {/* RIGHT: recency */}
      <span className="t-mono-xs" style={{ color: "var(--tm)", flexShrink: 0, textAlign: "right" }}>{when ?? ""}</span>
    </button>
  );
}
