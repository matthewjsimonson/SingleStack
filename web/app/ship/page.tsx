import { createClient } from "@/lib/supabase/server";
import Shell from "@/components/Shell";
import ShipBoard from "@/components/ShipBoard";

export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <Shell email={user?.email} crumbs={[{ label: "Ship" }]}>
      <ShipBoard />
    </Shell>
  );
}
