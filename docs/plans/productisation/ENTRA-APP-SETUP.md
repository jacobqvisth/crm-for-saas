# The Entra app registrations, and what to ask the customer's IT for

**Both new tenants are on Microsoft 365**, Animech and Spennare, each confirmed by MX, so both
need this, and it is the same procedure in each of their own tenants.

**There are TWO registrations, and conflating them costs a day.** They are asked for
separately, they can land weeks apart, and the small one is not blocked on the slow one.

| | **A. Sign-in** | **B. Mail** |
| --- | --- | --- |
| Purpose | Let people log in to the CRM | Send and read mail |
| Auth style | Delegated, user consent | App-only, client credentials |
| Permissions | `openid`, `profile`, `email`, `User.Read` | `Mail.Send`, `Mail.ReadWrite` as **application** permissions |
| Needs a client secret | Yes | Yes |
| Needs a redirect URI | Yes, the tenant's Supabase callback | No |
| Needs admin consent | Usually no | **Yes**, and mailbox scoping with it |
| Configured in | The tenant's **Supabase** auth settings, as the `azure` provider | The tenant's **Vercel** env |
| How slow | Minutes | The slowest external step in the programme |

Everything below happens in **the customer's own Entra tenant**, not Jacob's. They own the
domain and the mailboxes.

## An existing app the customer already has cannot be reused for B

This comes up because it looks like a shortcut. Animech sent over a per-person Outlook MCP
server for Claude Desktop, and it ships a working Entra app id. It cannot drive the CRM's
mail, for two independent reasons, neither of which is fixable by configuration on our side:

1. **Client credentials requires a confidential client.** Microsoft: the flow "permits a web
   service (confidential client) to use its own credentials", and every documented form of the
   request carries a `client_secret`, a certificate assertion or a federated credential. A
   desktop tool's registration has "Allow public client flows" turned on precisely so device
   flow works without a secret.
2. **App-only cannot use delegated permissions.** Microsoft: "When authenticating as an
   application (as opposed to with a user), you can't use *delegated permissions* because there
   is no user for your app to act on behalf of. You must use application permissions." A
   desktop tool holds only delegated ones, so bolting a secret on yields a token with no roles
   and every mailbox call returns 403.

One registration *can* technically hold both, and then the CRM would need no code change. Do
not ask for that. Mailbox scoping is keyed on the **app id**, not on the permission type, so
scoping that app id to the CRM's mailboxes risks cutting off every employee's desktop tool at
the same time. It also puts a secret that can send as every in-scope mailbox into the same
registration as software distributed to every laptop, and ties the two lifecycles together so
that one rotation breaks both.

The same reasoning rules out rewriting the CRM to use delegated tokens: see "Why app-only"
below.

---

# A. The sign-in app

The cheap one. Ask for it on day one; it does not wait for anything else.

1. **App registration**, e.g. `<Customer> CRM (sign-in)`. Single tenant.
2. **Redirect URI**, platform **Web**:
   `https://<their-supabase-project-ref>.supabase.co/auth/v1/callback`
   Byte-exact. This is the Supabase project for that tenant, not ours.
3. **API permissions**, Microsoft Graph, **delegated**: `openid`, `profile`, `email`,
   `User.Read`. Grant admin consent if their tenant requires it for delegated scopes.
4. **A client secret**, and its expiry date.

Then, on our side, in that tenant's Supabase project: Authentication -> Providers -> Azure,
with the client id, the secret, and the tenant URL
`https://login.microsoftonline.com/<tenant-id>/v2.0`.

**Only then** flip `microsoft: false` to `true` in that tenant's `src/config/tenants/*.ts`. A
`true` for a provider the Supabase project has not had enabled produces "provider is not
enabled" after the user has already clicked, which is worse than no button.

Two things the CRM handles that Entra makes necessary, both already in
`src/app/(auth)/auth/callback/route.ts`: Entra omits `email` when the account has no `mail`
attribute and carries the address as `preferred_username` instead, and it sends `name` where
Google sends `full_name`.

**Insert the operator's `workspace_members` row before their first sign-in.** Domain matching
puts a person into the workspace matching their email domain, and an operator on a different
domain otherwise lands alone in a brand new workspace. That is not an error anybody sees; it
looks like an empty CRM.

---

# B. The mail app

## The two-minute version, for the person who has to approve it

