"use client";

// ReviewPopup — the detail surface for ONE messaging input (a release or a
// signal-theme). The Review PAGE is just a board of input cards; clicking one
// opens THIS large Modal, which mirrors a screen: a LEFT pick-em nav (Overview ·
// Sources · Supporting details · Actions) + a RIGHT content panel.
//
// There is NO on-page editor. The brief is authored entirely through the
// conversation (DraftChatModal): "Use this draft" SAVES the brief into
// messaging_artifacts. The popup reflects the brief status (Needs / Draft /
// Ratified) and lets the human continue or ratify it.
import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getOrgId } from "@/lib/org";
import { Modal, Chip, SubTabs } from "@/components/ui";
import { fmtWhen, buildGrounding, buildDraftContext, type GroundingField, type ReleaseRow, type ThemeRow } from "@/lib/messaging";
import DraftChatModal from "@/components/messaging/DraftChatModal";
import type { RosterAgent } from "@/components/messaging/AgentPickerModal";

type BriefStatus = "draft" | "ratified" | "live";
export type Brief = {
  id: string;
  release_id: string | null;
  theme_id: string | null;
  body: string;
  status: BriefStatus;
  updated_at: string | null;
  title: string | null;
};
export type Input =
  | { kind: "release"; id: string; row: ReleaseRow; brief: Brief | null }
  | { kind: "theme"; id: string; row: ThemeRow & { signal_ids?: string[] | null }; brief: Brief | null };

// A release's changelog item (initiative_workstreams, area=build, by release_id).
type ChangelogItem = { id: string; title: string; change_type: string | null; stage: string | null };
// A signal-theme's evidence signal — carries the axes that drive bucketing.
type EvidenceSignal = {
  id: string; title: string; why: string | null; origin: string | null;
  domain: string | null; source_id: string | null; competitor_id: string | null; observed_at: string | null;
};

const CHANGE_LABEL: Record<string, string> = {
  feature: "Feature", feature_update: "Feature update", module_update: "Module update",
  bug_fix: "Bug fix", enhancement: "Enhancement",
};

// The four pick-em items of the popup's left nav.
type NavItem = "overview" | "sources" | "details" | "actions";
const NAV: { id: NavItem; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "sources", label: "Sources" },
  { id: "details", label: "Supporting details" },
  { id: "actions", label: "Actions" },
];

// The five evidence buckets, in display order.
type Bucket = "market" | "competitive" | "frontier" | "release" | "record";
const BUCKETS: { id: Bucket; label: string }[] = [
  { id: "market", label: "Market intel" },
  { id: "competitive", label: "Competitive" },
  { id: "frontier", label: "Frontier models" },
  { id: "release", label: "Product release" },
  { id: "record", label: "Product record" },
];

function relTime(ts: string | null): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return fmtWhen(ts);
}

const titleOf = (input: Input) =>
  input.kind === "release"
    ? `${input.row.version ? `${input.row.version} ` : ""}${input.row.name}`
    : input.row.title;

// One evidence row inside a Sources bucket.
type SourceItem = { id: string; title: string; desc: string | null; when: string | null };

