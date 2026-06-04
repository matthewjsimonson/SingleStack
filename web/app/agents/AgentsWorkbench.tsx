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

type Tab = "agents" | "plays";

export default function AgentsWorkbench() {
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>(params.get("tab") === "plays" ? "plays" : "agents");
  return (
    <div>
      <SubTabs<Tab> tabs={[{ key: "agents", label: "Agents" }, { key: "plays", label: "Plays" }]} active={tab} onChange={setTab} />
      {tab === "agents" ? <AgentsView /> : <PlaysView />}
    </div>
  );
}
