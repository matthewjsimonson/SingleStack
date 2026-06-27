"use client";

// Guided competitive-intel setup — the front door of the module. Five steps,
// every one HITL: the agent proposes (rivals from live web search, matrix rows
// from your product + market), the human confirms/edits/discards, and only then
// does the wizard write — as the user, RLS-fenced, the same inserts the manual
// UI does. Finishes by standing up live monitoring (website / LinkedIn jobs /
// LinkedIn posts / press, daily) per competitor and igniting the first pulls,
// so the matrix starts filling from EVIDENCE through the review gate — not by
// hand-typing numbers.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getOrgId } from "@/lib/org";
import { Chip, Banner, Modal } from "@/components/ui";
import { useAgentRun, AgentProgress, AgentStepList } from "@/components/AgentProgress";
import ProfileReadiness from "@/components/ProfileReadiness";
import { CATALOG_BY_KIND } from "@/lib/sources";
import { standUpCompetitiveAgents } from "@/lib/standUpCompetitive";
import MonitoringStatus from "@/components/MonitoringStatus";

type Step = 1 | 2 | 3 | 4 | 5;
type CompCand = { name: string; website: string; linkedin: string; overview: string; relationship: string; match: number; why: string; overlap: string; keep: boolean };
type CapCand = { name: string; category: string; why: string; keep: boolean };
const MONITOR_KINDS = [
  ["website", "Website"], ["press", "Press & news"], ["linkedin_jobs", "LinkedIn jobs"], ["linkedin_posts", "LinkedIn posts"],
] as const;
// The canonical record fields the setup may fill, with their record scope, label,
// and template section. The picture step is held to these keys server-side; the
// client validates against this map too, so a stray/invented key from the model
// is dropped rather than orphaning a field on the record. Mirrors lib/templates.ts.
const RECORD_FIELD_META: Record<string, { label: string; section: string; scope: "product" | "gtm" }> = {
  what_it_is: { label: "What it is", section: "Overview", scope: "product" },
  problem: { label: "Problem it solves", section: "Overview", scope: "product" },
  category: { label: "Category", section: "Overview", scope: "product" },
  strategic_intent: { label: "Strategic intent", section: "Overview", scope: "product" },
  core_capabilities: { label: "Core capabilities", section: "Capabilities", scope: "product" },
  differentiated_capabilities: { label: "Differentiated capabilities", section: "Capabilities", scope: "product" },
  primary_persona: { label: "Primary persona", section: "Buyer", scope: "gtm" },
  icp: { label: "Ideal customer profile", section: "Buyer", scope: "gtm" },
  industries: { label: "Industries / verticals", section: "Buyer", scope: "gtm" },
  positioning: { label: "Positioning", section: "Positioning", scope: "gtm" },
  category_pov: { label: "Category POV", section: "Positioning", scope: "gtm" },
  differentiation: { label: "Differentiation", section: "Positioning", scope: "gtm" },
  value_prop: { label: "Value proposition", section: "Messaging", scope: "gtm" },
  pillars: { label: "Message pillars", section: "Messaging", scope: "gtm" },
  gtm_motion: { label: "GTM motion", section: "Motion", scope: "gtm" },
  pricing_model: { label: "Pricing model", section: "Motion", scope: "gtm" },
  win_themes: { label: "Win themes", section: "Motion", scope: "gtm" },
};

