import { createClient } from "@/lib/supabase/server";
import Shell from "@/components/Shell";
import PqlBoard from "@/components/PqlBoard";

// Accounts — the lifecycle/accounts board. "PQL" is a STATE on accounts
// (accounts.pql_state) and a signal, not its own destination, so it lives here
// rather than as a jargon-named tab. Part of the 22->10 cohesion consolidation.
export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <Shell email={user?.email} crumbs={[{ label: "Accounts" }]}>
      <PqlBoard />
    </Shell>
  );
}
