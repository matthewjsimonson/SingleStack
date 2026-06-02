import { redirect } from "next/navigation";

// Initiatives lives as a tab on the homepage (the single canonical home).
// This route just forwards there so old links / the [id] parent resolve cleanly.
export default function Page() {
  redirect("/?tab=initiatives");
}
