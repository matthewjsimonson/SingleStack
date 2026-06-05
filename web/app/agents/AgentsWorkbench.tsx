"use client";

// Agents workbench — agent setup and play setup in one place (consolidated from
// the old separate Agents + Plays sidebar items). Two tabs:
//   Agents → the officer roster & their config.
//   Plays  → author plays, attach agents/skills, and MAP them onto surfaces
//            across the solution (with suggested placements).
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { SubTabs } from "@/components/ui";
import AgentsView from "./AgentsView";
import PlaysView from "../plays/PlaysView";
import WorkflowsView from "./WorkflowsView";

type Tab = "agents" | "plays" | "workflows";

export default function AgentsWorkbench() {
  const params = useSearchParams();
  const initial = params.get("tab");
  const [tab, setTab] = useState<Tab>(initial === "plays" ? "plays" : initial === "workflows" ? "workflows" : "agents");
  return (
    <div>
      <SubTabs<Tab> tabs={[{ key: "agents", label: "Agents" }, { key: "plays", label: "Plays" }, { key: "workflows", label: "Workflows" }]} active={tab} onChange={setTab} />
      {tab === "agents" ? <AgentsView /> : tab === "plays" ? <PlaysView /> : <WorkflowsView />}
    </div>
  );
}
