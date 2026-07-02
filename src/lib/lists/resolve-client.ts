// Client-side helper: resolve a list's contact ids WITH its stored exclusions
// applied, via the server endpoint. Use this instead of resolveListContactIds()
// in the browser whenever exclusions must be honored — the internal_testers
// exclusion source needs a service-role client that can't run client-side.
export async function resolveListContactIdsViaApi(listId: string): Promise<string[]> {
  const res = await fetch(`/api/lists/${listId}/resolve`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || "Failed to resolve list contacts");
  }
  const data = (await res.json()) as { contactIds?: string[] };
  return data.contactIds ?? [];
}
