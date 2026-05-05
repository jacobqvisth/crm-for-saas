export type InternalTestWorkshop = {
  readonly id: string;
  readonly name: string;
};

export type InternalTestUser = {
  readonly id: string;
  readonly label: string;
  readonly workshop: string | null;
};

export const INTERNAL_TEST_WORKSHOPS: readonly InternalTestWorkshop[] = [
  { id: "37ea2318-890a-401e-9c62-107e71a18341", name: "CodeOC" },
  { id: "472ab9b9-77f5-4a4f-af82-8adfc1c8a759", name: "Matteo self-service" },
  { id: "4c0aef67-a98b-49e5-b0ea-82f22642de2b", name: "Apple" },
  { id: "adb85343-1a35-45e8-9a99-4a80ddaa5ca9", name: "Android" },
  { id: "ebc4d121-7990-4381-81f9-f149dca8a0cf", name: "Edward's workshop" },
  { id: "2c4284e5-d879-40a6-9bfe-f8b3b33633e8", name: "xxx (happymachineholdings.com)" },
  { id: "bfa2f4b8-75df-41ff-949e-0693e0a00898", name: "Magnus test" },
  { id: "c623f3b1-e07d-4042-b56a-d945769bfcd1", name: "Internal — Magnus (codeoc.ai)" },
];

// User IDs that should be treated as external even if their workshop is in
// INTERNAL_TEST_WORKSHOPS. Lets us count an individual contractor or pilot
// user inside an otherwise-internal workshop (e.g. CodeOC).
export const INTERNAL_TEST_EXEMPT_USER_IDS: readonly string[] = [
  "50bc99ec-e001-7072-467a-15cff025c35c", // jesperh (CodeOC)
  "707cf9cc-b091-70ce-433c-73dda2978e4d", // maptun_1 (CodeOC)
  "f09cf9bc-2061-70c4-00cc-43408e8b44e9", // peter_thomassons (CodeOC)
];

export const INTERNAL_TEST_USERS: readonly InternalTestUser[] = [
  { id: "e0bcb9cc-6061-7079-a1e8-766b52daa75f", label: "hans_m", workshop: "CodeOC" },
  { id: "606c29fc-d0a1-70ff-c6f9-d3664c55e1e2", label: "edward_wrenchlane", workshop: null },
  { id: "c0ac193c-3031-70bc-c6be-d01891b07cde", label: "dogutest-apple", workshop: "Apple" },
  { id: "800ca92c-9081-70fe-9e77-38d79a1628d2", label: "jacobqvisth", workshop: "CodeOC" },
  { id: "d0dc99ac-7071-708c-9ff1-cbecd8fa58f9", label: "matteo.circa@gmail.com", workshop: "Matteo self-service" },
  { id: "102c49fc-a0c1-70c0-4bca-1b190487b61e", label: "dogu+test2@wrenchlane.com", workshop: null },
  { id: "d03cb99c-8001-7026-c5c6-cd1035e6daa0", label: "huntersb003@gmail.com", workshop: null },
  { id: "507cb90c-90d1-706d-20df-7025bb8fcb67", label: "edwardc", workshop: "CodeOC" },
  { id: "10eca93c-b061-705c-ec16-c4808fdce794", label: "ejcintron", workshop: "Edward's workshop" },
  { id: "006cf93c-2071-707e-8fcd-5ac8d4f2241e", label: "hans@codeoc.ai", workshop: "CodeOC" },
  { id: "f0dc599c-f061-7079-6942-ee9601bc1f49", label: "hans@bitknife.se", workshop: null },
  { id: "208c999c-c011-7079-a288-a854c7bb3c5a", label: "magnusx", workshop: "xxx (happymachineholdings.com)" },
  { id: "e07c793c-40a1-70cf-254f-2273ca563e14", label: "magnus-magnustest", workshop: "Magnus test" },
  { id: "b0bc599c-40f1-70f9-dad8-8168bacaebf1", label: "Internal Magnus (codeoc.ai)", workshop: "Internal — Magnus (codeoc.ai)" },
];

export const INTERNAL_TEST_EMAILS: readonly string[] = [
  "matteo.circa@gmail.com",
  "dogu+test2@wrenchlane.com",
  "huntersb003@gmail.com",
  "hans@wrenchlane.com",
  "hans@codeoc.ai",
  "hans@bitknife.se",
];

export const INTERNAL_TEST_USERNAMES: readonly string[] = [
  "hans_m",
  "edward_wrenchlane",
  "dogutest-apple",
  "jacobqvisth",
];

const INTERNAL_TEST_USER_ID_SET = new Set<string>(
  INTERNAL_TEST_USERS.map((user) => user.id),
);
const INTERNAL_TEST_WORKSHOP_ID_SET = new Set<string>(
  INTERNAL_TEST_WORKSHOPS.map((workshop) => workshop.id),
);
const INTERNAL_TEST_EMAIL_SET = new Set<string>(INTERNAL_TEST_EMAILS);
const INTERNAL_TEST_USERNAME_SET = new Set<string>(INTERNAL_TEST_USERNAMES);
const INTERNAL_TEST_EXEMPT_USER_ID_SET = new Set<string>(
  INTERNAL_TEST_EXEMPT_USER_IDS,
);

export function isInternalTestExemptUserId(
  userId?: string | number | null,
) {
  return Boolean(userId && INTERNAL_TEST_EXEMPT_USER_ID_SET.has(String(userId)));
}

export function isInternalTestUserId(userId?: string | number | null) {
  return Boolean(userId && INTERNAL_TEST_USER_ID_SET.has(String(userId)));
}

export function isInternalTestWorkshopId(workshopId?: string | number | null) {
  return Boolean(
    workshopId && INTERNAL_TEST_WORKSHOP_ID_SET.has(String(workshopId)),
  );
}

export function isInternalTestEmail(email?: string | null) {
  return Boolean(email && INTERNAL_TEST_EMAIL_SET.has(email.trim().toLowerCase()));
}

export function isInternalTestUsername(username?: string | null) {
  return Boolean(
    username && INTERNAL_TEST_USERNAME_SET.has(username.trim().toLowerCase()),
  );
}

// Combined check used at every per-row exclusion site. Honors the
// per-user exempt set so an individual user inside an internal workshop
// can still be counted (e.g. jesperh / maptun_1 / peter_thomassons within
// CodeOC).
export function isInternalTestUserOrWorkshop(
  userId?: string | number | null,
  workshopId?: string | number | null,
) {
  if (isInternalTestExemptUserId(userId)) return false;
  return isInternalTestUserId(userId) || isInternalTestWorkshopId(workshopId);
}

export function isInternalTestUser(input: {
  internalUserId?: string | number | null;
  workshopId?: string | number | null;
  email?: string | null;
  username?: string | null;
}) {
  if (isInternalTestExemptUserId(input.internalUserId)) return false;
  return (
    isInternalTestUserId(input.internalUserId) ||
    isInternalTestWorkshopId(input.workshopId) ||
    isInternalTestEmail(input.email) ||
    isInternalTestUsername(input.username)
  );
}
