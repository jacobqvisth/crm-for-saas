import { redirect } from "next/navigation";

// The partner manager moved into the tabbed Exclusion Lists page.
export default function PartnersRedirect() {
  redirect("/settings/exclusions?tab=partners");
}
