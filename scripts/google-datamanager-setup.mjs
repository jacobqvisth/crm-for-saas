#!/usr/bin/env node
//
// One-time setup for sending real payments back to Google Ads.
//
//   node scripts/google-datamanager-setup.mjs
//
// Offline conversion import cannot go through the Google Ads API any more.
// `ConversionUploadService.UploadClickConversions` answers
// CUSTOMER_NOT_ALLOWLISTED_FOR_THIS_FEATURE for a new integration — for a gclid
// and a hashed email alike, so it is the service that is closed, not the
// identifier. Google routes new integrations to the Data Manager API, which
// needs the `.../auth/datamanager` OAuth scope. The CRM's existing refresh
// token does not carry it.
//
// This script does three things and then stops:
//
//   1. Runs a browser consent flow for the datamanager scope ALONE and mints a
//      SEPARATE refresh token. It deliberately does not touch
//      GOOGLE_OAUTH_REFRESH_TOKEN: that one credential is what GA4, Search
//      Console, Firebase and Google Ads all authenticate with, and re-consenting
//      it to add one scope risks every sync in the app on the outcome of one
//      browser redirect.
//   2. Creates the conversion action the uploads land in, if it does not exist:
//      type UPLOAD_CLICKS, category SUBSCRIBE_PAID, and NOT primary — so it can
//      never influence bidding until somebody decides that on purpose.
//   3. Prints the two environment variables to add to Vercel production.
//
// It reads credentials from .env.local, or from the environment.

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";

const SCOPE = "https://www.googleapis.com/auth/datamanager";
const API = "https://googleads.googleapis.com/v25";
const REDIRECT_PORT = 8787;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth2callback`;

function loadEnv() {
  const out = { ...process.env };
  if (existsSync(".env.local")) {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const i = line.indexOf("=");
      if (i <= 0 || line.trimStart().startsWith("#")) continue;
      const key = line.slice(0, i).trim();
      const value = line
        .slice(i + 1)
        .trim()
        .replace(/^"|"$/g, "")
        .replace(/\\n/g, "");
      if (!out[key]) out[key] = value;
    }
  }
  return out;
}

const env = loadEnv();

function need(key) {
  if (!env[key]) {
    console.error(`Missing ${key}. Pull it first:  vercel env pull .env.local --environment=production`);
    process.exit(1);
  }
  return env[key];
}

const CLIENT_ID = need("GOOGLE_OAUTH_CLIENT_ID");
const CLIENT_SECRET = need("GOOGLE_OAUTH_CLIENT_SECRET");
const CUSTOMER_ID = need("GOOGLE_ADS_CUSTOMER_ID").replace(/[^0-9]/g, "");
const DEV_TOKEN = need("GOOGLE_ADS_DEVELOPER_TOKEN");

// ---------------------------------------------------------------- 1. consent

/**
 * `prompt=consent` and `access_type=offline` together are what make Google
 * return a REFRESH token rather than only an access token. Without both, a
 * second authorisation of an already-authorised client returns no refresh
 * token at all and the script would appear to succeed while producing nothing
 * durable.
 */
function authUrl(state) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

function waitForCode(expectedState) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
      if (url.pathname !== "/oauth2callback") {
        res.writeHead(404).end("not here");
        return;
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        `<body style="font:16px system-ui;padding:3rem">${
          error
            ? `<h2>Refused: ${error}</h2>`
            : "<h2>Done. You can close this tab and go back to the terminal.</h2>"
        }</body>`,
      );
      server.close();

      if (error) return reject(new Error(error));
      // The state check is the reason this is a real server and not a paste
      // prompt: it is what makes the redirect we accept the one we started.
      if (state !== expectedState) return reject(new Error("state mismatch"));
      if (!code) return reject(new Error("no code in redirect"));
      resolve(code);
    });
    server.listen(REDIRECT_PORT);
    setTimeout(() => {
      server.close();
      reject(new Error("timed out waiting for the browser redirect"));
    }, 300_000).unref();
  });
}

async function exchange(code) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  const payload = await response.json();
  if (!payload.refresh_token) {
    throw new Error(
      `No refresh token returned: ${JSON.stringify(payload).slice(0, 300)}. ` +
        "Revoke the app at myaccount.google.com/permissions and run this again.",
    );
  }
  return payload;
}

// -------------------------------------------------- 2. the conversion action

async function adsRequest(accessToken, path, body) {
  const response = await fetch(`${API}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "developer-token": DEV_TOKEN,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status}: ${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : {};
}

