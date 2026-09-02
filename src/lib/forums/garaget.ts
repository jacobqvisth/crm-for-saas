/**
 * Garaget.org — Sweden's largest motor community, and the second forum the
 * answer queue reads from.
 *
 * Why this is not another Apify integration: Garaget serves plain HTML to a
 * plain GET, with no login, no rate limiting we have hit, and no bot wall. So
 * discovery here costs nothing, has no cold-start delay, and does not touch the
 * $5/month Apify cap that gates the Reddit scan. It is strictly cheaper than
 * the Reddit path.
 *
 * Two things make the parsing robust rather than the usual scrape-and-pray:
 *
 * 1. Every board page carries one <script type="application/ld+json"> holding a
 *    schema.org CollectionPage → ItemList of DiscussionForumPosting entries,
 *    60 per page, each with headline, url, author, datePublished, dateModified
 *    and commentCount. A thread page carries the same object for the opening
 *    post, with the body in `text`. We read that structured data instead of the
 *    surrounding markup, so a template change breaks us only if it also breaks
 *    their SEO.
 *
 * 2. The pages are served as ISO-8859-15, NOT UTF-8, and say so only in a
 *    <meta charset>. `Response.text()` assumes UTF-8 and would turn every å ä ö
 *    into replacement characters, which on a Swedish car forum means mangling
 *    most titles ("Felsökning" → "Felsökning"). We therefore read raw bytes
 *    and decode them explicitly. The JSON-LD itself uses \uXXXX escapes so it
 *    survives either way, but the surrounding HTML does not, and a silent
 *    encoding bug here would poison the drafted replies too.
 */

import type { DiscoveredPost } from "./candidates";

/** Boards worth scanning. Ids are Garaget's own `viewforum.php?id=` values. */
export interface GaragetBoard {
  id: number;
  name: string;
  label: string;
  blurb: string;
}

/**
 * The diagnostic-heavy boards, in priority order.
 *
 * Deliberately NOT the whole forum: Garaget's biggest boards by volume are
 * "Projekt" (1.0M posts) and "Allmänt" (847k), which are build threads and
 * chat. The boards below are where someone describes a fault and asks what to
 * check, which is the only kind of thread we can usefully answer.
 */
export const GARAGET_BOARDS: GaragetBoard[] = [
  {
    id: 42,
    name: "42",
    label: "Generell felsökning",
    blurb:
      "General troubleshooting. Owners posting symptoms and fault codes asking what to check. The highest-intent board on the forum.",
  },
  {
    id: 43,
    name: "43",
    label: "Fordonsel och bilelektronik",
    blurb:
      "Vehicle electrics and electronics. Sensor faults, wiring, modules, warning lamps.",
  },
  {
    id: 13,
    name: "13",
    label: "Motorteknik (Grundläggande)",
    blurb: "Engine tech, everyday level. Running problems, misfires, starting faults.",
  },
  {
    id: 40,
    name: "40",
    label: "Motorteknik (Avancerad)",
    blurb: "Engine tech, deep end. Management systems, forced induction, tuning faults.",
  },
  {
    id: 47,
    name: "47",
    label: "El- och hybridbilar",
    blurb: "EV and hybrid. High-voltage systems, charging faults, battery diagnostics.",
  },
];

export const GARAGET_BOARD_IDS = new Set(GARAGET_BOARDS.map((b) => b.name));

export function garagetBoard(id: string | number | null | undefined): GaragetBoard | undefined {
  if (id === null || id === undefined) return undefined;
  return GARAGET_BOARDS.find((b) => b.name === String(id));
}

const BASE = "https://www.garaget.org/forum";

/** Browser-ish UA. Garaget serves us fine without one, but an honest identifier
 *  is better manners than a default fetch agent on someone else's forum. */
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/**
 * Fetch a Garaget page and decode it as ISO-8859-15.
 *
 * See the encoding note at the top of this file. TextDecoder("iso-8859-15") is
 * a WHATWG-required label, so this works in the Node runtime without a polyfill.
 */
async function fetchLatin(url: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html" },
      signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return new TextDecoder("iso-8859-15").decode(buf);
  } catch {
    return null;
  }
}

/**
 * Pull every JSON-LD payload out of a page.
 *
 * Returns parsed objects and silently drops any block that will not parse: a
 * broken block on one page must not take out a whole board scan.
 */
function readJsonLd(html: string): unknown[] {
  const out: unknown[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      out.push(JSON.parse(m[1]));
    } catch {
      // Not our problem to fix; skip it.
    }
  }
  return out;
}

/** Depth-first search for the first node whose @type matches. */
function findByType(node: unknown, type: string): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findByType(item, type);
      if (hit) return hit;
    }
    return null;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (obj["@type"] === type) return obj;
    for (const value of Object.values(obj)) {
      const hit = findByType(value, type);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Decode the HTML entities Garaget leaves inside its JSON-LD.
 *
 * Their structured data is generated from the stored post markup without being
 * unescaped first, so a real thread title arrives as
 *   Turbon &quot;lägger av&quot; vid 3500rpm
 * and a body comes through full of &quot; and &amp;. Left alone these reach the
 * model as literal entities, and it happily echoes them back into a reply that
 * a human then pastes onto a public forum.
 *
 * Deliberately a small fixed table plus numeric escapes rather than a parser:
 * this is decoding known noise in a text field, not rendering untrusted HTML,
 * and no output of this is ever inserted as markup.
 */
const NAMED_ENTITIES: Record<string, string> = {
  quot: '"',
  apos: "'",
  amp: "&",
  lt: "<",
  gt: ">",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
};

export function decodeEntities(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => {
      const hit = NAMED_ENTITIES[name.toLowerCase()];
      return hit === undefined ? whole : hit;
    })
    // &amp;quot; is double-encoded in a few older posts; one more pass clears it
    // without risking a loop, because this pass never re-introduces an entity.
    .replace(/&(quot|apos|lt|gt);/gi, (whole, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? whole);
}

const asString = (v: unknown): string | null => {
  if (typeof v !== "string" || !v.trim()) return null;
  return decodeEntities(v);
};
const asNumber = (v: unknown): number | null => (typeof v === "number" ? v : null);

/** "https://www.garaget.org/forum/viewtopic.php?id=352437" → "352437" */
export function garagetTopicId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /viewtopic\.php\?id=(\d+)/.exec(url);
  return m ? m[1] : null;
}

