"use client";

// The Ecosystem (Phase G) — the agent-workforce home, as ONE view of the product-
// led-growth MOTION. A single heart shows both records — Build/Product (the PM
// engine, where execution with frontier models is the differentiator) and GTM (the
// PMM flywheel) — and the loop between them: product builds fuel growth; usage/PQL
// signals feed back into the product. Filter down to either circle exclusively.
// Each area answers, per task: is there an agent, with the right cornerstone +
// child-skills, running the right workflow, to actually do this? Gap-first and
// build-forward — a gap in a feeder stalls the flywheel. Status is always
// answerable (singlestack-ui §1.5); every gap/partial carries a control to act.
// Reads the verified model (web/lib/ecosystem.ts) over RLS-fenced data.
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Section } from "@/components/ui";
import {
  PRODUCT_AREAS, GTM_AREAS, CHECKS, CHECK_LABEL, computeCoverage, classifyCoverage,
  type Area, type AreaCoverage, type Check, type AreaStatus, type Harmony,
} from "@/lib/ecosystem";

type Input = Parameters<typeof computeCoverage>[0];
type Lens = "all" | "product" | "gtm";

const statusTone = (s: AreaStatus) =>
  s === "covered" ? { fill: "var(--gn-fill)", text: "var(--gn-text)", label: "Covered" }
  : s === "partial" ? { fill: "color-mix(in srgb, var(--am) 15%, transparent)", text: "var(--am)", label: "Partial" }
  : { fill: "color-mix(in srgb, var(--rd) 13%, transparent)", text: "var(--rd)", label: "Gap" };
const harmonyTone = (h: Harmony) =>
  h === "healthy" ? { fill: "var(--gn-fill)", text: "var(--gn-text)", label: "Healthy" }
  : h === "watch" ? { fill: "color-mix(in srgb, var(--am) 16%, transparent)", text: "var(--am)", label: "Watch" }
  : { fill: "color-mix(in srgb, var(--rd) 14%, transparent)", text: "var(--rd)", label: "At risk" };

// Where a human goes to close each missing check (navigational HITL).
const fixFor = (area: Area, c: Check): { href: string; label: string } =>
  c === "agent" ? { href: "/agents?tab=agents", label: `Put an agent on ${area.label}` }
  : c === "cornerstone" ? { href: "/agents?tab=agents", label: "Give it a cornerstone" }
  : c === "skills" ? { href: "/agents?tab=skills", label: "Add a child skill" }
  : { href: "/agents?tab=workflows", label: "Create a workflow" };

const tally = (areas: AreaCoverage[]) => ({
  covered: areas.filter((a) => a.status === "covered").length,
  partial: areas.filter((a) => a.status === "partial").length,
  gap: areas.filter((a) => a.status === "gap").length,
  total: areas.length,
});

// A thin coverage bar — green covered, amber partial, red gap. Data appears; no spring.
function CoverageBar({ areas }: { areas: AreaCoverage[] }) {
  const t = tally(areas);
  const seg = (n: number, color: string) =>
    n > 0 ? <span style={{ flex: n, background: color, height: "100%" }} /> : null;
  return (
    <div style={{ display: "flex", height: 6, borderRadius: 999, overflow: "hidden", background: "var(--surface-2, var(--well))", gap: 1 }}>
      {seg(t.covered, "var(--gn-text)")}
      {seg(t.partial, "var(--am)")}
      {seg(t.gap, "var(--rd)")}
    </div>
  );
}

// One record core inside the heart: the record, its coverage, what it is.
function Core({ title, role, areas, engine, active, onClick }: {
  title: string; role: string; areas: AreaCoverage[]; engine?: boolean; active: boolean; onClick: () => void;
}) {
  const t = tally(areas);
  return (
    <button
      onClick={onClick}
      className="card card-pad"
      style={{
        flex: "1 1 240px", minWidth: 0, textAlign: "left", cursor: "pointer", background: "var(--surface-0, var(--bg))",
        borderColor: active ? "var(--ac-text)" : "var(--border)", borderWidth: active ? 1.5 : 1,
        boxShadow: active ? "0 0 0 3px var(--ac-fill)" : undefined, transition: "border-color var(--dur-fast, 120ms), box-shadow var(--dur-fast, 120ms)",
      }}
    >
      <div className="row gap-2" style={{ alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 740, fontSize: 14 }}>{title}</span>
        {engine && <span className="chip" style={{ fontSize: 9, background: "var(--ac-fill)", color: "var(--ac-text)", fontWeight: 700 }}>engine</span>}
      </div>
      <div className="t-sub t-muted" style={{ fontSize: 11.5, lineHeight: 1.4, marginBottom: 9 }}>{role}</div>
      <CoverageBar areas={areas} />
      <div className="t-mono-xs t-muted" style={{ fontSize: 10.5, marginTop: 7 }}>
        {t.covered}/{t.total} covered{t.gap ? ` · ${t.gap} gap${t.gap === 1 ? "" : "s"}` : ""}{t.partial ? ` · ${t.partial} partial` : ""}
      </div>
    </button>
  );
}

