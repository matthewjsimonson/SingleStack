"use client";

// Campaign detail — a minimal record page so a campaign is a real surface plays
// can be placed on and run against (campaign_record). Shows the campaign's fields
// (editable), the content tied to it, and the plays placed on campaign records.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Chip, Banner, BackLink, Spinner, Section } from "@/components/ui";
import PlayActions from "@/components/PlayActions";

type Campaign = { id: string; name: string; objective: string | null; status: string; channels: string | null; gtm_record_id: string | null; start_date: string | null; end_date: string | null };
type Content = { id: string; title: string; content_type: string | null; stage: string };

const STATUS_TONE: Record<string, "default" | "violet" | "green"> = { planning: "default", active: "violet", complete: "green" };

export default function CampaignDetail({ id }: { id: string }) {
  const supabase = createClient();
  const [c, setC] = useState<Campaign | null>(null);
  const [gtmName, setGtmName] = useState<string | null>(null);
  const [content, setContent] = useState<Content[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ objective: "", channels: "", status: "planning", start_date: "", end_date: "" });

  const load = useCallback(async () => {
    const { data: camp } = await supabase.from("campaigns").select("id, name, objective, status, channels, gtm_record_id, start_date, end_date").eq("id", id).maybeSingle();
    if (!camp) { setNotFound(true); setLoading(false); return; }
    setC(camp);
    const [{ data: ct }, gtm] = await Promise.all([
      supabase.from("initiative_workstreams").select("id, title, content_type, stage").eq("campaign_id", id).not("content_type", "is", null),
      camp.gtm_record_id ? supabase.from("gtm_records").select("name").eq("id", camp.gtm_record_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    setContent((ct ?? []) as Content[]);
    setGtmName((gtm?.data as { name?: string } | null)?.name ?? null);
    setLoading(false);
  }, [supabase, id]);
  useEffect(() => { load(); }, [load]);

  function startEdit() {
    if (!c) return;
    setForm({ objective: c.objective ?? "", channels: c.channels ?? "", status: c.status, start_date: c.start_date ?? "", end_date: c.end_date ?? "" });
    setEditing(true);
  }
  async function save() {
    setError(null);
    const { error } = await supabase.from("campaigns").update({
      objective: form.objective.trim() || null, channels: form.channels.trim() || null,
      status: form.status, start_date: form.start_date || null, end_date: form.end_date || null,
    }).eq("id", id);
    if (error) setError(error.message); else { setEditing(false); await load(); }
  }

  if (loading) return <Spinner label="Loading campaign…" />;
  if (notFound || !c) return <BackLink href="/campaigns" label="Campaigns" />;

  return (
    <div>
      <BackLink href="/campaigns" label="Campaigns" />
      <div className="row gap-2" style={{ marginBottom: 4, alignItems: "center" }}>
        <Chip tone={STATUS_TONE[c.status] ?? "default"}>{c.status}</Chip>
        {gtmName && <Chip>{gtmName}</Chip>}
      </div>
      <h1 className="t-page" style={{ marginBottom: 4 }}>{c.name}</h1>
      <Banner>{error}</Banner>

      <Section label="Overview" action={!editing ? <button className="btn btn-secondary btn-sm" onClick={startEdit}>Edit</button> : undefined}>
        {editing ? (
          <div className="card card-pad">
            <label className="field"><span className="t-label">Objective</span><textarea className="textarea" rows={2} value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })} /></label>
            <label className="field"><span className="t-label">Channels</span><input className="input" value={form.channels} onChange={(e) => setForm({ ...form, channels: e.target.value })} placeholder="e.g. LinkedIn, email, webinar" /></label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--sp-3)" }}>
              <label className="field"><span className="t-label">Status</span>
                <select className="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  <option value="planning">Planning</option><option value="active">Active</option><option value="complete">Complete</option>
                </select></label>
              <label className="field"><span className="t-label">Start</span><input className="input" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></label>
              <label className="field"><span className="t-label">End</span><input className="input" type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></label>
            </div>
            <div className="row gap-2"><button className="btn btn-sm" onClick={save}>Save</button><button className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}>Cancel</button></div>
          </div>
        ) : (
          <div className="card card-pad">
            <div className="t-body" style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 8 }}>{c.objective || <span className="t-muted">No objective set.</span>}</div>
            <div className="row gap-2" style={{ flexWrap: "wrap" }}>
              {c.channels && <Chip>{c.channels}</Chip>}
              {(c.start_date || c.end_date) && <span className="t-mono-xs" style={{ color: "var(--tm)" }}>{c.start_date ?? "—"} → {c.end_date ?? "—"}</span>}
            </div>
          </div>
        )}
      </Section>

      {/* Plays placed on campaign records run against this campaign */}
      <PlayActions surfaceKey="campaign_record" targetId={c.id} targetName={c.name} heading="Plays" />

      <Section label={`Content · ${content.length}`}>
        {content.length === 0 ? <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No content tied to this campaign yet. Tie content to it in <a href="/content" style={{ color: "var(--ac-text)", fontWeight: 600 }}>Content</a>.</div> : (
          <div className="stack-3">
            {content.map((ct) => (
              <div key={ct.id} className="card card-pad row-between">
                <span className="row gap-2"><span style={{ fontSize: 13.5, fontWeight: 600 }}>{ct.title}</span>{ct.content_type && <Chip>{ct.content_type}</Chip>}</span>
                <Chip tone={ct.stage === "done" ? "green" : "default"}>{ct.stage}</Chip>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
