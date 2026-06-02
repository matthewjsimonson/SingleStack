import { redirect } from "next/navigation";

// One detail page for an initiative — the cross-functional cockpit at
// /initiatives/[id]. The old build-item workspace is folded into it.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/initiatives/${id}`);
}
