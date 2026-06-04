import { redirect } from "next/navigation";

// Plays now live under Agents (consolidated). Keep the old URL working.
export default function Page() {
  redirect("/agents?tab=plays");
}
