#!/usr/bin/env node
// One-shot (idempotent) geocoding backfill for companies.latitude / longitude.
// Reads .env.local, connects to prod via the Supabase REST API (no pg dependency).
// Throttles to ~10/sec to stay under Geocoding API quota.
//
// Usage:
//   GOOGLE_MAPS_API_KEY=... node scripts/backfill-companies-latlng.mjs
// or with the key in .env.local already.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ENV_PATH = resolve(process.cwd(), ".env.local");
loadEnv(ENV_PATH);

const SUPABASE_URL = mustEnv("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_ROLE = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
const MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY;

if (!MAPS_KEY) {
  console.error("GOOGLE_MAPS_API_KEY not set — set it in .env.local or pass it inline.");
  process.exit(1);
}

const HEADERS = {
  apikey: SERVICE_ROLE,
  Authorization: `Bearer ${SERVICE_ROLE}`,
  "Content-Type": "application/json",
  Prefer: "return=minimal",
};

async function main() {
  let geocoded = 0;
  let failed = 0;
  let skipped = 0;
  let pageOffset = 0;
  const PAGE_SIZE = 200;

  while (true) {
    const url = new URL(`${SUPABASE_URL}/rest/v1/companies`);
    url.searchParams.set(
      "select",
      "id,name,address,city,postal_code,country,latitude,geocoded_at",
    );
    url.searchParams.set("address", "not.is.null");
    url.searchParams.set("latitude", "is.null");
    url.searchParams.set("order", "id");
    url.searchParams.set("limit", String(PAGE_SIZE));
    url.searchParams.set("offset", String(pageOffset));

    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) {
      console.error(`Fetch failed (${res.status}):`, await res.text());
      process.exit(2);
    }
    const rows = await res.json();
    if (rows.length === 0) break;

    for (const row of rows) {
      if (row.geocoded_at) {
        skipped++;
        continue;
      }
      const fullAddress = [row.address, row.postal_code, row.city, row.country]
        .filter(Boolean)
        .join(", ");
      try {
        const coords = await geocode(fullAddress, MAPS_KEY);
        if (!coords) {
          failed++;
          await markGeocodedFailed(row.id);
          continue;
        }
        await writeBack(row.id, coords);
        geocoded++;
        if (geocoded % 25 === 0) {
          console.log(`  ...geocoded ${geocoded} so far`);
        }
      } catch (err) {
        failed++;
        console.error(`  failed for ${row.id} (${row.name}):`, err.message ?? err);
      }
      await sleep(100); // ~10/sec
    }

    pageOffset += rows.length;
  }

  console.log(`\nDone. Geocoded ${geocoded}, ${failed} failed, ${skipped} skipped.`);
}

async function geocode(address, key) {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("key", key);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.status !== "OK") {
    if (data.status !== "ZERO_RESULTS") {
      console.error(`  geocode status=${data.status} for "${address}"`);
    }
    return null;
  }
  const loc = data.results[0]?.geometry?.location;
  return loc ? { lat: loc.lat, lng: loc.lng } : null;
}

async function writeBack(id, { lat, lng }) {
  const url = `${SUPABASE_URL}/rest/v1/companies?id=eq.${id}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: HEADERS,
    body: JSON.stringify({ latitude: lat, longitude: lng, geocoded_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`PATCH HTTP ${res.status}: ${await res.text()}`);
}

async function markGeocodedFailed(id) {
  // Set geocoded_at to mark "we tried" so re-runs skip it. Lat/lng stay null.
  const url = `${SUPABASE_URL}/rest/v1/companies?id=eq.${id}`;
  await fetch(url, {
    method: "PATCH",
    headers: HEADERS,
    body: JSON.stringify({ geocoded_at: new Date().toISOString() }),
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function mustEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name} in environment / .env.local`);
    process.exit(1);
  }
  return v;
}

function loadEnv(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

await main();
