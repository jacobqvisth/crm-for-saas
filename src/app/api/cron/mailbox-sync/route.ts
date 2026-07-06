import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getGmailClient } from "@/lib/gmail/client";
import { getValidAccessToken } from "@/lib/gmail/token-refresh";
import type { gmail_v1 } from "googleapis";
import {
  getHeader,
  parseEmailAddress,
  parseAddressList,
  extractTextBody,
  extractHtmlBody,
  isAutoReply,
  type GmailHeader,
} from "@/lib/gmail/messages";
import {
  findContactByEmail,
  autoCreateContactFromMail,
  emailDomain,
  isRoleOrNoReplyAddress,
} from "@/lib/contacts/match";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Supabase = SupabaseClient<Database>;

// Walks Gmail threads sequentially (one threads.get per thread) — give it the
// Pro plan's max budget. Per-run work is bounded by THREADS_PER_PAGE × accounts.
export const maxDuration = 300;

// How many threads to pull per account per run. Each threads.get is ~250ms, so
// ~75 ≈ 20s/account — comfortably inside the budget for a handful of senders.
const THREADS_PER_PAGE = 75;
// Stop starting new accounts past this elapsed time so we always return cleanly.
const TIME_BUDGET_MS = 250_000;
// Overlap the incremental window so a message landing right on the boundary
// isn't missed; idempotency gates dedup the overlap.
const INCREMENTAL_OVERLAP_MS = 60 * 60 * 1000;

type AccountRow = {
  id: string;
  email_address: string;
  workspace_id: string;
  status: string | null;
};

type SyncStateRow = {
  gmail_account_id: string;
  backfill_cursor: string | null;
  backfill_done_at: string | null;
  last_synced_at: string | null;
  messages_synced: number | null;
};

type Stats = { inbound: number; outbound: number; threads: number };

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const startedAt = Date.now();

  const { data: accounts } = await supabase
    .from("gmail_accounts")
    .select("id, email_address, workspace_id, status")
    .neq("status", "disconnected");

  if (!accounts || accounts.length === 0) {
    return NextResponse.json({ ok: true, accounts: 0 });
  }

  // Internal domains per workspace — addresses we never treat as a contact
  // (team-to-team mail). Derived from the connected mailboxes themselves.
  const internalByWorkspace = new Map<string, Set<string>>();
  for (const a of accounts as AccountRow[]) {
    const d = emailDomain(a.email_address);
    if (!d) continue;
    if (!internalByWorkspace.has(a.workspace_id)) internalByWorkspace.set(a.workspace_id, new Set());
    internalByWorkspace.get(a.workspace_id)!.add(d);
  }

  const perAccount: Record<string, Stats & { mode: string }> = {};

  for (const account of accounts as AccountRow[]) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) break;
    const internalDomains = internalByWorkspace.get(account.workspace_id) ?? new Set<string>();
    try {
      const result = await processAccount(supabase, account, internalDomains, startedAt);
      perAccount[account.email_address] = result;
    } catch (err) {
      console.error(`mailbox-sync failed for ${account.email_address}:`, err);
    }
  }

  return NextResponse.json({ ok: true, accounts: accounts.length, perAccount });
}

