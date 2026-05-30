import { createClient } from "@/lib/supabase/server";
import Shell from "@/components/Shell";
import CompetitiveView from "./CompetitiveView";

export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <Shell email={user?.email} crumbs={[{ label: "Competitive intel" }]}>
      <CompetitiveView />
    </Shell>
  );
}