/** The URL a logged-in human lands on to reply to a topic. Returns 401 to us,
 *  which is the point: posting is a human action from a signed-in profile. */
export function garagetReplyUrl(topicId: string): string {
  return `${BASE}/post.php?tid=${encodeURIComponent(topicId)}`;
}

export function garagetTopicUrl(topicId: string): string {
  return `${BASE}/viewtopic.php?id=${encodeURIComponent(topicId)}`;
}

export function garagetBoardUrl(boardId: number | string): string {
  return `${BASE}/viewforum.php?id=${encodeURIComponent(String(boardId))}`;
}

/** Turn one schema.org DiscussionForumPosting into a queue candidate. */
function toPost(item: Record<string, unknown>, boardName: string): DiscoveredPost | null {
  const url = asString(item.url);
  const id = garagetTopicId(url);
  const title = asString(item.headline) ?? asString(item.name);
  if (!id || !title) return null;

  const author = item.author && typeof item.author === "object"
    ? asString((item.author as Record<string, unknown>).name)
    : null;

  const published = asString(item.datePublished);

  return {
    platform: "garaget",
    external_id: id,
    board: boardName,
    board_label: garagetBoard(boardName)?.label ?? null,
    title,
    // A board listing carries no body. The thread page does, and
    // fetchGaragetTopic fills it in when a draft actually needs it.
    body: asString(item.text) ?? asString(item.articleBody) ?? null,
    author,
    url: url ?? garagetTopicUrl(id),
    score: null, // Garaget has no vote score.
    num_comments: asNumber(item.commentCount),
    created_utc: published ? Math.floor(new Date(published).getTime() / 1000) : null,
  };
}

/**
 * Read one board's newest topics.
 *
 * Garaget orders a board page by most recent activity, so page 1 is the live
 * set. We never paginate: a daily scan only cares about what is new, and the
 * 60 entries on page 1 comfortably cover a day on even the busiest board.
 */
export async function fetchGaragetBoard(opts: {
  boardId: number | string;
  limit?: number;
  signal?: AbortSignal;
}): Promise<{ posts: DiscoveredPost[]; failed: boolean }> {
  const boardName = String(opts.boardId);
  const html = await fetchLatin(garagetBoardUrl(boardName), opts.signal);
  if (!html) return { posts: [], failed: true };

  const list = readJsonLd(html)
    .map((doc) => findByType(doc, "ItemList"))
    .find((node): node is Record<string, unknown> => node !== null);

  const entries = Array.isArray(list?.itemListElement) ? (list.itemListElement as unknown[]) : [];

  const posts: DiscoveredPost[] = [];
  for (const entry of entries) {
    const item =
      entry && typeof entry === "object"
        ? ((entry as Record<string, unknown>).item as Record<string, unknown> | undefined)
        : undefined;
    if (!item) continue;
    const post = toPost(item, boardName);
    if (post) posts.push(post);
  }

  // A board page is not a failure just because it had no parsable items, but an
  // empty result from a page that DID load is worth distinguishing from a fetch
  // error, so the caller can tell "nothing new" from "Garaget changed".
  return { posts: opts.limit ? posts.slice(0, opts.limit) : posts, failed: false };
}

/** Scan several boards. Sequential on purpose: this is one small forum run by
 *  volunteers, and there is no deadline that justifies hammering it. */
export async function fetchGaragetBoards(opts: {
  boardIds: Array<number | string>;
  limitPerBoard?: number;
  signal?: AbortSignal;
}): Promise<{ posts: DiscoveredPost[]; failedBoards: string[] }> {
  const posts: DiscoveredPost[] = [];
  const failedBoards: string[] = [];

  for (const boardId of opts.boardIds) {
    const res = await fetchGaragetBoard({
      boardId,
      limit: opts.limitPerBoard,
      signal: opts.signal,
    });
    if (res.failed) {
      failedBoards.push(String(boardId));
      continue;
    }
    posts.push(...res.posts);
  }

  return { posts, failedBoards };
}

/**
 * Fetch one thread's opening post, including the body.
 *
 * Needed because the reply generator has to answer the actual question, and a
 * board listing only gives us the title. Called when a draft is requested, not
 * during the scan, so we fetch one page per draft rather than 60 per board.
 */
export async function fetchGaragetTopic(opts: {
  topicId: string;
  signal?: AbortSignal;
}): Promise<DiscoveredPost | null> {
  const html = await fetchLatin(garagetTopicUrl(opts.topicId), opts.signal);
  if (!html) return null;

  const posting = readJsonLd(html)
    .map((doc) => findByType(doc, "DiscussionForumPosting"))
    .find((node): node is Record<string, unknown> => node !== null);
  if (!posting) return null;

  // The thread page's JSON-LD has no board id; the caller knows which board it
  // scanned this topic from, and a pasted URL simply has no board.
  const post = toPost({ ...posting, url: posting.url ?? garagetTopicUrl(opts.topicId) }, "");
  if (!post) return null;
  return { ...post, board: post.board || null, board_label: null };
}
