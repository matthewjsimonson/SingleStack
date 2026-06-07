"use client";

// Agents workbench — agent setup and workflow setup in one place. Two tabs:
//   Agents    → the officer roster & their config.
//   Workflows → author multi-step workflows, the agents/skills they apply, and
//               their triggers.
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { SubTabs } from "@/components/ui";
import AgentsView from "./AgentsView";
import WorkflowsView from "./WorkflowsView";

type Tab = "agents" | "workflows";

export default function AgentsWorkbench() {
  const params = useSearchParams();
  const initial = params.get("tab");
  // "plays" is retired — any old deep link lands on Workflows.
  const [tab, setTab] = useState<Tab>(initial === "workflows" || initial === "plays" ? "workflows" : "agents");
  return (
    <div>
      <SubTabs<Tab> tabs={[{ key: "agents", label: "Agents" }, { key: "workflows", label: "Workflows" }]} active={tab} onChange={setTab} />
      {tab === "agents" ? <AgentsView /> : <WorkflowsView />}
    </div>
  );
}