async function adsAccessToken() {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: need("GOOGLE_OAUTH_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    }),
  });
  const payload = await response.json();
  if (!payload.access_token) throw new Error("could not refresh the Google Ads token");
  return payload.access_token;
}

const ACTION_NAME = "WrenchLane paid subscription (offline, from Stripe)";

async function ensureConversionAction(accessToken) {
  const found = await adsRequest(accessToken, `customers/${CUSTOMER_ID}/googleAds:search`, {
    query:
      "SELECT conversion_action.id, conversion_action.name, conversion_action.type, " +
      "conversion_action.category, conversion_action.primary_for_goal " +
      `FROM conversion_action WHERE conversion_action.name = '${ACTION_NAME}'`,
  });

  const existing = found.results?.[0]?.conversionAction;
  if (existing) {
    console.log(`  conversion action already exists: ${existing.id}`);
    return existing.id;
  }

  const created = await adsRequest(
    accessToken,
    `customers/${CUSTOMER_ID}/conversionActions:mutate`,
    {
      operations: [
        {
          create: {
            name: ACTION_NAME,
            type: "UPLOAD_CLICKS",
            category: "SUBSCRIBE_PAID",
            status: "ENABLED",
            // NOT primary. Real payments run 4-10 a month on this account,
            // well under the ~30 Smart Bidding needs, so this starts as an
            // observation signal. Promoting it is a separate, deliberate act.
            primaryForGoal: false,
            countingType: "ONE_PER_CLICK",
            clickThroughLookbackWindowDays: 90,
            valueSettings: { defaultValue: 0, alwaysUseDefaultValue: false },
          },
        },
      ],
    },
  );

  const id = created.results?.[0]?.resourceName?.split("/").pop();
  console.log(`  created conversion action: ${id}`);
  return id;
}

// ------------------------------------------------------------------- run it

const state = randomBytes(16).toString("hex");
const url = authUrl(state);

console.log("\n1. Open this in the browser signed in as the Google Ads account owner:\n");
console.log(`   ${url}\n`);
console.log(`   Waiting for the redirect back to ${REDIRECT_URI} ...`);

const code = await waitForCode(state);
const tokens = await exchange(code);

const granted = String(tokens.scope || "");
if (!granted.includes("datamanager")) {
  console.error(`\nThe datamanager scope was NOT granted. Got: ${granted}`);
  process.exit(1);
}
console.log("\n2. Scope granted.");

console.log("\n3. Conversion action:");
const actionId = await ensureConversionAction(await adsAccessToken());

console.log("\n--------------------------------------------------------------");
console.log("Add these to Vercel production, then redeploy:\n");
console.log(`  GOOGLE_DATAMANAGER_REFRESH_TOKEN=${tokens.refresh_token}`);
console.log(`  GOOGLE_ADS_PAID_SUBSCRIPTION_ACTION_ID=${actionId}`);
console.log("\n  vercel env add GOOGLE_DATAMANAGER_REFRESH_TOKEN production");
console.log("  vercel env add GOOGLE_ADS_PAID_SUBSCRIPTION_ACTION_ID production");
console.log("\nThen dry-run the upload before letting the cron near it:");
console.log("  curl -H \"Authorization: Bearer $SYNC_SECRET\" \\");
console.log("    'https://crm-for-saas.vercel.app/api/cron/upload-paid-conversions?dryRun=1'");
console.log("--------------------------------------------------------------\n");
