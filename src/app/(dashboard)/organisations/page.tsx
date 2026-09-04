import { OrgsClient } from "@/components/orgs/orgs-client";
import { getOrgsData } from "@/lib/orgs/data";

export const metadata = {
  title: "Branschorganisationer",
};

// Read live: the contact rows are edited in the CRM, so a cached render would show
// counts that disagree with the contact pages this table links to.
export const dynamic = "force-dynamic";

export default async function OrganisationsPage() {
  const data = await getOrgsData();
  return <OrgsClient data={data} />;
}