async function processAccount(
  supabase: Supabase,
  account: AccountRow,
  internalDomains: Set<string>,
  startedAt: number,
): Promise<Stats & { mode: string }> {
  const stats: Stats = { inbound: 0, outbound: 0, threads: 0 };

  const tokenResult = await getValidAccessToken(account.id);
  if ("error" in tokenResult) return { ...stats, mode: "token-error" };
  const gmail = getGmailClient(tokenResult.accessToken);

  // Load or create the sync cursor.
  let { data: state } = await supabase
    .from("gmail_sync_state")
    .select("gmail_account_id, backfill_cursor, backfill_done_at, last_synced_at, messages_synced")
    .eq("gmail_account_id", account.id)
    .maybeSingle<SyncStateRow>();

  if (!state) {
    await supabase
      .from("gmail_sync_state")
      .insert({ gmail_account_id: account.id, workspace_id: account.workspace_id });
    state = {
      gmail_account_id: account.id,
      backfill_cursor: null,
      backfill_done_at: null,
      last_synced_at: null,
      messages_synced: 0,
    };
  }

  const backfilling = !state.backfill_done_at;
  const mode = backfilling ? "backfill" : "incremental";
  const runStart = Date.now();

  // Build the list query.
  const baseQ = "-in:chats";
  const seqSendCache = new Map<string, boolean>();

  if (backfilling) {
    // One page per run, resumable via the stored pageToken.
    const resp = await gmail.users.threads.list({
      userId: "me",
      q: baseQ,
      maxResults: THREADS_PER_PAGE,
      pageToken: state.backfill_cursor ?? undefined,
    });
    const list: gmail_v1.Schema$ListThreadsResponse = resp.data;

    const threads = list.threads ?? [];
    for (const t of threads) {
      if (!t.id) continue;
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        // Out of time mid-page — leave the cursor untouched so we redo this
        // page next run (idempotency makes the redo safe).
        return { ...stats, mode };
      }
      await processThread(supabase, gmail, account, internalDomains, t.id, seqSendCache, stats);
      stats.threads++;
    }

    if (list.nextPageToken) {
      await supabase
        .from("gmail_sync_state")
        .update({
          backfill_cursor: list.nextPageToken,
          last_run_at: new Date().toISOString(),
          messages_synced: (state.messages_synced ?? 0) + stats.inbound + stats.outbound,
        })
        .eq("gmail_account_id", account.id);
    } else {
      // History exhausted — switch to incremental from this moment on.
      await supabase
        .from("gmail_sync_state")
        .update({
          backfill_cursor: null,
          backfill_done_at: new Date().toISOString(),
          last_synced_at: new Date(runStart).toISOString(),
          last_run_at: new Date().toISOString(),
          messages_synced: (state.messages_synced ?? 0) + stats.inbound + stats.outbound,
        })
        .eq("gmail_account_id", account.id);
    }
    return { ...stats, mode };
  }

  // Incremental: only threads with activity since last sync (minus overlap).
  const sinceMs = state.last_synced_at
    ? new Date(state.last_synced_at).getTime() - INCREMENTAL_OVERLAP_MS
    : runStart - 7 * 24 * 60 * 60 * 1000;
  const afterEpoch = Math.floor(sinceMs / 1000);
  const q = `${baseQ} after:${afterEpoch}`;

  let pageToken: string | undefined = undefined;
  let pages = 0;
  while (pages < 10 && Date.now() - startedAt < TIME_BUDGET_MS) {
    const resp = await gmail.users.threads.list({
      userId: "me",
      q,
      maxResults: THREADS_PER_PAGE,
      pageToken,
    });
    const list: gmail_v1.Schema$ListThreadsResponse = resp.data;
    const threads = list.threads ?? [];
    let outOfTime = false;
    for (const t of threads) {
      if (!t.id) continue;
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        outOfTime = true;
        break;
      }
      await processThread(supabase, gmail, account, internalDomains, t.id, seqSendCache, stats);
      stats.threads++;
    }
    pages++;
    const next = list.nextPageToken ?? undefined;
    if (outOfTime || !next) break;
    pageToken = next;
  }

  await supabase
    .from("gmail_sync_state")
    .update({
      last_synced_at: new Date(runStart).toISOString(),
      last_run_at: new Date().toISOString(),
      messages_synced: (state.messages_synced ?? 0) + stats.inbound + stats.outbound,
    })
    .eq("gmail_account_id", account.id);

  return { ...stats, mode };
}

