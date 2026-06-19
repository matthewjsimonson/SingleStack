"use client";

// ProductReviewPopup — the detail surface for ONE product signal-theme. The
// Review PAGE is a board of theme cards; clicking one opens THIS large Modal,
// which mirrors a screen: a LEFT pick-em nav (Overview · Sources · Actions) + a
// RIGHT content panel.
//
// There is NO on-page editor. The spec is authored entirely through the
// conversation (DraftChatModal): "Use this draft" SAVES the spec into
// product_specs. The popup reflects the spec status (Needs / Draft / Ratified)
// and lets the human continue or ratify it. Mirrors messaging/ReviewPopup.tsx,
// theme-only and grounded in the PRODUCT record.
import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getOrgId } from "@/lib/org";
import { Modal, Chip, SubTabs } from "@/components/ui";
import { fmtWhen, buildProductGrounding, buildSpecContext, type GroundingField, type Persona, type ThemeRow } from "@/lib/productSpec";
import DraftChatModal from "@/components/messaging/DraftChatModal";
import type { RosterAgent } from "@/components/messaging/AgentPickerModal";

type SpecStatus = "draft" | "ratified" | "live";
export type Spec = {
  id: string;
  theme_id: string | null;
  body: string;
  status: SpecStatus;
  updated_at: string | null;
  title: string | null;
  org_id?: string | null;
  persona_id?: string | null;
};

// A dynamic audience row loaded from the personas table (scoped to org/product).
type PersonaRow = {
  id: string;
  name: string;
  role: string | null;
  industry: string | null;
  description: string | null;
  product_id: string | null;
};

export type Input = {
  kind: "theme";
  id: string;
  row: ThemeRow & { signal_ids?: string[] | null };
  spec: Spec | null;
};

// A signal-theme's evidence signal — carries the axes that drive bucketing.
type EvidenceSignal = {
  id: string; title: string; why: string | null; origin: string | null;
  domain: string | null; source_id: string | null; competitor_id: string | null; observed_at: string | null;
};

// The three pick-em items of the popup's left nav.
type NavItem = "overview" | "sources" | "actions";
const NAV: { id: NavItem; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "sources", label: "Sources" },
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

const titleOf = (input: Input) => input.row.title;

// One evidence row inside a Sources bucket.
type SourceItem = { id: string; title: string; desc: string | null; when: string | null };

