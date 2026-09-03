import { SchoolsClient } from "@/components/schools/schools-client";
import { getSchoolsData } from "@/lib/schools/data";

export const metadata = {
  title: "Fordonsutbildningar · Skolor",
};

// The directory is read live rather than cached: it is one query set over ~2300 rows
// and the contact data is edited in the CRM, so a stale render would show counts that
// disagree with the contact pages it links to.
export const dynamic = "force-dynamic";

export default async function SchoolsPage() {
  const data = await getSchoolsData();
  return <SchoolsClient data={data} />;
}
