import { createClient } from "@/lib/supabase/server";
import Shell from "@/components/Shell";
import PqlBoard from "@/components/PqlBoard";

export default async function PqlPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <Shell email={user?.email} crumbs={[{ label: "Product-qualified leads" }]}>
      <PqlBoard />
    </Shell>
  );
}
