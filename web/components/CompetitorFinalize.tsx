"use client";

// Per-competitor Finalize — the HITL flow that turns a freshly-DISCOVERED rival
// (name + website + LinkedIn + overview, carried over from the landscape wizard)
// into a finished competitor page. Discovery identifies; this finalizes. It
// orchestrates the pieces that already exist, one ratified step at a time:
//   1. Identity   — confirm the carried-over website / LinkedIn / overview.
//   2. Signals    — stand up monitors from those URLs + ignite the first pull
//                   (connector-runner). The fix for "no competitor has a signal."
//   3. Overview   — synthesize-profile drafts the deep dossier (their product,
//                   modules, GTM, strengths/weaknesses vs us) from our records +
//                   the pulled signals; saved as the competitor Signal Profile.
//   4. Comparison — score-capabilities rates us vs them from evidence (→ review).
//   5. Battlecards— the analyst proposes items, the messenger drafts GTM copy.
// Everything an agent produces is a PROPOSAL the human ratifies; nothing here
// writes strategy directly. Step progress persists in competitors.setup so it
// resumes across sessions.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Banner, Chip } from "@/components/ui";
import { CATALOG_BY_KIND } from "@/lib/sources";
import { standUpCompetitiveAgents } from "@/lib/standUpCompetitive";

type Comp = { id: string; name: string; website: string | null; linkedin: string | null; notes: string | null; setup: { step?: number; finalized_at?: string | null } | null };
type Wf = { id: string; name: string; steps: { agent_id?: string; skill_id?: string | null }[] };
type Pull = { id: string; label: string; state: "pulling" | "ok" | "error"; startedAt: number; msg?: string };

// supabase.functions.invoke hides a non-2xx function's real error behind a
// generic "non-2xx status code". Dig the actual message out of the response body
// (the function always returns { error }) so the user sees WHY a pull failed.
async function fnError(error: unknown, data: unknown): Promise<string | null> {
  if (data && typeof data === "object" && (data as { error?: string }).error) return (data as { error: string }).error;
  if (!error) return null;
  const ctx = (error as { context?: Response }).context;
  if (ctx && typeof ctx.json === "function") {
    const body = (await ctx.clone().json().catch(() => null)) as { error?: string } | null;
    if (body?.error) return body.error;
    if (ctx.status === 504 || ctx.status === 546) return "The pull ran past the server time limit — try again; it usually completes on a retry.";
  }
  return error instanceof Error ? error.message : "pull failed";
}

// The monitor kinds we can stand up from a competitor's URLs. press is name-
// anchored (web search), so it needs no link; the others need their URL.
const MONITORS: { kind: string; label: string; needs: "website" | "linkedin" | null; guidance: string }[] = [
  { kind: "website", label: "Website", needs: "website", guidance: "Track changes to positioning, pricing, packaging, and what they ship." },
  { kind: "press", label: "Press & news", needs: null, guidance: "Launches, funding, partnerships, exec moves, pricing changes — with dates." },
  { kind: "linkedin_posts", label: "LinkedIn posts", needs: "linkedin", guidance: "Announcements, launches, hiring pushes, narrative shifts." },
  { kind: "linkedin_jobs", label: "LinkedIn jobs", needs: "linkedin", guidance: "New roles and what the descriptions imply — teams, tech, new bets." },
];

