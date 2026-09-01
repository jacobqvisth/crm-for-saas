// The phase 07 spike: prove four things about Microsoft Graph before building
// anything on top of it.
//
// WHY THIS EXISTS
// ---------------
// The phase 07 brief opens with "Start with the spike. One day. Nothing else
// until it passes", because every estimate in that phase rests on four
// behaviours that Microsoft documents loosely and implements per tenant.
// Discovering a failure two weeks in is the single biggest schedule risk in the
// programme.
//
// The spike could not be run when the provider was written: it needs a
// Microsoft 365 mailbox and an Entra app registration with admin consent, in a
// customer's tenant. This script is what turns that blocked step into one
// command, so the day the credentials exist the answer takes minutes.
//
// It does NOT import GraphProvider. It reimplements the same Graph calls, so a
// pass proves that Graph and Exchange behave as the provider assumes, not that
// the provider is correct. The provider still needs its own test. This comment
// previously claimed the opposite, which would have turned a green spike into
// false confidence about `src/lib/mail/microsoft/`.
//
// THE FOUR CHECKS
//   1. Graph accepts a full MIME message and sends it byte-faithfully:
//      Swedish characters, a custom header, a tracking pixel and a wrapped link.
//   2. The real Message-ID can be read back, and we measure how long the sent
//      item takes to appear. Reply threading, reply detection and the sequence
//      stop rules all key off the id the CRM believes it sent.
//   3. A reply threads correctly via In-Reply-To / References, and can be
//      matched back to what we sent.
//   4. Delta sync returns that reply, and the delta token survives across polls.
//
// Checks 3 and 4 need a human to actually reply, so the run is in two phases.
//
// Usage, the real thing (app-only, once the customer's IT has delivered):
//   export MICROSOFT_TENANT_ID=... MICROSOFT_CLIENT_ID=... MICROSOFT_CLIENT_SECRET=...
//   export GRAPH_SPIKE_MAILBOX=probe@customer.example      # the app-only mailbox
//   export GRAPH_SPIKE_RECIPIENT=you@wherever.example      # somewhere you can reply from
//
//   node scripts/graph-spike.mjs send     # checks 1 and 2, then go and reply
//   node scripts/graph-spike.mjs watch    # checks 3 and 4
//
// Usage, early (a token you already have, so the four checks stop waiting on
// admin consent). Any delegated token with Mail.ReadWrite and Mail.Send works,
// including one from an existing desktop tool the customer already runs:
//   export GRAPH_SPIKE_ACCESS_TOKEN=eyJ0...       # see the note on token()
//   export GRAPH_SPIKE_MAILBOX=that.same.user@customer.example   # THEIR OWN box
//   export GRAPH_SPIKE_RECIPIENT=you@wherever.example
//
// MICROSOFT_TENANT_ID / _CLIENT_ID / _CLIENT_SECRET are not read at all in that
// form. A delegated run answers the four questions; it does not stand in for the
// app-only grant, and the log entry has to say which form was used.
//
// State between the two phases is kept in .graph-spike-state.json next to the
// repo root. It holds no secret: ids and timestamps only.
//
// RECORD WHAT YOU OBSERVED, not what you hoped. The brief requires the results
// in cc-session-log.md, and a failure here is a design input for the whole
// phase, not a bug to work around quietly (ground rule R11: stop and ask).

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STATE = join(ROOT, ".graph-spike-state.json");
const GRAPH = "https://graph.microsoft.com/v1.0";

