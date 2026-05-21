# Phase: Email Verification UI — Discovery Page

## Context

We have run MX-based email verification on all shops in `discovered_shops`. Two new columns now exist on the table:
- `email_valid boolean` — true = MX confirmed, false = dead domain or bad format
- `email_check_detail text` — reason string: `mx_ok`, `domain_not_found`, `no_mx_records`, `invalid_format`

Out of 1,035 emails verified: 1,022 valid, 13 invalid (12 dead domains, 1 bad format).

The Discovery UI needs to surface this data so Jacob can see which emails are safe before promoting to CRM.

## What to build

### 1. Update the `Shop` type

In `src/components/discovery/discovery-page-client.tsx`, add to the `Shop` type:

```typescript
email_valid: boolean | null;
email_check_detail: string | null;
```

### 2. Email column — add verified badge

Replace the current email cell (lines ~700–714 in `discovery-page-client.tsx`) with this logic:

- If `shop.primary_email` exists AND `shop.email_valid === true` → show the email as a mailto link with a green checkmark icon (`CheckCircle` from lucide-react, `w-3 h-3 text-emerald-500`) to the left of the Mail icon
- If `shop.primary_email` exists AND `shop.email_valid === false` → show the email as plain text (no link) with a red X icon (`XCircle` from lucide-react, `w-3 h-3 text-red-400`) and a tooltip on the icon showing the reason (map `email_check_detail` to human-readable: `domain_not_found` → "Domain does not exist", `no_mx_records` → "No mail server found", `invalid_format` → "Invalid email format")
- If `shop.primary_email` exists AND `shop.email_valid === null` → show as before (mailto link, no badge — not yet verified)
- If no email → show `—` as before

Use a `title` attribute on the icon for the tooltip (no extra library needed).

### 3. Add "Verified" filter toggle

In the `Filters` type, add:
```typescript
verified_email: boolean;
```

Initialize it as `false` in the default filter state.

Add a third checkbox next to "Has email" and "Has phone":
```
☑ Verified email
```

Same styling as the existing checkboxes. When checked, only shows shops where `email_valid = true`.

Wire up the filter:
- In the `fetchShops` params builder: `if (filters.verified_email) params.set("verified_email", "true");`
- In `src/app/api/discovery/shops/route.ts`, add:
```typescript
const verified_email = searchParams.get("verified_email");
// ...
if (verified_email === "true") {
  query = query.eq("email_valid", true);
}
```

Also update the select query in `shops/route.ts` to include the new columns:
```typescript
.select("id, name, ..., email_valid, email_check_detail")
```
(add `email_valid, email_check_detail` to the existing select string)

### 4. Protect the import flow — skip invalid emails

In `src/app/api/discovery/promote/route.ts`:

After fetching the shops array, before the loop, count and separate invalid ones:

```typescript
const invalidEmail = shops.filter(s => s.email_valid === false);
const validShops = shops.filter(s => s.email_valid !== false);
let skipped_invalid_email = invalidEmail.length;
```

Only loop over `validShops` for promotion. At the end, also mark `invalidEmail` shops as `skipped` in `discovered_shops`:

```typescript
if (invalidEmail.length > 0) {
  await supabase
    .from("discovered_shops")
    .update({ status: "skipped" })
    .in("id", invalidEmail.map(s => s.id));
}
```

Update the response to include the new count:
```typescript
return NextResponse.json({ promoted, skipped_duplicates, skipped_invalid_email });
```

Update the client-side toast in `discovery-page-client.tsx` to show it:
```typescript
toast.success(
  `Promoted ${data.promoted} shop${data.promoted !== 1 ? "s" : ""}` +
  (data.skipped_duplicates > 0 ? ` · ${data.skipped_duplicates} duplicate${data.skipped_duplicates !== 1 ? "s" : ""} skipped` : "") +
  (data.skipped_invalid_email > 0 ? ` · ${data.skipped_invalid_email} invalid email${data.skipped_invalid_email !== 1 ? "s" : ""} skipped` : "")
);
```

Also update the `promote/route.ts` select query to include `email_valid`:
```typescript
.select("id, name, website, domain, phone, address, street, city, postal_code, country, country_code, primary_email, all_emails, all_phones, instagram_url, facebook_url, google_place_id, rating, review_count, category, email_valid")
```

## Files to change

1. `src/components/discovery/discovery-page-client.tsx` — type, email cell, filter checkbox, toast message
2. `src/app/api/discovery/shops/route.ts` — select + verified_email filter
3. `src/app/api/discovery/promote/route.ts` — select + skip invalid email logic + response

## Done criteria

- `npm run build` passes with 0 errors
- `npm run lint` clean
- `npx tsc --noEmit` clean
- Shops with `email_valid = false` show a red X badge next to the email
- Shops with `email_valid = true` show a green checkmark badge
- "Verified email" checkbox filters to only verified shops
- Promoting a mix of valid/invalid shops skips the invalid ones and shows the count in the toast
