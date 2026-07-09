"use client";

// Signal Profile — the HITL record of "your place in the market," editable by
// hand. Two scopes: the org-wide LANDSCAPE (the signals profile workbench —
// core + three intelligence vectors that aim every pull) and the per-COMPETITOR
// raw battlecard (built from that rival's signals + records).
//
// The landscape is a WORKBENCH, not a visualization: vector tabs across the
// top, and one full-width working surface per vector (VectorCurator) where you
// manage, set up, and optimize that vector — nodes as a readable tree, AI
// proposals you accept one by one, sources, and the signals the pulls brought
// in. AI drafts/refreshes; the human owns the final word (nothing saves until
// you Save).
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Banner, Chip, SubTabs } from "@/components/ui";
import { Markdown } from "@/components/Markdown";
import VectorCurator from "@/components/VectorCurator";
import { compileVectorBrief } from "@/lib/profileBrief";
import { edgeErrorMessage } from "@/lib/edgeError";

// The signals profile: a CORE (what we are) plus THREE intelligence vectors.
// Each node carries a WEIGHT (3 closest … 1 edge); what the weight MEANS is
// the vector's own vocabulary (market: direct → adjacent → indirect).
export type Vector = "core" | "competitive" | "market" | "technology";
const VECTORS: { key: Vector; label: string; blurb: string }[] = [
  { key: "core", label: "Core — what we are", blurb: "The center: essence, positioning, wedge. Every vector builds on this." },
  { key: "competitive", label: "Competitive", blurb: "Competing products — the attributes that pinpoint the right rivals and aim the competitor search." },
  { key: "market", label: "Market", blurb: "The applicable market: industries, personas, and market news — direct, adjacent, and indirect." },
  { key: "technology", label: "Technology", blurb: "What powers the product, what powers building it, and what powers GTM — frontier and open-source models across all three." },
];
const vectorMeta = (v?: string) => VECTORS.find((x) => x.key === v) ?? VECTORS[0];
// Where each vector PUSHES — the intel area that applies it to search/analyze.
const PUSH: Partial<Record<Vector, { label: string; href: string }>> = {
  competitive: { label: "Competitive", href: "/competitive" },
  market: { label: "Market intel", href: "/market" },
  technology: { label: "Frontier", href: "/frontier" },
};

