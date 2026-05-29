import { createClient } from "@/lib/supabase/server";
import Shell from "@/components/Shell";
import AgentsView from "./AgentsView";

export default async function AgentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <Shell email={user?.email} crumbs={[{ label: "Agents" }]}>
      <AgentsView />
    </Shell>
  );
}
