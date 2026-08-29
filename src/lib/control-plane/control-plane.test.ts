import { afterEach, describe, expect, it } from "vitest";
import { FEATURES, FEATURE_KEYS } from "@/config/features";
import { isSuperAdminEmail, superAdminAllowList, isControlPlane } from "./auth";
import { resolveEffectiveFlags, type OverrideRow } from "./db";

const saved = {
  admins: process.env.CONTROL_PLANE_ADMIN_EMAILS,
  cp: process.env.IS_CONTROL_PLANE,
};

afterEach(() => {
  for (const [k, v] of Object.entries({
    CONTROL_PLANE_ADMIN_EMAILS: saved.admins,
    IS_CONTROL_PLANE: saved.cp,
  })) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("the super-admin allow-list", () => {
  it("matches an allow-listed address, case-insensitively", () => {
    process.env.CONTROL_PLANE_ADMIN_EMAILS = "jacob.qvisth@gmail.com";
    expect(isSuperAdminEmail("jacob.qvisth@gmail.com")).toBe(true);
    expect(isSuperAdminEmail("Jacob.Qvisth@Gmail.com")).toBe(true);
  });

  it("denies when the list is empty, rather than allowing", () => {
    process.env.CONTROL_PLANE_ADMIN_EMAILS = "";
    expect(isSuperAdminEmail("jacob.qvisth@gmail.com")).toBe(false);
    delete process.env.CONTROL_PLANE_ADMIN_EMAILS;
    expect(isSuperAdminEmail("jacob.qvisth@gmail.com")).toBe(false);
  });

  it("denies a missing address", () => {
    process.env.CONTROL_PLANE_ADMIN_EMAILS = "jacob.qvisth@gmail.com";
    expect(isSuperAdminEmail(null)).toBe(false);
    expect(isSuperAdminEmail(undefined)).toBe(false);
    expect(isSuperAdminEmail("")).toBe(false);
  });

  // The hole this closes: `endsWith` matching would let
  // "evil-jacob.qvisth@gmail.com" or "jacob.qvisth@gmail.com.attacker.tld"
  // through. Exact equality only.
  it("does not match on substring or suffix", () => {
    process.env.CONTROL_PLANE_ADMIN_EMAILS = "jacob.qvisth@gmail.com";
    expect(isSuperAdminEmail("evil-jacob.qvisth@gmail.com")).toBe(false);
    expect(isSuperAdminEmail("jacob.qvisth@gmail.com.attacker.tld")).toBe(false);
    expect(isSuperAdminEmail("xjacob.qvisth@gmail.com")).toBe(false);
  });

  // The single most dangerous misconfiguration available here: the primary
  // super-admin address is a Gmail one, so honouring an "@gmail.com" entry
  // would admit the entire internet. The list drops domain entries entirely
  // rather than trusting whoever set the variable.
  it("ignores a @domain entry instead of honouring it", () => {
    process.env.CONTROL_PLANE_ADMIN_EMAILS = "@gmail.com";
    expect(superAdminAllowList()).toEqual([]);
    expect(isSuperAdminEmail("anyone@gmail.com")).toBe(false);

    process.env.CONTROL_PLANE_ADMIN_EMAILS = "@gmail.com,jacob.qvisth@gmail.com";
    expect(superAdminAllowList()).toEqual(["jacob.qvisth@gmail.com"]);
    expect(isSuperAdminEmail("someone.else@gmail.com")).toBe(false);
    expect(isSuperAdminEmail("jacob.qvisth@gmail.com")).toBe(true);
  });

  it("carries the break-glass address alongside the primary", () => {
    process.env.CONTROL_PLANE_ADMIN_EMAILS = "jacob.qvisth@gmail.com, jacob@wrenchlane.com";
    expect(isSuperAdminEmail("jacob@wrenchlane.com")).toBe(true);
    expect(isSuperAdminEmail("someone@wrenchlane.com")).toBe(false);
  });
});

describe("isControlPlane", () => {
  it("is true only for exactly '1'", () => {
    process.env.IS_CONTROL_PLANE = "1";
    expect(isControlPlane()).toBe(true);
    for (const v of ["", "0", "true", "yes"]) {
      process.env.IS_CONTROL_PLANE = v;
      expect(isControlPlane(), `"${v}" must not enable the console`).toBe(false);
    }
    delete process.env.IS_CONTROL_PLANE;
    expect(isControlPlane()).toBe(false);
  });
});

describe("effective flags", () => {
  const TENANT = "11111111-1111-1111-1111-111111111111";
  const OTHER = "22222222-2222-2222-2222-222222222222";

  const override = (over: Partial<OverrideRow>): OverrideRow => ({
    tenant_id: TENANT,
    feature_key: "forums",
    enabled: false,
    note: "not sold",
    updated_at: "2026-08-30T00:00:00Z",
    updated_by: "jacob.qvisth@gmail.com",
    ...over,
  });

  it("returns one row per registry feature", () => {
    const flags = resolveEffectiveFlags([], TENANT);
    expect(flags.map((f) => f.key).sort()).toEqual([...FEATURE_KEYS].sort());
  });

  // An absent row means inherit. That is what keeps a newly added feature on
  // for every existing tenant with no backfill (R2).
  it("inherits the registry default when there is no override", () => {
    const flags = resolveEffectiveFlags([], TENANT);
    for (const f of flags) {
      expect(f.source).toBe("default");
      expect(f.enabled).toBe(featureDefault(f.key));
    }
  });

  it("applies an override and marks it as explicitly set", () => {
    const flags = resolveEffectiveFlags([override({})], TENANT);
    const forums = flags.find((f) => f.key === "forums")!;
    expect(forums.enabled).toBe(false);
    expect(forums.source).toBe("override");
    expect(forums.note).toBe("not sold");
    expect(forums.updatedBy).toBe("jacob.qvisth@gmail.com");
    // and the default it is overriding is still visible, so the console can
    // show what "inherit" would go back to
    expect(forums.defaultEnabled).toBe(true);
  });

  // The isolation property, in miniature: one tenant's override must never
  // leak into another tenant's resolved view.
  it("ignores overrides belonging to a different tenant", () => {
    const flags = resolveEffectiveFlags([override({ tenant_id: OTHER })], TENANT);
    const forums = flags.find((f) => f.key === "forums")!;
    expect(forums.source).toBe("default");
    expect(forums.enabled).toBe(true);
  });

  it("keeps an explicit true distinguishable from an inherited true", () => {
    const flags = resolveEffectiveFlags(
      [override({ feature_key: "dtc", enabled: true, note: null })],
      TENANT,
    );
    const dtc = flags.find((f) => f.key === "dtc")!;
    expect(dtc.enabled).toBe(true);
    // Same value, different provenance. Without this the console could not warn
    // that a tenant will move when the default moves.
    expect(dtc.source).toBe("override");
    expect(flags.find((f) => f.key === "videos")!.source).toBe("default");
  });
});

function featureDefault(key: string): boolean {
  return FEATURES.find((f) => f.key === key)!.enabledByDefault;
}