async function processThread(
  supabase: Supabase,
  gmail: ReturnType<typeof getGmailClient>,
  account: AccountRow,
  internalDomains: Set<string>,
  threadId: string,
  seqSendCache: Map<string, boolean>,
  stats: Stats,
): Promise<void> {
  const { data: thread } = await gmail.users.threads.get({
    userId: "me",
    id: threadId,
    format: "full",
  });
  if (!thread?.messages?.length) return;

  const accountEmail = account.email_address.toLowerCase();
  const isInternal = (email: string): boolean => {
    if (email === accountEmail) return true;
    const d = emailDomain(email);
    return !!d && internalDomains.has(d);
  };

  // Pass 1 — who is on the other side, and is the thread genuinely two-way?
  const inboundFrom = new Set<string>();
  const outboundTo = new Set<string>();
  for (const m of thread.messages) {
    const headers = (m.payload?.headers ?? []) as GmailHeader[];
    const from = parseEmailAddress(getHeader(headers, "from")).email;
    if (!from) continue;
    if (from === accountEmail) {
      const recips = [
        ...parseAddressList(getHeader(headers, "to")),
        ...parseAddressList(getHeader(headers, "cc")),
      ];
      for (const r of recips) if (!isInternal(r)) outboundTo.add(r);
    } else if (!isInternal(from)) {
      inboundFrom.add(from);
    }
  }
  // Auto-create only for genuine two-way counterparties that aren't role/no-reply.
  const qualifying = new Set<string>();
  for (const e of inboundFrom) {
    if (outboundTo.has(e) && !isRoleOrNoReplyAddress(e)) qualifying.add(e);
  }

  // Resolve a counterparty to a contact (known, or auto-created if qualifying).
  const resolveCache = new Map<string, string | null>();
  const resolveContact = async (email: string, name: string | null): Promise<string | null> => {
    if (resolveCache.has(email)) return resolveCache.get(email)!;
    const match = await findContactByEmail(supabase, account.workspace_id, email);
    let contactId = match.contactId;
    if (!contactId && qualifying.has(email)) {
      contactId = await autoCreateContactFromMail(supabase, {
        workspaceId: account.workspace_id,
        email,
        name,
        companyId: match.companyId,
      });
    }
    resolveCache.set(email, contactId);
    return contactId;
  };

  // Pass 2 — log each message.
  for (const m of thread.messages) {
    const msgId = m.id;
    if (!msgId || !m.payload) continue;
    const headers = (m.payload.headers ?? []) as GmailHeader[];
    const fromParsed = parseEmailAddress(getHeader(headers, "from"));
    const from = fromParsed.email;
    if (!from) continue;

    const subject = getHeader(headers, "subject");
    const dateHeader = getHeader(headers, "date");
    const parsedDate = dateHeader ? new Date(dateHeader) : null;
    const tsIso =
      parsedDate && !isNaN(parsedDate.getTime())
        ? parsedDate.toISOString()
        : new Date().toISOString();

    if (from === accountEmail) {
      // ---- OUTBOUND ----
      const recips = [
        ...parseAddressList(getHeader(headers, "to")),
        ...parseAddressList(getHeader(headers, "cc")),
      ].filter((r) => !isInternal(r));
      if (recips.length === 0) continue;

      // Already logged by the sequence sender? Skip.
      if (await isSequenceSend(supabase, msgId, seqSendCache)) continue;

      let contactId: string | null = null;
      let usedRecip: string | null = null;
      for (const r of recips) {
        const id = await resolveContact(r, null);
        if (id) {
          contactId = id;
          usedRecip = r;
          break;
        }
      }
      if (!contactId) continue; // outbound to a stranger (one-way) — skip

      const inserted = await insertSyncedActivity(supabase, {
        workspace_id: account.workspace_id,
        type: "email_sent",
        subject: subject || "(no subject)",
        body: `Email sent to ${usedRecip}`,
        contact_id: contactId,
        // Stamp the activity with the real send date, not now(). Backfilled mail
        // is often months old; without this the whole thread bunches at sync time.
        created_at: tsIso,
        metadata: {
          synced_from: "mailbox_sync",
          direction: "outbound",
          gmail_message_id: msgId,
          gmail_thread_id: threadId,
          gmail_account_id: account.id,
          to: recips,
          sent_at: tsIso,
        },
      });
      if (inserted) {
        stats.outbound++;
        await touchContact(supabase, contactId, tsIso);
      }
    } else {
      // ---- INBOUND ----
      if (isInternal(from)) continue;
      const contactId = await resolveContact(from, fromParsed.name || null);
      if (!contactId) continue; // unknown one-way inbound — wait for two-way

      const bodyText = extractTextBody(m.payload);
      const bodyHtml = extractHtmlBody(m.payload);
      const autoReply = isAutoReply(headers, subject, bodyText);

      // Capture which of our addresses the mail was sent to, so it can be
      // attributed to an alias "lane" (e.g. support@wrenchlane.com is an alias
      // on this mailbox). Delivered-To is the most reliable alias signal; To/Cc
      // cover cases where routing leaves Delivered-To as the primary address.
      const toEmails = [
        ...parseAddressList(getHeader(headers, "to")),
        ...parseAddressList(getHeader(headers, "cc")),
      ];
      const deliveredTo = parseEmailAddress(getHeader(headers, "delivered-to")).email || null;

      // inbox_messages.gmail_message_id is UNIQUE; ignoreDuplicates means a
      // returned row == a genuinely new message (also dedups vs check-replies).
      const { data: insRows } = await supabase
        .from("inbox_messages")
        .upsert(
          {
            workspace_id: account.workspace_id,
            gmail_account_id: account.id,
            gmail_message_id: msgId,
            gmail_thread_id: threadId,
            contact_id: contactId,
            from_email: from,
            from_name: fromParsed.name || null,
            subject: subject || null,
            body_html: bodyHtml || null,
            body_text: bodyText || null,
            received_at: tsIso,
            is_auto_reply: autoReply,
            category: autoReply ? "out_of_office" : "inbox",
            to_emails: Array.from(new Set(toEmails)),
            delivered_to: deliveredTo,
          },
          { onConflict: "gmail_message_id", ignoreDuplicates: true },
        )
        .select("id");

      const isNew = !!(insRows && insRows.length > 0);
      if (!isNew) continue;
      stats.inbound++;

      if (!autoReply) {
        const inserted = await insertSyncedActivity(supabase, {
          workspace_id: account.workspace_id,
          type: "email_received",
          subject: "Email received",
          body: `Email from ${from}`,
          contact_id: contactId,
          // Real received date, not now() — see the outbound insert above.
          created_at: tsIso,
          metadata: {
            synced_from: "mailbox_sync",
            direction: "inbound",
            gmail_message_id: msgId,
            gmail_thread_id: threadId,
            gmail_account_id: account.id,
            from,
            received_at: tsIso,
            is_auto_reply: false,
          },
        });
        if (inserted) await touchContact(supabase, contactId, tsIso);
      }
    }
  }
}

