// Read-only Customer.io App API helpers for the activation plan: list
// campaigns and fetch the email content (subject + body) of a campaign's
// actions, so the touchpoint modal can show exactly what we're saying in
// each step. Uses the same env credentials as the hourly metrics sync
// (src/lib/ceo/sync/sources/customer-io.ts). We never write to Customer.io.

import { getEnv } from "@/lib/ceo/env";

export interface CioCampaignSummary {
  id: number;
  name: string;
  state: string | null;
  type: string | null;
}

export interface CioEmail {
  id: number;
  name: string | null;
  subject: string | null;
  from: string | null;
  body: string | null;
}

function apiBase(): string {
  return getEnv("CUSTOMER_IO_REGION")?.toLowerCase() === "eu"
    ? "https://api-eu.customer.io/v1"
    : "https://api.customer.io/v1";
}

function dashboardBase(): string {
  return getEnv("CUSTOMER_IO_REGION")?.toLowerCase() === "eu"
    ? "https://fly-eu.customer.io"
    : "https://fly.customer.io";
}

export function cioConfigured(): boolean {
  return Boolean(getEnv("CUSTOMER_IO_APP_API_KEY"));
}

async function cioGet(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${apiBase()}${path}`, {
    headers: { authorization: `Bearer ${getEnv("CUSTOMER_IO_APP_API_KEY")}` },
    // Campaign definitions change rarely; a short cache keeps the modal snappy.
    next: { revalidate: 300 },
  });
  if (!res.ok) {
    throw new Error(`Customer.io API ${res.status} on ${path}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

export async function listCampaigns(): Promise<CioCampaignSummary[]> {
  const payload = await cioGet("/campaigns");
  const campaigns = Array.isArray(payload.campaigns) ? payload.campaigns : [];
  return campaigns
    .map((c) => {
      const rec = c as Record<string, unknown>;
      return {
        id: Number(rec.id),
        name: String(rec.name ?? `Campaign ${rec.id}`),
        state: rec.state != null ? String(rec.state) : rec.active === true ? "running" : null,
        type: rec.type != null ? String(rec.type) : null,
      };
    })
    .filter((c) => Number.isFinite(c.id))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Fetch the campaign's email actions with full content (subject + body). */
export async function getCampaignEmails(
  campaignId: number,
  maxEmails = 5
): Promise<{ campaign: CioCampaignSummary | null; emails: CioEmail[] }> {
  const [campaignPayload, actionsPayload] = await Promise.all([
    cioGet(`/campaigns/${campaignId}`).catch(() => null),
    cioGet(`/campaigns/${campaignId}/actions`),
  ]);

  const campaignRec = (campaignPayload?.campaign ?? null) as Record<string, unknown> | null;
  const campaign: CioCampaignSummary | null = campaignRec
    ? {
        id: Number(campaignRec.id ?? campaignId),
        name: String(campaignRec.name ?? `Campaign ${campaignId}`),
        state:
          campaignRec.state != null
            ? String(campaignRec.state)
            : campaignRec.active === true
              ? "running"
              : null,
        type: campaignRec.type != null ? String(campaignRec.type) : null,
      }
    : null;

  const actions = Array.isArray(actionsPayload.actions) ? actionsPayload.actions : [];
  const emailActions = actions
    .map((a) => a as Record<string, unknown>)
    .filter((a) => String(a.type ?? "").toLowerCase() === "email")
    .slice(0, maxEmails);

  const emails = await Promise.all(
    emailActions.map(async (a) => {
      const id = Number(a.id);
      try {
        const detail = await cioGet(`/campaigns/${campaignId}/actions/${id}`);
        const action = (detail.action ?? detail) as Record<string, unknown>;
        return {
          id,
          name: action.name != null ? String(action.name) : null,
          subject: action.subject != null ? String(action.subject) : null,
          from: action.from != null ? String(action.from) : null,
          body: action.body != null ? String(action.body) : null,
        };
      } catch {
        return {
          id,
          name: a.name != null ? String(a.name) : null,
          subject: null,
          from: null,
          body: null,
        };
      }
    })
  );

  return { campaign, emails };
}

/** Best-effort deep link into the Customer.io campaign editor. */
export async function campaignDashboardUrl(campaignId: number): Promise<string> {
  try {
    const payload = await cioGet("/workspaces");
    const workspaces = Array.isArray(payload.workspaces) ? payload.workspaces : [];
    const first = workspaces[0] as Record<string, unknown> | undefined;
    if (first?.id != null) {
      return `${dashboardBase()}/env/${first.id}/campaigns/${campaignId}`;
    }
  } catch {
    /* fall through to the dashboard root */
  }
  return dashboardBase();
}
