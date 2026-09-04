import { ConfiguratorsClient } from "@/components/configurators/configurators-client";
import { getConfiguratorsData } from "@/lib/configurators/data";

export const metadata = {
  title: "Configurators",
};

// Read live: the contact rows are edited in the CRM, so a cached render would show
// counts that disagree with the contact pages this table links to.
export const dynamic = "force-dynamic";

export default async function ConfiguratorsPage() {
  const data = await getConfiguratorsData();
  return <ConfiguratorsClient data={data} />;
}
