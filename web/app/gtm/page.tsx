import { createClient } from "@/lib/supabase/server";
import Shell from "@/components/Shell";
import ListView from "@/components/ListView";

export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <Shell email={user?.email} crumbs={[{ label: "Foundation", href: "/" }, { label: "GTM records" }]}>
      <ListView kind="gtm" />
    </Shell>
  );
}