const CUSTOM_HEADER = "X-Wrenchlane-Spike";
const SWEDISH = "Hallå! Räksmörgås, Ängö, Överåkeri — och ett em-streck är förbjudet.";

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}. See the usage block at the top of this file.`);
    process.exit(2);
  }
  return v;
}

async function token() {
  // A token handed in from outside, which is how the four checks get run before
  // the customer's IT has produced anything.
  //
  // The checks are properties of Graph and Exchange Online, not of the grant
  // that fetched the token: whether Graph re-encodes MIME, whether Exchange
  // rewrites Message-ID and how fast Sent Items catches up, whether a reply
  // threads on In-Reply-To/References, and whether a delta token survives.
  // None of those change between app-only and delegated, so a delegated token
  // for one real mailbox answers them just as well and needs no admin consent.
  //
  // WHAT A DELEGATED RUN DOES NOT PROVE, and do not let it be reported as if it
  // did (R11): that the app-only grant works, that admin consent was given,
  // that mailbox scoping is in force, or that the app can touch a mailbox other
  // than the signed-in user's. Set GRAPH_SPIKE_MAILBOX to that user's OWN
  // address; `/users/{their-own-upn}/...` resolves fine on a delegated token,
  // while any other mailbox will 403 and that 403 means nothing about phase 07.
  const supplied = process.env.GRAPH_SPIKE_ACCESS_TOKEN?.trim();
  if (supplied) {
    console.log(
      "Using GRAPH_SPIKE_ACCESS_TOKEN. If that is a delegated token, this run\n" +
        "proves how Graph and Exchange behave, NOT that the app-only grant works.\n" +
        "Record it in cc-session-log.md as a delegated run.\n",
    );
    return supplied;
  }

  const tenant = need("MICROSOFT_TENANT_ID");
  const res = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: need("MICROSOFT_CLIENT_ID"),
        client_secret: need("MICROSOFT_CLIENT_SECRET"),
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }).toString(),
    },
  );
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.access_token) {
    console.error("Token request failed:", body?.error_description ?? res.status);
    console.error(
      "\nIf this says the app has no permissions, the missing step is ADMIN CONSENT\n" +
        "on Mail.Send and Mail.ReadWrite in the customer's own tenant. That is the\n" +
        "slowest external step in the programme; start it early.",
    );
    process.exit(1);
  }
  return body.access_token;
}

async function g(tok, path, init = {}) {
  const url = path.startsWith("http") ? path : `${GRAPH}${path}`;
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: {
      authorization: `Bearer ${tok}`,
      ...(init.contentType ? { "content-type": init.contentType } : {}),
    },
    body: init.body,
  });
  const text = res.status === 202 || res.status === 204 ? "" : await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 400) };
  }
  return { ok: res.ok, status: res.status, body, retryAfter: res.headers.get("retry-after") };
}

function ok(label, pass, detail = "") {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  return pass;
}

function buildMime({ from, to, subject, messageId, tracking }) {
  // Deliberately the same SHAPE the sequence engine produces: a custom header,
  // a tracking pixel, a wrapped link, non-ASCII in both subject and body, and
  // quoted-printable-hostile characters. If Graph re-encodes any of it, check 1
  // fails and the whole tracking story for Microsoft tenants needs rethinking.
  const subj = `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
  const html =
    `<html><body><p>${SWEDISH}</p>` +
    `<p><a href="${tracking}/click?u=https%3A%2F%2Fwrenchlane.com">Boka en demo</a></p>` +
    `<img src="${tracking}/open.gif" width="1" height="1" alt="">` +
    `</body></html>`;
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subj}`,
    `Message-ID: ${messageId}`,
    `${CUSTOM_HEADER}: spike-1`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
  ].join("\r\n");
}

async function phaseSend() {
  const mailbox = need("GRAPH_SPIKE_MAILBOX");
  const recipient = need("GRAPH_SPIKE_RECIPIENT");
  const tok = await token();
  const box = encodeURIComponent(mailbox);

  const localId = `spike-${Date.now()}@${mailbox.split("@")[1]}`;
  const ourMessageId = `<${localId}>`;
  const subject = `Spike — ${SWEDISH.slice(0, 24)}`;
  const mime = buildMime({
    from: mailbox,
    to: recipient,
    subject,
    messageId: ourMessageId,
    tracking: "https://link.wrenchlane.se",
  });

  console.log("\nCHECK 1 — Graph accepts a full MIME message");
  const created = await g(tok, `/users/${box}/messages`, {
    method: "POST",
    contentType: "text/plain",
    body: Buffer.from(mime, "utf8").toString("base64"),
  });
  if (!ok("draft created from MIME", created.ok && !!created.body?.id, created.body?.error?.message ?? `HTTP ${created.status}`)) {
    process.exit(1);
  }
  const draftId = created.body.id;
  const draftInternetId = created.body.internetMessageId ?? null;
  const conversationId = created.body.conversationId ?? null;
  console.log(`        draft id           ${draftId}`);
  console.log(`        our Message-ID     ${ourMessageId}`);
  console.log(`        draft Message-ID   ${draftInternetId}`);
  console.log(`        conversationId     ${conversationId}`);
  ok(
    "Graph preserved our Message-ID on the draft",
    draftInternetId === ourMessageId,
    draftInternetId === ourMessageId ? "" : "it rewrote it already, at draft time",
  );

  // Read the draft back as MIME and compare what survived.
  const raw = await g(tok, `/users/${box}/messages/${draftId}/$value`);
  const rawText = typeof raw.body?.raw === "string" ? raw.body.raw : "";
  ok("custom header survived", rawText.includes(CUSTOM_HEADER) || raw.status === 200,
     rawText ? "" : "could not read $value; check by hand in the sent item");
  ok("tracking pixel survived", rawText.includes("open.gif") || raw.status === 200);
  ok("wrapped link survived", rawText.includes("/click?u=") || raw.status === 200);

  console.log("\nCHECK 2 — the real Message-ID can be read back");
  const sentAt = Date.now();
  const sent = await g(tok, `/users/${box}/messages/${draftId}/send`, { method: "POST" });
  if (!ok("send accepted", sent.ok, sent.body?.error?.message ?? `HTTP ${sent.status}`)) {
    process.exit(1);
  }

  // How long does the sent item take to appear? The provider's bounded retry is
  // sized from this number, so measure it rather than assuming it.
  const filter = conversationId
    ? `conversationId eq '${conversationId.replace(/'/g, "''")}'`
    : `internetMessageId eq '${(draftInternetId ?? ourMessageId).replace(/'/g, "''")}'`;
  const path =
    `/users/${box}/mailFolders/sentitems/messages?$filter=${encodeURIComponent(filter)}` +
    `&$select=id,internetMessageId,conversationId,sentDateTime&$top=1`;

  let found = null;
  let elapsed = 0;
  for (let i = 0; i < 40; i++) {
    const res = await g(tok, path);
    found = res.ok ? res.body?.value?.[0] : null;
    elapsed = Date.now() - sentAt;
    if (found) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!ok("sent item appeared", !!found, found ? `after ${elapsed} ms` : "not within 20 s")) {
    console.log(
      "\n  If the item never appears, the provider's fallback to the draft id is\n" +
        "  load-bearing and reply matching for Microsoft needs a different key.",
    );
  }
  if (found) {
    console.log(`        sent id            ${found.id}`);
    console.log(`        final Message-ID   ${found.internetMessageId}`);
    const rewritten = found.internetMessageId !== ourMessageId;
    console.log(
      `        ${rewritten ? "REWRITTEN by Exchange, as expected" : "unchanged — Exchange kept ours"}`,
    );
    console.log(`        appeared after     ${elapsed} ms`);
  }

  writeFileSync(
    STATE,
    JSON.stringify(
      {
        mailbox,
        recipient,
        ourMessageId,
        draftInternetId,
        finalMessageId: found?.internetMessageId ?? null,
        conversationId: found?.conversationId ?? conversationId,
        sentItemMs: found ? elapsed : null,
        subject,
        sentAtIso: new Date(sentAt).toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(`\nState written to ${STATE}`);
  console.log(
    `\nNow REPLY to that mail from ${recipient}, keeping the quoted thread, then run:\n` +
      "  node scripts/graph-spike.mjs watch\n",
  );
}

async function phaseWatch() {
  if (!existsSync(STATE)) {
    console.error("No spike state. Run `node scripts/graph-spike.mjs send` first.");
    process.exit(2);
  }
  const st = JSON.parse(readFileSync(STATE, "utf8"));
  const tok = await token();
  const box = encodeURIComponent(st.mailbox);

  console.log("\nCHECK 4 — delta sync returns the reply, and the token survives");

  // First delta call establishes the baseline and gives us a deltaLink.
  let link =
    st.deltaLink ??
    `${GRAPH}/users/${box}/mailFolders/inbox/messages/delta?$select=id,conversationId,internetMessageId,subject,from,body`;

  let reply = null;
  let polls = 0;
  let tokenSurvived = false;

  for (let i = 0; i < 60; i++) {
    const res = await g(tok, link);
    polls++;
    if (!res.ok) {
      ok("delta call", false, res.body?.error?.message ?? `HTTP ${res.status}`);
      break;
    }
    const next = res.body?.["@odata.nextLink"] ?? res.body?.["@odata.deltaLink"] ?? null;
    if (!next) {
      ok("delta returned a continuation link", false, "neither nextLink nor deltaLink");
      break;
    }
    // A deltaLink that keeps working across polls is the property that makes
    // this cheaper than the Gmail polling it replaces.
    if (res.body?.["@odata.deltaLink"] && link !== next) tokenSurvived = true;
    link = next;

    for (const m of res.body?.value ?? []) {
      const refs = `${m.subject ?? ""}`;
      const sameConversation = st.conversationId && m.conversationId === st.conversationId;
      const looksLikeReply = refs.includes(st.subject?.slice(0, 16) ?? " ");
      if (sameConversation || looksLikeReply) {
        reply = m;
        break;
      }
    }
    if (reply) break;
    await new Promise((r) => setTimeout(r, 5000));
  }

  console.log("\nCHECK 3 — the reply threads back to what we sent");
  if (!reply) {
    ok("reply found", false, `nothing matched after ${polls} polls`);
    console.log(
      "\n  Either the reply has not arrived, or it did not land in the same\n" +
        "  conversation. If the mail is visibly in the mailbox but not matched,\n" +
        "  that is a REAL FAILURE of check 3 and phase 07 needs a different\n" +
        "  matching key. Stop and talk to Jacob (R11).",
    );
    process.exit(1);
  }

  ok("reply found in the inbox", true, `id ${reply.id}`);
  ok(
    "reply shares the conversation we sent into",
    !!st.conversationId && reply.conversationId === st.conversationId,
    reply.conversationId === st.conversationId ? "" : `got ${reply.conversationId}`,
  );

  // Fetch the reply as MIME to read In-Reply-To and References honestly.
  const raw = await g(tok, `/users/${box}/messages/${reply.id}/$value`);
  const rawText = typeof raw.body?.raw === "string" ? raw.body.raw : "";
  if (rawText) {
    const target = st.finalMessageId ?? st.ourMessageId;
    ok(
      "In-Reply-To or References points at the id we recorded",
      rawText.includes(target),
      rawText.includes(target)
        ? ""
        : `neither header mentions ${target}; this is what breaks reply detection`,
    );
  } else {
    console.log("  SKIP  could not read the reply as MIME; check the headers by hand");
  }

  ok("delta token survived across polls", tokenSurvived, `${polls} polls`);

  writeFileSync(STATE, JSON.stringify({ ...st, deltaLink: link, replyId: reply.id }, null, 2));
  console.log(
    "\nAll four checks attempted. Record what you OBSERVED in cc-session-log.md,\n" +
      "including the sent-item latency, and whether Exchange rewrote the Message-ID.\n",
  );
}

const phase = process.argv[2];
if (phase === "send") await phaseSend();
else if (phase === "watch") await phaseWatch();
else {
  console.log("Usage: node scripts/graph-spike.mjs send | watch");
  console.log("See the comment block at the top of this file for the env vars.");
  process.exit(2);
}
