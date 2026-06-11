import { createClient } from "@/lib/supabase/server";
import Shell from "@/components/Shell";
import SellDesk from "@/components/SellDesk";

export default async function SellPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <Shell email={user?.email} crumbs={[{ label: "Desk" }]}>
      <SellDesk />
    </Shell>
  );
}