type Field = { field_key: string; label: string; value: string; origin?: string; vector?: Vector; weight?: number; parent_key?: string | null };
type Profile = { id: string; headline: string | null };
type Stage = { v: Vector; status: "pending" | "running" | "done" | "error"; msg?: string; count?: number };

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
  const [activeVector, setActiveVector] = useState<Vector>("core");
  const [refining, setRefining] = useState(false);
  const [stages, setStages] = useState<Stage[]>([]); // staged Draft-all progress

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

  const currentPayload = (fs: Field[]) => fs.map((f) => ({ field_key: f.field_key, label: f.label, value: f.value, vector: f.vector ?? "core", weight: f.weight ?? 2, parent_key: f.parent_key ?? null }));

  // Draft the WHOLE profile — STAGED, one vector at a time, with visible
  // progress: core first (everything builds on it), then each vector. A failed
  // stage reports its real error and the rest still run. Landscape only.
  async function draftAllStaged() {
    if (busy || vecBusy) return;
    setBusy("ai"); setError(null); setNote(null);
    const order: Vector[] = ["core", "competitive", "market", "technology"];
    setStages(order.map((v) => ({ v, status: "pending" })));
    let acc = fields;
    let failed = 0, total = 0;
    for (const v of order) {
      setStages((s) => s.map((x) => (x.v === v ? { ...x, status: "running" } : x)));
      try {
        const { data, error } = await supabase.functions.invoke("synthesize-profile", { body: { scope: "landscape", vector: v, current: currentPayload(acc) } });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        const incoming: Field[] = (data?.draft?.fields ?? []).map((f: Field) => ({ ...f, origin: "ai", vector: v, weight: f.weight ?? 2, parent_key: f.parent_key ?? null }));
        acc = [...acc.filter((f) => (f.vector ?? "core") !== v), ...incoming];
        if (v === "core" && data?.draft?.headline) setHeadline(data.draft.headline);
        setFields(acc); setDirty(true);
        total += incoming.length;
        setStages((s) => s.map((x) => (x.v === v ? { ...x, status: "done", count: incoming.length } : x)));
      } catch (e) {
        failed++;
        const msg = await edgeErrorMessage(e, "synthesize-profile");
        setStages((s) => s.map((x) => (x.v === v ? { ...x, status: "error", msg } : x)));
      }
    }
    setNote(failed
      ? `Drafted ${total} node(s); ${failed} vector(s) failed — their errors are shown above. Review and Save what landed.`
      : `Drafted ${total} node(s) across the profile. Review each vector and Save.`);
    setBusy(null);
  }

  // Draft ONE vector — returns PROPOSALS: nothing lands until the human
  // accepts each node in the vector's surface.
  async function draftVector(v: Vector, transcript: { role: "q" | "a"; text: string }[] = []): Promise<Field[] | null> {
    if (vecBusy || busy) return null;
    setVecBusy(v); setError(null); setNote(null);
    try {
      const { data, error } = await supabase.functions.invoke("synthesize-profile", { body: { scope: "landscape", vector: v, transcript, current: currentPayload(fields) } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const d = data?.draft;
      if (!d) throw new Error("No draft returned.");
      if (v === "core" && d.headline) { setHeadline(d.headline); setDirty(true); }
      const incoming: Field[] = (d.fields ?? []).map((f: Field) => ({ ...f, origin: "ai", vector: v, weight: f.weight ?? 2, parent_key: f.parent_key ?? null }));
      setNote(`Proposed ${incoming.length} node(s) for ${vectorMeta(v).label.split(" — ")[0]}${data?.mode === "analysis" ? " (analysis mode)" : ""} — accept the ones that are true.`);
      return incoming;
    } catch (e) { setError(await edgeErrorMessage(e, "synthesize-profile")); return null; }
    finally { setVecBusy(null); }
  }

  // Refine ONE node with AI — sharpen it, or apply a free-text instruction.
  async function refineNode(ni: number, instruction: string) {
    const f = fields[ni]; if (!f || refining) return;
    setRefining(true); setError(null);
    try {
      const { data, error } = await supabase.functions.invoke("synthesize-profile", { body: { scope: "landscape", vector: f.vector ?? "core", step: "refine_node", instruction, node: { label: f.label, value: f.value, weight: f.weight ?? 2 } } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const nn = data?.node;
      if (nn) setField(ni, { label: nn.label ?? f.label, value: nn.value ?? f.value, weight: nn.weight ?? f.weight, origin: "ai" });
    } catch (e) { setError(await edgeErrorMessage(e, "synthesize-profile")); }
    finally { setRefining(false); }
  }

  // Accept one reviewed node (replaces by field_key if it already exists).
  // Still unsaved until Save — the second gate.
  function upsertNode(n: Field) {
    setFields((fs) => {
      const i = fs.findIndex((f) => f.field_key === n.field_key);
      if (i >= 0) return fs.map((f, j) => (j === i ? { ...f, ...n } : f));
      return [...fs, n];
    });
    setDirty(true);
  }

  // Push a vector to its intel area — where it's applied to search/analyze.
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
      // same vector) — a dangling parent would just re-root at the vector anyway.
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
    } catch (e) { setError(await edgeErrorMessage(e, "battlecard-analyst")); }
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
    } catch (e) { setError(await edgeErrorMessage(e, "profile-to-strategy")); }
    finally { setBusy(null); }
  }

  // Clear the WHOLE profile — wipe every section + the headline so it can be
  // rebuilt from scratch.
  async function clearProfile() {
    if (!profile) return;
    if (!confirm("Clear this profile completely? Every node and the headline are deleted so it can be rebuilt fresh. This can't be undone.")) return;
    setBusy("clear"); setError(null); setNote(null);
    try {
      await supabase.from("signal_profile_fields").delete().eq("profile_id", profile.id);
      await supabase.from("signal_profiles").update({ headline: null, updated_at: new Date().toISOString() }).eq("id", profile.id);
      setFields([]); setHeadline(""); setDirty(false); setStages([]);
      setNote(scope === "landscape"
        ? "Cleared. Draft with AI to rebuild it fresh from your product & GTM records."
        : "Cleared. Draft with AI to rebuild it fresh from this competitor's signals & your records.");
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
    ? "Your intelligence profile, built from your product & GTM records: a core (what you are) plus three vectors — competitive, market, technology. Each node is a weighted statement that aims search; the intelligence tabs draw on their vector. Editable by hand; it sharpens as signals come in."
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

  const activeMeta = vectorMeta(activeVector);
  const countOf = (v: Vector) => fields.filter((f) => (f.vector ?? "core") === v && f.label.trim()).length;

  return (
    <div>
      <div className="row-between" style={{ alignItems: "flex-start", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 660 }}>{title}</div>
          <div className="t-sub t-muted" style={{ fontSize: 12, marginTop: 2 }}>{blurb}</div>
        </div>
        <div className="row gap-2" style={{ flexShrink: 0 }}>
          <button className="btn btn-secondary btn-sm" onClick={scope === "landscape" ? draftAllStaged : draftAllCompetitor} disabled={busy === "ai" || vecBusy !== null} style={{ color: "var(--ac-text)" }}
            title={scope === "landscape" ? "Draft/refresh the whole profile, one vector at a time with visible progress" : "Synthesize this competitor's profile from its signals + your records"}>{busy === "ai" ? "Drafting…" : scope === "landscape" ? "Draft all vectors" : "Draft / refresh with AI"}</button>
          {scope === "competitor" && (
            <button className="btn btn-secondary btn-sm" onClick={fillBattlecard} disabled={busy === "battlecard" || dirty}
              title={dirty ? "Save first" : "This profile is the raw battlecard — the analyst refines it into evidence-cited items (through review), then the messenger drafts the GTM battlecard copy"}>
              {busy === "battlecard" ? "Filling…" : "→ Fill the battlecard"}
            </button>
          )}
          {scope === "competitor" && (
            <button className="btn btn-secondary btn-sm" onClick={pushToStrategy} disabled={busy === "push" || dirty} title={dirty ? "Save first" : "Derive product + GTM strategy themes from this profile"}>{busy === "push" ? "Pushing…" : dirty ? "Save to push to strategy" : "→ Push to strategy"}</button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={clearProfile} disabled={busy === "clear" || (fields.length === 0 && !headline.trim())} title="Wipe every node so the profile rebuilds fresh" style={{ color: "var(--rd-text)" }}>{busy === "clear" ? "Clearing…" : "Clear"}</button>
          <button className="btn btn-sm" onClick={save} disabled={busy === "save" || !dirty}>{busy === "save" ? "Saving…" : dirty ? "Save" : "Saved"}</button>
        </div>
      </div>

      <Banner>{error}</Banner>
      {note && <div className="banner" style={{ marginBottom: 12 }}>{note}</div>}

      {/* Staged draft progress — you always see where it is and what failed. */}
      {stages.length > 0 && (
        <div className="card card-pad" style={{ marginBottom: 12 }}>
          <div className="row-between" style={{ marginBottom: 8, alignItems: "center" }}>
            <div className="t-label">Drafting the profile — vector by vector</div>
            {busy !== "ai" && <button className="btn btn-secondary btn-sm" onClick={() => setStages([])}>Dismiss</button>}
          </div>
          <div className="stack-2">
            {stages.map((s) => {
              const m = vectorMeta(s.v).label.split(" — ")[0];
              return (
                <div key={s.v} className="row gap-2" style={{ alignItems: "baseline" }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, alignSelf: "center",
                    background: s.status === "done" ? "var(--gn)" : s.status === "error" ? "var(--rd-text)" : s.status === "running" ? "var(--am-text)" : "var(--border-strong)" }} />
                  <span style={{ fontSize: 13, fontWeight: 620, width: 110, flexShrink: 0 }}>{m}</span>
                  <span className="t-sub t-muted" style={{ fontSize: 12.5, minWidth: 0 }}>
                    {s.status === "pending" ? "waiting…"
                      : s.status === "running" ? "drafting — reading your records and signals…"
                      : s.status === "done" ? `${s.count ?? 0} node(s) drafted`
                      : s.msg}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {scope === "landscape" ? (<>
        {/* The workbench: one tab per vector, one working surface at a time. */}
        <SubTabs<Vector>
          tabs={VECTORS.map((v) => ({ key: v.key, label: `${v.label.split(" — ")[0]} · ${countOf(v.key)}` }))}
          active={activeVector} onChange={setActiveVector}
        />
        {dirty && <div className="t-sub t-muted" style={{ fontSize: 11.5, margin: "6px 0 10px" }}>Unsaved changes — Save in the header or on the Nodes card.</div>}
        <VectorCurator
          key={activeVector}
          vector={activeVector} label={activeMeta.label.split(" — ")[0]} blurb={activeMeta.blurb}
          entries={fields.map((f, i) => ({ f, i })).filter(({ f }) => (f.vector ?? "core") === activeVector)}
          setField={setField} removeField={removeField} upsertNode={upsertNode}
          generate={draftVector} generating={vecBusy === activeVector}
          refineNode={refineNode} refining={refining}
          onSave={save} onPush={() => pushVector(activeVector)} pushLabel={PUSH[activeVector]?.label}
          dirty={dirty} savingBusy={busy === "save"}
        />
      </>) : (<>
        <label className="field"><span className="t-label">Headline <span className="t-muted" style={{ fontWeight: 400 }}>— where we sit, in one line</span></span>
          <input className="input" value={headline} onChange={(e) => { setHeadline(e.target.value); setDirty(true); }} placeholder="e.g. We lead on explainability for mid-market; exposed on price vs Acme." /></label>
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

  // Competitor scope: single whole-dossier draft (flat sections; unchanged path).
  async function draftAllCompetitor() {
    setBusy("ai"); setError(null); setNote(null);
    try {
      const { data, error } = await supabase.functions.invoke("synthesize-profile", { body: { scope, competitor_id: competitorId, current: currentPayload(fields) } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const d = data?.draft;
      if (!d) throw new Error("No draft returned.");
      setHeadline(d.headline ?? headline);
      setFields((d.fields ?? []).map((f: Field) => ({ ...f, origin: "ai", vector: (f.vector ?? "core") as Vector, weight: f.weight ?? 2, parent_key: f.parent_key ?? null })));
      setDirty(true);
      const ev = data?.evidence;
      setNote(`Drafted from ${ev?.internal ?? 0} internal + ${ev?.external ?? 0} external signal(s). Review and edit, then Save.`);
    } catch (e) { setError(await edgeErrorMessage(e, "synthesize-profile")); }
    finally { setBusy(null); }
  }
}
