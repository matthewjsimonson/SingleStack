import { createClient } from "@/lib/supabase/server";
import Shell from "@/components/Shell";
import { ComingSoon } from "@/components/ui";

export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <Shell email={user?.email} crumbs={[{ label: "Enablement" }]}>
      <ComingSoon title="Enablement" blurb="Battlecards, talk tracks, and demo paths — the bridge between the product record and what a seller says." />
    </Shell>
  );
}
