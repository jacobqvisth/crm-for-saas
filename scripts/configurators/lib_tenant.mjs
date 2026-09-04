// Which tenant database a script writes to, resolved explicitly at run time.
//
// GROUND RULE R5: never copy `.env.local` between tenants. A copied env file makes one
// customer's tooling authenticate as another, and this pipeline writes hundreds of
// companies and contacts -- exactly the mistake that is expensive to discover late.
//
// So no script here reads `.env.local` at all. The target is named on the command line
// as a Supabase project ref, and the service key is fetched from the Management API with
// Jacob's personal access token for that one ref. Writing to the wrong tenant therefore
// requires typing the wrong tenant's ref, rather than forgetting which env file was
// lying in the working directory.
//
//   animech    hnriqsnenyzmlctkkdmi
//   spennare   cuzbkkmqyyvjcuoofzvm
//   wrenchlane wdgiwuhehqpkhpvdzzzl

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const TENANT_REFS = {
  animech: "hnriqsnenyzmlctkkdmi",
  spennare: "cuzbkkmqyyvjcuoofzvm",
  wrenchlane: "wdgiwuhehqpkhpvdzzzl",
};

function pat() {
  const file = path.join(os.homedir(), ".secrets/keys.env");
  const token = fs.readFileSync(file, "utf8").match(/^SUPABASE_ACCESS_TOKEN=(.+)$/m)?.[1];
  if (!token) throw new Error(`No SUPABASE_ACCESS_TOKEN in ${file}`);
  return token.replace(/^["']|["']$/g, "").trim();
}

/**
 * Resolve a tenant slug to a live PostgREST client.
 *
 * `wrenchlane` is refused outright. This directory is Animech's prospect list; there is
 * no version of this pipeline that should ever write to Wrenchlane's database, and a
 * typo should fail loudly rather than land 500 companies in the wrong CRM.
 */
export async function tenantRest(slug) {
  if (slug === "wrenchlane") {
    throw new Error(
      "Refusing to write the configurator directory to Wrenchlane. This is Animech's " +
      "list; Wrenchlane has the feature flag off and must not receive these rows.",
    );
  }
  const ref = TENANT_REFS[slug] ?? slug;
  if (!/^[a-z]{20}$/.test(ref)) throw new Error(`Not a Supabase project ref: ${slug}`);

  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${pat()}`, "User-Agent": "Mozilla/5.0" },
  });
  const keys = await res.json();
  if (!Array.isArray(keys)) throw new Error(`Cannot read keys for ${ref}: ${JSON.stringify(keys).slice(0, 200)}`);
  const key = keys.find((k) => k.name === "service_role")?.api_key
    ?? keys.find((k) => k.type === "secret")?.api_key;
  if (!key) throw new Error(`No service key for ${ref}`);

  const base = `https://${ref}.supabase.co/rest/v1`;
  const H = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

  async function rest(q, init = {}) {
    const r = await fetch(`${base}/${q}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
    const text = await r.text();
    if (!r.ok) throw new Error(`${r.status} ${q}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  }

  async function selectAll(table, query) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const rows = await rest(`${table}?${query}&order=id.asc&limit=1000&offset=${from}`);
      out.push(...rows);
      if (rows.length < 1000) break;
    }
    return out;
  }

  return { ref, slug, rest, selectAll };
}

/** The one workspace in a single-tenant database. Fails loudly if there is not exactly one. */
export async function soleWorkspace({ rest }) {
  const rows = await rest("workspaces?select=id,name&limit=5");
  if (rows.length !== 1) {
    throw new Error(`Expected exactly one workspace, found ${rows.length}: ${JSON.stringify(rows)}`);
  }
  return rows[0];
}
