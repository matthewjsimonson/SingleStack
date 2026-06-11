"use client";

// Guided competitive-intel setup — the front door of the module. Five steps,
// every one HITL: the agent proposes (rivals from live web search, matrix rows
// from your product + market), the human confirms/edits/discards, and only then
// does the wizard write — as the user, RLS-fenced, the same inserts the manual
// UI does. Finishes by standing up live monitoring (website / LinkedIn jobs /
// LinkedIn posts / press, daily) per competitor and igniting the first pulls,
// so the matrix starts filling from EVIDENCE through the review gate — not by
// hand-typing numbers.
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Chip, Banner } from "@/components/ui";
import { CATALOG_BY_KIND } from "@/lib/sources";
import { SKILL_DEFS } from "@/lib/skills.generated";

type Step = 1 | 2 | 3 | 4 | 5;
type CompCand = { name: string; website: string; relationship: string; why: string; keep: boolean };
type CapCand = { name: string; category: string; why: string; keep: boolean };
const MONITOR_KINDS = [
  ["website", "Website"], ["press", "Press & news"], ["linkedin_jobs", "LinkedIn jobs"], ["linkedin_posts", "LinkedIn posts"],
] as const;

export default function CompetitiveSetup({ onDone, productId }: { onDone: () => void; productId?: string | null }) {
  const supabase = createClient();
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // step 1 — anchor
  const [prod, setProd] = useState<{ name: string; value_prop: string | null } | null>(null);
  const [market, setMarket] = useState("");
  // step 2 — competitors
  const [comps, setComps] = useState<CompCand[]>([]);
  const [savedComps, setSavedComps] = useState<{ id: string; name: string; website: string | null }[]>([]);
  // step 3 — capabilities
  const [caps, setCaps] = useState<CapCand[]>([]);
  const [capsSaved, setCapsSaved] = useState(0);
  // step 4 — monitoring: per competitor, which kinds + cadence
  const [monitor, setMonitor] = useState<Record<string, Set<string>>>({});
  const [cadence, setCadence] = useState("daily");
  const [createdSources, setCreatedSources] = useState<{ id: string; label: string }[]>([]);
  // step 5 — ignite
  const [pullLog, setPullLog] = useState<string[]>([]);
  // The agent side: the ✦ buttons (score / analyst / messenger) need a workflow
  // whose steps carry agent × SKILL. Detect whether one exists; offer to stand
  // up the pair (skills from the canonical templates → attached to your agent →
  // two workflows) in one ratified click.
  const [wfReady, setWfReady] = useState<boolean | null>(null);
  const [wfNote, setWfNote] = useState<string | null>(null);
  useEffect(() => {
    if (step !== 5) return;
    supabase.from("workflows").select("id, steps").eq("is_active", true).then(({ data }) => {
      const ok = ((data ?? []) as { steps: { agent_id?: string; skill_id?: string | null }[] }[])
        .some((w) => Array.isArray(w.steps) && w.steps[0]?.agent_id && w.steps[0]?.skill_id);
      setWfReady(ok);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);
  async function standUpAgents() {
    setBusy("wf"); setError(null); setWfNote(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      // 1. the agent that runs the playbooks: prefer the CRO, else any active agent
      const { data: agents } = await supabase.from("agents").select("id, key, name").eq("is_active", true).order("created_at");
      const agent = (agents ?? []).find((a) => a.key === "cro") ?? (agents ?? [])[0];
      if (!agent) throw new Error("No active agent yet — create one on the Agents page first, then re-run this step.");
      // 2. the three competitive skills, from the canonical templates (insert if missing)
      const KEYS = ["competitive_evidence_analyst", "competitive_messenger", "capability_evidence_scoring"];
      const skillId: Record<string, string> = {};
      for (const key of KEYS) {
        const def = SKILL_DEFS.find((d) => d.key === key); if (!def) continue;
        const { data: ex } = await supabase.from("skills").select("id").eq("key", key).maybeSingle();
        if (ex?.id) skillId[key] = ex.id;
        else {
          const { data: created, error } = await supabase.from("skills").insert({
            org_id: orgId, key, name: def.name, description: def.description, category: def.category,
            instructions: def.instructions, source: "template", areas: def.areas, connectors: def.connectors,
          }).select("id").single();
          if (error || !created) throw error ?? new Error(`could not create skill ${key}`);
          skillId[key] = created.id;
        }
        await supabase.from("agent_skills").upsert({ org_id: orgId, agent_id: agent.id, skill_id: skillId[key], is_cornerstone: false }, { onConflict: "agent_id,skill_id", ignoreDuplicates: true });
      }
      // 3. the two workflows, steps carrying agent × skill (what the ✦ buttons need)
      const uid = () => crypto.randomUUID();
      const { data: have } = await supabase.from("workflows").select("name");
      const names = new Set((have ?? []).map((w) => w.name));
      const defs = [
        { name: "Competitive battlecard pair", description: "Step 1: the analyst proposes evidence-cited battlecard items (through review). Step 2: the messenger drafts seller copy from the ratified items (through proposals).",
          steps: [
            { id: uid(), agent_id: agent.id, skill_id: skillId["competitive_evidence_analyst"], signals: "both", instruction: "Work one named competitor at a time. Propose only what the evidence supports." },
            { id: uid(), agent_id: agent.id, skill_id: skillId["competitive_messenger"], signals: "none", instruction: "Draft from ratified items only — never re-introduce rejected claims." },
          ] },
        { name: "Score the capability matrix", description: "Step 1: rate a rival on each capability 0–3 strictly from cited evidence — proposals land in Signals → Review.",
          steps: [
            { id: uid(), agent_id: agent.id, skill_id: skillId["capability_evidence_scoring"], signals: "both", instruction: "Omit capabilities the evidence doesn't address. A single soft mention is a 1, never higher." },
          ] },
      ];
      let made = 0;
      for (const d of defs) {
        if (names.has(d.name)) continue;
        const { error } = await supabase.from("workflows").insert({ org_id: orgId, agent_id: agent.id, name: d.name, description: d.description, trigger: "manual", target_type: "none", steps: d.steps, is_active: true });
        if (error) throw error; made++;
      }
      setWfReady(true);
      setWfNote(`Ready — ${agent.name} carries the three competitive playbooks${made ? `, ${made} workflow${made === 1 ? "" : "s"} created` : ""}. Pick them in the workflow selector next to each ✦ button.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not stand up the agent side."); }
    finally { setBusy(null); }
  }

  useEffect(() => {
    (async () => {
      const { data: p } = await supabase.from("product_records").select("id, name").order("created_at").limit(1).maybeSingle();
      if (!p) { setProd(null); return; }
      const { data: vp } = await supabase.from("record_fields").select("value").eq("product_id", p.id).eq("field_key", "value_prop").maybeSingle();
      setProd({ name: p.name, value_prop: vp?.value ?? null });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const invoke = async (body: Record<string, unknown>) => {
    const { data: s } = await supabase.auth.getSession();
    const token = s.session?.access_token;
    const { data, error } = await supabase.functions.invoke("setup-competitive", {
      body, headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  };

  // ---- step 2: propose rivals (web search), confirm, insert ------------------
  async function findCompetitors() {
    setBusy("comps"); setError(null);
    try {
      const data = await invoke({ step: "competitors", market, product: { name: prod?.name, value_prop: prod?.value_prop } });
      const list = (data.competitors ?? []) as Omit<CompCand, "keep">[];
      if (!list.length) throw new Error("No rivals found — try describing the market more specifically.");
      setComps(list.map((c) => ({ ...c, keep: true })));
      setStep(2);
    } catch (e) { setError(e instanceof Error ? e.message : "The landscape search failed."); }
    finally { setBusy(null); }
  }
  async function confirmCompetitors() {
    const keep = comps.filter((c) => c.keep && c.name.trim());
    if (!keep.length) { setError("Keep at least one competitor (or add your own)."); return; }
    setBusy("save-comps"); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      const { data, error } = await supabase.from("competitors").insert(keep.map((c, i) => ({
        org_id: orgId, name: c.name.trim(), relationship: c.relationship === "adjacent" ? "adjacent" : "direct",
        website: c.website.trim() || null, notes: c.why || null, position: i, product_id: productId ?? null,
      }))).select("id, name, website");
      if (error) throw error;
      setSavedComps(data ?? []);
      // default monitoring: every kind on, website only when we know the URL
      const m: Record<string, Set<string>> = {};
      for (const c of data ?? []) m[c.id] = new Set(MONITOR_KINDS.map(([k]) => k).filter((k) => k !== "website" || !!c.website));
      setMonitor(m);
      setStep(3);
      // pre-fetch capability proposals while the user reads
      void proposeCapabilities((data ?? []).map((c) => c.name));
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save competitors."); }
    finally { setBusy(null); }
  }

  // ---- step 3: propose matrix rows, confirm, insert ---------------------------
  async function proposeCapabilities(rivals: string[]) {
    setBusy("caps"); setError(null);
    try {
      const data = await invoke({ step: "capabilities", market, product: { name: prod?.name, value_prop: prod?.value_prop }, competitors: rivals });
      setCaps(((data.capabilities ?? []) as Omit<CapCand, "keep">[]).map((c) => ({ ...c, keep: true })));
    } catch (e) { setError(e instanceof Error ? e.message : "Could not propose capabilities."); }
    finally { setBusy(null); }
  }
  async function confirmCapabilities() {
    const keep = caps.filter((c) => c.keep && c.name.trim());
    if (!keep.length) { setError("Keep at least one capability row."); return; }
    setBusy("save-caps"); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      const { error } = await supabase.from("capabilities").insert(keep.map((c, i) => ({
        org_id: orgId, name: c.name.trim(), category: c.category || null, position: i,
      })));
      if (error) throw error;
      setCapsSaved(keep.length);
      setStep(4);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save capabilities."); }
    finally { setBusy(null); }
  }

  // ---- step 4: stand up live monitoring per competitor ------------------------
  const toggleMonitor = (compId: string, kind: string) => setMonitor((m) => {
    const next = new Set(m[compId] ?? []);
    if (next.has(kind)) next.delete(kind); else next.add(kind);
    return { ...m, [compId]: next };
  });
  async function confirmMonitoring() {
    setBusy("save-mon"); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      const rows: Record<string, unknown>[] = [];
      for (const c of savedComps) {
        for (const kind of monitor[c.id] ?? []) {
          const def = CATALOG_BY_KIND[kind]; if (!def) continue;
          rows.push({
            org_id: orgId, label: `${c.name} — ${def.label}`, icon: def.icon,
            origin: def.origin, kind, status: "connected", auth_mode: def.authMode, access_scope: def.accessScope,
            focus: def.defaultFocus ?? "both", max_per_pull: def.defaultMaxPerPull, cadence,
            config: kind === "website" && c.website ? { url: c.website } : null,
            guidance: kind === "website" ? "Track changes to positioning, pricing, and what they ship." : null,
            competitor_id: c.id,
          });
        }
      }
      if (!rows.length) { setStep(5); setBusy(null); return; }
      const { data, error } = await supabase.from("sources").insert(rows).select("id, label");
      if (error) throw error;
      setCreatedSources(data ?? []);
      setStep(5);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create the monitors."); }
    finally { setBusy(null); }
  }

  // ---- step 5: ignite — first pulls, then the loop takes over -----------------
  async function igniteAll() {
    setBusy("ignite"); setError(null); setPullLog([]);
    const { data: s } = await supabase.auth.getSession();
    const token = s.session?.access_token;
    for (const src of createdSources.slice(0, 12)) {
      setPullLog((l) => [...l, `Pulling ${src.label}…`]);
      try {
        const { data, error } = await supabase.functions.invoke("connector-runner", {
          body: { source_id: src.id }, headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        setPullLog((l) => [...l.slice(0, -1), `✓ ${src.label} — ${data.created ?? 0} signal${(data.created ?? 0) === 1 ? "" : "s"}`]);
      } catch (e) {
        setPullLog((l) => [...l.slice(0, -1), `✗ ${src.label} — ${e instanceof Error ? e.message : "failed"}`]);
      }
    }
    setBusy(null);
  }

  const stepLabel = ["", "Your market", "Competitors", "Capability matrix", "Monitoring", "Ignite"][step];

  return (
    <div className="card card-pad" style={{ borderTop: "3px solid var(--ac)" }}>
      <div className="row-between" style={{ marginBottom: 12, alignItems: "baseline" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 680 }}>Set up competitive intel</div>
          <div className="t-sub t-muted" style={{ fontSize: 12.5, marginTop: 2 }}>Guided and human-ratified: the agent proposes, you decide, the loop keeps it current.</div>
        </div>
        <div className="row gap-2" style={{ alignItems: "center" }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <span key={n} className="t-mono-xs" style={{ width: 22, height: 22, borderRadius: 11, display: "inline-flex", alignItems: "center", justifyContent: "center", background: n === step ? "var(--ac)" : n < step ? "var(--gn-bg, #CDEBD6)" : "var(--fill)", color: n === step ? "#fff" : "var(--ts)", fontWeight: 700 }}>{n < step ? "✓" : n}</span>
          ))}
          <span className="t-label" style={{ color: "var(--tm)", marginLeft: 4 }}>{stepLabel}</span>
        </div>
      </div>
      <Banner>{error}</Banner>

      {step === 1 && (
        <div className="stack-3">
          <div className="card card-pad" style={{ background: "var(--panel-2)" }}>
            <div className="t-label" style={{ color: "var(--tm)", marginBottom: 4 }}>Your product</div>
            {prod ? (<><div style={{ fontSize: 14, fontWeight: 640 }}>{prod.name}</div>
              {prod.value_prop && <div className="t-sub t-muted" style={{ fontSize: 12.5, marginTop: 3 }}>{prod.value_prop}</div>}</>)
              : <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>No product record yet — the search will lean on your market description below.</div>}
          </div>
          <label className="field"><span className="t-label">Describe your market — who you sell to, and against what</span>
            <textarea className="textarea" rows={3} autoFocus value={market} onChange={(e) => setMarket(e.target.value)}
              placeholder="e.g. AI-native product-marketing platform for B2B SaaS teams — competing with PMM tools, battlecard products, and competitive-intel platforms" /></label>
          <div className="row gap-2">
            <button className="btn btn-sm" disabled={busy === "comps" || (!market.trim() && !prod)} onClick={findCompetitors}>{busy === "comps" ? "Searching the landscape…" : "✦ Find my competitors"}</button>
            <button className="btn btn-secondary btn-sm" onClick={onDone}>Skip — set up by hand</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="stack-3">
          <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>From live web search. Uncheck the ones that don&rsquo;t belong, fix names/sites, add anyone missing — <b>you</b> decide who&rsquo;s on the board.</div>
          {comps.map((c, i) => (
            <div key={i} className="card card-pad row gap-2" style={{ alignItems: "flex-start", opacity: c.keep ? 1 : 0.45 }}>
              <input type="checkbox" checked={c.keep} onChange={() => setComps(comps.map((x, j) => j === i ? { ...x, keep: !x.keep } : x))} style={{ marginTop: 5 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row gap-2" style={{ marginBottom: 4 }}>
                  <input className="input" value={c.name} onChange={(e) => setComps(comps.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} style={{ fontWeight: 640, maxWidth: 220 }} />
                  <select className="select" value={c.relationship} onChange={(e) => setComps(comps.map((x, j) => j === i ? { ...x, relationship: e.target.value } : x))} style={{ width: 110 }}>
                    <option value="direct">Direct</option><option value="adjacent">Adjacent</option>
                  </select>
                  <input className="input" value={c.website} onChange={(e) => setComps(comps.map((x, j) => j === i ? { ...x, website: e.target.value } : x))} placeholder="https://…" style={{ flex: 1, minWidth: 140 }} />
                </div>
                <div className="t-sub t-muted" style={{ fontSize: 12 }}>{c.why}</div>
              </div>
            </div>
          ))}
          <button className="btn btn-secondary btn-sm" onClick={() => setComps([...comps, { name: "", website: "", relationship: "direct", why: "Added by you.", keep: true }])}>+ Add one they missed</button>
          <div className="row gap-2">
            <button className="btn btn-sm" disabled={busy === "save-comps"} onClick={confirmCompetitors}>{busy === "save-comps" ? "Saving…" : `Confirm ${comps.filter((c) => c.keep && c.name.trim()).length} competitor${comps.filter((c) => c.keep && c.name.trim()).length === 1 ? "" : "s"} →`}</button>
            <button className="btn btn-secondary btn-sm" disabled={busy === "comps"} onClick={findCompetitors}>↻ Search again</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="stack-3">
          <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>The functionality vectors to compare on — proposed from your product, market, and rivals. These become the matrix rows; scores then come from <b>evidence</b>, ratified by you, never hand-typed guesses.</div>
          {busy === "caps" && caps.length === 0 ? <div className="t-sub t-muted">Designing the matrix…</div> : caps.map((c, i) => (
            <div key={i} className="card card-pad row gap-2" style={{ alignItems: "flex-start", opacity: c.keep ? 1 : 0.45 }}>
              <input type="checkbox" checked={c.keep} onChange={() => setCaps(caps.map((x, j) => j === i ? { ...x, keep: !x.keep } : x))} style={{ marginTop: 5 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row gap-2" style={{ marginBottom: 3, alignItems: "center" }}>
                  <input className="input" value={c.name} onChange={(e) => setCaps(caps.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} style={{ fontWeight: 640, maxWidth: 300 }} />
                  <Chip tone={c.category === "gtm" ? "violet" : "accent"}>{c.category}</Chip>
                </div>
                <div className="t-sub t-muted" style={{ fontSize: 12 }}>{c.why}</div>
              </div>
            </div>
          ))}
          {caps.length > 0 && <button className="btn btn-secondary btn-sm" onClick={() => setCaps([...caps, { name: "", category: "product", why: "Added by you.", keep: true }])}>+ Add a row</button>}
          <div className="row gap-2">
            <button className="btn btn-sm" disabled={busy === "save-caps" || caps.length === 0} onClick={confirmCapabilities}>{busy === "save-caps" ? "Saving…" : "Confirm matrix rows →"}</button>
            <button className="btn btn-secondary btn-sm" disabled={busy === "caps"} onClick={() => proposeCapabilities(savedComps.map((c) => c.name))}>↻ Propose again</button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="stack-3">
          <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>Live monitoring per competitor — website, press, LinkedIn jobs &amp; posts, pulled on a schedule. Harvested signals land on the competitor and in the feed, then synthesis → evidence-derived scores → your review.</div>
          <div className="row gap-2" style={{ alignItems: "center" }}>
            <span className="t-label">Cadence</span>
            <select className="select" value={cadence} onChange={(e) => setCadence(e.target.value)} style={{ width: 120 }}>
              <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="manual">Manual only</option>
            </select>
          </div>
          <div className="card" style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
              <thead><tr>
                <th style={{ textAlign: "left", padding: "10px 14px", fontSize: 11, fontWeight: 600, color: "var(--tm)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Competitor</th>
                {MONITOR_KINDS.map(([k, label]) => <th key={k} style={{ padding: "10px 8px", fontSize: 11, fontWeight: 600, color: "var(--tm)" }}>{label}</th>)}
              </tr></thead>
              <tbody>
                {savedComps.map((c) => (
                  <tr key={c.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "8px 14px", fontWeight: 600 }}>{c.name}{!c.website && <span className="t-mono-xs t-muted" style={{ marginLeft: 6 }}>no site URL</span>}</td>
                    {MONITOR_KINDS.map(([k]) => (
                      <td key={k} style={{ padding: "6px 8px", textAlign: "center" }}>
                        <input type="checkbox" disabled={k === "website" && !c.website} checked={monitor[c.id]?.has(k) ?? false} onChange={() => toggleMonitor(c.id, k)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row gap-2">
            <button className="btn btn-sm" disabled={busy === "save-mon"} onClick={confirmMonitoring}>{busy === "save-mon" ? "Creating monitors…" : "Confirm monitoring →"}</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setStep(5)}>Skip monitoring</button>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="stack-3">
          <div className="card card-pad" style={{ background: "var(--panel-2)" }}>
            <div style={{ fontSize: 14, fontWeight: 640, marginBottom: 4 }}>Setup complete — now the loop does the work</div>
            <div className="t-sub" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
              {savedComps.length} competitor{savedComps.length === 1 ? "" : "s"} · {capsSaved} matrix row{capsSaved === 1 ? "" : "s"} · {createdSources.length} live monitor{createdSources.length === 1 ? "" : "s"}{cadence !== "manual" ? ` (${cadence})` : ""}.
              Pulls harvest signals onto each competitor → synthesis builds themes → <b>✦ Score from evidence</b> proposes matrix ratings citing those signals → you accept, adjust, or reject in <b>Signals → Review</b>. The matrix fills because evidence filled it.
            </div>
          </div>
          {wfReady === false && (
            <div className="card card-pad" style={{ borderLeft: "3px solid var(--am-text)" }}>
              <div style={{ fontSize: 13.5, fontWeight: 640, marginBottom: 4 }}>One more thing: the agent side</div>
              <div className="t-sub" style={{ fontSize: 12.5, lineHeight: 1.55, marginBottom: 8 }}>
                The ✦ buttons (score from evidence, analyst, messenger) run <b>your</b> agent × skill via a workflow — and no runnable one exists yet. This creates the three competitive playbooks (evidence analyst, messenger, evidence scoring), attaches them to your agent, and builds the two workflows. You ratify everything they ever propose.
              </div>
              <button className="btn btn-sm" disabled={busy === "wf"} onClick={standUpAgents}>{busy === "wf" ? "Standing up…" : "✦ Stand up the competitive agents"}</button>
            </div>
          )}
          {wfNote && <div className="card card-pad" style={{ background: "var(--panel-2)", fontSize: 12.5 }}>{wfNote}</div>}
          {createdSources.length > 0 && (
            <>
              <button className="btn btn-sm" disabled={busy === "ignite"} onClick={igniteAll}>{busy === "ignite" ? "Pulling…" : `⚡ Run the first pulls now (${Math.min(createdSources.length, 12)})`}</button>
              {pullLog.length > 0 && <div className="card card-pad" style={{ background: "var(--panel-2)" }}>{pullLog.map((l, i) => <div key={i} className="t-mono-xs" style={{ padding: "2px 0" }}>{l}</div>)}</div>}
            </>
          )}
          <button className="btn btn-secondary btn-sm" onClick={onDone}>Open the dashboard →</button>
        </div>
      )}
    </div>
  );
}
