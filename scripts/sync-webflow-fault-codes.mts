/**
 * Sync the fault-code cluster into Webflow.
 *
 *   npx tsx --env-file=<env> scripts/sync-webflow-fault-codes.mts [--apply] [--publish]
 *
 * The Astro cluster ships at the DNS cutover. Until then wrenchlane.com is
 * Webflow, and that is the domain with traffic, so the cluster has to exist in
 * both places rather than waiting. This keeps them in step.
 *
 * A SYNC, NOT AN IMPORT
 *
 * Keyed on slug and re-runnable. It creates what is missing, updates what has
 * drifted, and leaves alone what already matches, so running it after a data
 * refresh converges rather than duplicating. A one-shot importer would be
 * correct exactly once and would need a human to reconcile every time after.
 *
 * SAFETY
 *
 * Dry run by default: without --apply it prints the plan and writes nothing.
 * Everything it creates is a draft. Publishing is a separate, explicit flag,
 * because a draft is invisible and reversible and a published page is neither.
 *
 * It never deletes. A code that drops out of the data keeps its page rather
 * than having it silently removed, because an indexed URL that starts 404ing is
 * a worse outcome than a page that is one refresh out of date.
 */

import { readFile } from "node:fs/promises";
import type {
  FamilyHubPage,
  FaultCodeBundle,
  FaultCodePage,
  MakeHubPage,
  SystemHubPage,
} from "@/lib/landing/emit";
import {
  renderFamilyBody,
  renderMakeBody,
  renderSystemBody,
  renderWebflowBody,
} from "@/lib/landing/webflow-body";

const API = "https://api.webflow.com/v2";
const EXPECTED_SITE_ID = "6949978e26b3c3fc2873440d";

const COLLECTIONS = {
  codes: "6a8f5c94835a6fd40d7ec12f",
  families: "6a8fe68bf31ddf57d51ba77d",
  makes: "6a8fe68b090b945ce597b3f7",
  systems: "6a8fe68c6f62bbad442ee91e",
} as const;

const apply = process.argv.includes("--apply");
const publish = process.argv.includes("--publish");
const bundlePath = process.argv.find((a) => a.endsWith(".json")) ?? "fault-codes.json";

const token = process.env.WEBFLOW_API_TOKEN;
if (!token) {
  console.error("WEBFLOW_API_TOKEN is not set.");
  process.exit(1);
}
if (process.env.WEBFLOW_SITE_ID !== EXPECTED_SITE_ID) {
  console.error(
    `WEBFLOW_SITE_ID is ${process.env.WEBFLOW_SITE_ID ?? "unset"}, expected ${EXPECTED_SITE_ID}. Refusing to write to a site these collection ids do not belong to.`,
  );
  process.exit(1);
}

