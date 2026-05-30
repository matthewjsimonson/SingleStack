import { createClient } from "@/lib/supabase/server";
import Shell from "@/components/Shell";
import InitiativeBoard from "@/components/InitiativeBoard";

export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <Shell email={user?.email} crumbs={[{ label: "Enablement" }]}>
      <InitiativeBoard lane="enablement" title="Enablement" meta="Battlecards, talk tracks, and demo paths — the bridge between the product and sellers." recordType="gtm" />
    </Shell>
  );
}