> We need an application registered in your Microsoft 365 tenant so our CRM can send from, and
> read replies in, a small number of named mailboxes.
>
> We are asking for **application permissions scoped with RBAC for Applications**, which means
> the app can reach **only the mailboxes in one group** you define, not the tenant. Without
> that scope the same permissions would reach every mailbox, which we do not want either.
>
> There is no user sign-in and no refresh token, so nothing silently disconnects when someone
> changes a password, and there is no standing session for an attacker to ride.

## What to ask for

1. **An app registration** named for the CUSTOMER, e.g. `<Customer> CRM (mail)`, exactly as the
   sign-in app is named. Single tenant. No redirect URI, there is no interactive sign-in.

   **Never name it after Wrenchlane.** The customer's IT reads this name in their Entra portal
   for as long as the app exists, and it is the same rule as phase 08's "nothing in this file
   may reference Wrenchlane": what the customer sees is their own product, not ours. This is
   easy to get wrong here because the surrounding rationale legitimately does talk about
   Wrenchlane's own history.
2. **Application permissions** on Microsoft Graph: `Mail.Send` and `Mail.ReadWrite`.
3. **A resource scope limiting the app to named mailboxes**, see below.
4. **A client secret**, and its expiry date.

Then have them send back three values: **tenant id**, **client id**, **client secret**.

## Scoping: RBAC for Applications, NOT Application Access Policies

Earlier versions of this document asked for `New-ApplicationAccessPolicy`. **Microsoft has
deprecated that**: "App Access Policies are replaced by Role Based Access Control for
Applications... Don't create new App Access Policies as these policies will eventually require
migration." Asking for a deprecated mechanism is a good way to lose credibility with an IT
department on the first exchange.

The replacement, in Exchange Online PowerShell, in their tenant:

```powershell
Connect-ExchangeOnline

# 1. A mail-enabled security group holding ONLY the mailboxes the CRM may touch.
New-DistributionGroup -Name "CRM Mail Access" -Alias crm-mail-access `
  -Type Security -Members "sales@customer.example","info@customer.example"

# 2. A management scope pointing at that group. MemberOfGroup takes the group's
#    DISTINGUISHED NAME, which Get-Group returns.
$dn = (Get-Group crm-mail-access).DistinguishedName
New-ManagementScope -Name "CRM mailboxes" -RecipientRestrictionFilter "MemberOfGroup -eq '$dn'"

# 3. Point Exchange at the Entra service principal, then grant the scoped role.
#    Take BOTH ids from Enterprise applications, NOT from App registrations:
#    the two pages show different values.
New-ServicePrincipal -AppId <client-id> -ObjectId <enterprise-app-object-id> `
  -DisplayName "<Customer> CRM (mail)"

# "Application Mail Full Access" is exactly Mail.ReadWrite + Mail.Send.
New-ManagementRoleAssignment -App <enterprise-app-object-id> `
  -Role "Application Mail Full Access" -CustomResourceScope "CRM mailboxes"