export default function ProductReviewPopup({
  open, onClose, input, activeProductId, productName,
  productFields, roster, officerKey, supabase, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  input: Input | null;
  activeProductId: string | null;
  productName: string | null;
  productFields: GroundingField[];
  roster: RosterAgent[];
  officerKey: string | null;
  supabase: SupabaseClient;
  onSaved: () => void | Promise<void>;
}) {
  const [nav, setNav] = useState<NavItem>("overview");
  const [evidence, setEvidence] = useState<EvidenceSignal[]>([]);
  const [ctxLoading, setCtxLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // DraftChatModal state — the conversation that authors the spec.
  const [draftOpen, setDraftOpen] = useState(false);
  const [draftAgentKey, setDraftAgentKey] = useState<string | null>(null);
  const [seedMessage, setSeedMessage] = useState<string | null>(null);

  // Audience — dynamic personas in scope + the one this spec is framed for.
  const [personas, setPersonas] = useState<PersonaRow[]>([]);
  const [selectedPersona, setSelectedPersona] = useState<PersonaRow | null>(null);
  const [newPersonaOpen, setNewPersonaOpen] = useState(false);

  // Load the personas in scope: product-specific (when a product is active) plus
  // org-wide reusable ones. RLS scopes to the org; an empty list is fine.
  async function loadPersonas() {
    let q = supabase.from("personas").select("id, name, role, industry, description, product_id");
    if (activeProductId) q = q.or(`product_id.is.null,product_id.eq.${activeProductId}`);
    const { data } = await q.order("name");
    return (data ?? []) as PersonaRow[];
  }
  useEffect(() => {
    let alive = true;
    if (!open) return;
    (async () => {
      const rows = await loadPersonas();
      if (!alive) return;
      setPersonas(rows);
      // Default the selection to the spec's framed persona, else None (generic).
      const specPersonaId = input?.spec?.persona_id ?? null;
      setSelectedPersona(specPersonaId ? rows.find((p) => p.id === specPersonaId) ?? null : null);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, open, activeProductId, input?.id, input?.spec?.persona_id]);

  // Reset the nav back to Overview each time a new input opens.
  useEffect(() => { if (open) { setNav("overview"); setError(null); } }, [open, input?.id]);

  // Load the theme's deep context: its evidence signals.
  useEffect(() => {
    let alive = true;
    setEvidence([]);
    if (!open || !input) return;
    (async () => {
      setCtxLoading(true);
      try {
        const ids = input.row.signal_ids ?? [];
        if (ids.length) {
          const { data } = await supabase.from("signals")
            .select("id, title, why, origin, domain, source_id, competitor_id, observed_at")
            .in("id", ids).order("observed_at", { ascending: false, nullsFirst: false });
          if (alive) setEvidence((data ?? []) as EvidenceSignal[]);
        }
      } finally {
        if (alive) setCtxLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [supabase, open, input]);

  const spec = input?.spec ?? null;
  const isRatified = spec?.status === "ratified" || spec?.status === "live";
  const specStatusChip = isRatified
    ? <Chip tone="green">Ratified</Chip>
    : spec ? <Chip tone="amber">Draft</Chip>
    : <Chip tone="default">Needs spec</Chip>;

  // The grounding + spec context handed to the conversation (reused plumbing).
  const grounding = useMemo(() => buildProductGrounding(productFields), [productFields]);
  const personaForContext = useMemo<Persona | null>(
    () => selectedPersona
      ? { id: selectedPersona.id, name: selectedPersona.name, role: selectedPersona.role, industry: selectedPersona.industry, description: selectedPersona.description }
      : null,
    [selectedPersona],
  );
  const specContext = useMemo(() => {
    if (!input) return "";
    return buildSpecContext(input.row, grounding, personaForContext);
  }, [input, grounding, personaForContext]);

  // ---- bucket the theme's evidence into the FIVE origins ----------------------
  const buckets = useMemo<Record<Bucket, SourceItem[]>>(() => {
    const b: Record<Bucket, SourceItem[]> = { market: [], competitive: [], frontier: [], release: [], record: [] };
    if (!input) return b;
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
    return b;
  }, [input, evidence, productName]);

  // ---- conversation → SAVE the spec (mirror ProductReviewView's upsert) --------
  async function saveSpec(body: string) {
    if (!input) return;
    setSaving(true); setError(null);
    const title = titleOf(input);
    const now = new Date().toISOString();
    try {
      if (input.spec) {
        const { error } = await supabase.from("product_specs")
          .update({ body, updated_at: now, title, persona_id: selectedPersona?.id ?? null }).eq("id", input.spec.id);
        if (error) throw error;
      } else {
        const orgId = input.row.org_id ?? (await getOrgId());
        if (!orgId) throw new Error("Could not resolve your organization.");
        const { error } = await supabase.from("product_specs").insert({
          org_id: orgId,
          theme_id: input.id,
          product_id: activeProductId,
          persona_id: selectedPersona?.id ?? null,
          body, status: "draft", title,
        });
        if (error) throw error;
      }
      setDraftOpen(false);
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the spec.");
    } finally { setSaving(false); }
  }

  async function ratify() {
    if (!input?.spec) return;
    setSaving(true); setError(null);
    const now = new Date().toISOString();
    const { error } = await supabase.from("product_specs")
      .update({ status: "ratified", ratified_at: now, updated_at: now }).eq("id", input.spec.id);
    setSaving(false);
    if (error) { setError(error.message || "Could not ratify."); return; }
    await onSaved();
  }

  // Create a new persona (dynamic, reusable), then reload + select it. The
  // audience persists on the spec via persona_id when the spec is saved.
  async function createPersona(fields: { name: string; role: string; industry: string; description: string }) {
    const orgId = spec?.org_id ?? input?.row.org_id ?? (await getOrgId());
    if (!orgId) { setError("Could not resolve your organization."); return; }
    const { data, error } = await supabase.from("personas").insert({
      org_id: orgId,
      product_id: activeProductId ?? null,
      name: fields.name,
      role: fields.role || null,
      industry: fields.industry || null,
      description: fields.description || null,
      source: "manual",
    }).select("id, name, role, industry, description, product_id").single();
    if (error || !data) { setError(error?.message || "Could not create the audience."); return; }
    const rows = await loadPersonas();
    setPersonas(rows);
    setSelectedPersona((rows.find((p) => p.id === data.id) ?? data) as PersonaRow);
    setNewPersonaOpen(false);
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
          <span className="t-h2">{title}</span>
          <Chip tone="accent">signal</Chip>
          {specStatusChip}
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
                <button key={n.id} onClick={() => setNav(n.id)} className={on ? "nav-item on" : "nav-item"}>
                  {n.label}
                </button>
              );
            })}
          </nav>

          {/* RIGHT — content panel */}
          <div style={{ minWidth: 0 }}>
            {/* Audience bar — frames the whole review for a dynamic persona. */}
            <AudienceBar
              personas={personas}
              selected={selectedPersona}
              onSelect={setSelectedPersona}
              onNew={() => setNewPersonaOpen(true)}
            />
            {nav === "overview" && (
              <>
                <Overview input={input} evidence={evidence} ctxLoading={ctxLoading} />
                <GroundingBlock productName={productName} productFields={productFields} />
              </>
            )}
            {nav === "sources" && <Sources buckets={buckets} ctxLoading={ctxLoading} />}
            {nav === "actions" && (
              <Actions
                input={input} spec={spec} isRatified={isRatified} saving={saving}
                onStartConversation={startConversation} onSaveSpec={saveSpec} onRatify={ratify} onDismiss={onClose}
              />
            )}
          </div>
        </div>
      </Modal>

      {/* The conversation — authoring happens here; Use this draft SAVES the spec. */}
      <DraftChatModal
        open={draftOpen}
        onClose={() => setDraftOpen(false)}
        elementLabel={title}
        currentValue={spec?.body ?? ""}
        brief={specContext}
        agentKey={draftAgentKey}
        roster={roster}
        onAgentChange={setDraftAgentKey}
        onUseDraft={saveSpec}
        seedMessage={seedMessage}
      />

      {/* + New audience — a compact form; on save it's reusable across themes. */}
      <NewPersonaModal open={newPersonaOpen} onClose={() => setNewPersonaOpen(false)} onSave={createPersona} />
    </>
  );
}

// ---- AUDIENCE BAR — one slim row: who the spec is framed for -----------------
function AudienceBar({ personas, selected, onSelect, onNew }: {
  personas: PersonaRow[];
  selected: PersonaRow | null;
  onSelect: (p: PersonaRow | null) => void;
  onNew: () => void;
}) {
  const chip = selected
    ? `Framing for: ${selected.name}${selected.industry ? ` · ${selected.industry}` : ""}`
    : null;
  return (
    <div
      className="row gap-2"
      style={{
        alignItems: "center", flexWrap: "wrap",
        padding: "8px 12px", marginBottom: "var(--sp-4)",
        border: "1px solid var(--border)", borderRadius: 10, background: "var(--panel-2)", boxShadow: "var(--shadow-1)",
      }}
    >
      <span className="t-label" style={{ color: "var(--tm)", flexShrink: 0 }}>Audience</span>
      <select
        className="select"
        style={{ maxWidth: 280 }}
        value={selected?.id ?? ""}
        onChange={(e) => onSelect(personas.find((p) => p.id === e.target.value) ?? null)}
      >
        <option value="">— None (generic)</option>
        {personas.map((p) => (
          <option key={p.id} value={p.id}>{p.name}{p.industry ? ` · ${p.industry}` : ""}</option>
        ))}
      </select>
      {chip && <Chip tone="accent">{chip}</Chip>}
      <button className="btn btn-secondary btn-sm" style={{ marginLeft: "auto" }} onClick={onNew}>+ New</button>
    </div>
  );
}

// ---- + NEW AUDIENCE — compact create form (name required) -------------------
function NewPersonaModal({ open, onClose, onSave }: {
  open: boolean;
  onClose: () => void;
  onSave: (f: { name: string; role: string; industry: string; description: string }) => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [industry, setIndustry] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  // Reset the form each time it opens.
  useEffect(() => { if (open) { setName(""); setRole(""); setIndustry(""); setDescription(""); setBusy(false); } }, [open]);

  const trimmed = name.trim();
  async function submit() {
    if (!trimmed) return;
    setBusy(true);
    await onSave({ name: trimmed, role: role.trim(), industry: industry.trim(), description: description.trim() });
    setBusy(false);
  }

  return (
    <Modal open={open} onClose={onClose} title="New audience" width={460}>
      <div className="stack-3">
        <div>
          <div className="t-label" style={{ color: "var(--tm)", marginBottom: 4 }}>Name</div>
          <input className="input" style={{ width: "100%" }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Product Manager" />
        </div>
        <div>
          <div className="t-label" style={{ color: "var(--tm)", marginBottom: 4 }}>Role</div>
          <input className="input" style={{ width: "100%" }} value={role} onChange={(e) => setRole(e.target.value)} placeholder="Senior PM, platform team" />
        </div>
        <div>
          <div className="t-label" style={{ color: "var(--tm)", marginBottom: 4 }}>Industry</div>
          <input className="input" style={{ width: "100%" }} value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="SaaS" />
        </div>
        <div>
          <div className="t-label" style={{ color: "var(--tm)", marginBottom: 4 }}>Description</div>
          <textarea className="textarea" rows={4} style={{ width: "100%" }} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Their goals, pains, and the language they use." />
        </div>
        <div className="row gap-2" style={{ justifyContent: "flex-end" }}>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-accent btn-sm" disabled={!trimmed || busy} onClick={submit}>Save audience</button>
        </div>
      </div>
    </Modal>
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

// ---- OVERVIEW — a legit, structured read of the theme -----------------------
function Overview({ input, evidence, ctxLoading }: {
  input: Input; evidence: EvidenceSignal[]; ctxLoading: boolean;
}) {
  return (
    <div className="stack-3">
      {/* header chips */}
      <div className="row gap-2" style={{ alignItems: "center", flexWrap: "wrap" }}>
        <span className="t-h2">{titleOf(input)}</span>
        {input.row.state && <Chip tone="default">{input.row.state}</Chip>}
        {input.row.conf_level != null && <Chip tone="default">{Math.round(input.row.conf_level * 100)}% confidence</Chip>}
      </div>

      <ThemeOverview input={input} evidence={evidence} ctxLoading={ctxLoading} />
    </div>
  );
}

function ThemeOverview({ input, evidence, ctxLoading }: {
  input: Input; evidence: EvidenceSignal[]; ctxLoading: boolean;
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
            <div key={it.id} className="lift-card" style={{ padding: "12px 14px", border: "1px solid var(--border)", borderRadius: 10, background: "var(--panel)", boxShadow: "var(--shadow-1)" }}>
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

// The product truth the spec is grounded in — readable, grouped, no table chrome.
// Lives in Overview (it's context, not a source). Values render in primary ink so
// they're actually readable; labels are quiet but legible. Grouped Product record
// (what it is · strategy · capabilities) and Technical (the build constraints).
function GroundingBlock({ productName, productFields }: {
  productName: string | null; productFields: GroundingField[];
}) {
  const RECORD_KEYS: [string, string][] = [
    ["what_it_is", "What it is"], ["who_its_for", "Who it's for"], ["problem", "Problem"],
    ["strategic_intent", "Strategic intent"],
    ["core_capabilities", "Core capabilities"], ["differentiated_capabilities", "Differentiated capabilities"], ["roadmap_themes", "Roadmap themes"],
  ];
  const TECH_KEYS: [string, string][] = [
    ["architecture", "Architecture"], ["tech_stack", "Tech stack"],
    ["tech_debt", "Known constraints & debt"], ["evolution_watch", "Evolution watchlist"],
  ];
  const pick = (rows: GroundingField[], keys: [string, string][]) =>
    keys.map(([k, label]) => {
      const f = rows.find((r) => r.field_key === k);
      const v = (f?.value ?? "").trim();
      return v ? { label: f?.label || label, value: v } : null;
    }).filter((x): x is { label: string; value: string } => !!x);
  const record = pick(productFields, RECORD_KEYS);
  const tech = pick(productFields, TECH_KEYS);
  if (!record.length && !tech.length) return null;

  const Group = ({ title, items }: { title: string; items: { label: string; value: string }[] }) => (
    <div>
      <div className="t-label" style={{ color: "var(--ts)", marginBottom: 10 }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {items.map((it) => (
          <div key={it.label}>
            <div className="t-sub" style={{ color: "var(--ts)", fontWeight: 600, marginBottom: 3 }}>{it.label}</div>
            <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--tp)", display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{it.value}</div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16, marginTop: 16 }}>
      <div className="t-label" style={{ color: "var(--ts)", marginBottom: 14 }}>
        Grounded in what the product is{productName ? ` — ${productName}` : ""}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {record.length > 0 && <Group title="Product record" items={record} />}
        {tech.length > 0 && <Group title="Technical" items={tech} />}
      </div>
    </div>
  );
}

// ---- ACTIONS — current spec · Conversation · Formulate composer · Dismiss ----
function Actions({ input, spec, isRatified, saving, onStartConversation, onSaveSpec, onRatify, onDismiss }: {
  input: Input; spec: Spec | null; isRatified: boolean; saving: boolean;
  onStartConversation: (seed: string | null) => void; onSaveSpec: (body: string) => void | Promise<void>;
  onRatify: () => void; onDismiss: () => void;
}) {
  const title = titleOf(input);
  // The primary recommendation: the theme's recommendation, else a generic starter.
  const recommendation = (input.row.recommendation ?? "").trim();
  const recSeed = recommendation
    ? `We need a spec for "${title}". The standing recommendation is: "${recommendation}". Give me your first take on the spec — the problem, success metric, and behavior — grounded in what the product is and its constraints, then ask me where to push.`
    : `Write the spec for this product theme: "${title}". Give me your first take — the problem, success metric, and behavior — in a few tight sentences, then ask me where to push.`;

  // Formulate composer — the human writes their own thinking; no AI typing.
  const [formulation, setFormulation] = useState("");
  const [saved, setSaved] = useState(false);
  const trimmed = formulation.trim();

  async function sendToNextStep() {
    if (!trimmed) return;
    await onSaveSpec(trimmed);
    setSaved(true);
  }

  return (
    <div className="stack-3">
      {/* current spec status + continue/ratify if one exists */}
      {spec && (
        <div className="card card-pad" style={{ background: "var(--panel-2)" }}>
          <div className="row-between" style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div className="row gap-2" style={{ alignItems: "center" }}>
              <span className="t-label" style={{ color: "var(--tm)" }}>Current spec</span>
              {isRatified ? <Chip tone="green">Ratified</Chip> : <Chip tone="amber">Draft</Chip>}
              {spec.updated_at && <span className="t-mono-xs" style={{ color: "var(--tm)" }}>updated {fmtWhen(spec.updated_at)}</span>}
            </div>
            <div className="row gap-2">
              <button className="btn btn-secondary btn-sm" onClick={() => onStartConversation(
                `Here is the current spec for "${title}":\n\n${spec.body}\n\nLet's continue refining it. Give me your read and one question about where to push.`
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
            {recommendation || `Write the spec for this product theme.`}
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
          placeholder="Write your own starting thinking — the problem, the success metric, the non-goals, what to avoid. No AI involved here."
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
            Saved as the draft spec — ready for Tailor.
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
