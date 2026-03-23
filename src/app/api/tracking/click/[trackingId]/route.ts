import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ trackingId: string }> }
) {
  const { trackingId } = await params;
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  // TODO: Record click event in email_events table
  // - Look up email_queue by tracking_id
  // - Insert email_event with event_type = 'click' and link_url
  // - Include user_agent and ip_address from request headers
  console.log(`Link clicked: ${trackingId}, URL: ${url}`);

  if (url) {
    return NextResponse.redirect(url);
  }

  return new NextResponse("Invalid link", { status: 400 });
}
