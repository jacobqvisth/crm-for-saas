// Autopilot: the scheduler and topic picker behind "publish 5 articles a day".
//
// THE SHAPE OF THE PROBLEM
// Publishing on a clock is easy. Publishing on a clock *honestly*, forever, is
// not: five articles a day is 150 a month, and the fastest way to wreck a domain
// is to point a language model at a topic list and let it write filler. So the
// scheduling half of this file is small and the topic half is where the care is.
//
// THE WELL
// Every autopilot article is grounded in something that actually happened on the
// platform. The main well is real diagnostics: roughly 2,400 rows, of which the
// ones carrying a described problem plus ranked causes can each support one case
// study. At 5 a day that is most of a year, and the well refills daily because
// workshops keep running diagnoses. The garnish is the 13 curated stat stories,
// which are strong but few, so one appears every `stats_every` articles and then
// goes on a cooldown. There is deliberately NO free-topic path: a free topic is
// the one mode with no data behind it, and unattended is exactly when that
// matters most.
//
// WHAT IT WILL NOT DO
// It stops rather than lowering the bar. If every rich diagnostic has been used
// and the stat stories are all in cooldown, the run logs "nothing worth writing
// about" and publishes nothing. An empty slot is a much cheaper mistake than a
// thin article on a domain that has to rank.

import { buildStatFactPack, STAT_STORIES, type StatStoryKey } from "./stat-stories";
import { loadDiagnosticCandidates, loadDiagnosticSnapshot, loadStatSources } from "./sources";
import { normalizeArticleOptions } from "./generation-options";
import type { ArticleDiagnosticSnapshot, ArticleGenerationOptions } from "./types";
import type { StatFactPack } from "./stat-stories";

/** Marks the `articles` rows this feature owns, as `release_mail` does for Releases. */
export const AUTOPILOT_SOURCE_KIND_DIAGNOSTIC = "diagnostic";
export const AUTOPILOT_SOURCE_KIND_STATS = "stats";

/**
 * The tag every autopilot article carries on the public site.
 *
 * A marker in the CRM would not be visible to anyone reading wrenchlane.com, and
 * "which of these did a human read before it went out" is a question worth being
 * able to answer from the outside. The name is honest rather than sheepish: these
 * pieces genuinely are built from platform data, which is the reason they are
 * worth publishing at all.
 */
export const AUTOPILOT_MARKER_TAG = "from-our-data";

/**
 * Categories an unattended article may be filed under.
 *
 * The excluded three each need a human: Product Updates is owned by the Releases
 * tab, Industry & Trends means having an opinion about the market, and DIY & Car
 * Care addresses vehicle owners rather than the trade, which is a different voice
 * from the one these are generated in.
 */
export const DEFAULT_AUTOPILOT_CATEGORIES = [
  "Diagnostics",
  "Troubleshooting",
  "Repair Data",
  "Electrical faults",
  "Shop Tips",
  "Predictive Maintenance",
  "Shop Operations",
];

export interface AutopilotSettings {
  enabled: boolean;
  perDay: number;
  intervalHours: number;
  startHour: number;
  timeZone: string;
  weekdaysOnly: boolean;
  publishMode: "live" | "stage";
  allowedCategories: string[];
  extraTags: string[];
  statsEvery: number;
  statsCooldownDays: number;
  options: Partial<ArticleGenerationOptions>;
}

export const DEFAULT_AUTOPILOT_SETTINGS: AutopilotSettings = {
  enabled: false,
  perDay: 5,
  intervalHours: 2,
  startHour: 8,
  timeZone: "Europe/Stockholm",
  weekdaysOnly: false,
  publishMode: "live",
  allowedCategories: DEFAULT_AUTOPILOT_CATEGORIES,
  extraTags: [AUTOPILOT_MARKER_TAG],
  statsEvery: 7,
  statsCooldownDays: 60,
  options: {},
};

