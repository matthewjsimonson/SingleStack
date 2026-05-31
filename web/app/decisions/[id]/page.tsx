import { createClient } from "@/lib/supabase/server";
import Shell from "@/components/Shell";
import DecisionWorkspace from "./DecisionWorkspace";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <Shell email={user?.email} crumbs={[{ label: "Decisions", href: "/decisions" }, { label: "Decision" }]}>
      <DecisionWorkspace id={id} />
    </Shell>
  );
}
