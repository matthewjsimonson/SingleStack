import { createClient } from "@/lib/supabase/server";
import Shell from "@/components/Shell";
import WorkstreamBoard from "@/components/WorkstreamBoard";

export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <Shell email={user?.email} crumbs={[{ label: "Enablement" }]}>
      <WorkstreamBoard area="gtm" title="Enablement" meta="GTM execution — the go-to-market workstreams of your initiatives (messaging, campaigns, content, battlecards). Each ladders up to its initiative." />
    </Shell>
  );
}