/** Map a DB row onto the settings shape, filling anything absent. */
export function settingsFromRow(row: Record<string, unknown> | null): AutopilotSettings {
  if (!row) return DEFAULT_AUTOPILOT_SETTINGS;
  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  const arr = (v: unknown, fallback: string[]) =>
    Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : fallback;

  return {
    enabled: row.enabled === true,
    perDay: num(row.per_day, DEFAULT_AUTOPILOT_SETTINGS.perDay),
    intervalHours: num(row.interval_hours, DEFAULT_AUTOPILOT_SETTINGS.intervalHours),
    startHour: num(row.start_hour, DEFAULT_AUTOPILOT_SETTINGS.startHour),
    timeZone: typeof row.time_zone === "string" ? row.time_zone : DEFAULT_AUTOPILOT_SETTINGS.timeZone,
    weekdaysOnly: row.weekdays_only === true,
    publishMode: row.publish_mode === "stage" ? "stage" : "live",
    allowedCategories: arr(row.allowed_categories, []),
    extraTags: arr(row.extra_tags, DEFAULT_AUTOPILOT_SETTINGS.extraTags),
    statsEvery: num(row.stats_every, DEFAULT_AUTOPILOT_SETTINGS.statsEvery),
    statsCooldownDays: num(row.stats_cooldown_days, DEFAULT_AUTOPILOT_SETTINGS.statsCooldownDays),
    options:
      row.options && typeof row.options === "object"
        ? (row.options as Partial<ArticleGenerationOptions>)
        : {},
  };
}

/* --------------------------------------------------------------- the clock */

export interface LocalParts {
  /** 0-23 in the configured zone. */
  hour: number;
  minute: number;
  /** 0 = Sunday. */
  weekday: number;
  /** YYYY-MM-DD in the configured zone. The key "today" is counted against. */
  dateKey: string;
}

/**
 * Wall-clock parts in the configured zone.
 *
 * Everything date-shaped in this codebase is Stockholm-local and half-open, and
 * a schedule is the one place where being an hour out is immediately visible. So
 * the zone is resolved through Intl rather than by adding an offset, which would
 * be wrong for half the year.
 */
