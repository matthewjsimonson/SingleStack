import { createClient } from "@/lib/supabase/server";
import Shell from "@/components/Shell";
import { ComingSoon } from "@/components/ui";

export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <Shell email={user?.email} crumbs={[{ label: "Ship" }]}>
      <ComingSoon title="Ship" blurb="Releases moving from build to GA, with the product-record changes each one drives." />
    </Shell>
  );
}