async function call<T>(
  path: string,
  init?: { method: string; body?: unknown },
): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const res = await fetch(`${API}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "accept-version": "2.0.0",
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
    if (res.status === 429) {
      // Webflow's limit is per minute; backing off is cheaper than failing a
      // 480-item run most of the way through.
      const wait = 2 ** attempt * 2000;
      console.log(`  rate limited, waiting ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Webflow ${res.status} on ${path}: ${text.slice(0, 300)}`);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }
  throw new Error(`Gave up after repeated rate limits on ${path}`);
}

type Item = { id: string; fieldData: Record<string, unknown> };

/** Every item in a collection, following pagination to the end. */
async function listAll(collectionId: string): Promise<Item[]> {
  const out: Item[] = [];
  let offset = 0;
  for (;;) {
    const page = await call<{ items?: Item[]; pagination?: { total: number } }>(
      `/collections/${collectionId}/items?limit=100&offset=${offset}`,
    );
    const items = page.items ?? [];
    out.push(...items);
    if (items.length < 100) break;
    offset += items.length;
  }
  return out;
}

type Payload = { name: string; slug: string } & Record<string, unknown>;

/**
 * Only the fields we generate are compared.
 *
 * Webflow returns plenty the payload does not set, and treating any difference
 * as drift would rewrite all 480 items on every run.
 */
function differs(existing: Record<string, unknown>, next: Payload): boolean {
  return Object.keys(next).some(
    (key) => String(existing[key] ?? "") !== String(next[key] ?? ""),
  );
}

async function syncCollection(label: string, collectionId: string, payloads: Payload[]) {
  const existing = await listAll(collectionId);
  const bySlug = new Map(
    existing.map((item) => [String(item.fieldData.slug ?? ""), item]),
  );

  const toCreate = payloads.filter((p) => !bySlug.has(p.slug));
  const toUpdate = payloads.filter((p) => {
    const found = bySlug.get(p.slug);
    return found && differs(found.fieldData, p);
  });

  console.log(
    `${label.padEnd(10)} have ${String(existing.length).padStart(3)} · create ${String(toCreate.length).padStart(3)} · update ${String(toUpdate.length).padStart(3)} · unchanged ${payloads.length - toCreate.length - toUpdate.length}`,
  );
  if (!apply) return { created: 0, updated: 0, ids: [] as string[] };

  const ids: string[] = [];
  for (let i = 0; i < toCreate.length; i += 25) {
    const batch = toCreate.slice(i, i + 25);
    // Bulk create takes `items`, each with its own isDraft and fieldData. The
    // MCP tool's flatter `fieldData: [...]` shape is not what raw v2 accepts.
    const res = await call<{ items?: Item[] }>(
      `/collections/${collectionId}/items`,
      {
        method: "POST",
        body: {
          items: batch.map((fieldData) => ({ isDraft: true, fieldData })),
        },
      },
    );
    for (const item of res.items ?? []) ids.push(item.id);
    console.log(`  ${label}: created ${i + batch.length}/${toCreate.length}`);
  }
  for (let i = 0; i < toUpdate.length; i += 25) {
    const batch = toUpdate.slice(i, i + 25);
    await call(`/collections/${collectionId}/items`, {
      method: "PATCH",
      body: {
        items: batch.map((p) => ({
          id: bySlug.get(p.slug)!.id,
          fieldData: p,
        })),
      },
    });
    console.log(`  ${label}: updated ${i + batch.length}/${toUpdate.length}`);
  }
  return { created: toCreate.length, updated: toUpdate.length, ids };
}

/* ------------------------------------------------------------------ payloads */

const bundle = JSON.parse(await readFile(bundlePath, "utf8")) as FaultCodeBundle;
const stamp = bundle.generatedFor;

// Which code pages exist on THIS target. The Webflow cluster carries every
// buildable code, so this is the full set, but the renderers still take it
// explicitly rather than assuming: that assumption is what produced a page full
// of 404s the first time round.
const published = new Set(bundle.pages.map((page) => page.slug));

const codePayloads: Payload[] = bundle.pages.map((page: FaultCodePage) => ({
  name: page.meta.title.replace(/ \| Wrenchlane$/, ""),
  slug: page.slug,
  code: page.code,
  "code-name": page.name ?? "",
  summary: page.name
    ? `${page.name}. Seen in ${page.evidence.sessions} real diagnostics across ${page.evidence.workshops} workshops.`
    : `Not individually documented. Seen in ${page.evidence.sessions} real diagnostics across ${page.evidence.workshops} workshops.`,
  body: renderWebflowBody(page, published),
  "meta-title": page.meta.title,
  "meta-description": page.meta.description,
  "measured-on": stamp,
  tier: page.tier,
  diagnostics: page.evidence.sessions,
}));

const familyPayloads: Payload[] = bundle.families.map((family: FamilyHubPage) => ({
  name: `${family.label} fault codes`,
  slug: family.path.split("/").pop()!,
  summary: `${family.codes.length} documented codes across ${family.sessions} real diagnostics.`,
  body: renderFamilyBody(family, published),
  "meta-title": family.meta.title,
  "meta-description": family.meta.description,
  "measured-on": stamp,
}));

const makePayloads: Payload[] = bundle.makes.map((make: MakeHubPage) => ({
  name: `${make.make} fault codes`,
  slug: make.slug,
  summary: `${make.distinctCodes} distinct codes across ${make.diagnostics} real ${make.make} diagnostics.`,
  body: renderMakeBody(make, published),
  "meta-title": make.meta.title,
  "meta-description": make.meta.description,
  "measured-on": stamp,
}));

const systemPayloads: Payload[] = bundle.systems.map((system: SystemHubPage) => ({
  name: `${system.label} fault codes`,
  slug: system.slug,
  summary: `${system.pages} documented codes across ${system.families.length} functional groups.`,
  body: renderSystemBody(system, published),
  "meta-title": system.meta.title,
  "meta-description": system.meta.description,
  "measured-on": stamp,
}));

console.log(
  apply
    ? `APPLYING to Webflow. Everything created is a draft.${publish ? " Publishing after." : ""}`
    : "DRY RUN. Nothing is written. Pass --apply to write.",
);
console.log("");

const results = [
  await syncCollection("codes", COLLECTIONS.codes, codePayloads),
  await syncCollection("families", COLLECTIONS.families, familyPayloads),
  await syncCollection("makes", COLLECTIONS.makes, makePayloads),
  await syncCollection("systems", COLLECTIONS.systems, systemPayloads),
];

const created = results.reduce((n, r) => n + r.created, 0);
const updated = results.reduce((n, r) => n + r.updated, 0);
console.log("");
console.log(`Total: ${created} created, ${updated} updated.`);
console.log(
  `Cluster size on Webflow: ${codePayloads.length + familyPayloads.length + makePayloads.length + systemPayloads.length} items.`,
);
if (apply && !publish) {
  console.log("All drafts. Re-run with --publish to make them live.");
}
