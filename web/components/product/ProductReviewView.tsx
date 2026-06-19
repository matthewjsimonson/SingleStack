"use client";

// ProductReview — the REVIEW surface of the PRODUCT workflow. The product-side
// mirror of MessagingView, through a technical-PM-who-ships lens: it takes a
// product SIGNAL-THEME (the input a PM triages) and molds it into a SPEC/PRD,
// GROUNDED in the product record (what the product is + its technical
// constraints). The product record is read-only CONTEXT the AI writes from; it is
// never edited here. The spec is the seed downstream build work executes from. It
// lives in product_specs (one spec per theme).
//
// THE PAGE IS JUST A BOARD OF THEMES. Each product signal-theme is a row showing
// its title, a type chip, and a spec-status dot. Clicking a row opens the
// ProductReviewPopup — a large Modal that holds ALL the detail (Overview ·
// Sources · Actions). There is no on-page editor; authoring happens inside the
// popup's conversation.
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useProductScope } from "@/lib/ProductContext";
import { Chip, Empty, Banner } from "@/components/ui";
import { fetchAgentKey } from "@/lib/strategy";
import { fmtWhen, type ThemeRow, type GroundingField } from "@/lib/productSpec";
import type { RosterAgent } from "@/components/messaging/AgentPickerModal";
import ProductReviewPopup, { type Spec, type Input } from "@/components/product/ProductReviewPopup";

// A card's spec state drives its status dot/label.
type Bucket = "needs" | "draft" | "ratified";
const bucketOf = (s: Spec | null): Bucket =>
  !s ? "needs" : s.status === "draft" ? "draft" : "ratified";
const BUCKET_LABEL: Record<Bucket, string> = { needs: "Needs spec", draft: "Draft", ratified: "Ratified" };
const BUCKET_DOT: Record<Bucket, string> = { needs: "var(--am-text)", draft: "var(--ac)", ratified: "var(--gn)" };

// The grouped-row buckets in triage order.
const BUCKET_ORDER: Bucket[] = ["needs", "draft", "ratified"];

// Status filter (a spec bucket, or "all").
type StatusFilter = "all" | Bucket;

// Sort modes. "needs" groups by bucket; the rest are flat lists.
type SortMode = "needs" | "newest" | "oldest" | "az";
const SORTS: { id: SortMode; label: string }[] = [
  { id: "needs", label: "Needs first" },
  { id: "newest", label: "Newest" },
  { id: "oldest", label: "Oldest" },
  { id: "az", label: "A–Z" },
];

const titleOf = (i: Input): string => i.row.title;

// The recency timestamp a theme sorts/reads by (its spec's updated_at — themes
// carry no observed_at on the board row).
const tsOf = (i: Input): string | null => i.spec?.updated_at ?? null;
const tsMs = (i: Input): number => { const t = tsOf(i); const n = t ? Date.parse(t) : NaN; return isNaN(n) ? 0 : n; };

