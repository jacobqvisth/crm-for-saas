// User-rejected phone numbers ("NO, this is not correct") are stored on the
// record's custom_fields.rejected_phones array. Keeping them here — rather than
// in a new table — means no schema migration and a fully reversible edit, and
// the finders already read each record's row, so excluding them is a one-line
// merge into the `existing` set.

/** Pull the list of rejected phone numbers stored on a record's custom_fields.
 *  Tolerant of any shape (custom_fields is free-form JSONB). */
export function rejectedPhonesFrom(customFields: unknown): string[] {
  if (!customFields || typeof customFields !== "object") return [];
  const v = (customFields as Record<string, unknown>).rejected_phones;
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

/** Return a NEW custom_fields object with `number` appended to rejected_phones
 *  (deduped). Never mutates the input. */
export function withRejectedPhone(
  customFields: unknown,
  number: string,
): Record<string, unknown> {
  const base =
    customFields && typeof customFields === "object"
      ? { ...(customFields as Record<string, unknown>) }
      : {};
  const current = rejectedPhonesFrom(base);
  if (!current.includes(number)) current.push(number);
  base.rejected_phones = current;
  return base;
}
