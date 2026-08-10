import { PricingOptionsClient } from "@/components/pricing-options/pricing-options-client";

export const metadata = {
  title: "Pricing options",
};

// Brainstorm surface for plan structure. Static drafts only, no Stripe reads or
// writes, so it stays cheap and cannot drift the real pricing out from under us.
export default function PricingOptionsPage() {
  return <PricingOptionsClient />;
}