export default function CompetitiveSetup({ onDone, productId }: { onDone: () => void; productId?: string | null }) {
  const supabase = createClient();
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState<string | null>(null);
  // Staged progress for the capability proposal; the SEARCH gets REAL phase
  // status (phase + elapsed seconds + token usage) instead of a guessed cadence.
  const capsRun = useAgentRun("setupCaps");
  const askRun = useAgentRun("setupAsk");
  const pullRun = useAgentRun("pullSource");
  const pictureRun = useAgentRun("setupPicture");
  // The living search checklist: short, controlled steps that complete on REAL
  // transitions (request fired / phase resolved) — spinner on the active step,
  // ✓ as each one lands. No fake progress between events.
  const [searchStep, setSearchStep] = useState<number | null>(null); // index into SEARCH_STEPS; null = not searching
  const [searchSecs, setSearchSecs] = useState(0);
  const [searchUsage, setSearchUsage] = useState<{ input: number; output: number } | null>(null);

  const [error, setError] = useState<string | null>(null);

  // step 1 — anchor: the market context comes FROM the records the user already
  // authored (product + GTM); the structured fields below pre-fill from them
  // and stay fully editable.
  const [prod, setProd] = useState<{ name: string; value_prop: string | null } | null>(null);
  const [gtm, setGtm] = useState<{ name: string; personas: string | null; positioning: string | null } | null>(null);
  // Structured, ALWAYS-editable market context — pre-filled from the records,
  // never locked. Personas and industries are first-class: they decide which
  // rivals actually compete for the same buyer.
  const [ctx, setCtx] = useState({ product: "", features: "", who: "", industries: "", positioning: "", more: "", competitors: "" });
  const SEARCH_STEPS = [
    "Reading your profile",
    ctx.competitors.trim() ? `Verifying ${ctx.competitors.split(",").filter((x) => x.trim()).length} named rival${ctx.competitors.includes(",") ? "s" : ""}, searching beyond` : "Searching the live landscape",
    "Scoring overlap — buyer · industry · capability · positioning",
    "Ranking by match",
  ];
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
  // The per-dimension coverage behind the score — what's covered, partial,
  // missing, n/a, and from where. The readiness IS computed from this.
  type Cov = { dimension: string; label: string; status: string; source: string; note: string; weight: number };
  const [coverage, setCoverage] = useState<Cov[]>([]);
  // step 2 — competitors
  // Governed run: the in-progress setup lives in competitive_setup_runs so
  // matches SURVIVE across devices/sessions (resume is a DB read), and the
  // run's budgets are first-class.
  const [comps, setComps] = useState<CompCand[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [savedRun, setSavedRun] = useState<{ comps: CompCand[]; at: number; transcript?: { role: "q" | "a"; text: string }[]; picture?: string; context?: typeof ctx } | null>(null);
  // Controls: how many questions the interview may ask, and how many rivals a
  // run returns. The user owns both.
  const [maxQuestions, setMaxQuestions] = useState(6);
  const [targetMatches, setTargetMatches] = useState(8);
  const [savedComps, setSavedComps] = useState<{ id: string; name: string; website: string | null; linkedin: string | null }[]>([]);
  // step 3 — capabilities
  const [caps, setCaps] = useState<CapCand[]>([]);
  const [capsSaved, setCapsSaved] = useState(0);
  // step 4 — monitoring: per competitor, which kinds + cadence
  const [monitor, setMonitor] = useState<Record<string, Set<string>>>({});
  const [cadence, setCadence] = useState("daily");
  // "How you want it" — per-source-type instructions, editable before anything
  // is created. These land on each source's guidance and aim every pull.
  const [kindGuide, setKindGuide] = useState<Record<string, string>>({
    website: "Track changes to positioning, pricing, packaging, and what they ship.",
    press: "Launches, funding, partnerships, exec moves, pricing changes — with dates. Flag anything that corroborates their job postings or product direction.",
    linkedin_jobs: "New postings, and what the DESCRIPTIONS imply — teams, technologies, segments, new bets — not just titles. Flag postings that corroborate product releases or GTM shifts.",
    linkedin_posts: "Announcements, launches, hiring pushes, narrative shifts — note where a post cross-validates other moves.",
  });
  const [createdSources, setCreatedSources] = useState<{ id: string; label: string }[]>([]);
  // Specific links the engine couldn't know — a pricing page, a LinkedIn
  // people/jobs area, a docs site. Each becomes its own monitored source:
  // LinkedIn URLs anchor a search-backed monitor (LinkedIn blocks direct
  // fetch); anything else is fetched directly.
  const [extraLinks, setExtraLinks] = useState<{ compId: string; url: string }[]>([]);
  const [extraDraft, setExtraDraft] = useState({ compId: "", url: "" });
  // step 5 — ignite: each pull is the VERIFICATION — reachable or exact error,
  // and a preview of the actual signals harvested so you see what it pulls
  // before daily monitoring runs on it.
  const [pullLog, setPullLog] = useState<{ text: string; ok?: boolean; signals?: { title: string; relevance: number }[] }[]>([]);
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
      const res = await standUpCompetitiveAgents(supabase);
      if (!res.ok) throw new Error(res.message);
      setWfReady(true); setWfNote(res.message);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not stand up the agent side."); }
    finally { setBusy(null); }
  }


  useEffect(() => {
    void (async () => {
    try {
      let q = supabase.from("competitive_setup_runs").select("id, matches, transcript, picture, context, settings, updated_at").eq("status", "open");
      q = productId ? q.eq("product_id", productId) : q.is("product_id", null);
      const { data } = await q.order("updated_at", { ascending: false }).limit(1).maybeSingle();
      if (data) {
        setRunId(data.id);
        const st = (data.settings ?? {}) as { max_questions?: number; target_matches?: number };
        if (st.max_questions) setMaxQuestions(st.max_questions);
        if (st.target_matches) setTargetMatches(st.target_matches);
        // AUTO-RESTORE the in-progress context — merge its non-empty fields over
        // whatever's there, so industries/competitors (and the rest) come back
        // filled. The records-prefill effect only fills EMPTY slots, so order
        // doesn't matter.
        const rc = (data.context ?? null) as Partial<typeof ctx> | null;
        if (rc) setCtx((cur) => {
          const next = { ...cur };
          (Object.keys(next) as (keyof typeof next)[]).forEach((k) => { const v = rc[k]; if (typeof v === "string" && v.trim()) next[k] = v; });
          return next;
        });
        if (typeof data.picture === "string" && data.picture.trim()) { setPicture(data.picture); setChatDone(true); }
        const tr = (data.transcript ?? []) as { role: "q" | "a"; text: string }[];
        if (tr.length) setChat(tr);
        const m = (data.matches ?? []) as CompCand[];
        if (m.length) setComps(m);  // keep them; the resume banner offers to jump to review
        if (m.length || tr.length || data.picture) {
          setSavedRun({ comps: m, at: new Date(data.updated_at).getTime(), transcript: tr, picture: (data.picture as string) || "", context: (rc ?? undefined) as typeof ctx | undefined });
        }
      }
    } catch { /* ignore */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const loadFromRecords = useCallback(async (force = false) => {
      let prodLine = "", whoLine = "", posLine = "", problemLine = "", industriesLine = "", competitorsLine = "", moreLine = "";
      // Product record: the REAL template keys (what_it_is / who_its_for /
      // problem / category), with the legacy seed keys (overview / value_prop)
      // as fallback — not just value_prop, which products don't carry.
      let featLine = "", modulesText = "";
      const { data: p } = await supabase.from("product_records").select("id, name").order("created_at").limit(1).maybeSingle();
      if (p) {
        const [{ data: fs }, { data: mods }] = await Promise.all([
          supabase.from("record_fields").select("field_key, value").eq("product_id", p.id)
            .in("field_key", ["what_it_is", "who_its_for", "problem", "category", "value_prop", "overview", "core_capabilities", "differentiated_capabilities", "strategic_intent"]),
          supabase.from("modules").select("id, name, description").eq("product_id", p.id).order("position").order("created_at"),
        ]);
        // The SPECIFIC features under each module (Modules → Features) — the real
        // product detail the search needs. Previously only module NAMES were read,
        // which is why the profile listed no actual features. Pull them, grouped.
        const modIds = (mods ?? []).map((m) => m.id);
        const { data: feats } = modIds.length
          ? await supabase.from("features").select("module_id, name, description").in("module_id", modIds).order("created_at")
          : { data: [] as { module_id: string; name: string; description: string | null }[] };
        const featsByMod: Record<string, { name: string; description: string | null }[]> = {};
        for (const ft of feats ?? []) (featsByMod[ft.module_id] ??= []).push(ft);
        const moduleLines = (mods ?? []).map((m) => {
          const fl = (featsByMod[m.id] ?? []).map((ft) => ft.description ? `${ft.name} (${ft.description})` : ft.name);
          const head = m.description ? `${m.name} — ${m.description}` : m.name;
          return fl.length ? `${head} · features: ${fl.join(", ")}` : head;
        });
        modulesText = moduleLines.join("\n");                  // full, for the records dump
        const f = (k: string) => fs?.find((x) => x.field_key === k)?.value ?? null;
        const what = f("what_it_is") ?? f("value_prop") ?? f("overview");
        setProd({ name: p.name, value_prop: what });
        prodLine = `${p.name}${what ? ` — ${what}` : ""}${f("category") ? ` (category: ${f("category")})` : ""}${f("strategic_intent") ? `. Strategic intent: ${f("strategic_intent")}` : ""}`;
        if (f("who_its_for")) whoLine = f("who_its_for") as string;
        if (f("problem")) problemLine = `Problem it solves: ${f("problem")}`;
        // Features window = every module WITH its features + the capability fields.
        const capBits = [f("core_capabilities"), f("differentiated_capabilities")].filter(Boolean) as string[];
        featLine = [...moduleLines, ...capBits].join("; ");
      } else setProd(null);
      // GTM record: personas/icp (who we sell to) + positioning (against what).
      const { data: g } = await supabase.from("gtm_records").select("id, name").order("created_at").limit(1).maybeSingle();
      if (g) {
        const { data: fs } = await supabase.from("record_fields").select("field_key, value").eq("gtm_record_id", g.id)
          .in("field_key", ["personas", "primary_persona", "icp", "positioning", "category_pov", "differentiation", "industries", "key_competitors", "value_prop", "pillars", "win_themes", "gtm_motion", "pricing_model"]);
        const f = (k: string) => fs?.find((x) => x.field_key === k)?.value ?? null;
        const personas = f("personas") ?? f("primary_persona") ?? f("icp");
        const positioning = f("positioning") ?? f("category_pov");
        setGtm({ name: g.name, personas, positioning });
        // Richer profile: COMBINE the related GTM fields so each window (and the
        // search) reflects the depth of the record, not one thin line.
        whoLine = [whoLine, f("primary_persona"), f("icp")].filter(Boolean).join(" · ") || whoLine;
        posLine = [f("positioning"), f("category_pov"), f("differentiation")].filter(Boolean).join(" · ") || posLine;
        // Industries (verticals) and key competitors have canonical GTM fields, so
        // they pre-fill from the record and survive a competitive-board clear.
        industriesLine = f("industries") ?? "";
        competitorsLine = f("key_competitors") ?? "";
        // The "Also" window carries our motion/pricing/win-themes — strong signal
        // for who actually competes with us and how.
        moreLine = [
          f("value_prop") && `Value prop: ${f("value_prop")}`,
          f("pillars") && `Message pillars: ${f("pillars")}`,
          f("win_themes") && `Win themes: ${f("win_themes")}`,
          f("gtm_motion") && `GTM motion (how they message): ${f("gtm_motion")}`,
          f("pricing_model") && `Pricing: ${f("pricing_model")}`,
        ].filter(Boolean).join(" · ");
      } else setGtm(null);
      // The full dump: EVERY field on both records + every module, labeled —
      // the complete picture the records can paint on their own.
      const dump: string[] = [];
      if (p) {
        dump.push(`PRODUCT RECORD: ${p.name}`);
        const { data: allPf } = await supabase.from("record_fields").select("label, value").eq("product_id", p.id).order("position");
        for (const f of allPf ?? []) if (f.value?.trim()) dump.push(`${f.label}: ${f.value}`);
        // Modules WITH their specific features (built above) — the concrete surface
        // area the search compares against, not just module headings.
        if (modulesText.trim()) dump.push(`MODULES & FEATURES:\n${modulesText}`);
      }
      if (g) {
        dump.push(`\nGTM RECORD: ${g.name}`);
        const { data: allGf } = await supabase.from("record_fields").select("label, value").eq("gtm_record_id", g.id).order("position");
        for (const f of allGf ?? []) if (f.value?.trim()) dump.push(`${f.label}: ${f.value}`);
      }
      setRecordsDump(dump.join("\n"));
      // Pre-fill the EDITABLE fields from the records — the human can adjust,
      // add, or rewrite everything before anything runs. Never overwrite typing.
      // Force (Clear & rebuild) overwrites the windows with the CURRENT records,
      // discarding any picture/interview enrichments; on mount we only fill empties
      // so we never clobber what the user is typing.
      const derived = {
        product: [prodLine, problemLine].filter(Boolean).join(" "),
        features: featLine, who: whoLine, industries: industriesLine,
        positioning: posLine, more: moreLine, competitors: competitorsLine,
      };
      setCtx((cur) => force ? { ...cur, ...derived } : {
        product: cur.product.trim() ? cur.product : derived.product,
        features: cur.features.trim() ? cur.features : derived.features,
        who: cur.who.trim() ? cur.who : derived.who,
        industries: cur.industries.trim() ? cur.industries : derived.industries,
        positioning: cur.positioning.trim() ? cur.positioning : derived.positioning,
        more: cur.more.trim() ? cur.more : derived.more,
        competitors: cur.competitors.trim() ? cur.competitors : derived.competitors,
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);
  useEffect(() => { void loadFromRecords(false); }, [loadFromRecords]);

  // Persist the run — upsert into the governed layer so matches survive.
  async function persistRun(patch: { comps?: CompCand[]; transcript?: { role: "q" | "a"; text: string }[]; picture?: string }) {
    try {
      const orgId = await getOrgId(); if (!orgId) return;
      const row = {
        org_id: orgId, product_id: productId ?? null, status: "open",
        context: ctx, picture: patch.picture ?? picture ?? null,
        transcript: patch.transcript ?? chat, matches: patch.comps ?? comps,
        settings: { max_questions: maxQuestions, target_matches: targetMatches },
      };
      if (runId) await supabase.from("competitive_setup_runs").update(row).eq("id", runId);
      else { const { data } = await supabase.from("competitive_setup_runs").insert(row).select("id").single(); if (data) setRunId(data.id); }
    } catch { /* best-effort */ }
  }

  // Durably persist the human-owned market context (industries + the named
  // competitors) onto the GTM RECORD — not just the competitive_setup_run. These
  // are the user's own inputs about their own market, so they go through the
  // sanctioned human edit channel (human_set_field_value / human_add_fields), NOT
  // the proposal gate. This is the fix for "industries & competitors revert to
  // nothing": they now live on the record, pre-fill from it, and survive a
  // competitive-board clear. Best-effort; the wizard never fails on this.
  async function persistContextToRecords() {
    try {
      const { data: g } = await supabase.from("gtm_records").select("id").order("created_at").limit(1).maybeSingle();
      if (!g) return;
      const { data: rf } = await supabase.from("record_fields").select("id, field_key").eq("gtm_record_id", g.id).in("field_key", ["industries", "key_competitors"]);
      const want: [string, string, string, string][] = [
        ["industries", "Industries / verticals", ctx.industries.trim(), "Buyer"],
        ["key_competitors", "Key competitors", ctx.competitors.trim(), "Positioning"],
      ];
      const adds: Record<string, unknown>[] = [];
      for (const [field_key, label, value, section] of want) {
        if (!value) continue;                                  // never clobber a filled field with a blank
        const ex = rf?.find((x) => x.field_key === field_key);
        if (ex) await supabase.rpc("human_set_field_value", { p_field: ex.id, p_value: value });
        else adds.push({ gtm_record_id: g.id, field_key, label, value, section });
      }
      if (adds.length) await supabase.rpc("human_add_fields", { p_rows: adds });
    } catch { /* best-effort — the human edit channel is allowed; failures shouldn't block setup */ }
  }

  // Save context as it changes (debounced) — so industries/competitors and the
  // rest survive even if a search is interrupted before it finishes. Only once
  // there's something worth saving.
  useEffect(() => {
    if (step > 2) return;
    if (!Object.values(ctx).some((v) => v.trim())) return;
    const t = setTimeout(() => { void persistRun({}); }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  // What the agent searches from = exactly what's in the editable fields.
  const marketCtx = [
    picture.trim() ? `FULL PICTURE:\n${picture.trim()}` : "",
    ctx.product.trim() ? `Our product: ${ctx.product.trim()}` : "",
    ctx.features.trim() ? `Key features / modules (for capability overlap): ${ctx.features.trim()}` : "",
    ctx.who.trim() ? `Who we sell to (personas): ${ctx.who.trim()}` : "",
    ctx.industries.trim() ? `Industries / verticals: ${ctx.industries.trim()}` : "",
    ctx.positioning.trim() ? `How we position / against what: ${ctx.positioning.trim()}` : "",
    ctx.competitors.trim() ? `KNOWN COMPETITORS (user-named — verify these first, then search beyond them): ${ctx.competitors.trim()}` : "",
    ctx.more.trim() ? `Also: ${ctx.more.trim()}` : "",
    // Ground the search in the FULL product & GTM records — the real depth lives
    // there (strategy, motion, pricing, technical, differentiation), not in the
    // distilled fields above. Without this the search reasons off thin summaries.
    recordsDump.trim() ? `\nOUR FULL PRODUCT & GTM RECORDS (the authoritative detail — weigh these heavily):\n${recordsDump.trim()}` : "",
  ].filter(Boolean).join("\n");

  // invoke with REAL errors: a non-2xx from the function carries its message in
  // the response body — surface that, never the generic "non-2xx status code".
  const invoke = async (body: Record<string, unknown>) => {
    const { data: s } = await supabase.auth.getSession();
    const token = s.session?.access_token;
    const { data, error } = await supabase.functions.invoke("setup-competitive", {
      body, headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (error) {
      const resp = (error as { context?: Response }).context;
      if (resp && typeof resp.json === "function") {
        const body = await resp.clone().json().catch(() => null) as { error?: string } | null;
        if (body?.error) throw new Error(body.error);
        if (resp.status === 546 || resp.status === 504) throw new Error("The search ran past the server time limit — try again; it usually completes on a retry.");
      }
      throw error;
    }
    if (data?.error) throw new Error(data.error);
    return data;
  };
  // One automatic retry for the long phases — transient timeouts shouldn't
  // cost the user their flow.
  const invokeRetry = async (body: Record<string, unknown>) => {
    try { return await invoke(body); }
    catch { return await invoke(body); }
  };

  // ---- chat drill-down: ask → answer → ask … → paint the full picture --------
  async function nextQuestion(history: { role: "q" | "a"; text: string }[]) {
    setChatBusy(true); setError(null);
    try {
      const data = await askRun.go(() => invoke({ step: "interview", records: recordsDump, transcript: history, max_questions: maxQuestions }));
      const r = Math.min(100, Math.max(0, Math.round(Number(data.readiness) || 0)));
      setReady((prev) => { setReadyDelta(prev !== null ? r - prev : null); return r; });
      setGaps((data.gaps as string) || "");
      if (Array.isArray(data.coverage)) setCoverage(data.coverage as Cov[]);
      if (data.done || !data.question) { setChatDone(true); setChatWhy(null); await paintPicture(history); }
      else { const next = [...history, { role: "q" as const, text: data.question }]; setChat(next); setChatWhy(data.why || null); void persistRun({ transcript: next }); }
    } catch (e) { setError(e instanceof Error ? e.message : "The interviewer stalled."); }
    finally { setChatBusy(false); }
  }
  function openChat() {
    setChatOpen(true);
    if (chat.length === 0 && !chatBusy) void nextQuestion([]);
  }
  // Ask one more, even after it called itself done — raises the budget by one
  // and re-engages from the current transcript. This is the 'continue' path.
  function askAnother() {
    setChatDone(false);
    setMaxQuestions((q) => Math.max(q + 1, chat.filter((m) => m.role === "q").length + 1));
    void nextQuestion(chat);
  }
  // Go back: re-open a previous answer (partial or wrong), discard everything
  // after it, and continue the interview from there. The question that prompted
  // it stays on screen; readiness re-scores on the next send.
  function editAnswer(i: number) {
    if (chatBusy) return;
    const prev = chat[i];
    if (prev?.role !== "a") return;
    setAnswer(prev.text);
    setChat(chat.slice(0, i));   // keep the question, drop this answer + all that followed
    setChatDone(false); setPicture(""); setReadyDelta(null); setChatWhy(null);
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
      const data = await pictureRun.go(() => invoke({ step: "picture", records: recordsDump, transcript: history }));
      setPicture(data.picture || "");
      // MERGE, don't overwrite: a field the picture returns fills its box; a
      // field it leaves empty keeps whatever the records/you already had — so
      // an answered industry/competitor lands without wiping anything else.
      setCtx((cur) => ({
        product: (data.product || "").trim() || cur.product,
        features: (data.features || "").trim() || cur.features,
        who: (data.who || "").trim() || cur.who,
        industries: (data.industries || "").trim() || cur.industries,
        positioning: (data.positioning || "").trim() || cur.positioning,
        more: (data.more || "").trim() || cur.more,
        competitors: (data.known_competitors || "").trim() || cur.competitors,
      }));
      setChatDone(true);
      // Fill the FULL product & GTM record from what the interview surfaced —
      // empty fields auto-apply; differences to already-filled fields are proposed.
      if (history.length > 0) void applyRecordUpdates((data.record_updates ?? []) as { scope?: string; field_key?: string; value?: string }[]);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not paint the picture."); }
    finally { setChatBusy(false); }
  }
  const [profileNote, setProfileNote] = useState<string | null>(null);
  // Fill the FULL product & GTM record from what the interview surfaced. The
  // picture step returns record_updates over the canonical field set (product
  // strategy, GTM motion, pricing, positioning, …); each is routed to the RIGHT
  // field on the RIGHT record. EMPTY fields auto-apply through the human edit
  // channel — so answering the questions leaves a complete record. A field that
  // already holds curated content is NEVER clobbered: a differing value lands as
  // a proposal you accept in the record's drawer. Invalid/invented keys are
  // dropped (validated against RECORD_FIELD_META).
  async function applyRecordUpdates(updates: { scope?: string; field_key?: string; value?: string }[]) {
    try {
      if (!Array.isArray(updates) || !updates.length) return;
      const orgId = await getOrgId(); if (!orgId) return;
      const [{ data: prodRec }, { data: g }] = await Promise.all([
        supabase.from("product_records").select("id").order("created_at").limit(1).maybeSingle(),
        supabase.from("gtm_records").select("id").order("created_at").limit(1).maybeSingle(),
      ]);
      const recordId: Record<"product" | "gtm", string | undefined> = { product: prodRec?.id, gtm: g?.id };
      const byScope: Record<"product" | "gtm", { field_key: string; value: string; label: string; section: string }[]> = { product: [], gtm: [] };
      for (const u of updates) {
        const meta = u.field_key ? RECORD_FIELD_META[u.field_key] : undefined;
        if (!meta || meta.scope !== u.scope) continue;             // only canonical, correctly-scoped keys
        const v = (u.value ?? "").trim(); if (!v) continue;
        byScope[meta.scope].push({ field_key: u.field_key!, value: v, label: meta.label, section: meta.section });
      }
      let applied = 0, queued = 0;
      for (const scope of ["product", "gtm"] as const) {
        const rid = recordId[scope]; const items = byScope[scope];
        if (!rid || !items.length) continue;
        const col = scope === "product" ? "product_id" : "gtm_record_id";
        const { data: rf } = await supabase.from("record_fields").select("id, field_key, value").eq(col, rid);
        const adds: Record<string, unknown>[] = [];
        const propose: { id: string; old: string | null; value: string }[] = [];
        for (const it of items) {
          const ex = rf?.find((f) => f.field_key === it.field_key);
          const existing = (ex?.value ?? "").trim();
          if (existing === it.value) continue;                     // already current
          if (!existing) {                                         // empty or absent → auto-apply
            if (ex) { await supabase.rpc("human_set_field_value", { p_field: ex.id, p_value: it.value }); applied++; }
            else adds.push({ [col]: rid, field_key: it.field_key, label: it.label, value: it.value, section: it.section });
          } else if (ex) {                                         // filled + different → propose, don't clobber
            propose.push({ id: ex.id, old: ex.value, value: it.value });
          }
        }
        if (adds.length) { await supabase.rpc("human_add_fields", { p_rows: adds }); applied += adds.length; }
        if (propose.length) {
          const { data: prop } = await supabase.from("proposals").insert({
            org_id: orgId, [col]: rid, title: `Setup learnings → ${scope === "product" ? "product" : "GTM"} record`,
            rationale: "The guided-setup interview surfaced detail that differs from what this field already holds. Accept to update it — your current wording stands until you do.",
            proposed_by: "Setup interview", status: "pending",
          }).select("id").single();
          if (prop) {
            await supabase.from("proposal_changes").insert(propose.map((c) => ({
              org_id: orgId, proposal_id: prop.id, change_kind: "update_field",
              record_field_id: c.id, old_value: c.old, field_key: null, label: null, proposed_value: c.value,
            })));
            queued += propose.length;
          }
        }
      }
      if (applied || queued) {
        const bits = [applied ? `${applied} field${applied === 1 ? "" : "s"} filled automatically` : "", queued ? `${queued} change${queued === 1 ? "" : "s"} to already-filled fields await review` : ""].filter(Boolean).join(" · ");
        setProfileNote(`Product & GTM records updated from your answers — ${bits}.${queued ? " The proposals are in each record's drawer." : ""}`);
      }
    } catch { /* best-effort: the wizard flow never fails on record persistence */ }
  }

  // ---- step 2: propose rivals (web search), confirm, insert ------------------
  async function findCompetitors() {
    setBusy("comps"); setError(null); setSearchUsage(null); setSearchSecs(0);
    await persistRun({});   // save context first — a search interruption can't lose it
    void persistContextToRecords();   // and durably onto the GTM record (industries + competitors)
    const t0 = Date.now();
    const tick = setInterval(() => setSearchSecs(Math.round((Date.now() - t0) / 1000)), 1000);
    try {
      // Each advance below is a REAL transition: profile composed → live search
      // in flight → resolved → scoring in flight → resolved → ranked.
      setSearchStep(1); // profile (step 0) is composed at fire time — ✓ immediately, search in flight
      const land = await invokeRetry({ step: "landscape", market: marketCtx, target_matches: targetMatches, product: { name: prod?.name, value_prop: prod?.value_prop } });
      const u1 = (land.usage ?? { input: 0, output: 0 }) as { input: number; output: number };
      setSearchStep(2); // briefing in hand — scoring in flight
      const data = await invokeRetry({ step: "competitors", market: marketCtx, briefing: land.briefing, target_matches: targetMatches, product: { name: prod?.name, value_prop: prod?.value_prop } });
      const u2 = (data.usage ?? { input: 0, output: 0 }) as { input: number; output: number };
      setSearchUsage({ input: u1.input + u2.input, output: u1.output + u2.output });
      setSearchStep(3); // ranking (client-side, instant)
      const list = (data.competitors ?? []) as Omit<CompCand, "keep">[];
      if (!list.length) throw new Error("No rivals found — try describing the market more specifically.");
      const found = list.map((c) => ({ ...c, keep: true }));
      setComps(found); setStep(2);
      void persistRun({ comps: found });
    } catch (e) { setError(e instanceof Error ? e.message : "The landscape search failed."); }
    finally { clearInterval(tick); setSearchStep(null); setBusy(null); }
  }
  // Keep the stash in sync with edits made while reviewing (so leaving mid-
  // review is also resumable). Only while on the candidate step.
  useEffect(() => {
    if (step !== 2 || comps.length === 0) return;
    void persistRun({ comps });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comps, step]);
  function resumeMatches() {
    if (!savedRun) return;
    if (savedRun.context) setCtx(savedRun.context);
    if (savedRun.transcript?.length) setChat(savedRun.transcript);
    if (savedRun.picture) setPicture(savedRun.picture);
    if (savedRun.comps?.length) { setComps(savedRun.comps); setStep(2); }
  }
  async function clearSavedRun(status: "discarded" | "confirmed" = "discarded") {
    try { if (runId) await supabase.from("competitive_setup_runs").update({ status }).eq("id", runId); } catch { /* ignore */ }
    setRunId(null); setSavedRun(null);
  }

  // Clear the interview answers + synthesized picture so a fresh, fuller profile
  // can be built from scratch (the records base stays). Discards the open run so
  // the old answers don't auto-restore. The user then re-runs "Set up profile".
  async function clearProfile() {
    setChat([]); setAnswer(""); setPicture(""); setChatDone(false);
    setReady(null); setReadyDelta(null); setGaps(""); setCoverage([]); setChatWhy(null);
    await clearSavedRun("discarded");
    await loadFromRecords(true);   // reset the profile windows to the CURRENT records (drop picture enrichments)
    setProfileNote("Cleared — the profile is reset to your records. Run “✦ Set up profile with AI” to layer a fresh, fuller profile on top.");
  }

  async function confirmCompetitors() {
    const keep = comps.filter((c) => c.keep && c.name.trim());
    if (!keep.length) { setError("Keep at least one competitor (or add your own)."); return; }
    setBusy("save-comps"); setError(null);
    try {
      const orgId = await getOrgId(); if (!orgId) throw new Error("Could not resolve your organization.");
      const { data, error } = await supabase.from("competitors").insert(keep.map((c, i) => ({
        org_id: orgId, name: c.name.trim(), relationship: ["adjacent", "watching"].includes(c.relationship) ? c.relationship : "direct",
        website: c.website.trim() || null,
        // Carry the discovered LinkedIn URL onto the competitor itself — the
        // per-competitor Finalize flow (and its monitors) reuse it instead of
        // re-finding it. Previously it was only spent on sources and discarded.
        linkedin: c.linkedin.trim() || null,
        // The pulled overview IS the record: who they are, then the match rationale.
        notes: [c.overview, c.why, c.overlap ? `Overlap: ${c.overlap}` : "", c.match < 100 ? `Match at setup: ${c.match}%` : ""].filter(Boolean).join("\n") || null,
        position: i, product_id: productId ?? null,
      }))).select("id, name, website, linkedin");
      if (error) throw error;
      // LinkedIn now persists on the competitor row; keep the same shape for the
      // monitoring step (it reads c.linkedin to seed jobs/posts sources).
      const withLi = (data ?? []).map((d) => ({ ...d, linkedin: d.linkedin ?? (keep.find((k) => k.name.trim() === d.name)?.linkedin.trim() || null) }));
      setSavedComps(withLi);
      void clearSavedRun("confirmed");
      // LEGIT monitoring only: a kind is on ONLY when its confirmed link exists —
      // website needs the site URL; jobs/posts need the LinkedIn page. Press is
      // name-anchored search (no link needed).
      const m: Record<string, Set<string>> = {};
      for (const c of withLi) m[c.id] = new Set(MONITOR_KINDS.map(([k]) => k).filter((k) =>
        k === "press" ? true : k === "website" ? !!c.website : !!c.linkedin));
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
  // Confirm/fix the links right here — website persists to the competitor row;
  // linkedin feeds the source config. resolveTarget shows the EXACT URL/aim a
  // source will use, so a checkbox is never a black box.
  const setCompLink = (id: string, field: "website" | "linkedin", val: string) =>
    setSavedComps((cs) => cs.map((c) => c.id === id ? { ...c, [field]: val } : c));
  async function saveCompWebsite(id: string, val: string) {
    try { await supabase.from("competitors").update({ website: val.trim() || null }).eq("id", id); } catch { /* best-effort */ }
  }
  function resolveTarget(c: { name: string; website: string | null; linkedin: string | null }, k: string): { url: string | null; aim: string } {
    if (k === "website") return { url: c.website || null, aim: c.website || "needs the website URL" };
    if (k === "press") return { url: null, aim: `web search · "${c.name}" press, funding, launches, exec moves` };
    if (k === "linkedin_jobs") return { url: c.linkedin ? c.linkedin.replace(/\/+$/, "") + "/jobs" : null, aim: c.linkedin ? c.linkedin.replace(/\/+$/, "") + "/jobs" : "needs the LinkedIn URL" };
    if (k === "linkedin_posts") return { url: c.linkedin || null, aim: c.linkedin || "needs the LinkedIn URL" };
    return { url: null, aim: "" };
  }

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
            config: kind === "website" && c.website ? { url: c.website }
              : kind === "linkedin_jobs" && c.linkedin ? { url: c.linkedin.replace(/\/+$/, "") + "/jobs" }
              : kind === "linkedin_posts" && c.linkedin ? { url: c.linkedin }
              : null,
            guidance: kindGuide[kind]?.trim() || null,
            competitor_id: c.id,
          });
        }
      }
      for (const x of extraLinks) {
        const c = savedComps.find((sc) => sc.id === x.compId); if (!c || !x.url.trim()) continue;
        const isLi = /linkedin\.com/i.test(x.url);
        const def = CATALOG_BY_KIND[isLi ? "linkedin_posts" : "website"]; if (!def) continue;
        rows.push({
          org_id: orgId, label: `${c.name} — ${x.url.replace(/^https?:\/\//, "").slice(0, 40)}`, icon: def.icon,
          origin: "external", kind: isLi ? "linkedin_posts" : "website", status: "connected", auth_mode: def.authMode, access_scope: def.accessScope,
          focus: "both", max_per_pull: def.defaultMaxPerPull, cadence,
          config: { url: x.url.trim() },
          guidance: isLi ? "Go through this specific LinkedIn area thoroughly." : "Read this page fully — everything decision-useful on it.",
          competitor_id: c.id,
        });
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
      setPullLog((l) => [...l, { text: `${src.label}` }]);
      try {
        await pullRun.go(async () => {
          const { data, error } = await supabase.functions.invoke("connector-runner", {
            body: { source_id: src.id }, headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          });
          if (error) throw error;
          if (data?.error) throw new Error(data.error);
          const candidates = (data.created ?? 0) + (data.dropped ?? 0);
          setPullLog((l) => [...l.slice(0, -1), {
            text: `${src.label} — fetched ${data.fetched ?? 0} · ${data.quarantined ? `⚠ ${data.quarantined} quarantined · ` : ""}${candidates} distilled · ${data.dropped ?? 0} below the bar → ${data.created ?? 0} landed`, ok: true,
            signals: (data.signals ?? []) as { title: string; relevance: number }[],
          }]);
        });
      } catch (e) {
        setPullLog((l) => [...l.slice(0, -1), { text: `${src.label} — ${e instanceof Error ? e.message : "failed"}`, ok: false }]);
      }
    }
    // Signals landed → synthesize immediately, so setup ends with CONTENT:
    // themes on the competitors, proposals in review — not just raw rows.
    setPullLog((l) => [...l, { text: "Synthesizing signals into themes…" }]);
    try {
      const { data, error } = await supabase.functions.invoke("synthesize-signals", { body: {}, headers: token ? { Authorization: `Bearer ${token}` } : undefined });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setPullLog((l) => [...l.slice(0, -1), { text: "Synthesis complete — themes are forming on your competitors; high-judgment changes await you in Signals → Review", ok: true }]);
    } catch (e) {
      setPullLog((l) => [...l.slice(0, -1), { text: `Synthesis: ${e instanceof Error ? e.message : "failed"} — run it from the Signal feed`, ok: false }]);
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
          {/* The durable gauge: derived from records + matrix + signal flow, so it
              updates as the company evolves — the chat's session score is only a
              conversation aid. */}
          <ProfileReadiness nonce={chat.length + (picture ? 1 : 0)} />
          {/* The profile as WINDOWS — sideways-scrolling pages instead of a sea of
              text. Each window is one facet; swipe/scroll right for the next.
              ✎ Edit opens the popup where every line can be adjusted, added to,
              or eliminated. */}
          <div>
            <div className="row-between" style={{ marginBottom: 6 }}>
              <span className="t-label" style={{ color: "var(--tm)" }}>Your profile — scroll sideways for more →</span>
              <span className="row gap-2">
                {(chat.length > 0 || picture) && <button className="btn btn-secondary btn-sm" onClick={clearProfile} title="Clear the interview answers and synthesized picture, then rebuild a fresh profile from your records">↺ Clear &amp; rebuild</button>}
                <button className="btn btn-secondary btn-sm" onClick={() => setEditCtx(true)}>✎ Edit</button>
              </span>
            </div>
            {marketCtx || picture ? (
              <div style={{ display: "flex", gap: "var(--sp-3)", overflowX: "auto", scrollSnapType: "x mandatory", paddingBottom: 8, WebkitOverflowScrolling: "touch" }}>
                {picture && (
                  <div className="card card-pad" style={{ flex: "0 0 380px", scrollSnapAlign: "start", borderTop: "3px solid var(--ac)", maxHeight: 230, overflowY: "auto" }}>
                    <div className="t-label" style={{ color: "var(--ac-text, var(--ac))", marginBottom: 6 }}>✦ The full picture</div>
                    <div className="t-sub" style={{ fontSize: 12.5, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{picture}</div>
                    {profileNote && <div className="t-mono-xs" style={{ marginTop: 6, color: "var(--gn-text, var(--gn-text))" }}>✓ {profileNote}</div>}
                  </div>
                )}
                {([
                  ["Product", "What it is", ctx.product, "Add what the product is and the problem it solves."],
                  ["Features", "Modules & capabilities", ctx.features, "What it actually does — drives capability-overlap matching."],
                  ["Personas", "Who you sell to", ctx.who, "The people who decide deals."],
                  ["Industries", "Verticals", ctx.industries, "Key for who actually competes for your buyer — worth filling."],
                  ["Positioning", "Against what", ctx.positioning, "The category you claim and what you replace."],
                  ["Competitors", "Known rivals", ctx.competitors, "Name them — they anchor the whole search."],
                  ["Notes", "Anything else", ctx.more, ""],
                ] as const).map(([title, sub, v, hint]) => (v.trim() || hint) && (
                  <div key={title} className="card card-pad" style={{ flex: "0 0 250px", scrollSnapAlign: "start", maxHeight: 230, overflowY: "auto", opacity: v.trim() ? 1 : 0.75, borderTop: v.trim() ? "3px solid var(--border-strong, var(--border))" : "3px dashed var(--border)", cursor: "pointer" }}
                    onClick={() => setEditCtx(true)} title="Click to edit">
                    <div className="t-label" style={{ color: "var(--tm)" }}>{title}</div>
                    <div className="t-mono-xs t-muted" style={{ marginBottom: 6 }}>{sub}</div>
                    {v.trim()
                      ? <div className="t-sub" style={{ fontSize: 12.5, lineHeight: 1.55 }}>{v}</div>
                      : <div className="t-sub t-muted" style={{ fontSize: 12 }}>{hint} <span style={{ color: "var(--ac-text, var(--ac))", fontWeight: 600 }}>✎ Add</span></div>}
                  </div>
                ))}
              </div>
            ) : (
              <div className="card card-pad t-sub t-muted" style={{ fontSize: 12.5 }}>
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
              <label className="field"><span className="t-label">Known competitors <span className="t-muted" style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>— name them; they anchor the search</span></span>
                <input className="input" value={ctx.competitors} onChange={ctxSet("competitors")} placeholder="e.g. Crayon, Klue, Productboard" /></label>
              <label className="field"><span className="t-label">Anything else</span>
                <input className="input" value={ctx.more} onChange={ctxSet("more")} placeholder="e.g. also watch the open-source alternatives" /></label>
              <div className="row gap-2"><button className="btn btn-sm" onClick={() => { setEditCtx(false); void persistContextToRecords(); }}>Done</button></div>
            </div>
          </Modal>
          {searchStep !== null ? (
            <div className="card card-pad" style={{ borderLeft: "3px solid var(--ac)" }}>
              <div className="row-between" style={{ alignItems: "baseline", marginBottom: 8 }}>
                <span className="t-label" style={{ color: "var(--tm)" }}>Finding your competitors</span>
                <span className="t-mono-xs t-muted">{searchSecs}s</span>
              </div>
              <div className="stack-2">
                {SEARCH_STEPS.map((label, i) => {
                  const state = i < searchStep ? "done" : i === searchStep ? "active" : "pending";
                  return (
                    <div key={i} className="row gap-2" style={{ alignItems: "center", opacity: state === "pending" ? 0.45 : 1 }}>
                      {state === "done" && <span style={{ width: 16, textAlign: "center", color: "var(--gn-text, var(--gn-text))", fontWeight: 700, fontSize: 12 }}>✓</span>}
                      {state === "active" && <span style={{ width: 16, display: "inline-flex", justifyContent: "center" }}><span className="agent-progress-dot" aria-hidden /></span>}
                      {state === "pending" && <span style={{ width: 16, textAlign: "center", color: "var(--tm)", fontSize: 11 }}>○</span>}
                      <span style={{ fontSize: 12.5, fontWeight: state === "active" ? 650 : 500, color: state === "active" ? "var(--tp)" : "var(--ts)" }}>{label}{state === "active" ? "…" : ""}</span>
                    </div>
                  );
                })}
              </div>
              <div className="t-mono-xs t-muted" style={{ marginTop: 8 }}>≤3 web searches, capped tokens · typically 20–40s</div>
            </div>
          ) : (<>
            {savedRun && (savedRun.comps?.length || savedRun.transcript?.length) && step === 1 ? (
              <div className="card card-pad" style={{ background: "var(--panel-2)", borderLeft: "3px solid var(--ac)" }}>
                <div className="row-between" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span className="t-sub" style={{ fontSize: 12.5 }}>
                    {savedRun.comps?.length ? <><b>{savedRun.comps.length} matches</b> saved</> : <><b>interview in progress</b></>} from a previous run ({new Date(savedRun.at).toLocaleString()}) — picks up across devices.
                  </span>
                  <span className="row gap-2">
                    <button className="btn btn-sm" onClick={resumeMatches}>↩ Resume</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => clearSavedRun()}>Discard</button>
                  </span>
                </div>
              </div>
            ) : null}
            {/* Governance: the run's two budgets, the user's to set. */}
            <div className="row gap-2" style={{ flexWrap: "wrap", alignItems: "center", fontSize: 12.5 }}>
              <span className="t-mono-xs t-muted">Run settings:</span>
              <label className="row gap-2" style={{ alignItems: "center" }}>
                <span className="t-mono-xs">max questions</span>
                <select className="select" value={maxQuestions} onChange={(e) => setMaxQuestions(Number(e.target.value))} style={{ padding: "2px 6px", fontSize: 12, height: "auto", width: "auto" }}>
                  <option value={0}>0 — records only</option><option value={4}>4</option><option value={6}>6</option><option value={8}>8</option><option value={10}>10</option>
                </select>
              </label>
              <label className="row gap-2" style={{ alignItems: "center" }}>
                <span className="t-mono-xs">matches per run</span>
                <select className="select" value={targetMatches} onChange={(e) => setTargetMatches(Number(e.target.value))} style={{ padding: "2px 6px", fontSize: 12, height: "auto", width: "auto" }}>
                  <option value={5}>5</option><option value={8}>8</option><option value={10}>10</option><option value={15}>15</option>
                </select>
              </label>
              <span className="t-mono-xs t-muted">— the interview defers to your records and stops at the budget.</span>
            </div>
            <div className="row gap-2">
              <button className="btn btn-secondary btn-sm" disabled={maxQuestions === 0} onClick={openChat} title={maxQuestions === 0 ? "Set max questions above 0 to set up the profile" : "AI interviews you to build (or sharpen) your profile, then fills your product & GTM records"}>{picture ? "✦ Refine profile with AI" : chat.length ? "✦ Continue setting up the profile" : "✦ Set up profile with AI"}</button>
              <button className="btn btn-sm" disabled={!marketCtx} onClick={findCompetitors}
                title={picture ? "Search from the confirmed full picture" : "You can search now, or drill down first for a sharper match"}>
                {savedRun?.comps?.length ? `✦ New search (${targetMatches} matches)` : `✦ Find my competitors (${targetMatches})`}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={onDone}>Skip — set up by hand</button>
            </div>
          </>)}

          {/* The drill-down — a side pop-out chat. The AI asks one discriminating
              question at a time (never re-asking what the records answer); the
              answer box is full-width and tall — you see everything you type. */}
          {chatOpen && (
            <>
              <div onClick={() => setChatOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(11,12,14,0.32)", zIndex: 40 }} />
              <aside style={{ position: "fixed", top: 0, right: 0, height: "100vh", width: 520, maxWidth: "94vw", background: "var(--panel)", borderLeft: "1px solid var(--border)", boxShadow: "var(--shadow-md)", zIndex: 41, display: "flex", flexDirection: "column" }}>
                <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }} className="row-between">
                  <span className="t-h2" style={{ fontSize: 15 }}>{picture ? "Refine your profile" : "Set up your profile"} — so the search gets specific</span>
                  <button className="btn btn-secondary btn-sm" onClick={() => setChatOpen(false)}>Close</button>
                </div>
                {ready !== null && (
                  <div style={{ padding: "10px 20px", borderBottom: "1px solid var(--border)" }}>
                    <div className="row-between" style={{ marginBottom: 5, alignItems: "baseline" }}>
                      <span className="t-label" style={{ color: "var(--tm)" }}>Search readiness</span>
                      <span className="row gap-2" style={{ alignItems: "baseline" }}>
                        {readyDelta !== null && readyDelta > 0 && <span className="t-mono-xs" style={{ color: "var(--gn-text, var(--gn-text))", fontWeight: 700 }}>+{readyDelta}</span>}
                        <span className="t-mono-xs" style={{ fontWeight: 700, color: ready >= 80 ? "var(--gn-text, var(--gn-text))" : ready >= 55 ? "var(--am-text)" : "var(--tm)" }}>{chatDone ? 100 : ready}%</span>
                      </span>
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: "var(--fill)", overflow: "hidden" }}>
                      <div style={{ width: `${chatDone ? 100 : ready}%`, height: "100%", borderRadius: 3, background: ready >= 80 || chatDone ? "var(--gn-text, var(--gn-text))" : ready >= 55 ? "var(--am-text, var(--am-text))" : "var(--ac)", transition: "width 0.4s ease" }} />
                    </div>
                    <div className="t-mono-xs t-muted" style={{ marginTop: 5 }}>
                      {chatDone ? "Specific enough — the picture is painted." : ready >= 80 ? "Good enough to move on — answer more only if you want a sharper cut." : gaps ? `Still thin: ${gaps}` : "Keep going — each answer narrows who you actually compete with."}
                    </div>
                    {coverage.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <div className="t-mono-xs t-muted" style={{ marginBottom: 4 }}>What the score is built from — hover for the evidence:</div>
                        <div className="row gap-2" style={{ flexWrap: "wrap" }}>
                          {coverage.slice().sort((a, b) => b.weight - a.weight).map((c) => {
                            const icon = c.status === "covered" ? "✓" : c.status === "partial" ? "◐" : c.status === "not_applicable" ? "–" : "○";
                            const col = c.status === "covered" ? "var(--gn-text, var(--gn-text))" : c.status === "partial" ? "var(--am-text, var(--am-text))" : c.status === "not_applicable" ? "var(--tm)" : "var(--rd-text, #B91C1C)";
                            const bg = c.status === "covered" ? "var(--gn-bg, #CDEBD6)" : "var(--fill)";
                            return (
                              <span key={c.dimension} className="t-mono-xs" title={`${c.status}${c.source !== "none" ? ` · from ${c.source}` : ""}${c.note ? `\n${c.note}` : ""}`}
                                style={{ padding: "2px 7px", borderRadius: 6, background: bg, color: col, fontWeight: 600, cursor: "default", opacity: c.status === "not_applicable" ? 0.6 : 1 }}>
                                {icon} {c.label}{c.source === "records" ? " ·rec" : c.source === "answer" ? " ·you" : ""}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }} className="stack-3">
                  {chat.map((m, i) => (
                    <div key={i} className="card card-pad" style={{ background: m.role === "q" ? "var(--panel-2)" : "var(--ac-fill, var(--fill))", marginLeft: m.role === "a" ? 32 : 0, marginRight: m.role === "q" ? 32 : 0 }}>
                      <div className="row-between" style={{ marginBottom: 3, alignItems: "baseline" }}>
                        <span className="t-mono-xs t-muted">{m.role === "q" ? "✦ AI" : "You"}</span>
                        {m.role === "a" && !chatBusy && (
                          <button className="t-mono-xs" onClick={() => editAnswer(i)} title="Edit this answer — the questions and answers after it are discarded and the interview continues from here"
                            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ac-text, var(--ac))", fontWeight: 600, padding: 0 }}>✎ Edit</button>
                        )}
                      </div>
                      <div style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{m.text}</div>
                    </div>
                  ))}
                  {chatWhy && !chatDone && <div className="t-mono-xs t-muted">Why this question: {chatWhy}</div>}
                  {askRun.active && <div className="card card-pad" style={{ background: "var(--panel-2)", marginRight: 32 }}><AgentStepList run={askRun} /></div>}
                  {pictureRun.active && <div className="card card-pad" style={{ background: "var(--panel-2)", marginRight: 32 }}><AgentStepList run={pictureRun} /></div>}
                  {chatDone && !chatBusy && (
                    <div className="card card-pad" style={{ borderLeft: "3px solid var(--gn-text, var(--gn-text))", fontSize: 12.5 }}>
                      Got what it needs — the full picture is on the setup screen. Review it, ✎ Edit anything (including any answer above), then ✦ Find my competitors.
                      <div className="row gap-2" style={{ marginTop: 8 }}>
                        <button className="btn btn-secondary btn-sm" onClick={askAnother}>✦ Ask another question</button>
                      </div>
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
                        style={(ready ?? 0) >= 80 ? { background: "var(--gn-text, var(--gn-text))", color: "#fff" } : undefined}
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
                    <option value="direct">Direct</option><option value="adjacent">Adjacent</option><option value="watching">Watching</option>
                  </select>
                  <input className="input" value={c.website} onChange={(e) => setComps(comps.map((x, j) => j === i ? { ...x, website: e.target.value } : x))} placeholder="https://their-site.com" style={{ flex: 1, minWidth: 140 }} title="Their website — found by the search; confirm or fix it" />
                  <input className="input" value={c.linkedin} onChange={(e) => setComps(comps.map((x, j) => j === i ? { ...x, linkedin: e.target.value } : x))} placeholder="linkedin.com/company/…" style={{ flex: 1, minWidth: 150 }} title="Their LinkedIn company page — required for jobs/posts monitoring; confirm or fix it" />
                </div>
                {c.overview && <div className="t-sub" style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 3 }}>{c.overview}</div>}
                <div className="t-sub t-muted" style={{ fontSize: 12 }}>{c.why}</div>
                {c.overlap && <div className="t-mono-xs" style={{ marginTop: 3 }}>{c.overlap}</div>}
              </div>
              <Chip tone={c.match >= 70 ? "accent" : c.match >= 45 ? "violet" : "default"}>{c.match}% match</Chip>
            </div>
          ))}
          <button className="btn btn-secondary btn-sm" onClick={() => setComps([...comps, { name: "", website: "", linkedin: "", overview: "", relationship: "direct", match: 100, why: "Added by you.", overlap: "", keep: true }])}>+ Add one they missed</button>
          <div className="row gap-2">
            <button className="btn btn-sm" disabled={busy === "save-comps"} onClick={confirmCompetitors}>{busy === "save-comps" ? "Saving…" : `Confirm ${comps.filter((c) => c.keep && c.name.trim()).length} competitor${comps.filter((c) => c.keep && c.name.trim()).length === 1 ? "" : "s"} →`}</button>
            {searchStep !== null ? <span className="row gap-2 t-mono-xs t-muted" style={{ alignItems: "center" }}><span className="agent-progress-dot" aria-hidden />{SEARCH_STEPS[searchStep]}… · {searchSecs}s</span> : <button className="btn btn-secondary btn-sm" onClick={findCompetitors}>↻ Search again</button>}
            {searchUsage && searchStep === null && <span className="t-mono-xs t-muted" title="Exact token cost of this search (input + output across both phases)">{((searchUsage.input + searchUsage.output) / 1000).toFixed(1)}k tokens</span>}
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="stack-3">
          <div className="t-sub t-muted" style={{ fontSize: 12.5 }}>The matrix rows — the <b>standard, industry-recognized capability areas</b> buyers grade every vendor in your category on (verified against how the category is actually evaluated), not niche internal features. Scores then come from <b>evidence</b>, ratified by you.</div>
          {capsRun.active && caps.length === 0 ? <div className="card card-pad" style={{ borderLeft: "3px solid var(--ac)" }}>
            <div className="row-between" style={{ marginBottom: 8 }}><span className="t-label" style={{ color: "var(--tm)" }}>Designing your matrix</span></div>
            <AgentStepList run={capsRun} />
          </div> : caps.map((c, i) => (
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
          <div className="t-mono-xs t-muted" style={{ marginBottom: 4 }}>Confirm the links each monitor will use — fix any that are wrong, then check the sources you want. Click a link to open it and verify it's real.</div>
          <div className="stack-3">
            {savedComps.map((c) => (
              <div key={c.id} className="card card-pad" style={{ background: "var(--panel-2)" }}>
                <div style={{ fontWeight: 640, fontSize: 13.5, marginBottom: 6 }}>{c.name}</div>
                {/* the two links the monitors anchor on — editable + verifiable */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-3)", marginBottom: 8 }}>
                  <label className="field" style={{ margin: 0 }}><span className="t-label">Website {c.website && <a href={c.website} target="_blank" rel="noreferrer" style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "var(--ac-text, var(--ac))" }}>↗ open</a>}</span>
                    <input className="input" value={c.website ?? ""} onChange={(e) => setCompLink(c.id, "website", e.target.value)} onBlur={(e) => saveCompWebsite(c.id, e.target.value)} placeholder="https://their-site.com" /></label>
                  <label className="field" style={{ margin: 0 }}><span className="t-label">LinkedIn {c.linkedin && <a href={c.linkedin} target="_blank" rel="noreferrer" style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "var(--ac-text, var(--ac))" }}>↗ open</a>}</span>
                    <input className="input" value={c.linkedin ?? ""} onChange={(e) => setCompLink(c.id, "linkedin", e.target.value)} placeholder="linkedin.com/company/…" /></label>
                </div>
                {/* per-source: checkbox + the EXACT target it will hit */}
                <div className="stack-2">
                  {MONITOR_KINDS.map(([k, label]) => {
                    const t = resolveTarget(c, k);
                    const blocked = (k === "website" || k === "linkedin_jobs" || k === "linkedin_posts") && !t.url;
                    const on = monitor[c.id]?.has(k) ?? false;
                    return (
                      <label key={k} className="row gap-2" style={{ alignItems: "center", cursor: blocked ? "not-allowed" : "pointer", opacity: blocked ? 0.5 : 1 }}>
                        <input type="checkbox" disabled={blocked} checked={on && !blocked} onChange={() => toggleMonitor(c.id, k)} />
                        <span style={{ fontSize: 12.5, fontWeight: 600, minWidth: 96 }}>{label}</span>
                        {t.url
                          ? <a href={t.url} target="_blank" rel="noreferrer" className="t-mono-xs" style={{ color: "var(--ac-text, var(--ac))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>{t.url} ↗</a>
                          : <span className="t-mono-xs t-muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.aim}</span>}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="card card-pad" style={{ background: "var(--panel-2)" }}>
            <div className="t-label" style={{ color: "var(--tm)", marginBottom: 6 }}>Specific links the search couldn&rsquo;t know <span className="t-sub t-muted" style={{ textTransform: "none", letterSpacing: 0 }}>— a pricing page, a LinkedIn area, docs; each becomes its own monitor</span></div>
            {extraLinks.length > 0 && (
              <div className="stack-2" style={{ marginBottom: 8 }}>
                {extraLinks.map((x, i) => (
                  <div key={i} className="row-between" style={{ fontSize: 12.5 }}>
                    <span><b>{savedComps.find((c) => c.id === x.compId)?.name ?? "?"}</b> · {x.url}</span>
                    <button className="t-muted" onClick={() => setExtraLinks(extraLinks.filter((_, j) => j !== i))} style={{ background: "none", border: "none", cursor: "pointer" }}>×</button>
                  </div>
                ))}
              </div>
            )}
            <div className="row gap-2" style={{ flexWrap: "wrap" }}>
              <select className="select" value={extraDraft.compId} onChange={(e) => setExtraDraft({ ...extraDraft, compId: e.target.value })} style={{ width: 170 }}>
                <option value="">— competitor —</option>
                {savedComps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input className="input" value={extraDraft.url} onChange={(e) => setExtraDraft({ ...extraDraft, url: e.target.value })} placeholder="https://… (their pricing page, a LinkedIn jobs/people area, docs)" style={{ flex: 1, minWidth: 220 }} />
              <button className="btn btn-secondary btn-sm" disabled={!extraDraft.compId || !extraDraft.url.trim()}
                onClick={() => { setExtraLinks([...extraLinks, { compId: extraDraft.compId, url: extraDraft.url.trim() }]); setExtraDraft({ compId: extraDraft.compId, url: "" }); }}>+ Add link</button>
            </div>
          </div>
          <div className="card card-pad" style={{ background: "var(--panel-2)" }}>
            <div className="t-label" style={{ color: "var(--tm)", marginBottom: 6 }}>How you want each source — instructions aim every pull <span className="t-sub t-muted" style={{ textTransform: "none", letterSpacing: 0 }}>(editable later per source)</span></div>
            <div className="stack-2">
              {MONITOR_KINDS.map(([k, label]) => (
                <label key={k} className="field"><span className="t-label">{label}</span>
                  <textarea className="textarea" rows={2} value={kindGuide[k] ?? ""} onChange={(e) => setKindGuide({ ...kindGuide, [k]: e.target.value })} /></label>
              ))}
            </div>
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
          {createdSources.length > 0 && <MonitoringStatus />}
          {createdSources.length > 0 && (
            <>
              <button className="btn btn-sm" disabled={busy === "ignite"} onClick={igniteAll}>{busy === "ignite" ? "Pulling…" : `⚡ Run the first pulls now (${Math.min(createdSources.length, 12)})`}</button>
              {pullRun.active && (
                <div className="card card-pad" style={{ borderLeft: "3px solid var(--ac)" }}><AgentStepList run={pullRun} /></div>
              )}
              {pullLog.length > 0 && (
                <div className="card card-pad" style={{ background: "var(--panel-2)" }}>
                  <div className="t-mono-xs t-muted" style={{ marginBottom: 6 }}>The first pull is the verification — what each source actually returned. Wrong link or wrong content? Fix it on the competitor&rsquo;s Signals tab before the daily cadence runs.</div>
                  {pullLog.map((l, i) => (
                    <div key={i} style={{ padding: "3px 0" }}>
                      <div className="t-mono-xs" style={{ fontWeight: 640, color: l.ok === false ? "var(--rd-text, #B91C1C)" : l.ok ? "var(--gn-text, var(--gn-text))" : "var(--ts)" }}>
                        {l.ok === false ? "✗ " : l.ok ? "✓ " : ""}{l.text}
                      </div>
                      {l.signals && l.signals.length > 0 && (
                        <div style={{ marginLeft: 18, marginTop: 2 }}>
                          {l.signals.slice(0, 4).map((sg, j) => (
                            <div key={j} className="t-mono-xs t-muted" style={{ padding: "1px 0" }}>· {sg.title} <span style={{ opacity: 0.7 }}>({Math.round(sg.relevance * 100)}% relevant)</span></div>
                          ))}
                          {l.signals.length > 4 && <div className="t-mono-xs t-muted" style={{ opacity: 0.7 }}>+{l.signals.length - 4} more in the feed</div>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          <button className="btn btn-secondary btn-sm" onClick={onDone}>Open the dashboard →</button>
        </div>
      )}
    </div>
  );
}
