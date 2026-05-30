import { createClient } from "@/lib/supabase/server";
import Shell from "@/components/Shell";
import IntelView from "@/components/IntelView";

export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <Shell email={user?.email} crumbs={[{ label: "Market intel" }]}>
      <IntelView
        domain="market"
        title="Market intel"
        meta="Track category trends, analyst views, and demand shifts — the intel that shapes product strategy & narrative."
        suggestions={["Category narrative & analyst framing", "Emerging buyer priorities", "Regulatory / compliance shifts", "Adjacent market movements"]}
      />
    </Shell>
  );
}
