"use client";

// Agentic theme drawer — the side pop-out for an intelligence theme (used from
// the Signals homepage and the Map, so neither bounces to a new page). Shows the
// theme, its backing signals, the "so what" (recommendation), an embedded agent
// that gives a tailored read, the decisions it already drives, and the ability
// to make a decision IN PLACE (no navigation). AI + human, together, on a theme.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Chip, Confidence } from "@/components/ui";

type Theme = {
  id: string; title: string; summary: string | null; recommendation: string | null;
  state: string | null; momentum: string | null; conf_level: number | null; category: string | null; signal_ids: string[] | null;
};
type Sig = { id: string; title: string; conf_label: string | null };
type Decision = { id: string; title: string; status: string };

const OFFICER = (cat: string | null) => (cat === "gtm" ? { key: "cro", name: "CRO" } : { key: "cpo", name: "CPO" });

export default function ThemeDrawer({ themeId, onClose, onChanged }: { themeId: string | null; onClose: () => void; onChanged?: () => void }) {
  const supabase = createClient();
  const open = !!themeId;
  const [theme, setTheme] = useState<Theme | null>(null);
  const [signals, setSignals] = useState<Sig[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [take, setTake] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!themeId) return;
    setError(null); setTake(null);
    const { data: t } = await supabase.from("signal_themes").select("id, title, summary, recommendation, state, momentum, conf_level, category, signal_ids").eq("id", themeId).maybeSingle();
    setTheme(t as Theme | null);
    const ids = (t?.signal_ids as string[] | null) ?? [];
    const [{ data: sigs }, { data: ev }] = await Promise.all([
      ids.length ? supabase.from("signals").select("id, title, conf_label").in("id", ids) : Promise.resolve({ data: [] as Sig[] }),
      supabase.from("decision_evidence").select("decisions ( id, title, status )").eq("theme_id", themeId),
    ]);
    setSignals((sigs ?? []) as Sig[]);
    // deno-lint-ignore no-explicit-any
    const decs = ((ev ?? []) as any[]).map((r) => r.decisions).filter(Boolean);
    const seen = new Set<string>(); setDecisions(decs.filter((d: Decision) => (seen.has(d.id) ? false : seen.add(d.id))));
  }, [supabase, themeId]);
  useEffect(() => { load(); }, [load]);

  if (!themeId) return null;
  const officer = theme ? OFFICER(theme.category) : { key: "cpo", name: "CPO" };

  async function ask() {
    if (!theme) return;
    setThinking(true); setError(null); setTake(null);
    try {
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      const prompt = `Interpret this intelligence theme for me. In 3–4 sentences: the "so what", and the single most important decision or action.\n\nTheme: ${theme.title}\nSummary: ${theme.summary || "—"}\nCurrent recommendation: ${theme.recommendation || "—"}\nState: ${theme.state}/${theme.momentum} · backed by ${signals.length} signal(s): ${signals.slice(0, 6).map((x) => x.title).join("; ")}`;
      const { data, error } = await supabase.functions.invoke("agent-chat", {
        body: { agent_key: officer.key, messages: [{ role: "user", content: prompt }], context: { area: "signals" } },
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setTake(data.reply);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not reach the officer."); }
    finally { setThinking(false); }
  }

  async function makeDecision() {
    if (!theme) return;
    setBusy("decision"); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("No org.");
      const { data: dec, error } = await supabase.from("decisions").insert({ org_id: orgId, title: theme.title, status: "open", scope: "org", theme_id: theme.id }).select("id").single();
      if (error) throw error;
      const evidence: Record<string, unknown>[] = [{ org_id: orgId, decision_id: dec.id, theme_id: theme.id }];
      for (const sid of theme.signal_ids ?? []) evidence.push({ org_id: orgId, decision_id: dec.id, signal_id: sid });
      await supabase.from("decision_evidence").insert(evidence);
      await load(); onChanged?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create decision."); }
    setBusy(null);
  }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(11,12,14,0.32)", opacity: open ? 1 : 0, transition: "opacity 0.18s ease", zIndex: 40 }} />
      <aside style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: 520, maxWidth: "94vw", background: "var(--panel)", borderLeft: "1px solid var(--border)", boxShadow: "var(--shadow-md)", transform: open ? "translateX(0)" : "translateX(100%)", transition: "transform 0.22s cubic-bezier(0.4,0,0.2,1)", zIndex: 41, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="row gap-2" style={{ marginBottom: 4, flexWrap: "wrap" }}>
              {theme?.category && <Chip tone={theme.category === "gtm" ? "violet" : "accent"}>{theme.category}</Chip>}
              {theme?.state && <Chip>{theme.state}{theme.momentum ? ` · ${theme.momentum}` : ""}</Chip>}
              <Confidence label={theme?.conf_level != null ? (theme.conf_level >= 0.75 ? "High" : theme.conf_level >= 0.5 ? "Med" : "Low") : null} level={theme?.conf_level ?? null} />
            </div>
            <div style={{ fontSize: 16, fontWeight: 680, lineHeight: 1.3 }}>{theme?.title ?? "Theme"}</div>
          </div>
          <button onClick={onClose} className="btn btn-secondary btn-sm">Close</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }} className="stack-3">
          {error && <div className="banner banner-error">{error}</div>}
          {theme?.summary && <div className="t-sub" style={{ fontSize: 13, lineHeight: 1.55 }}>{theme.summary}</div>}

          {/* The so-what + officer read */}
          <div className="card card-pad" style={{ background: "var(--panel-2)" }}>
            <div className="t-label" style={{ color: "var(--tm)", marginBottom: 6 }}>The “so what”</div>
            {theme?.recommendation ? <div className="t-body" style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 10 }}>→ {theme.recommendation}</div> : <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 10 }}>No recommendation yet.</div>}
            <button className="btn btn-sm" onClick={ask} disabled={thinking} style={{ background: "var(--ac)", color: "#fff" }}>{thinking ? `${officer.name} is reading…` : `✦ Ask ${officer.name}`}</button>
            {take && <div className="card card-pad" style={{ marginTop: 10, background: "var(--panel)" }}><div className="t-sub" style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{take}</div></div>}
          </div>

          {/* Decisions it drives (in place) */}
          <div className="card card-pad">
            <div className="t-label" style={{ color: "var(--tm)", marginBottom: 8 }}>Decisions</div>
            {decisions.length > 0 ? (
              <div className="stack-3" style={{ marginBottom: 10 }}>
                {decisions.map((d) => (
                  <a key={d.id} href={`/decisions/${d.id}`} className="row-between card-link" style={{ textDecoration: "none", color: "inherit", gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{d.title}</span>
                    <Chip tone={d.status === "open" ? "amber" : "green"}>{d.status}</Chip>
                  </a>
                ))}
              </div>
            ) : <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 10 }}>No decision yet. Turn this theme into a decision — its signals carry over as evidence.</div>}
            <button className="btn btn-sm" onClick={makeDecision} disabled={busy === "decision"}>{busy === "decision" ? "Creating…" : "+ Make a decision"}</button>
          </div>

          {/* Backing signals */}
          <div className="card card-pad">
            <div className="t-label" style={{ color: "var(--tm)", marginBottom: 8 }}>Backed by {signals.length} signal{signals.length === 1 ? "" : "s"}</div>
            {signals.length === 0 ? <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No linked signals.</div> : (
              <div className="stack-3">
                {signals.map((s) => (
                  <div key={s.id} className="row-between" style={{ gap: 8 }}>
                    <span style={{ fontSize: 13 }}>{s.title}</span>
                    {s.conf_label && <Chip>{s.conf_label}</Chip>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
