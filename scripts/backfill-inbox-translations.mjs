#!/usr/bin/env node
/**
 * One-off backfill of inbox_messages translation columns.
 *
 * For every row where `detected_language IS NULL`, calls Claude Haiku once to
 * detect language + translate subject/body, and writes the result back.
 *
 * Usage:
 *   node scripts/backfill-inbox-translations.mjs [--limit=N] [--dry-run]
 *
 * Reads creds from /Users/jacobqvisth/crm-for-saas/.env.local (SUPABASE_DB_PASSWORD,
 * ANTHROPIC_API_KEY). Safe to re-run — only touches NULL rows.
 *
 * Pairs with PR A of the inbox translation plan. Subsequent inbound messages
 * are translated by the check-replies cron at receipt time, so this script
 * exists only to catch up historic rows.
 */
import dotenv from "/Users/jacobqvisth/crm-worktrees/pr-a0-inbox-filters/node_modules/dotenv/lib/main.js";
import Anthropic from "/Users/jacobqvisth/crm-worktrees/pr-a0-inbox-filters/node_modules/@anthropic-ai/sdk/index.mjs";
import pkg from "/Users/jacobqvisth/crm-worktrees/pr-a0-inbox-filters/node_modules/pg/lib/index.js";

dotenv.config({ path: "/Users/jacobqvisth/crm-for-saas/.env.local" });

const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `You translate inbound business emails to English for a B2B CRM inbox.
Rules:
- First, detect the source language. Output its ISO 639-1 code (en, sv, lv, lt, et, fi, da, no, de, pl, ru, …).
- If the source language is English, do NOT translate — return the language code only and leave subject/body fields empty strings.
- If the source language is NOT English: translate naturally to English (native-speaker quality, professional business tone, not literal).
- PRESERVE all HTML tags in the body (<p>, <a>, <br>, <div>, <span>, blockquote, etc.) exactly as in the source.
- PRESERVE URLs and email addresses exactly.
- PRESERVE quoted-reply blocks — translate the prose inside them, keep the structure.
- Translate the subject too unless source is English.
- Return ONLY valid JSON in this exact shape — no markdown fences, no commentary:
{"language": "lv", "subject_en": "...", "body_en": "..."}`;

const args = new Map();
for (const arg of process.argv.slice(2)) {
  const m = arg.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args.set(m[1], m[2] ?? "true");
}
const LIMIT = args.has("limit") ? Number(args.get("limit")) : Infinity;
const DRY_RUN = args.get("dry-run") === "true";

if (!process.env.SUPABASE_DB_PASSWORD) {
  console.error("SUPABASE_DB_PASSWORD missing from .env.local");
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY missing from .env.local");
  process.exit(1);
}

const AnthropicCtor = Anthropic.default ?? Anthropic;
const client = new AnthropicCtor({ apiKey: process.env.ANTHROPIC_API_KEY });

const pg = new pkg.Client({
  host: "aws-1-eu-north-1.pooler.supabase.com",
  port: 5432,
  user: "postgres.wdgiwuhehqpkhpvdzzzl",
  password: process.env.SUPABASE_DB_PASSWORD,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
});

await pg.connect();

const { rows } = await pg.query(
  `SELECT id, subject, body_html, body_text
   FROM inbox_messages
   WHERE detected_language IS NULL
   ORDER BY received_at DESC
   LIMIT $1`,
  [Number.isFinite(LIMIT) ? LIMIT : 5000],
);

console.log(`Found ${rows.length} rows to translate.`);
if (DRY_RUN) {
  console.log("[dry-run] not calling the model, not writing back.");
  await pg.end();
  process.exit(0);
}

let processed = 0;
let englishCount = 0;
let translatedCount = 0;
let failureCount = 0;

for (const row of rows) {
  processed++;
  try {
    const result = await translateOne(row);
    if (!result) {
      failureCount++;
      continue;
    }
    if (result.language === "en") englishCount++;
    else translatedCount++;

    await pg.query(
      `UPDATE inbox_messages
       SET detected_language = $1,
           subject_translated_en = $2,
           body_translated_en = $3,
           translation_model = $4
       WHERE id = $5`,
      [
        result.language,
        result.subjectEn,
        result.bodyHtmlEn,
        result.language === "en" ? null : MODEL,
        row.id,
      ],
    );

    if (processed % 25 === 0) {
      console.log(
        `  ${processed}/${rows.length} — en:${englishCount} translated:${translatedCount} failed:${failureCount}`,
      );
    }
  } catch (err) {
    failureCount++;
    console.error(`  row ${row.id} failed:`, err?.message ?? err);
  }
}

console.log(
  `Done. processed=${processed} english=${englishCount} translated=${translatedCount} failed=${failureCount}`,
);
await pg.end();

async function translateOne(row) {
  const subject = (row.subject ?? "").trim();
  const bodyHtml = (row.body_html ?? "").trim();
  const bodyText = (row.body_text ?? "").trim();
  if (!subject && !bodyHtml && !bodyText) return null;

  const bodyForModel = bodyHtml || `<p>${escapeHtml(bodyText)}</p>`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Subject: ${subject || "(no subject)"}\n\nBody (HTML):\n${bodyForModel}`,
      },
    ],
  });
  const raw = response.content[0]?.type === "text" ? response.content[0].text : "";
  const cleaned = raw
    .replace(/^```(?:json)?\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned);
  const language = normalizeLang(parsed.language);
  if (!language) return null;
  if (language === "en") {
    return { language: "en", subjectEn: null, bodyHtmlEn: null };
  }
  return {
    language,
    subjectEn:
      typeof parsed.subject_en === "string" && parsed.subject_en.trim()
        ? parsed.subject_en
        : null,
    bodyHtmlEn:
      typeof parsed.body_en === "string" && parsed.body_en.trim()
        ? parsed.body_en
        : null,
  };
}

function normalizeLang(v) {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  if (/^[a-z]{2}$/.test(t)) return t;
  const map = { lav: "lv", lit: "lt", est: "et", swe: "sv", fin: "fi", dan: "da", nor: "no", eng: "en" };
  return map[t] ?? null;
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
