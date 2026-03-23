import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ trackingId: string }> }
) {
  const { trackingId } = await params;

  // TODO: Process unsubscribe
  // - Look up email_queue by tracking_id to get contact email and workspace_id
  // - Insert into unsubscribes table
  // - Update contact status to 'unsubscribed'
  // - Insert email_event with event_type = 'unsubscribe'
  // - Cancel any pending emails for this contact
  console.log(`Unsubscribe: ${trackingId}`);

  const html = `
    <!DOCTYPE html>
    <html>
      <head><title>Unsubscribed</title></head>
      <body style="font-family: sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f8fafc;">
        <div style="text-align: center; padding: 2rem;">
          <h1 style="color: #0f172a; font-size: 1.5rem;">You've been unsubscribed</h1>
          <p style="color: #64748b; margin-top: 0.5rem;">You will no longer receive emails from this sender.</p>
        </div>
      </body>
    </html>
  `;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html" },
  });
}
