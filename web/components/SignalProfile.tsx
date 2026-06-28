"use client";

// Signal Profile — the HITL record of "your place in the market," editable by
// hand. Two scopes: the org-wide LANDSCAPE (step 1 of the competitive workflow —
// built from your product & GTM records to frame where to hunt for rivals) and
// the per-COMPETITOR raw battlecard (built from that rival's signals + records).
// AI drafts/refreshes; the human owns the final word (nothing saves until you save).
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Banner, Chip } from "@/components/ui";
import { Markdown } from "@/components/Markdown";

// A node's VECTOR — which intelligence domain it feeds. 'shared' = positioning/
// wedge every domain draws on. The central (landscape) profile holds all four;
// an intelligence tab passes vectorFilter to read just its slice.
export type Vector = "competitive" | "market" | "frontier" | "shared";
const VECTORS: { key: Vector; label: string; blurb: string }[] = [
  { key: "shared", label: "Shared — positioning & wedge", blurb: "What every domain draws on: where you play and why you win." },
  { key: "competitive", label: "Competitive", blurb: "Who to hunt and the axes you compete on — aims the competitor search." },
  { key: "market", label: "Market", blurb: "Industries & personas to track — aims the market discovery." },
  { key: "frontier", label: "Frontier", blurb: "Frontier capabilities & models to watch." },
];
const vectorMeta = (v?: string) => VECTORS.find((x) => x.key === v) ?? VECTORS[0];

type Field = { field_key: string; label: string; value: string; origin?: string; vector?: Vector };
type Profile = { id: string; headline: string | null };

