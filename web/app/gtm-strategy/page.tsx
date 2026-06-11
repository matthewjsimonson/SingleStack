import { createClient } from "@/lib/supabase/server";
import Shell from "@/components/Shell";
import GtmStrategyView from "./GtmStrategyView";

export default async function GtmStrategyPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <Shell email={user?.email} crumbs={[{ label: "GTM strategy" }]}>
      <GtmStrategyView />
    </Shell>
  );
}
