import { createClient } from "@/lib/supabase/server";
import Shell from "@/components/Shell";
import IntelView from "@/components/IntelView";

export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <Shell email={user?.email} crumbs={[{ label: "Competitive intel" }]}>
      <IntelView
        domain="competitive"
        title="Competitive intel"
        meta="Track competitors, positioning, and battlecards — the intel your CRO & CCO agents read into GTM."
        suggestions={["Competitor pricing & packaging changes", "New competitor product launches", "Win/loss themes vs top rivals", "Competitor messaging shifts"]}
      />
    </Shell>
  );
}
