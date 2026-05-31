"use client";

// Theme detail — a living theme's trajectory. Restrained, in the house style:
// the summary + recommendation, its evidence (grouped internal/external, newest
// first), and the append-only trajectory (theme_events) — the theme's memory.
// Curation is light: escalate, decay, or turn it into a decision. No charts,
// no dashboards — just the data that earns its place.
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { PageHeader, Section, Chip, Banner, BackLink, Spinner, Confidence } from "@/components/ui";
import { momentumGlyph, stateTone, ago, eventLabel } from "@/lib/themeLife";

type Theme = {
  id: string; category: string; title: string; summary: string | null; recommendation: string | null;
  conf_level: number | null; state: string | null; momentum: string | null;
  first_seen_at: string | null; last_evidence_at: string | null;
};
type Sig = { id: string; title: string; why: string | null; origin: string | null; conf_level: number | null; added_at: string };
type Event = { id: string; kind: string; detail: Record<string, unknown> | null; actor: string | null; created_at: string };

export default function ThemeDetail({ id }: { id: string }) {
  const supabase = createClient();
  const router = useRouter();
  const [theme, setTheme] = useState<Theme | null>(null);
  const [signals, setSignals] = useState<Sig[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data: t, error: tErr } = await supabase
      .from("signal_themes").select("id, category, title, summary, recommendation, conf_level, state, momentum, first_seen_at, last_evidence_at")
      .eq("id", id).single();
    if (tErr) setError(tErr.message);
    setTheme(t ?? null);

    // Evidence with WHEN it joined (the temporal relationship).
    const { data: links } = await supabase.from("theme_signals").select("signal_id, added_at").eq("theme_id", id).order("added_at", { ascending: false });
    const sigIds = (links ?? []).map((l) => l.signal_id);
    let sigs: Sig[] = [];
    if (sigIds.length) {
      const { data: rows } = await supabase.from("signals").select("id, title, why, origin, conf_level").in("id", sigIds);
      const addedById: Record<string, string> = {};
      for (const l of links ?? []) addedById[l.signal_id] = l.added_at;
      sigs = (rows ?? []).map((r) => ({ ...r, added_at: addedById[r.id] }))
        .sort((a, b) => (b.added_at ?? "").localeCompare(a.added_at ?? ""));
    }
    setSignals(sigs);

    const { data: evs } = await supabase.from("theme_events").select("id, kind, detail, actor, created_at").eq("theme_id", id).order("created_at", { ascending: false });
    setEvents(evs ?? []);
    setLoading(false);
  }, [supabase, id]);
  useEffect(() => { load(); }, [load]);

  // Curation — each writes a theme_event so the trajectory stays honest.
  async function setState(next: string) {
    if (!theme) return;
    setBusy(true); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("no org");
      await supabase.from("signal_themes").update({ state: next }).eq("id", id);
      await supabase.from("theme_events").insert({ org_id: orgId, theme_id: id, kind: "state_changed", detail: { from: theme.state, to: next }, actor: "human" });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update."); }
    finally { setBusy(false); }
  }

  async function makeDecision() {
    if (!theme) return;
    setBusy(true); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("no org");
      const { data: dec, error } = await supabase.from("decisions").insert({ org_id: orgId, title: theme.title, status: "open", scope: "org", theme_id: theme.id }).select("id").single();
      if (error) throw error;
      const evidence: { org_id: string; decision_id: string; theme_id?: string; signal_id?: string }[] = [{ org_id: orgId, decision_id: dec.id, theme_id: theme.id }];
      for (const s of signals) evidence.push({ org_id: orgId, decision_id: dec.id, signal_id: s.id });
      await supabase.from("decision_evidence").insert(evidence);
      router.push(`/decisions/${dec.id}`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create decision."); setBusy(false); }
  }

  if (loading) return <Spinner label="Loading theme…" />;
  if (!theme) return <Banner>Theme not found.</Banner>;

  const mo = momentumGlyph(theme.momentum);
  const internal = signals.filter((s) => s.origin !== "external");
  const external = signals.filter((s) => s.origin === "external");

  return (
    <div>
      <BackLink href="/signals" label="Signals" />
      <PageHeader
        title={theme.title}
        meta={theme.summary || undefined}
        actions={<button className="btn btn-secondary btn-sm" disabled={busy} onClick={makeDecision}>Make a decision →</button>}
      />
      <Banner>{error}</Banner>

      <div className="row gap-2" style={{ marginBottom: "var(--sp-5)", flexWrap: "wrap" }}>
        <Chip>{theme.category}</Chip>
        {theme.state && <Chip tone={stateTone(theme.state)}>{theme.state}</Chip>}
        <Chip><span style={{ color: mo.color }}>{mo.glyph}</span>&nbsp;{mo.label.toLowerCase()}</Chip>
        <Confidence level={theme.conf_level} label={theme.conf_level != null ? `${Math.round(theme.conf_level * 100)}%` : null} />
        <span className="t-mono-xs" style={{ alignSelf: "center" }}>
          {signals.length} signal{signals.length === 1 ? "" : "s"}
          {theme.first_seen_at ? ` · first seen ${ago(theme.first_seen_at)}` : ""}
          {theme.last_evidence_at ? ` · last evidence ${ago(theme.last_evidence_at)}` : ""}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 280px", gap: "var(--sp-6)", alignItems: "start" }}>
        {/* LEFT: recommendation + evidence */}
        <div style={{ display: "grid", gap: "var(--sp-5)" }}>
          {theme.recommendation && (
            <Section label="Recommended">
              <div className="card card-pad"><div className="t-body" style={{ fontSize: 13.5, lineHeight: 1.55 }}>{theme.recommendation}</div></div>
            </Section>
          )}

          <Section label={`Evidence · ${signals.length}`}>
            <div className="t-sub t-muted" style={{ marginBottom: "var(--sp-3)" }}>Signals supporting this theme, newest first.</div>
            {signals.length === 0 ? (
              <p className="t-muted" style={{ margin: 0 }}>No evidence yet.</p>
            ) : (
              <div style={{ display: "grid", gap: "var(--sp-4)" }}>
                {[["Internal", internal] as const, ["External", external] as const].map(([label, group]) => group.length === 0 ? null : (
                  <div key={label}>
                    <div className="t-label" style={{ marginBottom: 6 }}>{label} · {group.length}</div>
                    <div className="stack-3">
                      {group.map((s) => (
                        <div key={s.id} className="card card-pad" style={{ padding: "10px 12px" }}>
                          <div className="row-between" style={{ alignItems: "baseline", gap: 10 }}>
                            <span style={{ fontSize: 13, fontWeight: 600 }}>{s.title}</span>
                            <span className="t-mono-xs" style={{ flexShrink: 0 }}>{ago(s.added_at)}</span>
                          </div>
                          {s.why && <div className="t-sub t-muted" style={{ fontSize: 12, marginTop: 3 }}>{s.why}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>

        {/* RIGHT: curation + trajectory (the memory) */}
        <div style={{ display: "grid", gap: "var(--sp-4)", position: "sticky", top: "var(--sp-4)" }}>
          <Section label="Curate">
            <div className="t-sub t-muted" style={{ marginBottom: "var(--sp-3)" }}>Shape the lifecycle. Each action is recorded.</div>
            <div className="row gap-2" style={{ flexWrap: "wrap" }}>
              {theme.state !== "escalating" && <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setState("escalating")}>Escalate</button>}
              {theme.state !== "steady" && <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setState("steady")}>Mark steady</button>}
              {theme.state !== "fading" && <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setState("fading")}>Let fade</button>}
            </div>
          </Section>

          <Section label="Trajectory">
            <div className="t-sub t-muted" style={{ marginBottom: "var(--sp-3)" }}>How this theme has changed over time.</div>
            {events.length === 0 ? (
              <p className="t-muted" style={{ margin: 0 }}>No history yet.</p>
            ) : (
              <div style={{ display: "grid", gap: 0 }}>
                {events.map((e, i) => (
                  <div key={e.id} style={{ display: "flex", gap: 10, padding: "9px 0", borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                    <span aria-hidden style={{ width: 6, height: 6, borderRadius: 99, marginTop: 6, flexShrink: 0, background: e.actor === "human" ? "var(--ac)" : "var(--border-strong)" }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5 }}>{eventLabel(e.kind, e.detail)}</div>
                      <div className="t-mono-xs">{e.actor ?? "system"} · {ago(e.created_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
