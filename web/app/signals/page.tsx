import { createClient } from "@/lib/supabase/server";
import Shell from "@/components/Shell";
import { ComingSoon } from "@/components/ui";

export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <Shell email={user?.email} crumbs={[{ label: "Signals" }]}>
      <ComingSoon title="Signals" blurb="Internal and external signals — the evidence that informs how the product and its go-to-market evolve. Agents draw on these; MCP connections (incl. web search) will feed them." />
    </Shell>
  );
}