export default function ProductReviewView() {
  const supabase = createClient();
  const { active, matches } = useProductScope();

  const [themes, setThemes] = useState<(ThemeRow & { signal_ids?: string[] | null; product_id?: string | null; co_product_ids?: string[] | null })[]>([]);
  const [specs, setSpecs] = useState<Spec[]>([]);
  const [productFields, setProductFields] = useState<GroundingField[]>([]);
  const [productName, setProductName] = useState<string | null>(null);
  const [officerKey, setOfficerKey] = useState<string | null>(null);
  const [roster, setRoster] = useState<RosterAgent[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortMode>("needs");
  const [openKey, setOpenKey] = useState<string | null>(null); // `theme:${id}` of the open popup

  // The active product line drives the grounding (record_fields) we load.
  const activeProductId = useMemo(
    () => (active !== "all" && active !== "company" ? active : null),
    [active],
  );

  // ---- load product themes + specs + roster + officer ------------------------
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const [{ data: th }, { data: ps }, { data: ag }] = await Promise.all([
      supabase.from("signal_themes")
        .select("id, title, summary, recommendation, conf_level, category, state, org_id, signal_ids, product_id, co_product_ids")
        .in("category", ["product", "both"]).neq("state", "dormant"),
      supabase.from("product_specs")
        .select("id, theme_id, body, status, updated_at, title, org_id, persona_id"),
      supabase.from("agents").select("id, key, name, role").eq("is_active", true),
    ]);
    setThemes(((th ?? []) as (ThemeRow & { signal_ids?: string[] | null; product_id?: string | null; co_product_ids?: string[] | null })[]).filter((t) => matches(t)));
    setSpecs((ps ?? []) as Spec[]);
    setRoster((ag ?? []) as RosterAgent[]);
    setOfficerKey(await fetchAgentKey(supabase));
    setLoading(false);
  }, [supabase, matches]);

  useEffect(() => { load(); }, [load]);

  // ---- load the read-only GROUNDING (product record fields) ------------------
  useEffect(() => {
    let alive = true;
    (async () => {
      const prodReq = activeProductId
        ? supabase.from("record_fields").select("field_key, label, value, section").eq("product_id", activeProductId)
        : null;
      const nameReq = activeProductId
        ? supabase.from("product_records").select("name").eq("id", activeProductId).maybeSingle()
        : null;
      const [p, n] = await Promise.all([prodReq, nameReq]);
      if (!alive) return;
      setProductFields((p?.data ?? []) as GroundingField[]);
      setProductName((n?.data as { name?: string } | null)?.name ?? null);
    })();
    return () => { alive = false; };
  }, [supabase, activeProductId]);

  // ---- map specs onto their themes + assemble the board ----------------------
  const specByTheme = useMemo(() => {
    const m = new Map<string, Spec>();
    for (const s of specs) if (s.theme_id) m.set(s.theme_id, s);
    return m;
  }, [specs]);

  const allInputs = useMemo<Input[]>(() => {
    return themes.map((t) => ({ kind: "theme", id: t.id, row: t, spec: specByTheme.get(t.id) ?? null }));
  }, [themes, specByTheme]);

  const keyOf = (i: Input) => `${i.kind}:${i.id}`;

  // ---- filter + search (applied BEFORE grouping/sorting) ---------------------
  const filteredInputs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allInputs.filter((i) => {
      if (statusFilter !== "all" && bucketOf(i.spec) !== statusFilter) return false;
      if (q && !titleOf(i).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allInputs, statusFilter, search]);

  // ---- sort / group the filtered inputs --------------------------------------
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
    const within = (a: Input, b: Input) => tsMs(b) - tsMs(a);
    return BUCKET_ORDER
      .map((bucket) => ({
        bucket,
        items: filteredInputs.filter((i) => bucketOf(i.spec) === bucket).sort(within),
      }))
      .filter((g) => g.items.length > 0);
  }, [filteredInputs]);

  const needsCount = useMemo(() => allInputs.filter((i) => !i.spec).length, [allInputs]);

  const openInput = useMemo(
    () => allInputs.find((i) => keyOf(i) === openKey) ?? null,
    [allInputs, openKey],
  );

  const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
    { id: "all", label: "All" }, { id: "needs", label: "Needs spec" },
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
      {/* header: label + grounding hint + counts */}
      <div className="row-between" style={{ marginBottom: "var(--sp-5)", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div className="row gap-2" style={{ alignItems: "center", minWidth: 0 }}>
          <span className="t-label">Review</span>
          {productName && <span className="t-sub t-muted" style={{ fontSize: 12.5 }}>Grounded in {productName}</span>}
        </div>
        <div className="row gap-2" style={{ alignItems: "center" }}>
          <span className="t-mono-xs" style={{ color: "var(--tm)" }}>Needs spec · {needsCount}</span>
        </div>
      </div>

      <Banner>{error}</Banner>

      {loading ? (
        <div className="t-sub t-muted">Loading…</div>
      ) : allInputs.length === 0 ? (
        <Empty title="Nothing to spec yet" hint="Product signal-themes show up here as inputs to mold a spec for — grounded in what the product is and its technical constraints." />
      ) : (
        <div>
          {/* sticky triage toolbar: status filter, search, sort, count */}
          <div style={{
            position: "sticky", top: 0, zIndex: 2, background: "var(--panel)",
            borderBottom: "1px solid var(--border)", padding: "10px 0", marginBottom: "var(--sp-2)",
            display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10,
          }}>
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
                {filteredInputs.length} theme{filteredInputs.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>

          {filteredInputs.length === 0 ? (
            <Empty title="No themes match these filters." />
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

      {/* The detail surface — a large Modal opened from a row. */}
      <ProductReviewPopup
        open={!!openInput}
        onClose={() => setOpenKey(null)}
        input={openInput}
        activeProductId={activeProductId}
        productName={productName}
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
// chip ("signal"), plus a status chip when flat (ungrouped) so flat sorts still
// surface state. RIGHT: recency, right-aligned.
function InputRow({ input, grouped, onOpen }: { input: Input; grouped: boolean; onOpen: () => void }) {
  const title = titleOf(input);
  const bucket = bucketOf(input.spec);
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
        <Chip tone="accent">signal</Chip>
        {!grouped && <Chip>{BUCKET_LABEL[bucket]}</Chip>}
      </div>
      {/* RIGHT: recency */}
      <span className="t-mono-xs" style={{ color: "var(--tm)", flexShrink: 0, textAlign: "right" }}>{when ?? ""}</span>
    </button>
  );
}
