import { redirect } from "next/navigation";

// The skills library now lives as a tab inside Agents (skills are agent-scoped
// knowledge). Keep this route as a permanent redirect so old links/bookmarks land
// on the new home.
export default function SkillsPage() {
  redirect("/agents?tab=skills");
}
