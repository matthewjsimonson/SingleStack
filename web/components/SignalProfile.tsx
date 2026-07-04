"use client";

// Signal Profile — the HITL record of "your place in the market," editable by
// hand. Two scopes: the org-wide LANDSCAPE (step 1 of the competitive workflow —
// built from your product & GTM records to frame where to hunt for rivals) and
// the per-COMPETITOR raw battlecard (built from that rival's signals + records).
// AI drafts/refreshes; the human owns the final word (nothing saves until you save).
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Banner, Chip } from "@/components/ui";
import { Markdown } from "@/components/Markdown";
import SignalNetwork from "@/components/SignalNetwork";
import VectorCurator from "@/components/VectorCurator";
import NodeSources from "@/components/NodeSources";
import { compileNodeBrief, compileVectorBrief } from "@/lib/profileBrief";

// The signals network: a CENTER ('core' — what we are) plus four arms. Each
// node sits on a vector and carries a WEIGHT (3 core/closest … 1 edge/farthest).
export type Vector = "core" | "competitive" | "industry" | "persona" | "technology";
const VECTORS: { key: Vector; label: string; blurb: string }[] = [
  { key: "core", label: "Core — what we are", blurb: "The center: essence, positioning, wedge. Every arm hangs off this." },
  { key: "competitive", label: "Competitive", blurb: "The attributes that pinpoint the right rivals — aims the competitor search." },
  { key: "industry", label: "Industry", blurb: "The verticals you serve — aims industry discovery." },
  { key: "persona", label: "Persona", blurb: "The buyers/users you sell to — aims persona discovery." },
  { key: "technology", label: "Technology", blurb: "Frontier model/platform capabilities to watch." },
];
const vectorMeta = (v?: string) => VECTORS.find((x) => x.key === v) ?? VECTORS[0];
// Weight = distance from center. 3 core (closest, highest signal weight) … 1 edge.
const WEIGHTS: { w: number; label: string }[] = [{ w: 3, label: "Core" }, { w: 2, label: "Standard" }, { w: 1, label: "Edge" }];
const weightLabel = (w?: number) => WEIGHTS.find((x) => x.w === (w ?? 2))?.label ?? "Standard";
// Where each vector PUSHES — the intel area that applies it to search/analyze.
const PUSH: Partial<Record<Vector, { label: string; href: string }>> = {
  competitive: { label: "Competitive", href: "/competitive" },
  industry: { label: "Market intel", href: "/market" },
  persona: { label: "Market intel", href: "/market" },
  technology: { label: "Frontier", href: "/frontier" },
};

type Field = { field_key: string; label: string; value: string; origin?: string; vector?: Vector; weight?: number; parent_key?: string | null };
type Profile = { id: string; headline: string | null };

