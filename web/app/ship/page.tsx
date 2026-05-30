import { createClient } from "@/lib/supabase/server";
import Shell from "@/components/Shell";
import InitiativeBoard from "@/components/InitiativeBoard";

export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <Shell email={user?.email} crumbs={[{ label: "Ship" }]}>
      <InitiativeBoard lane="ship" title="Ship" meta="Initiatives moving build to GA, with the product-record changes they drive." recordType="product" />
    </Shell>
  );
}
