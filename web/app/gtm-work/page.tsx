import { createClient } from "@/lib/supabase/server";
import Shell from "@/components/Shell";
import GtmWorkView from "@/components/GtmWorkView";

export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <Shell email={user?.email} crumbs={[{ label: "GTM work" }]}>
      <GtmWorkView />
    </Shell>
  );
}