// The motion connector between the two cores — the PLG loop, made legible.
function Motion() {
  return (
    <div className="t-mono-xs t-muted" style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", justifyContent: "center", gap: 6, fontSize: 10, padding: "0 4px", minWidth: 92, textAlign: "center" }}>
      <span style={{ color: "var(--ac-text)", fontWeight: 700 }}>builds fuel growth →</span>
      <span style={{ color: "var(--tm)" }}>← usage &amp; PQL signals</span>
    </div>
  );
}

function CheckDots({ cov }: { cov: AreaCoverage }) {
  return (
    <div className="row gap-2" style={{ flexWrap: "wrap", gap: 6 }}>
      {CHECKS.map((c) => {
        const on = cov.checks[c];
        return (
          <span key={c} className="row gap-1" style={{ alignItems: "center", gap: 4, fontSize: 10.5, color: on ? "var(--tp)" : "var(--tm)" }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, flexShrink: 0, background: on ? "var(--gn-text)" : "transparent", border: on ? "none" : "1.5px solid var(--border)" }} />
            {CHECK_LABEL[c]}
          </span>
        );
      })}
    </div>
  );
}

function AreaCard({ cov }: { cov: AreaCoverage }) {
  const { area } = cov; const t = statusTone(cov.status);
  return (
    <div className="card card-pad" style={{ borderColor: cov.status === "gap" ? "var(--border)" : t.text, borderLeftWidth: area.engine ? 3 : undefined, borderLeftColor: area.engine ? "var(--ac-text)" : undefined }}>
      <div className="row-between" style={{ alignItems: "flex-start", gap: 8, marginBottom: 4 }}>
        <div className="row gap-2" style={{ alignItems: "center", minWidth: 0, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 660, fontSize: 13 }}>{area.label}</span>
          {area.engine && <span className="chip" style={{ fontSize: 9, background: "var(--ac-fill)", color: "var(--ac-text)", fontWeight: 700 }}>engine</span>}
        </div>
        <span className="chip" style={{ flexShrink: 0, fontSize: 9.5, fontWeight: 700, background: t.fill, color: t.text }}>{t.label}</span>
      </div>
      <div className="t-sub t-muted" style={{ fontSize: 11, lineHeight: 1.4, marginBottom: 7 }}>{area.blurb}</div>
      <div className="t-mono-xs t-muted" style={{ fontSize: 10, marginBottom: 7 }}>
        {area.record}{area.flywheel ? ` · ${area.flywheel}` : ""}{cov.agentIds.length ? ` · ${cov.agentIds.length} agent${cov.agentIds.length === 1 ? "" : "s"}` : ""}
      </div>
      <CheckDots cov={cov} />
      <ul style={{ margin: "8px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 2 }}>
        {area.tasks.map((task) => (
          <li key={task.key} className="t-sub t-muted" style={{ fontSize: 10.5, paddingLeft: 11, position: "relative", lineHeight: 1.35 }}>
            <span style={{ position: "absolute", left: 0, color: "var(--tm)" }}>·</span>{task.label}
          </li>
        ))}
      </ul>
      {cov.missing.length > 0 && (
        <div className="row gap-2" style={{ flexWrap: "wrap", marginTop: 9, gap: 6 }}>
          {cov.missing.map((c, i) => {
            const f = fixFor(area, c);
            return <a key={c} href={f.href} className={`btn btn-sm ${i === 0 ? "" : "btn-secondary"}`} style={{ fontSize: 11 }}>+ {f.label}</a>;
          })}
        </div>
      )}
    </div>
  );
}

function FilterTab({ label, sub, active, onClick }: { label: string; sub: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="btn btn-sm" style={{
      background: active ? "var(--ac-fill)" : "transparent", color: active ? "var(--ac-text)" : "var(--tp)",
      borderColor: active ? "var(--ac-text)" : "var(--border)", fontWeight: active ? 700 : 540,
    }}>
      {label}<span className="t-mono-xs" style={{ marginLeft: 6, opacity: 0.7, fontSize: 10 }}>{sub}</span>
    </button>
  );
}

export default function Ecosystem() {
  const supabase = createClient();
  const [data, setData] = useState<Input | null>(null);
  const [counts, setCounts] = useState({ products: 0, gtm: 0, agents: 0 });
  const [loading, setLoading] = useState(true);
  const [lens, setLens] = useState<Lens>("all");

  const load = useCallback(async () => {
    const [{ data: ag }, { data: conns }, { data: agSk }, { data: sk }, { data: wf }, { count: pc }, { count: gc }] = await Promise.all([
      supabase.from("agents").select("id, name").eq("is_active", true).order("name"),
      supabase.from("connections").select("agent_id, area").eq("kind", "internal"),
      supabase.from("agent_skills").select("agent_id, skill_id"),
      supabase.from("skills").select("id, kind, areas"),
      supabase.from("workflows").select("agent_id, target_type, is_active"),
      supabase.from("product_records").select("id", { count: "exact", head: true }),
      supabase.from("gtm_records").select("id", { count: "exact", head: true }),
    ]);
    const agents = (ag ?? []) as { id: string; name: string }[];
    setData({
      agents,
      connections: (conns ?? []) as Input["connections"],
      agentSkills: (agSk ?? []) as Input["agentSkills"],
      skills: (sk ?? []) as Input["skills"],
      workflows: (wf ?? []) as Input["workflows"],
    });
    setCounts({ products: pc ?? 0, gtm: gc ?? 0, agents: agents.length });
    setLoading(false);
  }, [supabase]);
  useEffect(() => { load(); }, [load]);

  const coverage = useMemo(() => (data ? computeCoverage(data) : null), [data]);
  const health = useMemo(() => (coverage ? classifyCoverage(coverage) : null), [coverage]);

  if (loading || !coverage || !health) return <div className="t-sub t-muted">Loading the ecosystem…</div>;

  const byKey = (k: string) => coverage.areas.find((a) => a.area.key === k)!;
  const productCov = PRODUCT_AREAS.map((a) => byKey(a.key));
  const gtmCov = GTM_AREAS.map((a) => byKey(a.key));
  const noRecords = counts.products === 0 && counts.gtm === 0;
  const noAgents = counts.agents === 0;
  const ht = harmonyTone(health.harmony.status);

  // Filter the areas + the unattended list to the chosen lens (the heart stays whole).
  const lensAreas = lens === "product" ? productCov : lens === "gtm" ? gtmCov : [...productCov, ...gtmCov];
  const lensKeys = new Set(lensAreas.map((a) => a.area.key));
  const todo = [...health.rankedGaps, ...health.rankedPartials].filter((c) => lensKeys.has(c.area.key));

  const Step = ({ n, done, title, body, href, cta }: { n: number; done: boolean; title: string; body: string; href: string; cta: string }) => (
    <div className="card card-pad" style={{ display: "flex", gap: 12, alignItems: "flex-start", opacity: done ? 0.6 : 1 }}>
      <span style={{ flexShrink: 0, width: 24, height: 24, borderRadius: 999, display: "grid", placeItems: "center", fontSize: 12, fontWeight: 720, background: done ? "var(--gn-fill)" : "var(--ac-fill)", color: done ? "var(--gn-text)" : "var(--ac-text)" }}>{done ? "✓" : n}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 660, fontSize: 13.5 }}>{title}</div>
        <div className="t-sub t-muted" style={{ fontSize: 12, lineHeight: 1.45, marginTop: 2 }}>{body}</div>
      </div>
      {!done && <a className="btn btn-sm" href={href} style={{ flexShrink: 0 }}>{cta}</a>}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
      {/* The heart — both records and the PLG motion between them. */}
      <div className="card card-pad" style={{ background: ht.fill, borderColor: ht.text }}>
        <div className="row-between" style={{ alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          <div className="row gap-2" style={{ alignItems: "center", minWidth: 0 }}>
            <span style={{ width: 9, height: 9, borderRadius: 999, background: ht.text, flexShrink: 0 }} />
            <span style={{ fontWeight: 720, color: ht.text }}>{ht.label}</span>
            <span style={{ fontSize: 13.5, color: "var(--tp)", minWidth: 0 }}>{health.harmony.headline}</span>
          </div>
          <span className="t-mono-xs t-muted" style={{ flexShrink: 0, fontSize: 11.5 }}>
            {health.counts.covered} covered · {health.counts.partial} partial · {health.counts.gap} gap
          </span>
        </div>
        <div className="row" style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "stretch" }}>
          <Core title="Build / Product" role="The PM engine — make the product worth growing. Execution with frontier models is the heart." areas={productCov} engine active={lens === "product"} onClick={() => setLens(lens === "product" ? "all" : "product")} />
          <Motion />
          <Core title="Go-to-market" role="The PMM flywheel — grow it across Acquire → Activate → Convert → Retain → Expand → Advocate." areas={gtmCov} active={lens === "gtm"} onClick={() => setLens(lens === "gtm" ? "all" : "gtm")} />
        </div>
      </div>

      {/* Filter the motion down to one circle. */}
      <div className="row gap-2" style={{ flexWrap: "wrap", alignItems: "center" }}>
        <span className="t-mono-xs t-muted" style={{ fontSize: 10.5, marginRight: 2 }}>View</span>
        <FilterTab label="The full motion" sub={`${health.counts.total}`} active={lens === "all"} onClick={() => setLens("all")} />
        <FilterTab label="Product" sub={`${productCov.length}`} active={lens === "product"} onClick={() => setLens("product")} />
        <FilterTab label="GTM" sub={`${gtmCov.length}`} active={lens === "gtm"} onClick={() => setLens("gtm")} />
      </div>

      {(noRecords || noAgents) && (
        <Section label="Stand up your ecosystem">
          <div className="t-sub t-muted" style={{ fontSize: 12.5, marginBottom: 10 }}>The workforce co-maintains your product &amp; GTM truth and runs the build. Set the foundation, then staff the areas — coverage fills in as agents, skills, and workflows go in.</div>
          <div className="stack-2">
            <Step n={1} done={!noRecords} title="Set your Product &amp; GTM records" body="The truth at the center of each circle. The ecosystem can't cover work it has no record for." href="/products" cta="Set up records" />
            <Step n={2} done={!noAgents} title="Staff the areas with agents" body="Executive agents with cornerstones + child skills, connected to the Build/Product and GTM areas they own." href="/agents?tab=agents" cta="Add agents" />
            <Step n={3} done={health.counts.covered > 0} title="Equip them with skills &amp; workflows" body="Child skills are the per-task playbooks; workflows put the work on a cadence. Start with the Build engine." href="/agents?tab=workflows" cta="Set up workflows" />
          </div>
        </Section>
      )}

      {/* Gap-first: what's unattended in the current lens (lead with the Build engine). */}
      {todo.length > 0 && (
        <Section label={lens === "all" ? "What's unattended" : `What's unattended · ${lens === "product" ? "Product" : "GTM"}`}>
          <div className="t-sub t-muted" style={{ fontSize: 12, marginBottom: 10 }}>Closest to the flywheel first. A gap is no agent on the area; a partial is an agent that isn't fully equipped.</div>
          <div className="stack-2">
            {todo.slice(0, 5).map((cov) => {
              const t = statusTone(cov.status); const c0 = cov.missing[0]; const f = c0 ? fixFor(cov.area, c0) : null;
              return (
                <div key={cov.area.key} className="card card-pad" style={{ borderLeft: `3px solid ${t.text}` }}>
                  <div className="row-between" style={{ alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="row gap-2" style={{ alignItems: "center", marginBottom: 2, flexWrap: "wrap" }}>
                        <span className="chip" style={{ fontSize: 9.5, background: t.fill, color: t.text, fontWeight: 700 }}>{t.label}</span>
                        <span style={{ fontSize: 12.5, fontWeight: 640 }}>{cov.area.label}</span>
                        {cov.area.engine && <span className="chip" style={{ fontSize: 9, background: "var(--ac-fill)", color: "var(--ac-text)", fontWeight: 700 }}>engine</span>}
                        <span className="t-mono-xs t-muted" style={{ fontSize: 10 }}>{cov.area.circle === "product" ? "Build / Product" : "Go-to-market"}</span>
                      </div>
                      <div className="t-sub t-muted" style={{ fontSize: 12, lineHeight: 1.4 }}>Missing: {cov.missing.map((m) => CHECK_LABEL[m].toLowerCase()).join(" · ")}.</div>
                    </div>
                    {f && <a className="btn btn-secondary btn-sm" href={f.href} style={{ flexShrink: 0 }}>+ {f.label}</a>}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* The areas of the current lens. */}
      <Section label={lens === "all" ? "Every area" : lens === "product" ? "Build / Product areas" : "Go-to-market areas"}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 10 }}>
          {lensAreas.map((c) => <AreaCard key={c.area.key} cov={c} />)}
        </div>
      </Section>
    </div>
  );
}