/** Insert an activity, swallowing the 23505 dup (already-synced) violation. */
async function insertSyncedActivity(
  supabase: Supabase,
  row: Database["public"]["Tables"]["activities"]["Insert"],
): Promise<boolean> {
  const { error } = await supabase.from("activities").insert(row);
  if (!error) return true;
  if (error.code === "23505") return false; // already logged this message
  console.error("mailbox-sync activity insert failed:", error.message);
  return false;
}

/** Bump last_contacted_at, but never move it backwards (backfill safety). */
async function touchContact(supabase: Supabase, contactId: string, tsIso: string): Promise<void> {
  await supabase
    .from("contacts")
    .update({ last_contacted_at: tsIso })
    .eq("id", contactId)
    .or(`last_contacted_at.is.null,last_contacted_at.lt.${tsIso}`);
}

/** Is this Gmail message already an email_queue send (logged by process-emails)? */
async function isSequenceSend(
  supabase: Supabase,
  msgId: string,
  cache: Map<string, boolean>,
): Promise<boolean> {
  if (cache.has(msgId)) return cache.get(msgId)!;
  const { data } = await supabase
    .from("email_queue")
    .select("id")
    .eq("gmail_message_id", msgId)
    .limit(1)
    .maybeSingle();
  const res = !!data;
  cache.set(msgId, res);
  return res;
}

// Vercel Cron Jobs send GET requests — alias POST handler.
export const GET = POST;
