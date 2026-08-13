import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { findPhonesForRecord } from "@/lib/enrich/find-phone-for-contact";
import type { PhoneSearchProgress } from "@/lib/enrich/find-phone";

// Website discovery + scraping + Google Maps + web search can take a while.
export const maxDuration = 180;

// The finder gets less than the full function budget so there is always room to
// rank, persist, and respond. Being killed by the platform timeout discards
// every number already found, which is strictly worse than returning partials.
const SEARCH_BUDGET_MS = 150_000;

/** One line of the NDJSON progress stream. */
type StreamEvent =
  | ({ type: "progress" } & PhoneSearchProgress)
  | { type: "result"; result: unknown }
  | { type: "error"; error: string };

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { workspaceId, contactId, companyId, stream } = body as {
    workspaceId: string;
    contactId?: string;
    companyId?: string;
    /** Opt in to the NDJSON progress stream (the contact panel does). Without
     *  it the response stays a single JSON object, as other callers expect. */
    stream?: boolean;
  };

  if (!workspaceId) {
    return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });
  }
  if (!contactId && !companyId) {
    return NextResponse.json({ error: "Missing contactId or companyId" }, { status: 400 });
  }

  // Workspace membership check
  const { data: member } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const deadline = Date.now() + SEARCH_BUDGET_MS;

  if (!stream) {
    const result = await findPhonesForRecord(supabase, {
      workspaceId,
      contactId,
      companyId,
      deadline,
    });
    return NextResponse.json(result);
  }

  // --- Streaming mode -------------------------------------------------------
  // Each leg of the search takes tens of seconds, so send progress as it happens
  // instead of leaving the user watching a spinner for three minutes. Streaming
  // also means the connection is producing bytes throughout, so a slow run reads
  // as "still working" rather than "hung".
  const encoder = new TextEncoder();
  const body$ = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: StreamEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // Client hung up (navigated away). Stop writing, but let the search
          // finish so its DB writes still land.
          open = false;
        }
      };

      try {
        const result = await findPhonesForRecord(supabase, {
          workspaceId,
          contactId,
          companyId,
          deadline,
          onProgress: (e) => send({ type: "progress", ...e }),
        });
        send({ type: "result", result });
      } catch (err) {
        console.error("[find-phone] stream failed", err);
        send({
          type: "error",
          error: err instanceof Error ? err.message : "Phone search failed",
        });
      } finally {
        open = false;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(body$, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      // Belt and braces against proxies that would otherwise buffer the stream.
      "X-Accel-Buffering": "no",
    },
  });
}
