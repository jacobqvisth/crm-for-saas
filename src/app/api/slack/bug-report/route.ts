import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { postBugReport } from "@/lib/slack/notify";

// Post a call follow-up / bug to the #bug-reports Slack channel. Authorized as
// a workspace member; the channel is fixed by the SLACK_BUG_REPORTS_WEBHOOK_URL
// incoming webhook (set in Vercel env).

const Body = z.object({
  title: z.string().min(1).max(500),
  detail: z.string().max(2000).nullish(),
  contactId: z.string().uuid().nullish(),
  contactName: z.string().max(200).nullish(),
  companyName: z.string().max(200).nullish(),
  dueDate: z.string().max(40).nullish(),
});

function appBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://crm-for-saas.vercel.app";
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
  }
  const b = parsed.data;

  const result = await postBugReport({
    title: b.title,
    detail: b.detail,
    contactName: b.contactName,
    companyName: b.companyName,
    contactUrl: b.contactId ? `${appBaseUrl()}/contacts/${b.contactId}` : null,
    dueDate: b.dueDate,
    reportedBy: user.email ?? null,
  });

  if (!result.configured) {
    return NextResponse.json(
      { error: "Slack is not configured (SLACK_BUG_REPORTS_WEBHOOK_URL missing)." },
      { status: 503 },
    );
  }
  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? "Failed to post to Slack" }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
