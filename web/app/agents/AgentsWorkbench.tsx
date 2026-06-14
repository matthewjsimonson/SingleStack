"use client";

// Agents workbench — agent setup, the skills library, and workflow setup in one
// place. Three tabs:
//   Agents    → the officer roster & their config.
//   Skills    → the org-wide library of reusable skills (templates) agents draw on.
//   Workflows → author multi-step workflows, the agents/skills they apply, and
//               their triggers.
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { SubTabs } from "@/components/ui";
import AgentsView from "./AgentsView";
import WorkflowsView from "./WorkflowsView";
import SkillLibrary from "@/components/SkillLibrary";

type Tab = "agents" | "skills" | "workflows";

export default function AgentsWorkbench() {
  const params = useSearchParams();
  const initial = params.get("tab");
  // "plays" is retired — any old deep link lands on Workflows.
  const [tab, setTab] = useState<Tab>(
    initial === "workflows" || initial === "plays" ? "workflows" : initial === "skills" ? "skills" : "agents",
  );
  return (
    <div>
      <SubTabs<Tab> tabs={[{ key: "agents", label: "Agents" }, { key: "skills", label: "Skills" }, { key: "workflows", label: "Workflows" }]} active={tab} onChange={setTab} />
      {tab === "agents" ? <AgentsView /> : tab === "skills" ? <SkillLibrary /> : <WorkflowsView />}
    </div>
  );
}