export function localParts(now: Date, timeZone: string): LocalParts {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    // "24" is how en-GB renders midnight with hour12:false. Left unhandled it
    // would put the day's first slot check an hour into tomorrow.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: weekdays[parts.weekday ?? "Mon"] ?? 1,
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

/** The local hours articles go out at, e.g. [8, 10, 12, 14, 16]. */
export function slotHours(settings: Pick<AutopilotSettings, "perDay" | "intervalHours" | "startHour">): number[] {
  const out: number[] = [];
  for (let i = 0; i < settings.perDay; i += 1) {
    const hour = settings.startHour + i * settings.intervalHours;
    // A slot past midnight would land on the next day's count and double up, so
    // the day simply ends. The UI shows the real slot list, so a cadence that
    // does not fit is visible rather than silently truncated at runtime only.
    if (hour > 23) break;
    out.push(hour);
  }
  return out;
}

export interface RunDecision {
  run: boolean;
  reason: string;
  /** How many slots have come due today. */
  slotsElapsed: number;
  /** Local hour of the next slot today, or null if the day is done. */
  nextSlotHour: number | null;
  slots: number[];
}

/**
 * Whether this invocation should publish.
 *
 * The cron fires hourly and this decides. Comparing published-today against
 * slots-elapsed rather than against "minutes since the last one" is what makes it
 * self-healing: if the 08:00 run failed, at 10:00 two slots have elapsed and none
 * has published, so it catches up instead of silently losing an article. It also
 * cannot drift, which a "wait N hours since the last publish" rule does as soon
 * as generation takes a few minutes.
 */
export function decideRun(input: {
  settings: AutopilotSettings;
  now: Date;
  publishedToday: number;
}): RunDecision {
  const { settings, now, publishedToday } = input;
  const slots = slotHours(settings);
  const { hour, weekday } = localParts(now, settings.timeZone);
  const elapsed = slots.filter((h) => h <= hour).length;
  const next = slots.find((h) => h > hour) ?? null;
  const base = { slotsElapsed: elapsed, nextSlotHour: next, slots };

  if (!settings.enabled) return { run: false, reason: "Autopilot is off", ...base };
  if (!slots.length) return { run: false, reason: "No slots configured", ...base };
  if (settings.weekdaysOnly && (weekday === 0 || weekday === 6)) {
    return { run: false, reason: "Weekends are off", ...base };
  }
  if (publishedToday >= settings.perDay) {
    return { run: false, reason: `Today's ${settings.perDay} are done`, ...base };
  }
  if (elapsed === 0) {
    return { run: false, reason: `Before the first slot (${pad(slots[0])}:00)`, ...base };
  }
  if (publishedToday >= elapsed) {
    return {
      run: false,
      reason: next === null ? "Caught up for today" : `Next slot at ${pad(next)}:00`,
      ...base,
    };
  }
  return {
    run: true,
    reason: `Slot ${publishedToday + 1} of ${settings.perDay}`,
    ...base,
  };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/* ------------------------------------------------------------ the topic */

export interface AutopilotTopic {
  sourceKind: "diagnostic" | "stats";
  sourceRef: string;
  /** Frozen onto the row, exactly as the Studio does. */
  snapshot: unknown;
  diagnostic: ArticleDiagnosticSnapshot | null;
  statPack: StatFactPack | null;
  /** What to tell the run log, and the Autopilot tab, this article is about. */
  label: string;
  /** Overrides merged over the configured options: a case study is not a data piece. */
  options: ArticleGenerationOptions;
}

export interface TopicInputs {
  /** source_ref of every article already written, any status. */
  usedRefs: Set<string>;
  /** stat story key -> most recent use, for the cooldown. */
  statLastUsed: Map<string, Date>;
  /** Autopilot articles written so far, which drives the stats rotation. */
  totalWritten: number;
  settings: AutopilotSettings;
  now: Date;
}

/**
 * Choose what to write about, or return null with a reason.
 *
 * Stats first when the rotation calls for it, then a diagnostic; if the stats
 * turn cannot be served (all in cooldown, or not enough data yet) it falls
 * through to a diagnostic rather than skipping the slot, because the rotation is
 * a preference and the case study is the dependable path.
 */
export async function pickTopic(
  inputs: TopicInputs,
): Promise<{ topic: AutopilotTopic } | { topic: null; reason: string }> {
  const { settings, usedRefs, statLastUsed, totalWritten, now } = inputs;

  const wantStats =
    settings.statsEvery > 0 && totalWritten > 0 && totalWritten % settings.statsEvery === 0;

  if (wantStats) {
    const picked = await pickStatStory({ statLastUsed, cooldownDays: settings.statsCooldownDays, now });
    if (picked) {
      return {
        topic: {
          sourceKind: "stats",
          sourceRef: picked.key,
          snapshot: picked.pack,
          diagnostic: null,
          statPack: picked.pack,
          label: picked.pack.label,
          // A stat story argues a thesis about aggregate data. Forcing the angle
          // stops it being written as a case study, which is what the configured
          // default is tuned for.
          options: normalizeArticleOptions({
            ...settings.options,
            angle: "data_insight",
            language: "en",
          }),
        },
      };
    }
  }

  const candidates = await loadDiagnosticCandidates(400);
  // Only diagnoses that can carry a story unaided. A bare code with one cause and
  // no description gives the model nothing, and nothing is what it fills with.
  const usable = candidates.filter(
    (c) =>
      !usedRefs.has(c.diagnosticId) &&
      Boolean(c.description) &&
      c.causeCount >= 2 &&
      c.dtcs.length > 0,
  );

  if (!usable.length) {
    return {
      topic: null,
      reason:
        "No unused diagnostic is rich enough to carry an article (needs a described problem, at least two ranked causes and a fault code)",
    };
  }

  // loadDiagnosticCandidates already sorts richest first.
  const chosen = usable[0];
  const snapshot = await loadDiagnosticSnapshot(chosen.diagnosticId);
  if (!snapshot) {
    return { topic: null, reason: "The chosen diagnostic disappeared between reads" };
  }

  return {
    topic: {
      sourceKind: "diagnostic",
      sourceRef: chosen.diagnosticId,
      snapshot,
      diagnostic: snapshot,
      statPack: null,
      label: `${chosen.car}${chosen.dtcs.length ? ` (${chosen.dtcs.slice(0, 3).join(", ")})` : ""}`,
      options: normalizeArticleOptions({
        ...settings.options,
        angle: "case_study",
        language: "en",
      }),
    },
  };
}

async function pickStatStory(input: {
  statLastUsed: Map<string, Date>;
  cooldownDays: number;
  now: Date;
}): Promise<{ key: StatStoryKey; pack: StatFactPack } | null> {
  const { statLastUsed, cooldownDays, now } = input;
  const cutoff = new Date(now.getTime() - cooldownDays * 24 * 60 * 60 * 1000);

  const eligible = STAT_STORIES.filter((s) => {
    const last = statLastUsed.get(s.key);
    return !last || last < cutoff;
  });
  if (!eligible.length) return null;

  // One read feeds both analysers; see sources.ts. Only paid for on a stats turn.
  const sources = await loadStatSources();

  // Longest-unused first, so the rotation spreads rather than always re-telling
  // whichever story happens to sort first.
  const ordered = [...eligible].sort((a, b) => {
    const at = statLastUsed.get(a.key)?.getTime() ?? 0;
    const bt = statLastUsed.get(b.key)?.getTime() ?? 0;
    return at - bt;
  });

  for (const story of ordered) {
    const pack = buildStatFactPack(story.key, sources);
    // Null means the sample is still under the story's own minimum. Try the next
    // one rather than publishing a claim that thin.
    if (pack) return { key: story.key, pack };
  }
  return null;
}
