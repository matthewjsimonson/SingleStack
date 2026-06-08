"use client";

// Signal Profile — the HITL record of "your place in the market," synthesized
// from internal + external competitive signals and editable by hand. Used for
// the org-wide landscape and per-competitor. AI drafts/refreshes; the human
// owns the final word (nothing saves until you save).
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Banner, Chip } from "@/components/ui";
import { Markdown } from "@/components/Markdown";

type Field = { field_key: string; label: string; value: string; origin?: string };
type Profile = { id: string; headline: string | null };

export default function SignalProfile({ scope, competitorId, competitorName }: { scope: "landscape" | "competitor"; competitorId?: string; competitorName?: string }) {
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [headline, setHeadline] = useState("");
  const [fields, setFields] = useState<Field[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | "save" | "ai" | "create" | "push">(null);
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
      const { data: fs } = await supabase.from("signal_profile_fields").select("field_key, label, value, origin").eq("profile_id", p.id).order("position");
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
      const { data, error } = await supabase.functions.invoke("synthesize-profile", { body: { scope, competitor_id: competitorId, current: fields.map((f) => ({ field_key: f.field_key, label: f.label, value: f.value })) } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const d = data?.draft;
      if (!d) throw new Error("No draft returned.");
      setHeadline(d.headline ?? headline);
      setFields((d.fields ?? []).map((f: Field) => ({ ...f, origin: "ai" })));
      setDirty(true);
      const ev = data?.evidence;
      setNote(`Drafted from ${ev?.internal ?? 0} internal + ${ev?.external ?? 0} external signal(s). Review and edit, then Save.`);
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
      const rows = fields.filter((f) => f.field_key.trim() && f.label.trim()).map((f, i) => ({ org_id: orgId, profile_id: profile.id, field_key: f.field_key.trim(), label: f.label.trim(), value: f.value.trim() || null, position: i, origin: f.origin ?? "human" }));
      if (rows.length) { const { error } = await supabase.from("signal_profile_fields").insert(rows); if (error) throw error; }
      setDirty(false); setNote("Saved."); load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save."); }
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

  function setField(i: number, patch: Partial<Field>) { setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f))); setDirty(true); }
  function removeField(i: number) { setFields((fs) => fs.filter((_, j) => j !== i)); setDirty(true); }
  function addField() { setFields((fs) => [...fs, { field_key: `section_${fs.length + 1}`, label: "New section", value: "", origin: "human" }]); setDirty(true); }

  if (loading) return <div className="t-sub t-muted">Loading…</div>;

  const title = scope === "landscape" ? "Signal Profile — your place in the market" : `Signal Profile — ${competitorName ?? "competitor"}`;
  const blurb = scope === "landscape"
    ? "A living, editable read of the competitive landscape and where you sit — synthesized from internal + external signals. This should dictate your product and GTM strategy."
    : "Where you stand against this competitor — synthesized from internal (deals, calls) + external (public) signals, editable by hand.";

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
          <button className="btn btn-secondary btn-sm" onClick={draftAI} disabled={busy === "ai"} style={{ color: "var(--ac-text)" }}>{busy === "ai" ? "Synthesizing…" : "✨ Draft / refresh with AI"}</button>
          <button className="btn btn-secondary btn-sm" onClick={pushToStrategy} disabled={busy === "push" || dirty} title={dirty ? "Save first" : "Derive product + GTM strategy themes from this profile"}>{busy === "push" ? "Pushing…" : "→ Push to strategy"}</button>
          <button className="btn btn-sm" onClick={save} disabled={busy === "save" || !dirty}>{busy === "save" ? "Saving…" : dirty ? "Save" : "Saved"}</button>
        </div>
      </div>

      <Banner>{error}</Banner>
      {note && <div className="banner" style={{ marginBottom: 12 }}>{note}</div>}

      <label className="field"><span className="t-label">Headline <span className="t-muted" style={{ fontWeight: 400 }}>— where we sit, in one line</span></span>
        <input className="input" value={headline} onChange={(e) => { setHeadline(e.target.value); setDirty(true); }} placeholder="e.g. We lead on explainability for mid-market; exposed on price vs Acme." /></label>

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
        <button className="btn btn-secondary btn-sm" onClick={addField}>+ Add section</button>
        {dirty && <span className="t-sub t-muted" style={{ fontSize: 11.5, alignSelf: "center" }}>Unsaved changes</span>}
      </div>
    </div>
  );
}