export default function SignalProfile({ scope, competitorId, competitorName, vectorFilter }: { scope: "landscape" | "competitor"; competitorId?: string; competitorName?: string; vectorFilter?: Vector }) {
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [headline, setHeadline] = useState("");
  const [fields, setFields] = useState<Field[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | "save" | "ai" | "create" | "push" | "battlecard" | "clear">(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let qb = supabase.from("signal_profiles").select("id, headline").eq("scope", scope);
    qb = scope === "competitor" ? qb.eq("competitor_id", competitorId!) : qb.is("competitor_id", null);
    const { data: p } = await qb.maybeSingle();
    if (p) {
      setProfile(p as Profile); setHeadline(p.headline ?? "");
      const { data: fs } = await supabase.from("signal_profile_fields").select("field_key, label, value, origin, vector").eq("profile_id", p.id).order("position");
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
      const { data, error } = await supabase.functions.invoke("synthesize-profile", { body: { scope, competitor_id: competitorId, current: fields.map((f) => ({ field_key: f.field_key, label: f.label, value: f.value, vector: f.vector ?? "shared" })) } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const d = data?.draft;
      if (!d) throw new Error("No draft returned.");
      setHeadline(d.headline ?? headline);
      setFields((d.fields ?? []).map((f: Field) => ({ ...f, origin: "ai", vector: (f.vector ?? "shared") as Vector })));
      setDirty(true);
      const ev = data?.evidence;
      const sigCount = (ev?.internal ?? 0) + (ev?.external ?? 0);
      setNote(scope === "landscape"
        ? (sigCount > 0
            ? `Built from your product & GTM records${sigCount ? ` + ${sigCount} competitive signal(s)` : ""}. Review the 'search_focus' section — that's what aims the rival search — then Save.`
            : "Built from your product & GTM records. Review the 'search_focus' section — that's what aims the rival search — then Save, and run setup to find competitors.")
        : `Drafted from ${ev?.internal ?? 0} internal + ${ev?.external ?? 0} external signal(s). Review and edit, then Save.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not draft the profile."); }
    finally { setBusy(null); }
  }

  async function save() {
    if (!profile) return;
    setBusy("save"); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      await supabase.from("signal_profiles").update({ headline: headline.trim() || null, updated_at: new Date().toISOString() }).eq("id", profile.id);
      // Replace the field set (simplest correct path for an editable section list).
      await supabase.from("signal_profile_fields").delete().eq("profile_id", profile.id);
      const rows = fields.filter((f) => f.field_key.trim() && f.label.trim()).map((f, i) => ({ org_id: orgId, profile_id: profile.id, field_key: f.field_key.trim(), label: f.label.trim(), value: f.value.trim() || null, position: i, origin: f.origin ?? "human", vector: f.vector ?? "shared" }));
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
        ? "Cleared. Press ✨ Draft / refresh with AI to rebuild it fresh from your product & GTM records."
        : "Cleared. Press ✨ Draft / refresh with AI to rebuild it fresh from this competitor's signals & your records.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not clear the profile."); }
    finally { setBusy(null); }
  }

  function setField(i: number, patch: Partial<Field>) { setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f))); setDirty(true); }
  function removeField(i: number) { setFields((fs) => fs.filter((_, j) => j !== i)); setDirty(true); }
  function addField(vector: Vector = "shared") { setFields((fs) => [...fs, { field_key: `section_${fs.length + 1}`, label: "New section", value: "", origin: "human", vector }]); setDirty(true); }

  if (loading) return <div className="t-sub t-muted">Loading…</div>;

  // SLICE MODE — an intelligence tab reads ONE vector of the central profile
  // (read-only). Editing/drafting happens on the Signals home, not here.
  if (vectorFilter) {
    const vm = vectorMeta(vectorFilter);
    const short = vm.label.split(" — ")[0];
    const slice = fields.filter((f) => (f.vector ?? "shared") === vectorFilter && f.value.trim());
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
          <div className="stack-3">
            {slice.map((f, i) => (
              <div key={i}>
                <div className="t-label" style={{ marginBottom: 4 }}>{f.label}</div>
                <Markdown text={f.value} />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const title = scope === "landscape" ? "Signals profile — what to find, track & analyze" : `Signal Profile — ${competitorName ?? "competitor"} (the raw battlecard)`;
  const blurb = scope === "landscape"
    ? "Built from your product & GTM records: your positioning & wedge (shared), plus what to find on each vector — competitors to hunt, industries & personas to track, frontier to watch. Each intelligence tab draws on its vector to aim discovery. Editable by hand; it sharpens as signals come in."
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
          <button className="btn btn-secondary btn-sm" onClick={draftAI} disabled={busy === "ai"} style={{ color: "var(--ac-text)" }}
            title={scope === "landscape" ? "Build/refresh this profile from your product & GTM records — frames where to aim the rival search" : "Synthesize this competitor's profile from its signals + your records"}>{busy === "ai" ? "Synthesizing…" : "✨ Draft / refresh with AI"}</button>
          {scope === "competitor" && (
            <button className="btn btn-secondary btn-sm" onClick={fillBattlecard} disabled={busy === "battlecard" || dirty}
              title={dirty ? "Save first" : "This profile is the raw battlecard — the analyst refines it into evidence-cited items (through review), then the messenger drafts the GTM battlecard copy"}>
              {busy === "battlecard" ? "Filling…" : "→ Fill the battlecard"}
            </button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={pushToStrategy} disabled={busy === "push" || dirty} title={dirty ? "Save first" : "Derive product + GTM strategy themes from this profile"}>{busy === "push" ? "Pushing…" : dirty ? "Save to push to strategy" : "→ Push to strategy"}</button>
          <button className="btn btn-secondary btn-sm" onClick={clearProfile} disabled={busy === "clear" || (fields.length === 0 && !headline.trim())} title="Wipe every section so the profile rebuilds fresh" style={{ color: "var(--rd-text, #b42318)" }}>{busy === "clear" ? "Clearing…" : "Clear"}</button>
          <button className="btn btn-sm" onClick={save} disabled={busy === "save" || !dirty}>{busy === "save" ? "Saving…" : dirty ? "Save" : "Saved"}</button>
        </div>
      </div>

      <Banner>{error}</Banner>
      {note && <div className="banner" style={{ marginBottom: 12 }}>{note}</div>}

      <label className="field"><span className="t-label">Headline <span className="t-muted" style={{ fontWeight: 400 }}>— where we sit, in one line</span></span>
        <input className="input" value={headline} onChange={(e) => { setHeadline(e.target.value); setDirty(true); }} placeholder="e.g. We lead on explainability for mid-market; exposed on price vs Acme." /></label>

      {(() => {
        // The central (landscape) profile groups its nodes by VECTOR; the
        // per-competitor dossier has no vectors, so it renders flat.
        const showVectors = scope === "landscape";
        const card = (f: Field, i: number) => (
          <div key={i} className="card card-pad">
            <div className="row-between" style={{ alignItems: "center", gap: 8, marginBottom: 6 }}>
              <input className="input" value={f.label} onChange={(e) => setField(i, { label: e.target.value })} style={{ fontWeight: 640, fontSize: 13.5, maxWidth: 320 }} />
              <div className="row gap-2" style={{ alignItems: "center" }}>
                {f.origin === "ai" && <Chip tone="violet">AI</Chip>}
                {showVectors && (
                  <select className="select" value={f.vector ?? "shared"} onChange={(e) => setField(i, { vector: e.target.value as Vector })} style={{ fontSize: 11.5, padding: "3px 6px" }} title="Which intelligence vector this node feeds">
                    {VECTORS.map((v) => <option key={v.key} value={v.key}>{v.label.split(" — ")[0]}</option>)}
                  </select>
                )}
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPreviewKey(previewKey === f.field_key ? null : f.field_key)}>{previewKey === f.field_key ? "Edit" : "Preview"}</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => removeField(i)} style={{ color: "var(--rd-text)" }}>Remove</button>
              </div>
            </div>
            {previewKey === f.field_key
              ? <div className="card card-pad" style={{ background: "var(--panel-2)", minHeight: 60 }}>{f.value.trim() ? <Markdown text={f.value} /> : <span className="t-sub t-muted">Empty.</span>}</div>
              : <textarea className="textarea" rows={4} value={f.value} onChange={(e) => setField(i, { value: e.target.value })} placeholder="What the evidence says — markdown supported." />}
          </div>
        );
        if (!showVectors) {
          return (<>
            <div className="stack-3" style={{ marginTop: "var(--sp-3)" }}>
              {fields.length === 0 && <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No sections yet. Draft with AI, or add one by hand.</div>}
              {fields.map((f, i) => card(f, i))}
            </div>
            <div className="row gap-2" style={{ marginTop: "var(--sp-3)" }}>
              <button className="btn btn-secondary btn-sm" onClick={() => addField()}>+ Add section</button>
              {dirty && <span className="t-sub t-muted" style={{ fontSize: 11.5, alignSelf: "center" }}>Unsaved changes</span>}
            </div>
          </>);
        }
        const groups = VECTORS.map((v) => ({ v, entries: fields.map((f, i) => ({ f, i })).filter(({ f }) => (f.vector ?? "shared") === v.key) }));
        return (<>
          <div className="stack-4" style={{ marginTop: "var(--sp-3)" }}>
            {fields.length === 0 && <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No nodes yet. Draft with AI to build the profile across vectors, or add one by hand.</div>}
            {groups.map(({ v, entries }) => (
              <div key={v.key}>
                <div className="row-between" style={{ alignItems: "baseline", marginBottom: 6 }}>
                  <span className="t-label">{v.label} <span className="t-muted" style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>· {entries.length}</span></span>
                  <button className="btn btn-secondary btn-sm" onClick={() => addField(v.key)} title={v.blurb}>+ Add</button>
                </div>
                {entries.length === 0
                  ? <div className="t-sub t-muted" style={{ fontSize: 12 }}>{v.blurb}</div>
                  : <div className="stack-3">{entries.map(({ f, i }) => card(f, i))}</div>}
              </div>
            ))}
          </div>
          {dirty && <div className="t-sub t-muted" style={{ fontSize: 11.5, marginTop: "var(--sp-3)" }}>Unsaved changes</div>}
        </>);
      })()}
    </div>
  );
}
