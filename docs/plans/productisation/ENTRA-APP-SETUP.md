# The Entra app registration, and what to ask the customer's IT for

**Both new tenants are on Microsoft 365** — Animech and Spennare, each confirmed by MX — so
both need this, and it is the same procedure in each of their own tenants.

Admin consent is called out in `07-microsoft-graph.md` as **the slowest external step in the
whole programme**. It is not slow because it is hard; it is slow because it goes through
someone else's IT department, who are right to ask questions before granting an application
permission to a mail system. This document exists so the asking can start on day one instead
of at the point the code is ready.

Everything below happens in **the customer's own Entra tenant**, not Jacob's. They own the
domain and the mailboxes.

## The two-minute version, for the person who has to approve it

> We need an application registered in your Microsoft 365 tenant so our CRM can send from,
> and read replies in, a small number of named mailboxes.
>
> We are asking for **application permissions restricted by an Application Access Policy**,
> which means the app can reach **only the mailboxes you put in one group** — not the tenant.
> Without that policy the same permissions would reach every mailbox, which we do not want
> either.
>
> There is no user sign-in and no refresh token, so nothing silently disconnects when someone
> changes a password, and there is no standing session for an attacker to ride.

If they push back on application permissions, the honest answer is that the alternative is
worse for them, not better: delegated access means one long-lived refresh token per mailbox,
stored by us, silently expiring, and re-consented by end users who will click through
anything. That failure mode has already cost Wrenchlane live campaigns.

## What to ask for

Send this list. It is deliberately short, and nothing on it is negotiable-but-unstated.

1. **An app registration** named something recognisable, e.g. `Wrenchlane CRM (mail)`.
   Single tenant. No redirect URI is needed — there is no interactive sign-in.
2. **Application permissions** on Microsoft Graph, with admin consent granted:
   - `Mail.Send`
   - `Mail.ReadWrite`
3. **An Application Access Policy** scoping that app to a named group of mailboxes.
4. **A client secret**, and its expiry date.

Then have them send back three values: **tenant id**, **client id**, **client secret**.

## The Application Access Policy is the part that matters

Without it, `Mail.Send` and `Mail.ReadWrite` as application permissions reach **every mailbox
in the tenant**. No competent IT department will accept that, and they would be right not to.
Ask for the policy in the same message as the permissions, so it never looks like something
we tried to slip past them.

In Exchange Online PowerShell, in their tenant:

```powershell
Connect-ExchangeOnline

# 1. A mail-enabled security group holding ONLY the mailboxes the CRM may touch.
New-DistributionGroup -Name "CRM Mail Access" -Alias crm-mail-access `
  -Type Security -Members "sales@customer.example","info@customer.example"

# 2. Restrict the app to exactly that group.
New-ApplicationAccessPolicy -AppId <client-id> `
  -PolicyScopeGroupId crm-mail-access@customer.example `
  -AccessRight RestrictAccess `
  -Description "Restrict the Wrenchlane CRM app to the mailboxes in this group"

# 3. Prove it. The first must be Granted, the second Denied.
Test-ApplicationAccessPolicy -Identity sales@customer.example -AppId <client-id>
Test-ApplicationAccessPolicy -Identity ceo@customer.example  -AppId <client-id>
```

**Ask them to send the output of both `Test-ApplicationAccessPolicy` calls.** That is the
only evidence the policy is actually in force, and it is cheap for them to produce. A policy
can take a little while to propagate, so a Denied that should be Granted is worth retrying
before treating it as wrong.

Adding a mailbox later means adding it to the group. It does not mean touching the app.

## Receiving the secret

The client secret is a credential belonging to **that customer's tenant**. Ground rule R7:
no credential crosses a tenant boundary. In practice:

- It goes into **that customer's own deployment**, as `MICROSOFT_TENANT_ID`,
  `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET`, and nowhere else.
- Never into Wrenchlane's `.env.local`, never into this repository, never into a shared
  secrets file alongside another customer's.
- **Record the expiry date** with the customer's other details. A client secret expires,
  usually in 6, 12 or 24 months, and when it does every mailbox for that customer stops at
  once. That is the one failure mode app-only auth does not remove, so it is the one to put a
  reminder on.

Ask them not to send it over email if there is any alternative.

## As soon as you have the three values, run the spike

```bash
export MICROSOFT_TENANT_ID=... MICROSOFT_CLIENT_ID=... MICROSOFT_CLIENT_SECRET=...
export GRAPH_SPIKE_MAILBOX=probe@customer.example
export GRAPH_SPIKE_RECIPIENT=<somewhere you can reply from>

node scripts/graph-spike.mjs send      # checks 1 and 2
# reply to the mail that arrives, keeping the quoted thread
node scripts/graph-spike.mjs watch     # checks 3 and 4
```

Ask for **one throwaway mailbox first**, not the real sending ones. The spike sends a real
message and the point is to find out what Exchange does to it.

`GraphProvider` is written but **has never touched a real tenant**. Until that script has
passed, nothing in `src/lib/mail/microsoft/` should be trusted. If a check fails, that is a
design input for phase 07, not a bug to work around quietly — stop and talk to Jacob (R11).

## Sending domains: do not skip this

**Animech's SPF ends in `-all`.** Sending outbound from `animech.com` through anything not
already in their SPF record will be rejected, not merely marked down. They need a **separate
sending domain**, warmed, with its own SPF, DKIM and DMARC, exactly as Wrenchlane does.

**Spennare has two conflicting `v=spf1` records on `spennare.com`,** which is invalid: RFC
7208 says a domain publishing more than one SPF record is a `permerror`, and receivers may
fail every check. Raise it early. It is their bug, it is cheap to fix, and it will otherwise
be blamed on whatever we send.

Neither of these is a Graph problem, and neither shows up in the spike. They show up as mail
that quietly does not arrive.

## Who to talk to

- **Animech:** `it@animech.com` receives their DMARC reports and is the technical contact.
  See `~/Documents/Any/research/` for the wider account picture.
- **Spennare:** see `~/Documents/Spennare/research/`.

Both are in the customer-research memories; neither belongs in this repository.
