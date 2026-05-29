import { createClient } from "@/lib/supabase/server";
import Shell from "@/components/Shell";
import { ComingSoon } from "@/components/ui";

export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <Shell email={user?.email} crumbs={[{ label: "Competitors" }]}>
      <ComingSoon title="Competitors" blurb="Competitive intelligence and battlecards — who you're up against and how you're positioned." />
    </Shell>
  );
}