# 4. Prove it. The first must be InScope True, the second False.
Test-ServicePrincipalAuthorization -Identity <client-id> -Resource sales@customer.example | Format-Table
Test-ServicePrincipalAuthorization -Identity <client-id> -Resource ceo@customer.example  | Format-Table
```

**Ask them to send the output of both `Test-ServicePrincipalAuthorization` calls.** That is the
only evidence the scope is actually in force, and it is cheap for them to produce.

### The trap that silently undoes all of it

**The two authorities are a union, not an intersection.** Microsoft: "if your Service Principal
has `Mail.Read` granted in Microsoft Entra ID and you configure a resource-scoped `Mail.Read`
permission in Application RBAC, it's important that you remove the assignment of `Mail.Read`
from Microsoft Entra ID. Otherwise the union of an unscoped grant from Microsoft Entra and a
resource-scoped grant in Application RBAC results in **no effective resource scoping**."

So the Entra-side admin consent for `Mail.Send` and `Mail.ReadWrite` must be **removed** once
the RBAC assignment exists. An IT department that does the obvious thing, grant in Entra and
then also scope in Exchange, ends up with a tenant-wide grant and a scope that does nothing,
and everyone believes it is scoped. Say this in the same message as the request.

Two more things worth knowing before debugging: permission changes are cached between 30
minutes and 2 hours, though `Test-ServicePrincipalAuthorization` bypasses the cache, and
adding a mailbox later means adding it to the group, not touching the app.

## Why app-only, and not delegated

Today every Google mailbox holds its own refresh token, and a silent expiry disconnects an
account mid-campaign. That has already cost Wrenchlane live sends. App-only removes the failure
mode rather than managing it: one secret per customer tenant, not per mailbox, and nothing dies
because a user changed their password.

If anyone proposes delegated instead, three further reasons it is worse, not merely different:

- Delegated sends **as a person, from their own mailbox**. Sequences want a dedicated sender.
- Refresh tokens are revoked on password change and roll on a 90-day window.
- **Device code flow is being switched off.** From 1 July 2026 every new Entra tenant blocks it
  under security defaults, and Microsoft recommends getting "as close as possible to a
  unilateral block". Anything built on it has a stated end date. Worth mentioning to a customer
  who runs a desktop tool that depends on it, because the day their IT applies that
  recommendation, that tool stops.

## Receiving the secret

Both secrets are credentials belonging to **that customer's tenant**. Ground rule R7: no
credential crosses a tenant boundary.

- Each goes into **that customer's own deployment** and nowhere else. The mail one as
  `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` in their Vercel
  project; the sign-in one into their Supabase auth settings.
- Never into Wrenchlane's `.env.local`, never into this repository, never into a shared secrets
  file alongside another customer's.
- **Record both expiry dates.** A client secret expires, usually in 6, 12 or 24 months, and
  when the mail one does, every mailbox for that customer stops at once. That is the one
  failure mode app-only auth does not remove, so it is the one to put a reminder on.

Ask them not to send it over email if there is any alternative.

---

# Run the spike, and do not wait for consent to do it

`GraphProvider` is written but **has never touched a real tenant**. Until the spike has passed,
nothing in `src/lib/mail/microsoft/` should be trusted.

The four checks are properties of Graph and Exchange Online, not of the grant that fetched the
token. So they can be answered with **any** delegated token for one real mailbox, weeks before
the app-only grant exists:

```bash
export GRAPH_SPIKE_ACCESS_TOKEN=eyJ0...                  # delegated, that user's own token
export GRAPH_SPIKE_MAILBOX=that.user@customer.example     # THEIR OWN mailbox
export GRAPH_SPIKE_RECIPIENT=<somewhere you can reply from>

node scripts/graph-spike.mjs send      # checks 1 and 2
# reply to the mail that arrives, keeping the quoted thread
node scripts/graph-spike.mjs watch     # checks 3 and 4
```

Once the real credentials land, run it again with `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`
and `MICROSOFT_CLIENT_SECRET` against a **throwaway** mailbox first, not a real sending one.
The spike sends a real message and the point is to find out what Exchange does to it.

**Record which form was used.** A delegated run does not prove the app-only grant works, that
admin consent was given, or that scoping is in force. And the spike does not import
`GraphProvider`; it reimplements the same calls, so a pass proves Graph behaves as the provider
assumes, not that the provider is correct.

If a check fails, that is a design input for phase 07, not a bug to work around quietly. Stop
and talk to Jacob (R11).

---

# Sending domains: less of a blocker than this document used to claim

**Graph sending aligns by itself.** `sendMail` submits the message into the mailbox and
Exchange Online sends it, so it leaves through the customer's own mail infrastructure.

Verified for Animech on 2026-08-31: `animech.com` publishes exactly
`v=spf1 include:spf.protection.outlook.com -all`, DMARC is `p=quarantine; pct=25`, and
autodiscover points at outlook. Mail sent through Graph from an `animech.com` mailbox therefore
leaves via the one host that record authorises. SPF passes, DKIM signs as `animech.com`, DMARC
aligns. An earlier version of this document said Animech "need a separate sending domain,
warmed" before mail could go out. That is true of sending through **our** infrastructure and it
is **not** a precondition for phase 07.

What remains true, and is a different argument:

- Cold outbound at volume from a company's primary domain is a **reputation** decision, not an
  SPF one. Raise it as such, and let the customer decide.
- **Spennare has two conflicting `v=spf1` records on `spennare.com`**, which is invalid: RFC
  7208 says a domain publishing more than one SPF record is a `permerror`, and receivers may
  fail every check. Raise it early. It is their bug, it is cheap to fix, and it will otherwise
  be blamed on whatever we send.

Neither shows up in the spike. They show up as mail that quietly does not arrive.

---

# Who to talk to

- **Animech:** `it@animech.com` receives their DMARC reports and is the technical contact.
  See `~/Documents/Any/research/` for the wider account picture.
- **Spennare:** see `~/Documents/Spennare/research/`.

Both are in the customer-research memories; neither belongs in this repository.
