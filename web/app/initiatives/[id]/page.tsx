import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import Shell from "@/components/Shell";
import InitiativeDetail from "./InitiativeDetail";

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string }> }) {
  const { id } = await params;
  const { from } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Breadcrumb reflects where you came from, matching the cockpit's back link.
  const origin = from === "ship" ? { label: "Ship", href: "/ship" }
    : from === "enablement" ? { label: "Go-to-market", href: "/enablement" }
    : { label: "Initiatives", href: "/?tab=initiatives" };
  return (
    <Shell email={user?.email} crumbs={[origin, { label: "Build Item" }]}>
      <Suspense fallback={null}>
        <InitiativeDetail id={id} />
      </Suspense>
    </Shell>
  );
}