export default function CompetitorFinalize({ competitor, capabilitiesCount, onChanged }: {
  competitor: Comp; capabilitiesCount: number; onChanged: () => void;
}) {
  const supabase = createClient();
  const finalized = !!competitor.setup?.finalized_at;
  const [open, setOpen] = useState(!finalized);
  const [step, setStep] = useState<number>(competitor.setup?.step ?? 1);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // step 1 — identity (carry-over, editable)
  const [website, setWebsite] = useState(competitor.website ?? "");
  const [linkedin, setLinkedin] = useState(competitor.linkedin ?? "");
  const [overview, setOverview] = useState(competitor.notes ?? "");

  // step 2 — monitoring
  const [picks, setPicks] = useState<Set<string>>(new Set());
  const [pulls, setPulls] = useState<Pull[]>([]);
  const [, setNowTick] = useState(0); // drives the live elapsed-seconds readout
  const [existingKinds, setExistingKinds] = useState<Set<string>>(new Set());

  // steps 4–5 — the agent workflows
  const [workflows, setWorkflows] = useState<Wf[]>([]);
  const wfReady = (w?: Wf | null, i = 0) => !!(w?.steps?.[i]?.agent_id && w?.steps?.[i]?.skill_id);
  const scoreWf = workflows.find((w) => w.name === "Score the capability matrix" && wfReady(w)) ?? workflows.find((w) => wfReady(w) && w.steps.length === 1);
  const pairWf = workflows.find((w) => w.name === "Competitive battlecard pair" && wfReady(w)) ?? workflows.find((w) => wfReady(w) && w.steps.length >= 2);

  const loadWorkflows = useCallback(async () => {
    const { data } = await supabase.from("workflows").select("id, name, steps").eq("is_active", true).order("created_at");
    setWorkflows(((data ?? []) as Wf[]).filter((w) => Array.isArray(w.steps) && w.steps.length > 0));
  }, [supabase]);

  // Which monitor kinds already exist for this competitor (so we never duplicate).
  const loadExisting = useCallback(async () => {
    const { data } = await supabase.from("sources").select("kind").eq("competitor_id", competitor.id);
    setExistingKinds(new Set((data ?? []).map((s) => s.kind)));
  }, [supabase, competitor.id]);

  useEffect(() => { loadWorkflows(); loadExisting(); }, [loadWorkflows, loadExisting]);
  // Default the monitor picks to every kind we have a link for and don't already run.
  useEffect(() => {
    setPicks(new Set(MONITORS.filter((m) => !existingKinds.has(m.kind) && (m.needs === null || (m.needs === "website" ? website : linkedin).trim())).map((m) => m.kind)));
  }, [existingKinds, website, linkedin]);
  // Tick once a second while any pull is in flight, so the elapsed readout moves
  // and the user can see it's working (search-backed pulls take a while).
  useEffect(() => {
    if (!pulls.some((p) => p.state === "pulling")) return;
    const t = setInterval(() => setNowTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [pulls]);

  async function patchSetup(patch: Record<string, unknown>) {
    const next = { ...(competitor.setup ?? {}), ...patch };
    await supabase.from("competitors").update({ setup: next }).eq("id", competitor.id);
  }
  const go = (s: number) => { setStep(s); setError(null); setNote(null); void patchSetup({ step: s }); };

  // ---- step 1 -------------------------------------------------------------
  async function saveIdentity() {
    setBusy("id"); setError(null);
    try {
      const { error } = await supabase.from("competitors").update({
        website: website.trim() || null, linkedin: linkedin.trim() || null, notes: overview.trim() || null,
      }).eq("id", competitor.id);
      if (error) throw error;
      onChanged(); go(2);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save."); }
    finally { setBusy(null); }
  }

  // ---- step 2: stand up monitors + first pull -----------------------------
  function toggle(kind: string) { setPicks((p) => { const n = new Set(p); n.has(kind) ? n.delete(kind) : n.add(kind); return n; }); }
  async function standUpSignals() {
    setBusy("signals"); setError(null); setNote(null); setPulls([]);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      const li = linkedin.trim().replace(/\/+$/, "");
      const rows = [...picks].map((kind) => {
        const def = CATALOG_BY_KIND[kind]; const g = MONITORS.find((m) => m.kind === kind)?.guidance;
        const config = kind === "website" && website.trim() ? { url: website.trim() }
          : kind === "linkedin_jobs" && li ? { url: `${li}/jobs` }
          : kind === "linkedin_posts" && li ? { url: li } : null;
        return { org_id: orgId, label: `${competitor.name} — ${def.label}`, icon: def.icon, origin: def.origin,
          kind, status: "connected", auth_mode: def.authMode, access_scope: def.accessScope,
          focus: def.defaultFocus ?? "both", max_per_pull: def.defaultMaxPerPull, cadence: "daily",
          config, guidance: g ?? null, competitor_id: competitor.id };
      });
      let created: { id: string; label: string }[] = [];
      if (rows.length) {
        const { data, error } = await supabase.from("sources").insert(rows).select("id, label");
        if (error) throw error;
        created = data ?? [];
      }
      if (!created.length) { setNote("No new monitors to add — they already exist. Continue to build the overview."); return; }
      // Ignite the first pull on each source NOW (concurrently — a slow search-
      // backed pull must not block the others) so signals land before the daily
      // cadence. Each shows live elapsed time and its real outcome.
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token;
      const startedAt = Date.now();
      setPulls(created.map((c) => ({ id: c.id, label: c.label, state: "pulling", startedAt })));
      const settle = (id: string, patch: Partial<Pull>) => setPulls((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
      let ok = 0, landed = 0;
      await Promise.all(created.map(async (src) => {
        try {
          const { data, error } = await supabase.functions.invoke("connector-runner", { body: { source_id: src.id }, headers: token ? { Authorization: `Bearer ${token}` } : undefined });
          const err = await fnError(error, data);
          if (err) throw new Error(err);
          const d = data as { created?: number; fetched?: number };
          ok++; landed += d.created ?? 0;
          settle(src.id, { state: "ok", msg: `fetched ${d.fetched ?? 0} → ${d.created ?? 0} signal${d.created === 1 ? "" : "s"} landed` });
        } catch (e) {
          settle(src.id, { state: "error", msg: e instanceof Error ? e.message : "pull failed" });
        }
      }));
      await loadExisting(); onChanged();
      setNote(`${ok}/${created.length} monitor${created.length === 1 ? "" : "s"} pulled · ${landed} signal${landed === 1 ? "" : "s"} landed on ${competitor.name}. They re-pull daily — see the Signals tab.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not stand up monitoring."); }
    finally { setBusy(null); }
  }

  // ---- step 3: synthesize the deep overview (their Signal Profile) ---------
  async function buildOverview() {
    setBusy("overview"); setError(null); setNote(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      // Ensure the profile shell exists.
      let { data: prof } = await supabase.from("signal_profiles").select("id").eq("scope", "competitor").eq("competitor_id", competitor.id).maybeSingle();
      if (!prof) {
        const { data, error } = await supabase.from("signal_profiles").insert({ org_id: orgId, scope: "competitor", competitor_id: competitor.id }).select("id").single();
        if (error) throw error; prof = data;
      }
      const { data: cur } = await supabase.from("signal_profile_fields").select("field_key, label, value").eq("profile_id", prof!.id);
      const { data, error } = await supabase.functions.invoke("synthesize-profile", { body: { scope: "competitor", competitor_id: competitor.id, current: cur ?? [] } });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error?: string }).error);
      const draft = (data as { draft?: { headline?: string; fields?: { field_key: string; label: string; value: string }[] } }).draft;
      if (!draft) throw new Error("No draft returned.");
      await supabase.from("signal_profiles").update({ headline: draft.headline?.trim() || null, updated_at: new Date().toISOString() }).eq("id", prof!.id);
      await supabase.from("signal_profile_fields").delete().eq("profile_id", prof!.id);
      const rows = (draft.fields ?? []).filter((f) => f.field_key?.trim() && f.label?.trim()).map((f, i) => ({ org_id: orgId, profile_id: prof!.id, field_key: f.field_key.trim(), label: f.label.trim(), value: f.value?.trim() || null, position: i, origin: "ai" }));
      if (rows.length) { const { error: insErr } = await supabase.from("signal_profile_fields").insert(rows); if (insErr) throw insErr; }
      const ev = (data as { evidence?: { internal?: number; external?: number } }).evidence;
      onChanged();
      setNote(`Drafted a ${rows.length}-section dossier on ${competitor.name} from ${(ev?.internal ?? 0) + (ev?.external ?? 0)} signal(s) + our records. Review and edit it on the Signal profile tab — it's the raw battlecard.`);
      go(4);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not build the overview."); }
    finally { setBusy(null); }
  }

  // ---- shared: ensure the competitive agent chain exists ------------------
  async function standUpAgents() {
    setBusy("agents"); setError(null);
    try {
      const res = await standUpCompetitiveAgents(supabase);
      if (!res.ok) throw new Error(res.message);
      await loadWorkflows(); setNote(res.message);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not stand up the agents."); }
    finally { setBusy(null); }
  }

  // ---- step 4: score the comparison ---------------------------------------
  async function scoreComparison() {
    if (!scoreWf) return;
    setBusy("score"); setError(null); setNote(null);
    try {
      const { data, error } = await supabase.functions.invoke("score-capabilities", { body: { competitor_id: competitor.id, workflow_id: scoreWf.id } });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error?: string }).error);
      setNote((data as { message?: string })?.message ?? "Scores proposed — accept them in Signals → Review, then they fill the matrix.");
      go(5);
    } catch (e) { setError(e instanceof Error ? e.message : "Scoring failed."); }
    finally { setBusy(null); }
  }

  // ---- step 5: battlecards (analyst → messenger) --------------------------
  async function runBattlecards() {
    if (!pairWf) return;
    setBusy("cards"); setError(null); setNote(null);
    try {
      const a = await supabase.functions.invoke("battlecard-analyst", { body: { competitor_id: competitor.id, workflow_id: pairWf.id } });
      if (a.error) throw a.error;
      if ((a.data as { error?: string })?.error) throw new Error((a.data as { error?: string }).error);
      const m = await supabase.functions.invoke("battlecard-messaging", { body: { competitor_id: competitor.id, workflow_id: pairWf.id } });
      if (m.error) throw m.error;
      if ((m.data as { error?: string })?.error) throw new Error((m.data as { error?: string }).error);
      setNote(`${(a.data as { message?: string })?.message ?? "Analyst proposed items."} ${(m.data as { message?: string })?.message ?? "Messenger drafted the GTM battlecard."} Both await you in review.`);
      onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : "The battlecard pair failed."); }
    finally { setBusy(null); }
  }

  async function finish() {
    await patchSetup({ finalized_at: new Date().toISOString(), step: 5 });
    onChanged(); setOpen(false);
  }

  // Collapsed chrome — a finished competitor shows a quiet "set up" strip.
  if (!open) {
    return (
      <div className="card card-pad" style={{ background: "var(--panel-2)", marginBottom: "var(--sp-4)" }}>
        <div className="row-between" style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="t-sub" style={{ fontSize: 12.5 }}>{finalized ? <>✓ <b>{competitor.name}</b> is set up — monitoring, overview, comparison and battlecards.</> : <>Setup paused at step {step} of 5.</>}</span>
          <button className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>{finalized ? "Re-run setup" : "Resume setup"}</button>
        </div>
      </div>
    );
  }

  const STEPS = ["Identity", "Signals", "Overview", "Comparison", "Battlecards"];
  const stepCard = (n: number, body: React.ReactNode) => (
    <div className="card card-pad" style={{ opacity: step === n ? 1 : 0.55, borderLeft: step === n ? "3px solid var(--ac)" : "3px solid transparent" }}>
      <button onClick={() => go(n)} className="row gap-2" style={{ background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: step === n ? 8 : 0, alignItems: "center" }}>
        <span className="t-mono-xs" style={{ width: 20, height: 20, borderRadius: 10, display: "inline-flex", alignItems: "center", justifyContent: "center", background: step > n ? "var(--gn-bg, #CDEBD6)" : step === n ? "var(--ac)" : "var(--fill)", color: step === n ? "#fff" : "var(--ts)", fontWeight: 700 }}>{step > n ? "✓" : n}</span>
        <span style={{ fontSize: 13.5, fontWeight: step === n ? 680 : 600, color: step === n ? "var(--tp)" : "var(--ts)" }}>{STEPS[n - 1]}</span>
      </button>
      {step === n && body}
    </div>
  );

  return (
    <div className="card card-pad" style={{ borderTop: "3px solid var(--ac)", marginBottom: "var(--sp-4)" }}>
      <div className="row-between" style={{ marginBottom: 10, alignItems: "baseline" }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 680 }}>Finish setting up {competitor.name}</div>
          <div className="t-sub t-muted" style={{ fontSize: 12.5, marginTop: 2 }}>Discovery found them; now stand up their signals, overview, comparison and battlecards — each step you ratify.</div>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => setOpen(false)}>Hide</button>
      </div>
      <Banner>{error}</Banner>
      {note && <div className="banner" style={{ marginBottom: 12 }}>{note}</div>}

      <div className="stack-3">
        {stepCard(1, (
          <div className="stack-2">
            <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Carried over from discovery — confirm or fix. These URLs are what we monitor.</div>
            <label className="field"><span className="t-label">Website</span><input className="input" value={website} placeholder="https://competitor.com" onChange={(e) => setWebsite(e.target.value)} /></label>
            <label className="field"><span className="t-label">LinkedIn <span className="t-muted" style={{ fontWeight: 400 }}>— company page</span></span><input className="input" value={linkedin} placeholder="linkedin.com/company/competitor" onChange={(e) => setLinkedin(e.target.value)} /></label>
            <label className="field"><span className="t-label">Overview <span className="t-muted" style={{ fontWeight: 400 }}>— who they are, how they position</span></span><textarea className="textarea" rows={3} value={overview} onChange={(e) => setOverview(e.target.value)} /></label>
            <div className="row gap-2"><button className="btn btn-sm" onClick={saveIdentity} disabled={busy === "id"}>{busy === "id" ? "Saving…" : "Save & continue →"}</button></div>
          </div>
        ))}

        {stepCard(2, (
          <div className="stack-2">
            <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Stand up live monitors from their URLs and pull once now, so {competitor.name} has signals today. Daily after.</div>
            <div className="stack-2">
              {MONITORS.map((m) => {
                const have = existingKinds.has(m.kind);
                const needUrl = m.needs && !(m.needs === "website" ? website : linkedin).trim();
                return (
                  <label key={m.kind} className="row gap-2" style={{ alignItems: "center", opacity: have || needUrl ? 0.6 : 1 }}>
                    <input type="checkbox" checked={picks.has(m.kind)} disabled={have || !!needUrl} onChange={() => toggle(m.kind)} />
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{CATALOG_BY_KIND[m.kind]?.icon} {m.label}</span>
                    {have && <Chip tone="green">already on</Chip>}
                    {!have && needUrl && <span className="t-mono-xs t-muted">needs the {m.needs} URL (step 1)</span>}
                  </label>
                );
              })}
            </div>
            {pulls.length > 0 && (
              <div className="card card-pad stack-2" style={{ background: "var(--panel-2)", padding: "8px 10px" }}>
                {pulls.map((p) => {
                  const secs = Math.max(0, Math.round((Date.now() - p.startedAt) / 1000));
                  return (
                    <div key={p.id} className="row-between" style={{ gap: 10, alignItems: "baseline" }}>
                      <span className="t-mono-xs" style={{ color: p.state === "error" ? "var(--rd-text)" : p.state === "ok" ? "var(--gn-text)" : "var(--tm)" }}>
                        {p.state === "pulling" ? "… " : p.state === "ok" ? "✓ " : "✕ "}{p.label}{p.msg ? ` — ${p.msg}` : ""}
                      </span>
                      {p.state === "pulling" && <span className="t-mono-xs t-muted" style={{ flexShrink: 0 }}>{secs}s</span>}
                    </div>
                  );
                })}
              </div>
            )}
            <div className="row gap-2">
              {picks.size > 0 && <button className="btn btn-sm" onClick={standUpSignals} disabled={busy === "signals"}>{busy === "signals" ? "Standing up…" : `Stand up ${picks.size} monitor${picks.size === 1 ? "" : "s"} & pull`}</button>}
              <button className="btn btn-secondary btn-sm" onClick={() => go(3)} disabled={busy === "signals"}>Continue →</button>
            </div>
          </div>
        ))}

        {stepCard(3, (
          <div className="stack-2">
            <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Synthesize the deep dossier — their product, modules, GTM and where they&rsquo;re strong/weak vs us — from our records + the signals just pulled. It becomes the editable Signal profile (the raw battlecard).</div>
            <div className="row gap-2">
              <button className="btn btn-sm" onClick={buildOverview} disabled={busy === "overview"}>{busy === "overview" ? "Synthesizing…" : "✦ Build the overview"}</button>
              <button className="btn btn-secondary btn-sm" onClick={() => go(4)}>Skip →</button>
            </div>
          </div>
        ))}

        {stepCard(4, (
          <div className="stack-2">
            <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Score us vs {competitor.name} on each capability, strictly from evidence. Scores land in Signals → Review for your verdict.</div>
            {capabilitiesCount === 0 && <div className="t-sub" style={{ fontSize: 12, color: "var(--am-text)" }}>No capabilities defined yet — add matrix rows on the Dashboard first, or skip.</div>}
            {!scoreWf ? (
              <div className="row gap-2"><button className="btn btn-sm" onClick={standUpAgents} disabled={busy === "agents"}>{busy === "agents" ? "Standing up…" : "✦ Stand up the scoring agent"}</button><button className="btn btn-secondary btn-sm" onClick={() => go(5)}>Skip →</button></div>
            ) : (
              <div className="row gap-2"><button className="btn btn-sm" onClick={scoreComparison} disabled={busy === "score" || capabilitiesCount === 0}>{busy === "score" ? "Scoring…" : "✦ Score from evidence"}</button><button className="btn btn-secondary btn-sm" onClick={() => go(5)}>Skip →</button></div>
            )}
          </div>
        ))}

        {stepCard(5, (
          <div className="stack-2">
            <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>The analyst proposes evidence-cited battlecard items; the messenger drafts the GTM battlecard copy from the ratified facts. Both go through review.</div>
            {!pairWf ? (
              <div className="row gap-2"><button className="btn btn-sm" onClick={standUpAgents} disabled={busy === "agents"}>{busy === "agents" ? "Standing up…" : "✦ Stand up the battlecard pair"}</button></div>
            ) : (
              <button className="btn btn-sm" onClick={runBattlecards} disabled={busy === "cards"}>{busy === "cards" ? "Running…" : "✦ Draft the battlecards"}</button>
            )}
            <div className="row gap-2" style={{ marginTop: 4 }}><button className="btn btn-sm" onClick={finish} style={{ background: "var(--gn, #2E7D52)", color: "#fff" }}>✓ Finish setup</button></div>
          </div>
        ))}
      </div>
    </div>
  );
}
