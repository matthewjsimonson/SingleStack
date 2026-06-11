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
import { Chip, Banner, Modal } from "@/components/ui";
import { useAgentRun, AgentProgress } from "@/components/AgentProgress";
import { CATALOG_BY_KIND } from "@/lib/sources";
import { SKILL_DEFS } from "@/lib/skills.generated";

type Step = 1 | 2 | 3 | 4 | 5;
type CompCand = { name: string; website: string; relationship: string; match: number; why: string; overlap: string; keep: boolean };
type CapCand = { name: string; category: string; why: string; keep: boolean };
const MONITOR_KINDS = [
  ["website", "Website"], ["press", "Press & news"], ["linkedin_jobs", "LinkedIn jobs"], ["linkedin_posts", "LinkedIn posts"],
] as const;

export default function CompetitiveSetup({ onDone, productId }: { onDone: () => void; productId?: string | null }) {
  const supabase = createClient();
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState<string | null>(null);
  // Staged progress for the long AI actions — the search visibly SEARCHES.
  const compsRun = useAgentRun("setupComps");
  const capsRun = useAgentRun("setupCaps");
  const [error, setError] = useState<string | null>(null);

  // step 1 — anchor: the market context comes FROM the records the user already
  // authored (product + GTM); the structured fields below pre-fill from them
  // and stay fully editable.
  const [prod, setProd] = useState<{ name: string; value_prop: string | null } | null>(null);
  const [gtm, setGtm] = useState<{ name: string; personas: string | null; positioning: string | null } | null>(null);
  // Structured, ALWAYS-editable market context — pre-filled from the records,
  // never locked. Personas and industries are first-class: they decide which
  // rivals actually compete for the same buyer.
  const [ctx, setCtx] = useState({ product: "", features: "", who: "", industries: "", positioning: "", more: "" });
  const ctxSet = (k: keyof typeof ctx) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setCtx((c) => ({ ...c, [k]: e.target.value }));
  const [editCtx, setEditCtx] = useState(false);
  // The FULL records dump (every product + GTM field + modules) — what the
  // interviewer reads so it never asks what the records already answer.
  const [recordsDump, setRecordsDump] = useState("");
  // Chat drill-down (side pop-out): the AI asks, the user answers in a roomy
  // box, and when it's specific enough we paint the full picture.
  const [chatOpen, setChatOpen] = useState(false);
  const [chat, setChat] = useState<{ role: "q" | "a"; text: string }[]>([]);
  const [chatWhy, setChatWhy] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatDone, setChatDone] = useState(false);
  const [picture, setPicture] = useState("");
  // Search readiness: scored by the interviewer after every answer — how
  // precisely the competitor search could run right now, and what's thin.
  const [ready, setReady] = useState<number | null>(null);
  const [readyDelta, setReadyDelta] = useState<number | null>(null);
  const [gaps, setGaps] = useState("");
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
      let prodLine = "", whoLine = "", posLine = "", problemLine = "";
      // Product record: the REAL template keys (what_it_is / who_its_for /
      // problem / category), with the legacy seed keys (overview / value_prop)
      // as fallback — not just value_prop, which products don't carry.
      let featLine = "";
      const { data: p } = await supabase.from("product_records").select("id, name").order("created_at").limit(1).maybeSingle();
      if (p) {
        const [{ data: fs }, { data: mods }] = await Promise.all([
          supabase.from("record_fields").select("field_key, value").eq("product_id", p.id)
            .in("field_key", ["what_it_is", "who_its_for", "problem", "category", "value_prop", "overview", "core_capabilities", "differentiated_capabilities"]),
          supabase.from("modules").select("name, description").eq("product_id", p.id).order("created_at").limit(12),
        ]);
        const f = (k: string) => fs?.find((x) => x.field_key === k)?.value ?? null;
        const what = f("what_it_is") ?? f("value_prop") ?? f("overview");
        setProd({ name: p.name, value_prop: what });
        prodLine = `${p.name}${what ? ` — ${what}` : ""}${f("category") ? ` (category: ${f("category")})` : ""}`;
        if (f("who_its_for")) whoLine = f("who_its_for") as string;
        if (f("problem")) problemLine = `Problem it solves: ${f("problem")}`;
        // Features/modules: what the product actually DOES — the strongest
        // signal for capability overlap when matching competitors.
        const modBits = (mods ?? []).map((m) => m.description ? `${m.name} (${m.description})` : m.name);
        const capBits = [f("core_capabilities"), f("differentiated_capabilities")].filter(Boolean) as string[];
        featLine = [...modBits, ...capBits].join("; ");
      } else setProd(null);
      // GTM record: personas/icp (who we sell to) + positioning (against what).
      const { data: g } = await supabase.from("gtm_records").select("id, name").order("created_at").limit(1).maybeSingle();
      if (g) {
        const { data: fs } = await supabase.from("record_fields").select("field_key, value").eq("gtm_record_id", g.id)
          .in("field_key", ["personas", "primary_persona", "icp", "positioning", "category_pov", "differentiation"]);
        const f = (k: string) => fs?.find((x) => x.field_key === k)?.value ?? null;
        const personas = f("personas") ?? f("primary_persona") ?? f("icp");
        const positioning = f("positioning") ?? f("category_pov");
        setGtm({ name: g.name, personas, positioning });
        if (personas && !whoLine) whoLine = personas;
        if (positioning) posLine = positioning;
      } else setGtm(null);
      // The full dump: EVERY field on both records + every module, labeled —
      // the complete picture the records can paint on their own.
      const dump: string[] = [];
      if (p) {
        dump.push(`PRODUCT RECORD: ${p.name}`);
        const { data: allPf } = await supabase.from("record_fields").select("label, value").eq("product_id", p.id).order("position");
        for (const f of allPf ?? []) if (f.value?.trim()) dump.push(`${f.label}: ${f.value}`);
        const { data: allMods } = await supabase.from("modules").select("name, description").eq("product_id", p.id).order("created_at");
        if (allMods?.length) dump.push(`MODULES/FEATURES: ${allMods.map((m) => m.description ? `${m.name} — ${m.description}` : m.name).join("; ")}`);
      }
      if (g) {
        dump.push(`\nGTM RECORD: ${g.name}`);
        const { data: allGf } = await supabase.from("record_fields").select("label, value").eq("gtm_record_id", g.id).order("position");
        for (const f of allGf ?? []) if (f.value?.trim()) dump.push(`${f.label}: ${f.value}`);
      }
      setRecordsDump(dump.join("\n"));
      // Pre-fill the EDITABLE fields from the records — the human can adjust,
      // add, or rewrite everything before anything runs. Never overwrite typing.
      setCtx((cur) => ({
        product: cur.product.trim() ? cur.product : [prodLine, problemLine].filter(Boolean).join(" "),
        features: cur.features.trim() ? cur.features : featLine,
        who: cur.who.trim() ? cur.who : whoLine,
        industries: cur.industries, // no canonical record field yet — the human owns this one
        positioning: cur.positioning.trim() ? cur.positioning : posLine,
        more: cur.more,
      }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // What the agent searches from = exactly what's in the editable fields.
  const marketCtx = [
    picture.trim() ? `FULL PICTURE:\n${picture.trim()}` : "",
    ctx.product.trim() ? `Our product: ${ctx.product.trim()}` : "",
    ctx.features.trim() ? `Key features / modules (for capability overlap): ${ctx.features.trim()}` : "",
    ctx.who.trim() ? `Who we sell to (personas): ${ctx.who.trim()}` : "",
    ctx.industries.trim() ? `Industries / verticals: ${ctx.industries.trim()}` : "",
    ctx.positioning.trim() ? `How we position / against what: ${ctx.positioning.trim()}` : "",
    ctx.more.trim() ? `Also: ${ctx.more.trim()}` : "",
  ].filter(Boolean).join("\n");

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

  // ---- chat drill-down: ask → answer → ask … → paint the full picture --------
  async function nextQuestion(history: { role: "q" | "a"; text: string }[]) {
    setChatBusy(true); setError(null);
    try {
      const data = await invoke({ step: "interview", records: recordsDump, transcript: history });
      const r = Math.min(100, Math.max(0, Math.round(Number(data.readiness) || 0)));
      setReady((prev) => { setReadyDelta(prev !== null ? r - prev : null); return r; });
      setGaps((data.gaps as string) || "");
      if (data.done || !data.question) { setChatDone(true); setChatWhy(null); await paintPicture(history); }
      else { setChat([...history, { role: "q", text: data.question }]); setChatWhy(data.why || null); }
    } catch (e) { setError(e instanceof Error ? e.message : "The interviewer stalled."); }
    finally { setChatBusy(false); }
  }
  function openChat() {
    setChatOpen(true);
    if (chat.length === 0 && !chatBusy) void nextQuestion([]);
  }
  async function sendAnswer(e: React.FormEvent) {
    e.preventDefault(); if (!answer.trim() || chatBusy) return;
    const history = [...chat, { role: "a" as const, text: answer.trim() }];
    setChat(history); setAnswer("");
    await nextQuestion(history);
  }
  async function paintPicture(history: { role: "q" | "a"; text: string }[]) {
    setChatBusy(true); setError(null);
    try {
      const data = await invoke({ step: "picture", records: recordsDump, transcript: history });
      setPicture(data.picture || "");
      setCtx({ product: data.product || "", features: data.features || "", who: data.who || "", industries: data.industries || "", positioning: data.positioning || "", more: data.more || "" });
      setChatDone(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not paint the picture."); }
    finally { setChatBusy(false); }
  }

  // ---- step 2: propose rivals (web search), confirm, insert ------------------
  async function findCompetitors() {
    setBusy("comps"); setError(null);
    try {
      await compsRun.go(async () => {
        const data = await invoke({ step: "competitors", market: marketCtx, product: { name: prod?.name, value_prop: prod?.value_prop } });
        const list = (data.competitors ?? []) as Omit<CompCand, "keep">[];
        if (!list.length) throw new Error("No rivals found — try describing the market more specifically.");
        setComps(list.map((c) => ({ ...c, keep: true })));
        setStep(2);
      });
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
        website: c.website.trim() || null,
        notes: [c.why, c.overlap ? `Overlap: ${c.overlap}` : "", c.match < 100 ? `Match at setup: ${c.match}%` : ""].filter(Boolean).join(" · ") || null,
        position: i, product_id: productId ?? null,
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
      await capsRun.go(async () => {
        const data = await invoke({ step: "capabilities", market: marketCtx, product: { name: prod?.name, value_prop: prod?.value_prop }, competitors: rivals });
        setCaps(((data.capabilities ?? []) as Omit<CapCand, "keep">[]).map((c) => ({ ...c, keep: true })));
      });
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
          {/* ONE context card — read from the records (product, modules, GTM), no
              re-typing, no redundant fields. ✎ Edit opens the popup where every
              line can be adjusted, added to, or eliminated. */}
          <div className="card card-pad" style={{ background: "var(--panel-2)" }}>
            <div className="row-between" style={{ marginBottom: 8 }}>
              <span className="t-label" style={{ color: "var(--tm)" }}>Market context — read from your records</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setEditCtx(true)}>✎ Edit</button>
            </div>
            {marketCtx ? (
              <div className="stack-2">
                {([["Product", ctx.product], ["Features / modules", ctx.features], ["Personas", ctx.who], ["Industries", ctx.industries], ["Positioning", ctx.positioning], ["Also", ctx.more]] as const).map(([label, v]) => v.trim() && (
                  <div key={label} style={{ fontSize: 12.5, lineHeight: 1.5 }}><b style={{ color: "var(--tm)", fontWeight: 640 }}>{label}:</b> <span className="t-sub">{v}</span></div>
                ))}
                {!ctx.industries.trim() && <div className="t-sub t-muted" style={{ fontSize: 12 }}>No industries yet — worth adding (✎ Edit): verticals decide who actually competes for your buyer.</div>}
              </div>
            ) : (
              <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>
                Nothing to read yet — {!prod && <><a href="/products">create the product record</a> and </>}{!gtm && <><a href="/gtm">the GTM record</a>, or </>}use ✎ Edit to write the context by hand.
              </div>
            )}
          </div>
          <Modal open={editCtx} onClose={() => setEditCtx(false)} title="Edit market context" width={620}>
            <div className="stack-3">
              <label className="field"><span className="t-label">Product — what it is</span>
                <textarea className="textarea" rows={2} value={ctx.product} onChange={ctxSet("product")} placeholder="What the product is and the problem it solves" /></label>
              <label className="field"><span className="t-label">Features / modules <span className="t-muted" style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— drives capability-overlap matching</span></span>
                <textarea className="textarea" rows={2} value={ctx.features} onChange={ctxSet("features")} placeholder="e.g. battlecards; signal synthesis; capability matrix; agent workflows" /></label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-3)" }}>
                <label className="field"><span className="t-label">Who you sell to — personas</span>
                  <input className="input" value={ctx.who} onChange={ctxSet("who")} placeholder="e.g. Heads of Product, PMMs" /></label>
                <label className="field"><span className="t-label">Industries / verticals</span>
                  <input className="input" value={ctx.industries} onChange={ctxSet("industries")} placeholder="e.g. B2B SaaS, fintech" /></label>
              </div>
              <label className="field"><span className="t-label">How you position — against what</span>
                <input className="input" value={ctx.positioning} onChange={ctxSet("positioning")} placeholder="The category you claim and what you replace" /></label>
              <label className="field"><span className="t-label">Anything else</span>
                <input className="input" value={ctx.more} onChange={ctxSet("more")} placeholder="e.g. also watch the open-source alternatives" /></label>
              <div className="row gap-2"><button className="btn btn-sm" onClick={() => setEditCtx(false)}>Done</button></div>
            </div>
          </Modal>
          {picture && (
            <div className="card card-pad" style={{ borderLeft: "3px solid var(--ac)" }}>
              <div className="t-label" style={{ color: "var(--tm)", marginBottom: 6 }}>The full picture — confirm before the search runs</div>
              <div className="t-sub" style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{picture}</div>
              <div className="t-mono-xs t-muted" style={{ marginTop: 6 }}>Synthesized from your records + the interview. ✎ Edit adjusts the distilled fields; ✦ Drill down continues the conversation.</div>
            </div>
          )}
          {compsRun.active ? (
            <div className="card card-pad" style={{ borderLeft: "3px solid var(--ac)" }}>
              <AgentProgress run={compsRun} />
              <div className="t-mono-xs t-muted" style={{ marginTop: 6 }}>Live web search across the landscape — typically 30–60 seconds. Every candidate comes back with a match % and its overlap explained.</div>
            </div>
          ) : (
            <div className="row gap-2">
              <button className="btn btn-secondary btn-sm" onClick={openChat}>{chat.length ? "✦ Continue the drill-down" : "✦ Drill down with AI"}</button>
              <button className="btn btn-sm" disabled={!marketCtx} onClick={findCompetitors}
                title={picture ? "Search from the confirmed full picture" : "You can search now, or drill down first for a sharper match"}>
                ✦ Find my competitors
              </button>
              <button className="btn btn-secondary btn-sm" onClick={onDone}>Skip — set up by hand</button>
            </div>
          )}

          {/* The drill-down — a side pop-out chat. The AI asks one discriminating
              question at a time (never re-asking what the records answer); the
              answer box is full-width and tall — you see everything you type. */}
          {chatOpen && (
            <>
              <div onClick={() => setChatOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(11,12,14,0.32)", zIndex: 40 }} />
              <aside style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: 520, maxWidth: "94vw", background: "var(--panel)", borderLeft: "1px solid var(--border)", boxShadow: "var(--shadow-md)", zIndex: 41, display: "flex", flexDirection: "column" }}>
                <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }} className="row-between">
                  <span className="t-h2" style={{ fontSize: 15 }}>Drill down — so the search gets specific</span>
                  <button className="btn btn-secondary btn-sm" onClick={() => setChatOpen(false)}>Close</button>
                </div>
                {ready !== null && (
                  <div style={{ padding: "10px 20px", borderBottom: "1px solid var(--border)" }}>
                    <div className="row-between" style={{ marginBottom: 5, alignItems: "baseline" }}>
                      <span className="t-label" style={{ color: "var(--tm)" }}>Search readiness</span>
                      <span className="row gap-2" style={{ alignItems: "baseline" }}>
                        {readyDelta !== null && readyDelta > 0 && <span className="t-mono-xs" style={{ color: "var(--gn-text, #15803d)", fontWeight: 700 }}>+{readyDelta}</span>}
                        <span className="t-mono-xs" style={{ fontWeight: 700, color: ready >= 80 ? "var(--gn-text, #15803d)" : ready >= 55 ? "var(--am-text)" : "var(--tm)" }}>{chatDone ? 100 : ready}%</span>
                      </span>
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: "var(--fill)", overflow: "hidden" }}>
                      <div style={{ width: `${chatDone ? 100 : ready}%`, height: "100%", borderRadius: 3, background: ready >= 80 || chatDone ? "var(--gn-text, #15803d)" : ready >= 55 ? "var(--am-text, #D97706)" : "var(--ac)", transition: "width 0.4s ease" }} />
                    </div>
                    <div className="t-mono-xs t-muted" style={{ marginTop: 5 }}>
                      {chatDone ? "Specific enough — the picture is painted." : ready >= 80 ? "Good enough to move on — answer more only if you want a sharper cut." : gaps ? `Still thin: ${gaps}` : "Keep going — each answer narrows who you actually compete with."}
                    </div>
                  </div>
                )}
                <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }} className="stack-3">
                  {chat.map((m, i) => (
                    <div key={i} className="card card-pad" style={{ background: m.role === "q" ? "var(--panel-2)" : "var(--ac-fill, var(--fill))", marginLeft: m.role === "a" ? 32 : 0, marginRight: m.role === "q" ? 32 : 0 }}>
                      <div className="t-mono-xs t-muted" style={{ marginBottom: 3 }}>{m.role === "q" ? "✦ AI" : "You"}</div>
                      <div style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{m.text}</div>
                    </div>
                  ))}
                  {chatWhy && !chatDone && <div className="t-mono-xs t-muted">Why this question: {chatWhy}</div>}
                  {chatBusy && <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>{chatDone || chat.length === 0 ? "Thinking…" : chat[chat.length - 1]?.role === "a" ? "Reading your answer…" : "Painting the full picture…"}</div>}
                  {chatDone && !chatBusy && (
                    <div className="card card-pad" style={{ borderLeft: "3px solid var(--gn-text, #15803d)", fontSize: 12.5 }}>
                      Got what it needs — the full picture is on the setup screen. Review it, ✎ Edit anything, then ✦ Find my competitors.
                    </div>
                  )}
                </div>
                {!chatDone && (
                  <form onSubmit={sendAnswer} style={{ padding: "12px 20px", borderTop: "1px solid var(--border)" }} className="stack-2">
                    <textarea className="textarea" rows={3} autoFocus value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Answer in your own words — detail helps; you can see everything you type."
                      onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendAnswer(e); }} />
                    <div className="row gap-2">
                      <button className="btn btn-sm" type="submit" disabled={chatBusy || !answer.trim()}>{chatBusy ? "…" : "Send"}</button>
                      <button className={(ready ?? 0) >= 80 ? "btn btn-sm" : "btn btn-secondary btn-sm"} type="button" disabled={chatBusy || chat.length < 2} onClick={() => paintPicture(chat)}
                        style={(ready ?? 0) >= 80 ? { background: "var(--gn-text, #15803d)", color: "#fff" } : undefined}
                        title={(ready ?? 0) >= 80 ? "You're at a good level — synthesize and move on" : "Stop here and synthesize the picture from what's answered so far"}>
                        {(ready ?? 0) >= 80 ? "✓ Good level — paint the picture" : "Enough — paint the picture"}</button>
                    </div>
                  </form>
                )}
              </aside>
            </>
          )}
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
                {c.overlap && <div className="t-mono-xs" style={{ marginTop: 3 }}>{c.overlap}</div>}
              </div>
              <Chip tone={c.match >= 70 ? "accent" : c.match >= 45 ? "violet" : "default"}>{c.match}% match</Chip>
            </div>
          ))}
          <button className="btn btn-secondary btn-sm" onClick={() => setComps([...comps, { name: "", website: "", relationship: "direct", match: 100, why: "Added by you.", overlap: "", keep: true }])}>+ Add one they missed</button>
          <div className="row gap-2">
            <button className="btn btn-sm" disabled={busy === "save-comps"} onClick={confirmCompetitors}>{busy === "save-comps" ? "Saving…" : `Confirm ${comps.filter((c) => c.keep && c.name.trim()).length} competitor${comps.filter((c) => c.keep && c.name.trim()).length === 1 ? "" : "s"} →`}</button>
            {compsRun.active ? <AgentProgress run={compsRun} compact /> : <button className="btn btn-secondary btn-sm" onClick={findCompetitors}>↻ Search again</button>}
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="stack-3">
          <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>The functionality vectors to compare on — proposed from your product, market, and rivals. These become the matrix rows; scores then come from <b>evidence</b>, ratified by you, never hand-typed guesses.</div>
          {capsRun.active && caps.length === 0 ? <div className="card card-pad" style={{ borderLeft: "3px solid var(--ac)" }}><AgentProgress run={capsRun} /></div> : caps.map((c, i) => (
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