export default function SignalProfile({ scope, competitorId, competitorName, vectorFilter }: { scope: "landscape" | "competitor"; competitorId?: string; competitorName?: string; vectorFilter?: Vector }) {
  const supabase = createClient();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [headline, setHeadline] = useState("");
  const [fields, setFields] = useState<Field[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | "save" | "ai" | "create" | "push" | "battlecard" | "clear">(null);
  const [vecBusy, setVecBusy] = useState<Vector | null>(null); // which vector is mid-draft
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [openVector, setOpenVector] = useState<Vector | null>(null); // which vector is zoomed
  const [curating, setCurating] = useState(false);                   // vector-level interview drawer
  const [curateParent, setCurateParent] = useState<string | null>(null); // preselected attach point
  const [openNode, setOpenNode] = useState<string | null>(null);     // node-level drawer (field_key)
  const [refineText, setRefineText] = useState("");
  const [refining, setRefining] = useState(false);
  function zoomTo(v: Vector | null) { setOpenVector(v); setCurating(false); setCurateParent(null); setOpenNode(null); }

  // Refine ONE node with AI — sharpen it, or apply a free-text instruction.
  async function refineNode(ni: number, instruction: string) {
    const f = fields[ni]; if (!f || refining) return;
    setRefining(true); setError(null);
    try {
      const { data, error } = await supabase.functions.invoke("synthesize-profile", { body: { scope: "landscape", vector: f.vector ?? "core", step: "refine_node", instruction, node: { label: f.label, value: f.value, weight: f.weight ?? 2 } } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const nn = data?.node;
      if (nn) { setField(ni, { label: nn.label ?? f.label, value: nn.value ?? f.value, weight: nn.weight ?? f.weight, origin: "ai" }); setRefineText(""); }
    } catch (e) { setError(e instanceof Error ? e.message : "Could not refine the node."); }
    finally { setRefining(false); }
  }
  // Plain-language role of a vector — so a human gets what a node here does.
  const nodeRole: Record<Vector, string> = {
    core: "defines who we are — the frame every search inherits.",
    competitive: "tells search which rivals to find and how to judge them.",
    industry: "tells search which verticals to track and where their signal lives.",
    persona: "tells search which buyers to track and where they gather.",
    technology: "tells search which model/platform shifts to watch.",
  };

  const load = useCallback(async () => {
    setLoading(true);
    let qb = supabase.from("signal_profiles").select("id, headline").eq("scope", scope);
    qb = scope === "competitor" ? qb.eq("competitor_id", competitorId!) : qb.is("competitor_id", null);
    const { data: p } = await qb.maybeSingle();
    if (p) {
      setProfile(p as Profile); setHeadline(p.headline ?? "");
      const { data: fs } = await supabase.from("signal_profile_fields").select("field_key, label, value, origin, vector, weight, parent_key").eq("profile_id", p.id).order("position");
      setFields((fs ?? []) as Field[]);
    } else { setProfile(null); setHeadline(""); setFields([]); }
    setDirty(false); setLoading(false);
  }, [supabase, scope, competitorId]);
  useEffect(() => { load(); }, [load]);

  async function createProfile() {
    setBusy("create"); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      const { data, error } = await supabase.from("signal_profiles").insert({ org_id: orgId, scope, competitor_id: scope === "competitor" ? competitorId : null }).select("id, headline").single();
      if (error) throw error;
      setProfile(data as Profile); load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create the profile."); }
    finally { setBusy(null); }
  }

  async function draftAI() {
    setBusy("ai"); setError(null); setNote(null);
    try {
      const { data, error } = await supabase.functions.invoke("synthesize-profile", { body: { scope, competitor_id: competitorId, current: fields.map((f) => ({ field_key: f.field_key, label: f.label, value: f.value, vector: f.vector ?? "core", weight: f.weight ?? 2, parent_key: f.parent_key ?? null })) } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const d = data?.draft;
      if (!d) throw new Error("No draft returned.");
      setHeadline(d.headline ?? headline);
      setFields((d.fields ?? []).map((f: Field) => ({ ...f, origin: "ai", vector: (f.vector ?? "core") as Vector, weight: f.weight ?? 2, parent_key: f.parent_key ?? null })));
      setDirty(true);
      const ev = data?.evidence;
      const sigCount = (ev?.internal ?? 0) + (ev?.external ?? 0);
      setNote(scope === "landscape"
        ? (data?.mode === "analysis"
            ? `Analysis mode — synthesis has run, so the profile now folds in what your ${sigCount} signal(s) mean across vectors, alongside the search-focus that keeps discovery going. Review and Save.`
            : sigCount > 0
              ? `Discovery mode — built from your records + ${sigCount} signal(s). The *_search_focus nodes aim each tab's discovery. Synthesize signals to switch this to analysis. Review and Save.`
              : "Discovery mode — built from your product & GTM records. The *_search_focus nodes aim each tab's discovery; synthesize signals later to add analysis. Review and Save.")
        : `Drafted from ${ev?.internal ?? 0} internal + ${ev?.external ?? 0} external signal(s). Review and edit, then Save.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not draft the profile."); }
    finally { setBusy(null); }
  }

  // Draft ONE vector — focused synthesis for that arm (built on the core),
  // tuned to that vector's own search/analysis. Returns PROPOSALS: nothing
  // lands on the network until the human accepts each node in the curator.
  async function draftVector(v: Vector, transcript: { role: "q" | "a"; text: string }[] = []): Promise<Field[] | null> {
    if (vecBusy || busy) return null;
    setVecBusy(v); setError(null); setNote(null);
    try {
      const { data, error } = await supabase.functions.invoke("synthesize-profile", { body: { scope: "landscape", vector: v, transcript, current: fields.map((f) => ({ field_key: f.field_key, label: f.label, value: f.value, vector: f.vector ?? "core", weight: f.weight ?? 2, parent_key: f.parent_key ?? null })) } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const d = data?.draft;
      if (!d) throw new Error("No draft returned.");
      if (v === "core" && d.headline) { setHeadline(d.headline); setDirty(true); }
      const meta = vectorMeta(v);
      const incoming: Field[] = (d.fields ?? []).map((f: Field) => ({ ...f, origin: "ai", vector: v, weight: f.weight ?? 2, parent_key: f.parent_key ?? null }));
      setNote(`Proposed ${incoming.length} node(s) for ${meta.label.split(" — ")[0]}${data?.mode === "analysis" ? " (analysis mode)" : ""} — accept the ones that are true.`);
      return incoming;
    } catch (e) { setError(e instanceof Error ? e.message : "Could not draft that vector."); return null; }
    finally { setVecBusy(null); }
  }

  // Accept one reviewed node onto the network (replaces by field_key if it
  // already exists). Still unsaved until Save — the second gate.
  function upsertNode(n: Field) {
    setFields((fs) => {
      const i = fs.findIndex((f) => f.field_key === n.field_key);
      if (i >= 0) return fs.map((f, j) => (j === i ? { ...f, ...n } : f));
      return [...fs, n];
    });
    setDirty(true);
  }

  // Push a vector to its intel area — where it's applied to search/analyze.
  // Save first so the area reads the latest nodes (the setups read the DB).
  function pushVector(v: Vector) {
    const dest = PUSH[v]; if (!dest) return;
    if (dirty) { setError("Save your changes first, then push — the intel area reads the saved profile."); return; }
    router.push(dest.href);
  }

  async function save() {
    if (!profile) return;
    setBusy("save"); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      await supabase.from("signal_profiles").update({ headline: headline.trim() || null, updated_at: new Date().toISOString() }).eq("id", profile.id);
      // Replace the field set (simplest correct path for an editable section list).
      await supabase.from("signal_profile_fields").delete().eq("profile_id", profile.id);
      const kept = fields.filter((f) => f.field_key.trim() && f.label.trim());
      const keptKeys = new Set(kept.map((f) => f.field_key.trim()));
      // parent_key only survives if the parent is still in the set (and on the
      // same vector) — a dangling parent would just re-root at the hub anyway.
      const parentFor = (f: Field) => {
        const p = f.parent_key?.trim();
        if (!p || p === f.field_key.trim() || !keptKeys.has(p)) return null;
        const parent = kept.find((k) => k.field_key.trim() === p);
        return parent && (parent.vector ?? "core") === (f.vector ?? "core") ? p : null;
      };
      const rows = kept.map((f, i) => ({ org_id: orgId, profile_id: profile.id, field_key: f.field_key.trim(), label: f.label.trim(), value: f.value.trim() || null, position: i, origin: f.origin ?? "human", vector: f.vector ?? "core", weight: f.weight ?? 2, parent_key: parentFor(f) }));
      if (rows.length) { const { error } = await supabase.from("signal_profile_fields").insert(rows); if (error) throw error; }
      setDirty(false); setNote("Saved."); load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save."); }
    finally { setBusy(null); }
  }

  // The profile is the RAW battlecard: hand it to the analyst, who refines it
  // (plus themes/signals/matrix) into evidence-cited battlecard items — every
  // one through Signals → Review, then the messenger turns ratified items into
  // the GTM battlecard copy.
  async function fillBattlecard() {
    if (!profile || scope !== "competitor") return;
    if (dirty) { setError("Save your changes first — the analyst reads the saved profile."); return; }
    setBusy("battlecard"); setError(null); setNote(null);
    try {
      const { data: wfs } = await supabase.from("workflows").select("id, steps").eq("is_active", true).order("created_at");
      const wf = ((wfs ?? []) as { id: string; steps: { agent_id?: string; skill_id?: string | null }[] }[])
        .find((w) => Array.isArray(w.steps) && w.steps[0]?.agent_id && w.steps[0]?.skill_id);
      if (!wf) throw new Error("No runnable workflow yet — use ✦ Stand up analysis + messaging on the GTM battlecard tab first.");
      const { data, error } = await supabase.functions.invoke("battlecard-analyst", { body: { competitor_id: competitorId, workflow_id: wf.id } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setNote((data as { message?: string })?.message ?? "Battlecard items proposed — review them in Signals → Review, then run the messenger to refine into the GTM battlecard.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not fill the battlecard."); }
    finally { setBusy(null); }
  }

  async function pushToStrategy() {
    if (!profile) return;
    if (dirty) { setError("Save your changes first, then push to strategy."); return; }
    setBusy("push"); setError(null); setNote(null);
    try {
      const { data, error } = await supabase.functions.invoke("profile-to-strategy", { body: { profile_id: profile.id } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (!data?.created) setNote(data?.message || "Nothing groundable to push yet.");
      else setNote(`Created ${data.product} product + ${data.gtm} GTM theme(s) — find them on the Strategy and GTM strategy boards.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not push to strategy."); }
    finally { setBusy(null); }
  }

  // Clear the WHOLE profile — wipe every section + the headline so it can be
  // rebuilt from scratch. Writes immediately (not a draft); the empty profile then
  // re-synthesizes fresh — landscape from your records, competitor from signals —
  // with no stale section preserved.
  async function clearProfile() {
    if (!profile) return;
    if (!confirm("Clear this competitive profile completely? Every section and the headline are deleted so it can be rebuilt fresh. This can't be undone.")) return;
    setBusy("clear"); setError(null); setNote(null);
    try {
      await supabase.from("signal_profile_fields").delete().eq("profile_id", profile.id);
      await supabase.from("signal_profiles").update({ headline: null, updated_at: new Date().toISOString() }).eq("id", profile.id);
      setFields([]); setHeadline(""); setDirty(false);
      setNote(scope === "landscape"
        ? "Cleared. Press Draft to rebuild it fresh from your product & GTM records."
        : "Cleared. Press Draft to rebuild it fresh from this competitor's signals & your records.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not clear the profile."); }
    finally { setBusy(null); }
  }

  function setField(i: number, patch: Partial<Field>) { setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f))); setDirty(true); }
  function removeField(i: number) { setFields((fs) => fs.filter((_, j) => j !== i)); setDirty(true); }
  // Competitor dossiers keep the plain add (flat sections, no vectors/branches).
  function addField(vector: Vector = "core") { setFields((fs) => [...fs, { field_key: `node_${fs.length + 1}`, label: "New section", value: "", origin: "human", vector, weight: 2 }]); setDirty(true); }

  if (loading) return <div className="t-sub t-muted">Loading…</div>;

  // SLICE MODE — an intelligence tab reads ONE vector of the central profile
  // (read-only). Editing/drafting happens on the Signals home, not here.
  if (vectorFilter) {
    const vm = vectorMeta(vectorFilter);
    const short = vm.label.split(" — ")[0];
    const slice = fields.filter((f) => (f.vector ?? "core") === vectorFilter && f.value.trim()).sort((a, b) => (b.weight ?? 2) - (a.weight ?? 2));
    return (
      <div className="card card-pad">
        <div className="row-between" style={{ gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 660 }}>Signals profile · {short}</div>
            <div className="t-sub t-muted" style={{ fontSize: 12, marginTop: 2 }}>{vm.blurb} Drawn from your central signals profile.</div>
          </div>
          <a className="btn btn-secondary btn-sm" href="/signals" style={{ flexShrink: 0 }} title="The signals profile lives on the Signals home">Edit on Signals →</a>
        </div>
        {headline.trim() && <div className="t-sub" style={{ fontSize: 12.5, fontStyle: "italic", marginBottom: 10 }}>{headline}</div>}
        {slice.length === 0 ? (
          <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No {short.toLowerCase()} guidance in your signals profile yet — set it up on the <strong>Signals</strong> home and it aims this tab&apos;s discovery.</div>
        ) : (
          <>
            <div className="stack-3">
              {slice.map((f, i) => (
                <div key={i}>
                  <div className="t-label" style={{ marginBottom: 4 }}>{f.label}</div>
                  <Markdown text={f.value} />
                </div>
              ))}
            </div>
            {/* The exact steer this tab's pulls inherit, compiled live. */}
            <details style={{ marginTop: 12 }}>
              <summary className="t-sub t-muted" style={{ fontSize: 11.5, cursor: "pointer" }}>What this vector tells the brain (the live pull steer)</summary>
              <div className="t-mono-xs" style={{ whiteSpace: "pre-wrap", color: "var(--ts)", lineHeight: 1.55, marginTop: 6, background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "8px 10px" }}>{compileVectorBrief(fields, vectorFilter)}</div>
            </details>
          </>
        )}
      </div>
    );
  }

  const title = scope === "landscape" ? "Signals profile — what to find, track & analyze" : `Signal Profile — ${competitorName ?? "competitor"} (the raw battlecard)`;
  const blurb = scope === "landscape"
    ? "One intelligence network, built from your product & GTM records: a core (what you are) plus four vectors — competitive, industry, persona, technology. Each node carries a weight (core → edge) so search focuses on what matters. The intelligence tabs draw on their vector. Editable by hand; it sharpens as signals come in."
    : "Where you stand against this competitor — carried over from setup, then sharpened with internal (deals, calls) + external (public) signals. Editable by hand.";

  if (!profile) {
    return (
      <div className="card card-pad">
        <div style={{ fontSize: 14.5, fontWeight: 660, marginBottom: 4 }}>{title}</div>
        <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 12 }}>{blurb}</div>
        <Banner>{error}</Banner>
        <button className="btn" onClick={createProfile} disabled={busy === "create"}>{busy === "create" ? "Creating…" : "Start this profile"}</button>
      </div>
    );
  }

  return (
    <div>
      <div className="row-between" style={{ alignItems: "flex-start", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 660 }}>{title}</div>
          <div className="t-sub t-muted" style={{ fontSize: 12, marginTop: 2 }}>{blurb}</div>
        </div>
        <div className="row gap-2" style={{ flexShrink: 0 }}>
          <button className="btn btn-secondary btn-sm" onClick={draftAI} disabled={busy === "ai" || vecBusy !== null} style={{ color: "var(--ac-text)" }}
            title={scope === "landscape" ? "Draft/refresh the WHOLE network at once — or use the per-vector Draft to do one arm" : "Synthesize this competitor's profile from its signals + your records"}>{busy === "ai" ? "Synthesizing…" : scope === "landscape" ? "Draft all vectors" : "Draft / refresh with AI"}</button>
          {scope === "competitor" && (
            <button className="btn btn-secondary btn-sm" onClick={fillBattlecard} disabled={busy === "battlecard" || dirty}
              title={dirty ? "Save first" : "This profile is the raw battlecard — the analyst refines it into evidence-cited items (through review), then the messenger drafts the GTM battlecard copy"}>
              {busy === "battlecard" ? "Filling…" : "→ Fill the battlecard"}
            </button>
          )}
          {scope === "competitor" && (
            <button className="btn btn-secondary btn-sm" onClick={pushToStrategy} disabled={busy === "push" || dirty} title={dirty ? "Save first" : "Derive product + GTM strategy themes from this profile"}>{busy === "push" ? "Pushing…" : dirty ? "Save to push to strategy" : "→ Push to strategy"}</button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={clearProfile} disabled={busy === "clear" || (fields.length === 0 && !headline.trim())} title="Wipe every node so the profile rebuilds fresh" style={{ color: "var(--rd-text, #b42318)" }}>{busy === "clear" ? "Clearing…" : "Clear"}</button>
          <button className="btn btn-sm" onClick={save} disabled={busy === "save" || !dirty}>{busy === "save" ? "Saving…" : dirty ? "Save" : "Saved"}</button>
        </div>
      </div>

      <Banner>{error}</Banner>
      {note && <div className="banner" style={{ marginBottom: 12 }}>{note}</div>}

      {scope === "competitor" && (
        <label className="field"><span className="t-label">Headline <span className="t-muted" style={{ fontWeight: 400 }}>— where we sit, in one line</span></span>
          <input className="input" value={headline} onChange={(e) => { setHeadline(e.target.value); setDirty(true); }} placeholder="e.g. We lead on explainability for mid-market; exposed on price vs Acme." /></label>
      )}

      {scope === "landscape" ? (<>
        <SignalNetwork fields={fields} openVector={openVector} onOpenVector={zoomTo} onOpenNode={(k) => { setOpenNode(k); setRefineText(""); }} onCurate={() => setCurating(true)} selectedKey={openNode} />
        {dirty && <div className="t-sub t-muted" style={{ fontSize: 11.5, marginTop: 8 }}>Unsaved changes — Save in the header or a drawer.</div>}

        {/* Vector-level interview/curation drawer (opened by Manage vector). */}
        {openVector && curating && (() => {
          const v = VECTORS.find((x) => x.key === openVector)!;
          const entries = fields.map((f, i) => ({ f, i })).filter(({ f }) => (f.vector ?? "core") === openVector).sort((a, b) => (b.f.weight ?? 2) - (a.f.weight ?? 2));
          return (
            <VectorCurator
              vector={openVector} label={v.label.split(" — ")[0]} blurb={v.blurb}
              entries={entries} onClose={() => { setCurating(false); setCurateParent(null); }}
              setField={setField} removeField={removeField} upsertNode={upsertNode}
              generate={draftVector} generating={vecBusy === openVector}
              onSave={save} onPush={() => pushVector(openVector)} pushLabel={PUSH[openVector]?.label}
              dirty={dirty} savingBusy={busy === "save"} initialParent={curateParent}
            />
          );
        })()}

        {/* Node-level drawer (opened by clicking a node). */}
        {openNode && (() => {
          const ni = fields.findIndex((f) => f.field_key === openNode);
          if (ni < 0) return null;
          const f = fields[ni];
          const vm = vectorMeta(f.vector);
          const dest = PUSH[(f.vector ?? "core") as Vector];
          return (
            <>
              <div onClick={() => setOpenNode(null)} style={{ position: "fixed", inset: 0, background: "rgba(11,12,14,0.32)", zIndex: 40 }} />
              <aside style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: 440, maxWidth: "95vw", background: "var(--panel)", borderLeft: "1px solid var(--border)", boxShadow: "var(--shadow-md)", zIndex: 41, display: "flex", flexDirection: "column" }}>
                <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }} className="row-between">
                  <div className="row gap-2" style={{ alignItems: "center" }}><Chip tone="default">{vm.label.split(" — ")[0]}</Chip>{f.origin === "ai" && <Chip tone="violet">AI</Chip>}</div>
                  <button className="btn btn-secondary btn-sm" onClick={() => setOpenNode(null)}>Close</button>
                </div>
                <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }} className="stack-3">
                  <div className="t-sub t-muted" style={{ fontSize: 12, background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}>
                    This is a <strong>{vm.label.split(" — ")[0]}</strong> node — it {nodeRole[(f.vector ?? "core") as Vector]} Its <strong>weight</strong> ({weightLabel(f.weight)}) sets how hard search leans on it: core nodes are searched first, edge nodes are caught but not chased.
                  </div>
                  <label className="field"><span className="t-label">Node</span>
                    <input className="input" value={f.label} onChange={(e) => setField(ni, { label: e.target.value })} placeholder="Short name" /></label>
                  <label className="field"><span className="t-label">Weight <span className="t-muted" style={{ fontWeight: 400 }}>— closeness to the core</span></span>
                    <select className="select" value={f.weight ?? 2} onChange={(e) => setField(ni, { weight: Number(e.target.value) })}>
                      {WEIGHTS.map((w) => <option key={w.w} value={w.w}>{w.label}</option>)}
                    </select></label>
                  {/* Where this node sits on its branch — and grow the chain from here */}
                  {(() => {
                    const parent = f.parent_key ? fields.find((x) => x.field_key === f.parent_key) : null;
                    const kids = fields.filter((x) => x.parent_key === f.field_key);
                    return (
                      <div className="row-between" style={{ alignItems: "center", gap: 8 }}>
                        <div className="t-mono-xs t-muted" style={{ minWidth: 0 }}>
                          branches off {parent ? parent.label : `the ${vm.label.split(" — ")[0]} hub`}{kids.length ? ` · ${kids.length} node${kids.length === 1 ? "" : "s"} branch off it` : ""}
                        </div>
                        <button className="btn btn-secondary btn-sm" style={{ flexShrink: 0 }}
                          onClick={() => { setOpenNode(null); setCurateParent(f.field_key); setCurating(true); }}>+ Branch off this node</button>
                      </div>
                    );
                  })()}
                  <label className="field"><span className="t-label">Statement <span className="t-muted" style={{ fontWeight: 400 }}>— a fact about us, declarative</span></span>
                    <textarea className="textarea" rows={6} value={f.value} onChange={(e) => setField(ni, { value: e.target.value })} placeholder="e.g. AI-built working prototypes are our core battleground." /></label>
                  {/* Refine with AI — sharpen, or steer with an instruction */}
                  <div className="card card-pad" style={{ background: "var(--panel-2)" }}>
                    <div className="t-label" style={{ marginBottom: 6 }}>Refine with AI</div>
                    <textarea className="textarea" rows={2} value={refineText} onChange={(e) => setRefineText(e.target.value)} placeholder="Optional: how to change it — e.g. 'more specific', 'split out the DIY angle', 'this is edge, not core'." />
                    <div className="row gap-2" style={{ marginTop: 8 }}>
                      <button className="btn btn-sm" onClick={() => refineNode(ni, refineText)} disabled={refining}>{refining ? "Refining…" : refineText.trim() ? "Apply" : "Sharpen"}</button>
                      <span className="t-sub t-muted" style={{ fontSize: 11.5, alignSelf: "center" }}>grounded in your records</span>
                    </div>
                  </div>
                  {/* What this node tells the brain — the LIVE steer compiled into
                      every pull this node feeds. Edit the node (and Save) and the
                      next pull hunts differently. */}
                  <div className="card card-pad" style={{ background: "var(--panel-2)" }}>
                    <div className="t-label" style={{ marginBottom: 6 }}>What this node tells the brain</div>
                    <div className="t-mono-xs" style={{ whiteSpace: "pre-wrap", color: "var(--ts)", lineHeight: 1.55 }}>{compileNodeBrief(fields, f.field_key) || "Give the node a statement — that statement becomes the search steer."}</div>
                    <div className="t-sub t-muted" style={{ fontSize: 11, marginTop: 6 }}>Compiled into every pull this node feeds, live at pull time. Edit the statement and Save — the next pull hunts differently.</div>
                  </div>
                  {/* Sources — where this node pulls from (web now; tools next). */}
                  <NodeSources vector={(f.vector ?? "core") as Vector} nodeKey={f.field_key} seed={compileNodeBrief(fields, f.field_key)} />
                </div>
                <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)" }} className="row-between">
                  <button className="btn btn-secondary btn-sm" onClick={() => { removeField(ni); setOpenNode(null); }} style={{ color: "var(--rd-text)" }}>Remove node</button>
                  <div className="row gap-2">
                    {dest && <button className="btn btn-secondary btn-sm" onClick={() => pushVector((f.vector ?? "core") as Vector)} title={`Apply the ${vm.label.split(" — ")[0]} vector in ${dest.label}`}>Push to {dest.label} →</button>}
                    <button className="btn btn-sm" onClick={save} disabled={!dirty || busy === "save"}>{busy === "save" ? "Saving…" : dirty ? "Save" : "Saved"}</button>
                  </div>
                </div>
              </aside>
            </>
          );
        })()}
      </>) : (<>
        {/* Per-competitor dossier — a flat, editable list (no vectors). */}
        <div className="stack-3" style={{ marginTop: "var(--sp-3)" }}>
          {fields.length === 0 && <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No sections yet. Draft with AI, or add one by hand.</div>}
          {fields.map((f, i) => (
            <div key={i} className="card card-pad">
              <div className="row-between" style={{ alignItems: "center", gap: 8, marginBottom: 6 }}>
                <input className="input" value={f.label} onChange={(e) => setField(i, { label: e.target.value })} style={{ fontWeight: 640, fontSize: 13.5, maxWidth: 320 }} />
                <div className="row gap-2" style={{ alignItems: "center" }}>
                  {f.origin === "ai" && <Chip tone="violet">AI</Chip>}
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPreviewKey(previewKey === f.field_key ? null : f.field_key)}>{previewKey === f.field_key ? "Edit" : "Preview"}</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => removeField(i)} style={{ color: "var(--rd-text)" }}>Remove</button>
                </div>
              </div>
              {previewKey === f.field_key
                ? <div className="card card-pad" style={{ background: "var(--panel-2)", minHeight: 60 }}>{f.value.trim() ? <Markdown text={f.value} /> : <span className="t-sub t-muted">Empty.</span>}</div>
                : <textarea className="textarea" rows={4} value={f.value} onChange={(e) => setField(i, { value: e.target.value })} placeholder="What the evidence says — markdown supported." />}
            </div>
          ))}
        </div>
        <div className="row gap-2" style={{ marginTop: "var(--sp-3)" }}>
          <button className="btn btn-secondary btn-sm" onClick={() => addField()}>+ Add section</button>
          {dirty && <span className="t-sub t-muted" style={{ fontSize: 11.5, alignSelf: "center" }}>Unsaved changes</span>}
        </div>
      </>)}
    </div>
  );
}
