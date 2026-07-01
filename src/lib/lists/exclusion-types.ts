// Client-safe exclusion types & metadata. The resolution engine in
// src/lib/lists/exclusions.ts is server-only (it reads the global dashboard_*
// tables via a service client), so anything the browser needs — the shape, the
// group metadata, and the pure parse/merge helpers — lives here instead.

export type ExclusionGroupKey = "never_call" | "internal_testers";

export const EXCLUSION_GROUPS: {
  key: ExclusionGroupKey;
  label: string;
  description: string;
}[] = [
  {
    key: "never_call",
    label: "Never-call list",
    description: "Competitors, your own domain, and anyone on the managed never-call list.",
  },
  {
    key: "internal_testers",
    label: "Internal test users",
    description: "Your team & internal testers (the same set excluded from statistics).",
  },
];

export type ListExclusions = { groups: ExclusionGroupKey[]; lists: string[] };

export const EMPTY_EXCLUSIONS: ListExclusions = { groups: [], lists: [] };

function isGroupKey(v: unknown): v is ExclusionGroupKey {
  return v === "never_call" || v === "internal_testers";
}

/** Parse the loosely-typed `contact_lists.exclusions` JSON into a safe shape. */
export function parseListExclusions(raw: unknown): ListExclusions {
  if (!raw || typeof raw !== "object") return EMPTY_EXCLUSIONS;
  const obj = raw as Record<string, unknown>;
  const groups = Array.isArray(obj.groups) ? obj.groups.filter(isGroupKey) : [];
  const lists = Array.isArray(obj.lists)
    ? obj.lists.filter((l): l is string => typeof l === "string" && l.length > 0)
    : [];
  return { groups: [...new Set(groups)], lists: [...new Set(lists)] };
}

export function hasAnyExclusion(e: ListExclusions): boolean {
  return e.groups.length > 0 || e.lists.length > 0;
}

/** Merge two exclusion specs (e.g. always-on never_call + a list's own). */
export function mergeExclusions(a: ListExclusions, b: ListExclusions): ListExclusions {
  return {
    groups: [...new Set([...a.groups, ...b.groups])],
    lists: [...new Set([...a.lists, ...b.lists])],
  };
}

/** Serialize for storage in contact_lists.exclusions (null when empty). */
export function serializeListExclusions(e: ListExclusions): ListExclusions | null {
  return hasAnyExclusion(e) ? { groups: [...e.groups], lists: [...e.lists] } : null;
}
