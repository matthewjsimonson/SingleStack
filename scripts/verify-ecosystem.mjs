// PLG Ecosystem coverage-model checks (web/lib/ecosystem.ts).
// Run: node --experimental-strip-types scripts/verify-ecosystem.mjs
import * as eco from "../web/lib/ecosystem.ts";

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.error("✗ " + m); } else console.log("✓ " + m); };

// --- taxonomy ---------------------------------------------------------------
ok(eco.PRODUCT_AREAS.length === 5 && eco.GTM_AREAS.length === 8 && eco.AREAS.length === 13,
  "taxonomy: 5 Build/Product + 8 GTM areas");
ok(eco.AREAS.find((a) => a.engine)?.key === "build_ship",
  "Build & Ship is the engine area");

// --- empty org: every area a gap; no execution → at-risk --------------------
const empty = eco.classifyCoverage(eco.computeCoverage({ agents: [], connections: [], agentSkills: [], skills: [], workflows: [] }));
ok(empty.counts.gap === eco.AREAS.length, "empty org → every area is a gap");
ok(empty.harmony.status === "at-risk" && /Build & Ship/.test(empty.harmony.headline),
  "no execution → at-risk, headline names Build & Ship");

// --- a fully-equipped product agent -----------------------------------------
const cov = eco.computeCoverage({
  agents: [{ id: "A", name: "CPO" }],
  connections: [{ agent_id: "A", area: "products" }, { agent_id: "A", area: "signals" }, { agent_id: "A", area: "capabilities" }],
  agentSkills: [{ agent_id: "A", skill_id: "corn" }, { agent_id: "A", skill_id: "child" }],
  skills: [{ id: "corn", kind: "cornerstone", areas: [] }, { id: "child", kind: "child", areas: ["products"] }],
  workflows: [{ agent_id: "A", target_type: "product", is_active: true }],
});
const truth = cov.areas.find((a) => a.area.key === "product_truth");
ok(truth.status === "covered" && truth.checks.agent && truth.checks.cornerstone && truth.checks.skills && truth.checks.workflow,
  "equipped product agent → Product Truth covered (all 4 checks)");
ok(cov.areas.find((a) => a.area.key === "build_ship").status === "covered",
  "same agent covers the Build engine");
const pos = cov.areas.find((a) => a.area.key === "positioning");
ok(pos.status === "gap" && pos.checks.agent === false, "GTM area with no agent → gap");

// --- partial: agent + cornerstone, but no child-skill / workflow -------------
const cov2 = eco.computeCoverage({
  agents: [{ id: "A", name: "X" }], connections: [{ agent_id: "A", area: "products" }],
  agentSkills: [{ agent_id: "A", skill_id: "corn" }], skills: [{ id: "corn", kind: "cornerstone", areas: [] }], workflows: [],
});
const t2 = cov2.areas.find((a) => a.area.key === "product_truth");
ok(t2.status === "partial" && t2.checks.cornerstone && t2.missing.includes("skills") && t2.missing.includes("workflow"),
  "agent + cornerstone but no child-skill/workflow → partial");

// --- precision: a child skill / workflow for a DIFFERENT area doesn't count --
const cov3 = eco.computeCoverage({
  agents: [{ id: "A", name: "X" }], connections: [{ agent_id: "A", area: "products" }],
  agentSkills: [{ agent_id: "A", skill_id: "c" }], skills: [{ id: "c", kind: "child", areas: ["gtm"] }],
  workflows: [{ agent_id: "A", target_type: "gtm", is_active: true }],
});
const t3 = cov3.areas.find((a) => a.area.key === "product_truth");
ok(t3.checks.skills === false, "child skill tagged to a different area does not count");
ok(t3.checks.workflow === false, "gtm-targeted workflow does not cover a product area");

// --- full coverage across both circles → healthy ----------------------------
const healthy = eco.classifyCoverage(eco.computeCoverage({
  agents: [{ id: "P", name: "CPO" }, { id: "G", name: "CRO" }],
  connections: [
    { agent_id: "P", area: "products" }, { agent_id: "P", area: "signals" }, { agent_id: "P", area: "capabilities" }, { agent_id: "P", area: "competitive" },
    { agent_id: "G", area: "gtm" }, { agent_id: "G", area: "signals" }, { agent_id: "G", area: "competitive" },
  ],
  agentSkills: [
    { agent_id: "P", skill_id: "cp" }, { agent_id: "P", skill_id: "sp" },
    { agent_id: "G", skill_id: "cg" }, { agent_id: "G", skill_id: "sg" },
  ],
  skills: [
    { id: "cp", kind: "cornerstone", areas: [] }, { id: "cg", kind: "cornerstone", areas: [] },
    { id: "sp", kind: "child", areas: ["products", "signals", "capabilities", "competitive"] },
    { id: "sg", kind: "child", areas: ["gtm", "signals", "competitive"] },
  ],
  workflows: [{ agent_id: "P", target_type: "product", is_active: true }, { agent_id: "G", target_type: "gtm", is_active: true }],
}));
ok(healthy.counts.gap === 0 && healthy.counts.partial === 0, "two well-equipped agents cover all 13 areas");
ok(healthy.harmony.status === "healthy", "full coverage → healthy");

console.log(fail ? `\n${fail} CHECK(S) FAILED` : "\nall ecosystem coverage checks passed");
process.exit(fail ? 1 : 0);
