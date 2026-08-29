// Moved to `@/lib/mail/google/client` in phase 06, so that everything which
// speaks the Gmail API lives under `lib/mail/`.
//
// This file stays as a re-export rather than being deleted, because the seven
// live API call sites (the send engine, the two sync crons, the inbox routes
// and the OAuth connect) are being migrated onto the MailProvider interface one
// at a time. Deleting it would have meant rewiring all of them in a single
// change to Wrenchlane's live outbound path, with no way to verify a real send
// before merging. Each call site drops its import here as it moves.
export { getOAuth2Client, getGmailClient, GMAIL_SCOPES } from "@/lib/mail/google/client";
