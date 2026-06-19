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
  fetchOfficerKey,
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
        .select("id, release_id, theme_id, body, status, updated_at, title"),
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

  const filteredInputs = useMemo(() => {
    const base = filter === "releases" ? allInputs.filter((i) => i.kind === "release")
      : filter === "signals" ? allInputs.filter((i) => i.kind === "theme")
      : allInputs;
    // Needs-first, then by release stage urgency (signals interleave at rank 1).
    const stateRank = (i: Input) => (i.brief ? (i.brief.status === "draft" ? 1 : 2) : 0);
    const stageRank = (i: Input) => i.kind === "release" ? (RELEASE_STAGE_RANK[i.row.stage ?? ""] ?? 3) : 1;
    return [...base].sort((a, b) => stateRank(a) - stateRank(b) || stageRank(a) - stageRank(b));
  }, [allInputs, filter]);

  const needsCount = useMemo(() => allInputs.filter((i) => !i.brief).length, [allInputs]);

  const openInput = useMemo(
    () => allInputs.find((i) => keyOf(i) === openKey) ?? null,
    [allInputs, openKey],
  );

  const FILTERS: { id: Filter; label: string }[] = [
    { id: "all", label: "All" }, { id: "releases", label: "Releases" }, { id: "signals", label: "Signals" },
  ];

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

      {/* filter + count */}
      {!loading && allInputs.length > 0 && (
        <div className="row-between" style={{ marginBottom: "var(--sp-4)", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div className="row gap-2">
            {FILTERS.map((f) => (
              <button key={f.id} onClick={() => setFilter(f.id)} className="chip"
                style={{ cursor: "pointer", fontSize: 11.5, border: "1px solid " + (filter === f.id ? "var(--ac)" : "var(--border)"), background: filter === f.id ? "var(--ac-fill, var(--fill))" : "transparent", color: filter === f.id ? "var(--ac-text)" : "var(--ts)" }}>
                {f.label}
              </button>
            ))}
          </div>
          <span className="t-mono-xs" style={{ color: "var(--tm)" }}>{filteredInputs.length} input{filteredInputs.length === 1 ? "" : "s"}</span>
        </div>
      )}

      {loading ? (
        <div className="t-sub t-muted">Loading…</div>
      ) : allInputs.length === 0 ? (
        <Empty title="Nothing to message yet" hint="Releases (in dev or shipped) and gtm signal-themes show up here as inputs to mold messaging for." />
      ) : filteredInputs.length === 0 ? (
        <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No inputs match this filter.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "var(--sp-4)", alignItems: "start" }}>
          {filteredInputs.map((i) => (
            <InputCard key={keyOf(i)} input={i} onOpen={() => setOpenKey(keyOf(i))} />
          ))}
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

// ---- one input card on the board --------------------------------------------
function InputCard({ input, onOpen }: { input: Input; onOpen: () => void }) {
  const title = input.kind === "release"
    ? `${input.row.version ? `${input.row.version} ` : ""}${input.row.name}`
    : input.row.title;
  const typeChip = input.kind === "release" ? (input.row.stage ?? "release") : "signal";
  const bucket = bucketOf(input.brief);

  return (
    <button onClick={onOpen} className="card card-link" style={{
      display: "flex", flexDirection: "column", gap: 10, textAlign: "left", cursor: "pointer",
      padding: "14px 16px", border: "1px solid var(--border)", background: "var(--panel)", minHeight: 116,
    }}>
      <div className="row gap-2" style={{ alignItems: "center", flexWrap: "wrap" }}>
        <Chip tone={input.kind === "release" ? "default" : "accent"}>{typeChip}</Chip>
      </div>
      <div style={{ fontSize: 14, fontWeight: 640, color: "var(--tp)", lineHeight: 1.35, flex: 1 }}>{title}</div>
      <div className="row gap-2" style={{ alignItems: "center" }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: BUCKET_DOT[bucket], display: "inline-block", flexShrink: 0 }} />
        <span className="t-mono-xs" style={{ color: "var(--tm)" }}>{BUCKET_LABEL[bucket]}</span>
      </div>
    </button>
  );
}
