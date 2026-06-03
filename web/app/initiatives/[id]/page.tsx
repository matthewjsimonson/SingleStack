import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import Shell from "@/components/Shell";
import InitiativeDetail from "./InitiativeDetail";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <Shell email={user?.email} crumbs={[{ label: "Initiatives", href: "/?tab=initiatives" }, { label: "Build Item" }]}>
      <Suspense fallback={null}>
        <InitiativeDetail id={id} />
      </Suspense>
    </Shell>
  );
}