export default function ReviewPopup({
  open, onClose, input, gtmId, gtmName, activeProductId, productName,
  gtmFields, productFields, roster, officerKey, supabase, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  input: Input | null;
  gtmId: string;
  gtmName: string | null;
  activeProductId: string | null;
  productName: string | null;
  gtmFields: GroundingField[];
  productFields: GroundingField[];
  roster: RosterAgent[];
  officerKey: string | null;
  supabase: SupabaseClient;
  onSaved: () => void | Promise<void>;
}) {
  const [nav, setNav] = useState<NavItem>("overview");
  const [changelog, setChangelog] = useState<ChangelogItem[]>([]);
  const [evidence, setEvidence] = useState<EvidenceSignal[]>([]);
  const [ctxLoading, setCtxLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // DraftChatModal state — the conversation that authors the brief.
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftAgentKey, setDraftAgentKey] = useState<string | null>(null);
  const [seedMessage, setSeedMessage] = useState<string | null>(null);

  // Reset the nav back to Overview each time a new input opens.
  useEffect(() => { if (open) { setNav("overview"); setError(null); } }, [open, input?.kind, input?.id]);

  // Load the input's deep context: a release's changelog, or a theme's evidence.
  useEffect(() => {
    let alive = true;
    setChangelog([]); setEvidence([]);
    if (!open || !input) return;
    (async () => {
      setCtxLoading(true);
      try {
        if (input.kind === "release") {
          const { data } = await supabase.from("initiative_workstreams")
            .select("id, title, change_type, stage")
            .eq("release_id", input.id).eq("area", "build");
          if (alive) setChangelog((data ?? []) as ChangelogItem[]);
        } else {
          const ids = input.row.signal_ids ?? [];
          if (ids.length) {
            const { data } = await supabase.from("signals")
              .select("id, title, why, origin, domain, source_id, competitor_id, observed_at")
              .in("id", ids).order("observed_at", { ascending: false, nullsFirst: false });
            if (alive) setEvidence((data ?? []) as EvidenceSignal[]);
          }
        }
      } finally {
        if (alive) setCtxLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [supabase, open, input]);

  const brief = input?.brief ?? null;
  const isRatified = brief?.status === "ratified" || brief?.status === "live";
  const briefStatusChip = isRatified
    ? <Chip tone="green">Ratified</Chip>
    : brief ? <Chip tone="amber">Draft</Chip>
    : <Chip tone="default">Needs messaging</Chip>;

  // The grounding + draft context handed to the conversation (reused plumbing).
  const grounding = useMemo(() => buildGrounding(gtmFields, productFields), [gtmFields, productFields]);
  const draftContext = useMemo(() => {
    if (!input) return "";
    return input.kind === "release"
      ? buildDraftContext({ kind: "release", row: input.row }, grounding)
      : buildDraftContext({ kind: "theme", row: input.row }, grounding);
  }, [input, grounding]);

  // ---- bucket the theme's evidence into the FIVE origins ----------------------
  const buckets = useMemo<Record<Bucket, SourceItem[]>>(() => {
    const b: Record<Bucket, SourceItem[]> = { market: [], competitive: [], frontier: [], release: [], record: [] };
    if (!input) return b;
    if (input.kind === "theme") {
      for (const s of evidence) {
        const item: SourceItem = { id: s.id, title: s.title, desc: s.why, when: relTime(s.observed_at) };
        // Bucketing precedence: competitor link → frontier/capability domain →
        // market vs release vs product record (the residual internal bucket).
        const dom = (s.domain ?? "").toLowerCase();
        if (s.competitor_id) b.competitive.push(item);
        else if (dom === "capability" || dom === "frontier") b.frontier.push(item);
        else if (dom === "market" || s.origin === "external") b.market.push(item);
        else if (dom === "release") b.release.push(item);
        else b.record.push(item);
      }
      // The grounded product record is always listed under Product record.
      if (productName) b.record.push({ id: "__product", title: productName, desc: "Grounded product record", when: null });
    } else {
      // Release: the release itself + its changelog are the Product release bucket.
      b.release.push({ id: "__release", title: titleOf(input), desc: input.row.summary ?? null, when: input.row.target_date ? fmtWhen(input.row.target_date) : null });
      for (const c of changelog) {
        b.release.push({ id: c.id, title: c.title, desc: c.change_type ? (CHANGE_LABEL[c.change_type] ?? c.change_type) : null, when: null });
      }
      if (productName) {
        // A couple of key product-record fields under Product record.
        const keys = ["what_it_is", "core_capabilities"];
        const fields = keys.map((k) => productFields.find((f) => f.field_key === k)).filter((f): f is GroundingField => !!f && !!(f.value ?? "").trim());
        b.record.push({ id: "__product", title: productName, desc: "Grounded product record", when: null });
        for (const f of fields) b.record.push({ id: f.field_key, title: f.label || f.field_key, desc: (f.value ?? "").trim(), when: null });
      }
    }
    return b;
  }, [input, evidence, changelog, productName, productFields]);

  // ---- conversation → SAVE the brief (mirror MessagingView's upsert) ----------
  async function saveBrief(body: string) {
    if (!input) return;
    setSaving(true); setError(null);
    const title = titleOf(input);
    const now = new Date().toISOString();
    try {
      if (input.brief) {
        const { error } = await supabase.from("messaging_artifacts")
          .update({ body, updated_at: now, title }).eq("id", input.brief.id);
        if (error) throw error;
      } else {
        const orgId = input.row.org_id ?? (await getOrgId());
        if (!orgId) throw new Error("Could not resolve your organization.");
        const { error } = await supabase.from("messaging_artifacts").insert({
          org_id: orgId,
          release_id: input.kind === "release" ? input.id : null,
          theme_id: input.kind === "theme" ? input.id : null,
          gtm_record_id: gtmId || null,
          product_id: activeProductId,
          body, status: "draft", title,
        });
        if (error) throw error;
      }
      setDraftOpen(false);
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the brief.");
    } finally { setSaving(false); }
  }

  async function ratify() {
    if (!input?.brief) return;
    setSaving(true); setError(null);
    const now = new Date().toISOString();
    const { error } = await supabase.from("messaging_artifacts")
      .update({ status: "ratified", ratified_at: now, updated_at: now }).eq("id", input.brief.id);
    setSaving(false);
    if (error) { setError(error.message || "Could not ratify."); return; }
    await onSaved();
  }

  // Open the conversation seeded for a recommendation / starter / continuation.
  function startConversation(seed: string | null) {
    if (!officerKey) { setError("No officer available — seed agents first."); return; }
    setSeedMessage(seed);
    setDraftAgentKey(draftAgentKey ?? officerKey);
    setDraftOpen(true);
  }

  if (!input) return null;

  const title = titleOf(input);

  return (
    <>
      <Modal open={open && !draftOpen} onClose={onClose} width={1180} title={
        <div className="row gap-2" style={{ alignItems: "center", flexWrap: "wrap" }}>
          <span>{title}</span>
          {input.kind === "release"
            ? <Chip tone="default">{input.row.stage ?? "release"}</Chip>
            : <Chip tone="accent">signal</Chip>}
          {briefStatusChip}
        </div>
      }>
        {error && <div className="banner banner-error" style={{ marginBottom: 12 }}>{error}</div>}

        {/* mirrored screen: LEFT pick-em nav · RIGHT content panel */}
        <div style={{ display: "grid", gridTemplateColumns: "190px minmax(0,1fr)", gap: "var(--sp-5)", alignItems: "start", minHeight: 480 }}>
          {/* LEFT — pick-em nav (feels like the app's own nav) */}
          <nav style={{ display: "flex", flexDirection: "column", gap: 2, borderRight: "1px solid var(--border)", paddingRight: 12 }}>
            {NAV.map((n) => {
              const on = nav === n.id;
              return (
                <button key={n.id} onClick={() => setNav(n.id)} style={{
                  display: "block", width: "100%", textAlign: "left", cursor: "pointer",
                  border: "none", borderLeft: `2px solid ${on ? "var(--ac)" : "transparent"}`,
                  background: on ? "var(--ac-fill, var(--fill))" : "transparent",
                  color: on ? "var(--ac-text)" : "var(--ts)", fontWeight: on ? 660 : 600,
                  fontSize: 13, padding: "8px 10px", borderRadius: 6,
                }}>
                  {n.label}
                </button>
              );
            })}
          </nav>

          {/* RIGHT — content panel */}
          <div style={{ minWidth: 0 }}>
            {nav === "overview" && <Overview input={input} productName={productName} changelog={changelog} evidence={evidence} ctxLoading={ctxLoading} />}
            {nav === "sources" && <Sources buckets={buckets} ctxLoading={ctxLoading} />}
            {nav === "details" && <Details input={input} evidence={evidence} changelog={changelog} ctxLoading={ctxLoading} gtmName={gtmName} productName={productName} gtmFields={gtmFields} productFields={productFields} />}
            {nav === "actions" && (
              <Actions
                input={input} brief={brief} isRatified={isRatified} saving={saving}
                onStartConversation={startConversation} onSaveBrief={saveBrief} onRatify={ratify} onDismiss={onClose}
              />
            )}
          </div>
        </div>
      </Modal>

      {/* The conversation — authoring happens here; Use this draft SAVES the brief. */}
      <DraftChatModal
        open={draftOpen}
        onClose={() => setDraftOpen(false)}
        elementLabel={title}
        currentValue={brief?.body ?? ""}
        brief={draftContext}
        agentKey={draftAgentKey}
        roster={roster}
        onAgentChange={setDraftAgentKey}
        onUseDraft={saveBrief}
        seedMessage={seedMessage}
      />
    </>
  );
}

// A labeled key/value used across the Overview grids. Shows a muted "—" when the
// value is empty so the customer still sees the shape of what's tracked.
function FactRow({ label, value }: { label: string; value: string | null | undefined }) {
  const v = (value ?? "").trim();
  return (
    <div style={{ display: "grid", gridTemplateColumns: "130px minmax(0,1fr)", gap: 10, padding: "6px 0", borderTop: "1px solid var(--border)" }}>
      <span className="t-mono-xs" style={{ color: "var(--tm)" }}>{label}</span>
      {v ? (
        <span className="t-sub" style={{ fontSize: 12.5, color: "var(--ts)", lineHeight: 1.5 }}>{v}</span>
      ) : (
        <span className="t-sub t-muted" style={{ fontSize: 12.5, color: "var(--tm)" }}>—</span>
      )}
    </div>
  );
}

// ---- OVERVIEW — a legit, structured read of the input -----------------------
function Overview({ input, productName, changelog, evidence, ctxLoading }: {
  input: Input; productName: string | null; changelog: ChangelogItem[]; evidence: EvidenceSignal[]; ctxLoading: boolean;
}) {
  return (
    <div className="stack-3">
      {/* header chips */}
      <div className="row gap-2" style={{ alignItems: "center", flexWrap: "wrap" }}>
        <span className="t-h2" style={{ fontSize: 18 }}>{titleOf(input)}</span>
        {input.kind === "release" ? (
          <>
            <Chip tone="default">{input.row.stage ?? "release"}</Chip>
            {input.row.target_date && <Chip tone="default">{fmtWhen(input.row.target_date)}</Chip>}
            {productName && <Chip tone="default">{productName}</Chip>}
          </>
        ) : (
          <>
            {input.row.state && <Chip tone="default">{input.row.state}</Chip>}
            {input.row.conf_level != null && <Chip tone="default">{Math.round(input.row.conf_level * 100)}% confidence</Chip>}
          </>
        )}
      </div>

      {input.kind === "release"
        ? <ReleaseOverview input={input} productName={productName} changelog={changelog} ctxLoading={ctxLoading} />
        : <ThemeOverview input={input} evidence={evidence} ctxLoading={ctxLoading} />}
    </div>
  );
}

function ReleaseOverview({ input, productName, changelog, ctxLoading }: {
  input: Extract<Input, { kind: "release" }>; productName: string | null; changelog: ChangelogItem[]; ctxLoading: boolean;
}) {
  const summary = (input.row.summary ?? "").trim();
  const stage = (input.row.stage ?? "").trim();
  // A factual GTM framing line derived from the data (not marketing copy).
  const whyParts: string[] = [];
  if (changelog.length) whyParts.push(`${changelog.length} ${changelog.length === 1 ? "change" : "changes"} shipping`);
  else whyParts.push("This release");
  if (stage) whyParts.push(`in ${stage}`);
  const whyTail = productName ? ` — messaging needs to land the value for ${productName}.` : " — messaging needs to land the value.";
  const why = `${whyParts.join(" ")}${whyTail}`;

  return (
    <>
      {/* Summary */}
      <div>
        <div className="t-label" style={{ color: "var(--tm)", marginBottom: 4 }}>Summary</div>
        {summary
          ? <div className="t-body" style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--ts)" }}>{summary}</div>
          : <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>—</div>}
      </div>

      {/* Key facts */}
      <div>
        <div className="t-label" style={{ color: "var(--tm)", marginBottom: 2 }}>Key facts</div>
        <FactRow label="Version" value={input.row.version} />
        <FactRow label="Stage" value={input.row.stage} />
        <FactRow label="Target date" value={input.row.target_date ? fmtWhen(input.row.target_date) : null} />
        <FactRow label="Product" value={productName} />
      </div>

      {/* What's shipping */}
      <div>
        <div className="row gap-2" style={{ alignItems: "baseline", marginBottom: 8 }}>
          <span className="t-label" style={{ color: "var(--tm)" }}>What&apos;s shipping</span>
          {!ctxLoading && <span className="t-mono-xs" style={{ color: "var(--tm)" }}>{changelog.length}</span>}
        </div>
        {ctxLoading ? (
          <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Loading changelog…</div>
        ) : changelog.length === 0 ? (
          <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No changelog items linked to this release yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {changelog.map((c) => (
              <div key={c.id} className="row gap-2" style={{ alignItems: "center", padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--panel)" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--tp)", minWidth: 0, flex: 1 }}>{c.title}</span>
                {c.change_type && <Chip tone="default">{CHANGE_LABEL[c.change_type] ?? c.change_type}</Chip>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Why it matters for GTM — factual framing */}
      <div>
        <div className="t-label" style={{ color: "var(--tm)", marginBottom: 4 }}>Why it matters for GTM</div>
        <div className="t-sub" style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--ts)" }}>{why}</div>
      </div>
    </>
  );
}

function ThemeOverview({ input, evidence, ctxLoading }: {
  input: Extract<Input, { kind: "theme" }>; evidence: EvidenceSignal[]; ctxLoading: boolean;
}) {
  const summary = (input.row.summary ?? "").trim();
  const recommendation = (input.row.recommendation ?? "").trim();
  // The most recent evidence timestamp drives the "Last evidence" fact.
  const lastEvidence = evidence.map((s) => s.observed_at).filter(Boolean).map((t) => relTime(t)).find(Boolean) ?? null;

  return (
    <>
      {/* What's happening */}
      <div>
        <div className="t-label" style={{ color: "var(--tm)", marginBottom: 4 }}>What&apos;s happening</div>
        {summary
          ? <div className="t-body" style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--ts)" }}>{summary}</div>
          : <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>—</div>}
      </div>

      {/* Signal strength */}
      <div>
        <div className="t-label" style={{ color: "var(--tm)", marginBottom: 2 }}>Signal strength</div>
        <FactRow label="State" value={input.row.state} />
        <FactRow label="Confidence" value={input.row.conf_level != null ? `${Math.round(input.row.conf_level * 100)}%` : null} />
        <FactRow label="Last evidence" value={ctxLoading ? "Loading…" : lastEvidence} />
        <FactRow label="Supporting signals" value={ctxLoading ? "Loading…" : String(evidence.length)} />
      </div>

      {/* Recommendation callout */}
      <div>
        <div className="t-label" style={{ color: "var(--tm)", marginBottom: 8 }}>Recommendation</div>
        {recommendation ? (
          <div className="card card-pad" style={{ borderLeft: "2px solid var(--ac)", background: "var(--fill)" }}>
            <div className="t-body" style={{ fontSize: 13, lineHeight: 1.55 }}>{recommendation}</div>
          </div>
        ) : (
          <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>—</div>
        )}
      </div>
    </>
  );
}

// ---- SOURCES — the five origins as a tabbed sub-interface --------------------
function Sources({ buckets, ctxLoading }: { buckets: Record<Bucket, SourceItem[]>; ctxLoading: boolean }) {
  // Default to the first bucket that actually has items (else the first bucket).
  const firstWithItems = useMemo(() => BUCKETS.find((bk) => buckets[bk.id].length > 0)?.id ?? BUCKETS[0].id, [buckets]);
  const [tab, setTab] = useState<Bucket>(firstWithItems);
  // Re-seat the active tab when the data (and therefore the populated bucket) changes.
  useEffect(() => { setTab(firstWithItems); }, [firstWithItems]);

  const tabs = BUCKETS.map((bk) => ({
    key: bk.id,
    label: `${bk.label} · ${buckets[bk.id].length}`,
  }));
  const active = BUCKETS.find((bk) => bk.id === tab) ?? BUCKETS[0];
  const items = buckets[active.id];

  return (
    <div className="stack-3">
      <div className="t-label" style={{ color: "var(--tm)" }}>Supporting evidence &amp; materials</div>
      <SubTabs tabs={tabs} active={tab} onChange={setTab} />
      {ctxLoading && items.length === 0 ? (
        <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Loading…</div>
      ) : items.length === 0 ? (
        <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Nothing from {active.label} yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map((it) => (
            <div key={it.id} style={{ padding: "11px 13px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--panel)" }}>
              <div className="row-between" style={{ alignItems: "baseline", gap: 10 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--tp)", minWidth: 0 }}>{it.title}</span>
                {it.when && <span className="t-mono-xs" style={{ color: "var(--tm)", flexShrink: 0 }}>{it.when}</span>}
              </div>
              {it.desc && <div className="t-sub" style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--ts)", marginTop: 5 }}>{it.desc}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- SUPPORTING DETAILS — deep context + grounded framework -----------------
function Details({ input, evidence, changelog, ctxLoading, gtmName, productName, gtmFields, productFields }: {
  input: Input; evidence: EvidenceSignal[]; changelog: ChangelogItem[]; ctxLoading: boolean;
  gtmName: string | null; productName: string | null; gtmFields: GroundingField[]; productFields: GroundingField[];
}) {
  return (
    <div className="stack-3">
      {/* the deeper context — full evidence (signal) / full changelog (release) */}
      {input.kind === "theme" ? (
        <div>
          <div className="t-label" style={{ color: "var(--tm)", marginBottom: 8 }}>Evidence</div>
          {ctxLoading ? <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Loading evidence…</div>
            : evidence.length === 0 ? <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No supporting signals linked.</div>
            : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
      ) : (
        <div>
          <div className="t-label" style={{ color: "var(--tm)", marginBottom: 8 }}>What&apos;s in this release</div>
          {ctxLoading ? <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Loading changelog…</div>
            : changelog.length === 0 ? <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No changelog items linked.</div>
            : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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

      {/* "Grounded in <gtm> · <product>" framework reference (read-only) */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
        <div className="t-mono-xs" style={{ color: "var(--tm)", marginBottom: 8 }}>
          Grounded in {gtmName ?? "GTM record"}{productName ? ` · ${productName}` : ""}
        </div>
        <GroundingList gtmFields={gtmFields} productFields={productFields} />
      </div>
    </div>
  );
}

// The grounded framework fields — label + value, read-only (context only).
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

// ---- ACTIONS — current brief · Conversation · Formulate composer · Dismiss --
function Actions({ input, brief, isRatified, saving, onStartConversation, onSaveBrief, onRatify, onDismiss }: {
  input: Input; brief: Brief | null; isRatified: boolean; saving: boolean;
  onStartConversation: (seed: string | null) => void; onSaveBrief: (body: string) => void | Promise<void>;
  onRatify: () => void; onDismiss: () => void;
}) {
  const noun = input.kind === "release" ? "release" : "signal";
  const title = titleOf(input);
  // The primary recommendation: a theme's recommendation, else a generic starter.
  const recommendation = input.kind === "theme" ? (input.row.recommendation ?? "").trim() : "";
  const recSeed = recommendation
    ? `We need messaging for "${title}". The standing recommendation is: "${recommendation}". Give me your first take on how to express this, grounded in our framework, then ask me where to push.`
    : `Draft the messaging for this ${noun}: "${title}". Give me your first take in a few tight sentences, then ask me where to push.`;

  // Formulate composer — the human writes their own thinking; no AI typing.
  const [formulation, setFormulation] = useState("");
  const [saved, setSaved] = useState(false);
  const trimmed = formulation.trim();

  async function sendToNextStep() {
    if (!trimmed) return;
    await onSaveBrief(trimmed);
    setSaved(true);
  }

  return (
    <div className="stack-3">
      {/* current brief status + continue/ratify if one exists */}
      {brief && (
        <div className="card card-pad" style={{ background: "var(--panel-2)" }}>
          <div className="row-between" style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div className="row gap-2" style={{ alignItems: "center" }}>
              <span className="t-label" style={{ color: "var(--tm)" }}>Current brief</span>
              {isRatified ? <Chip tone="green">Ratified</Chip> : <Chip tone="amber">Draft</Chip>}
              {brief.updated_at && <span className="t-mono-xs" style={{ color: "var(--tm)" }}>updated {fmtWhen(brief.updated_at)}</span>}
            </div>
            <div className="row gap-2">
              <button className="btn btn-secondary btn-sm" onClick={() => onStartConversation(
                `Here is the current brief for "${title}":\n\n${brief.body}\n\nLet's continue refining it. Give me your read and one question about where to push.`
              )}>View / continue</button>
              <button className="btn btn-sm" disabled={saving || isRatified} onClick={onRatify}>{isRatified ? "Ratified" : "Ratify"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Recommendation → opens the conversation seeded by the recommendation */}
      <div>
        <div className="t-label" style={{ color: "var(--tm)", marginBottom: 8 }}>Recommendation</div>
        <div className="card card-pad" style={{ borderLeft: "2px solid var(--ac)" }}>
          <div className="t-body" style={{ fontSize: 13, lineHeight: 1.55, marginBottom: 10 }}>
            {recommendation || `Draft the messaging for this ${noun}.`}
          </div>
          <button className="btn btn-accent btn-sm" onClick={() => onStartConversation(recSeed)}>Conversation</button>
        </div>
      </div>

      {/* Formulate — the human writes their own thinking; then hands off or saves */}
      <div>
        <div className="t-label" style={{ color: "var(--tm)", marginBottom: 8 }}>Formulate</div>
        <textarea
          className="textarea"
          rows={6}
          value={formulation}
          onChange={(e) => { setFormulation(e.target.value); if (saved) setSaved(false); }}
          placeholder="Write your own starting thinking — your angle, the value to land, what to avoid. No AI involved here."
          style={{ width: "100%" }}
        />
        <div className="row gap-2" style={{ flexWrap: "wrap", marginTop: 8 }}>
          <button
            className="btn btn-sm"
            disabled={!trimmed}
            onClick={() => onStartConversation(
              `Here's my starting thinking for "${title}":\n\n${trimmed}\n\nReact to this, build on it, and ask me one question.`
            )}
          >Bring in an agent</button>
          <button className="btn btn-accent btn-sm" disabled={!trimmed || saving} onClick={sendToNextStep}>Send to next step</button>
        </div>
        {saved && (
          <div className="t-sub" style={{ fontSize: 12.5, color: "var(--gn, var(--am-text))", marginTop: 8 }}>
            Saved as the draft brief — ready for Tailor.
          </div>
        )}
      </div>

      {/* Dismiss */}
      <div className="row gap-2" style={{ flexWrap: "wrap" }}>
        <button className="btn btn-secondary btn-sm" onClick={onDismiss}>Dismiss</button>
      </div>
    </div>
  );
}
