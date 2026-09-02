import { describe, expect, it, vi, afterEach } from "vitest";
import {
  decodeEntities,
  fetchGaragetBoard,
  fetchGaragetTopic,
  garagetBoard,
  garagetReplyUrl,
  garagetTopicId,
  GARAGET_BOARDS,
} from "./garaget";
import { identifyPost } from "./candidates";

/**
 * These tests exist for two failure modes that are silent in production.
 *
 * 1. Encoding. Garaget serves ISO-8859-15. If we ever decode it as UTF-8 the
 *    titles still parse, they just come back with the Swedish letters mangled,
 *    and a scan would happily bank hundreds of rows reading "Felsökning". So
 *    the fixture is built from real ISO-8859-15 BYTES, not a JS string, and the
 *    assertion is on the letters themselves.
 *
 * 2. The JSON-LD contract. We read schema.org structured data instead of the
 *    markup. If Garaget drops it, the parser must return nothing rather than
 *    half-populated rows.
 */

// Encode a JS string as ISO-8859-15 bytes, the way Garaget serves them.
function latin1Bytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function boardHtml(items: Array<Record<string, unknown>>): string {
  const ld = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Generell felsökning",
    mainEntity: {
      "@type": "ItemList",
      itemListElement: items.map((item, i) => ({
        "@type": "ListItem",
        position: i + 1,
        item,
      })),
    },
  };
  // The surrounding markup carries the accented bytes; JSON.stringify leaves
  // non-ASCII as literal characters, which is exactly what Garaget does.
  return `<!DOCTYPE html><html><head><meta charset="ISO-8859-15">
<title>Generell felsökning - Garaget</title>
<script type="application/ld+json">${JSON.stringify(ld)}</script>
</head><body><p>Fordonsel och bilelektronik</p></body></html>`;
}

const TOPIC = {
  "@type": "DiscussionForumPosting",
  headline: "Volvo V70 D5 2007, ojämn tomgång och felkod P0299",
  url: "https://www.garaget.org/forum/viewtopic.php?id=352437",
  author: { "@type": "Person", name: "Beppe34" },
  datePublished: "2026-08-27T21:58:07+02:00",
  commentCount: 10,
};

function mockFetchHtml(html: string) {
  const bytes = latin1Bytes(html);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => bytes.buffer.slice(0) as ArrayBuffer,
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("garagetTopicId", () => {
  it("pulls the id out of a topic URL", () => {
    expect(garagetTopicId("https://www.garaget.org/forum/viewtopic.php?id=352437")).toBe("352437");
  });

  it("ignores a board URL, which has an id but is not a topic", () => {
    expect(garagetTopicId("https://www.garaget.org/forum/viewforum.php?id=42")).toBeNull();
  });

  it("is null for junk", () => {
    expect(garagetTopicId(null)).toBeNull();
    expect(garagetTopicId("https://reddit.com/r/MechanicAdvice")).toBeNull();
  });
});

describe("board reference data", () => {
  it("has the troubleshooting board, which is the whole point", () => {
    expect(garagetBoard(42)?.label).toBe("Generell felsökning");
    expect(garagetBoard("42")?.label).toBe("Generell felsökning");
  });

  it("uses string board names so they survive a round trip through the DB", () => {
    for (const b of GARAGET_BOARDS) expect(b.name).toBe(String(b.id));
  });
});

describe("fetchGaragetBoard", () => {
  it("parses topics out of the JSON-LD", async () => {
    mockFetchHtml(boardHtml([TOPIC]));

    const { posts, failed } = await fetchGaragetBoard({ boardId: 42 });

    expect(failed).toBe(false);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      platform: "garaget",
      external_id: "352437",
      board: "42",
      author: "Beppe34",
      num_comments: 10,
      // Garaget has no votes. Null, not 0, so the UI does not claim nobody
      // upvoted a post on a forum with no upvotes.
      score: null,
    });
    expect(posts[0].created_utc).toBe(Math.floor(Date.parse(TOPIC.datePublished) / 1000));
  });

  it("decodes ISO-8859-15, so Swedish letters survive", async () => {
    mockFetchHtml(boardHtml([TOPIC]));

    const { posts } = await fetchGaragetBoard({ boardId: 42 });

    expect(posts[0].title).toBe("Volvo V70 D5 2007, ojämn tomgång och felkod P0299");
    expect(posts[0].title).not.toContain("�");
  });

  it("returns nothing rather than junk when the JSON-LD is gone", async () => {
    mockFetchHtml("<html><body><a href='viewtopic.php?id=1'>a thread</a></body></html>");

    const { posts, failed } = await fetchGaragetBoard({ boardId: 42 });

    expect(failed).toBe(false); // the page loaded; it just had nothing for us
    expect(posts).toEqual([]);
  });

  it("reports a fetch failure instead of pretending the board was empty", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) })));

    const { posts, failed } = await fetchGaragetBoard({ boardId: 42 });

    expect(failed).toBe(true);
    expect(posts).toEqual([]);
  });

  it("skips entries with no usable id or title", async () => {
    mockFetchHtml(
      boardHtml([
        TOPIC,
        { "@type": "DiscussionForumPosting", headline: "No URL here" },
        { "@type": "DiscussionForumPosting", url: "https://www.garaget.org/forum/viewtopic.php?id=9" },
      ]),
    );

    const { posts } = await fetchGaragetBoard({ boardId: 42 });

    expect(posts.map((p) => p.external_id)).toEqual(["352437"]);
  });

  it("honours the limit", async () => {
    mockFetchHtml(
      boardHtml([
        TOPIC,
        { ...TOPIC, url: "https://www.garaget.org/forum/viewtopic.php?id=1", headline: "Andra" },
      ]),
    );

    const { posts } = await fetchGaragetBoard({ boardId: 42, limit: 1 });

    expect(posts).toHaveLength(1);
  });
});

describe("fetchGaragetTopic", () => {
  it("returns the opening post with its body", async () => {
    const ld = { ...TOPIC, text: "Bilen stannade på tomgång. Kamremmen stod still." };
    mockFetchHtml(
      `<html><head><meta charset="ISO-8859-15"><script type="application/ld+json">${JSON.stringify(
        ld,
      )}</script></head><body></body></html>`,
    );

    const post = await fetchGaragetTopic({ topicId: "352437" });

    expect(post?.external_id).toBe("352437");
    expect(post?.body).toBe("Bilen stannade på tomgång. Kamremmen stod still.");
  });

  it("is null when the page has no structured data", async () => {
    mockFetchHtml("<html><body>nope</body></html>");
    expect(await fetchGaragetTopic({ topicId: "352437" })).toBeNull();
  });
});

describe("identifyPost", () => {
  it("tells the two forums apart", () => {
    expect(identifyPost("https://www.garaget.org/forum/viewtopic.php?id=352437")).toEqual({
      platform: "garaget",
      externalId: "352437",
    });
    expect(
      identifyPost("https://www.reddit.com/r/MechanicAdvice/comments/1abc2de/title/"),
    ).toEqual({ platform: "reddit", externalId: "1abc2de" });
  });

  it("refuses to guess at a URL it does not recognise", () => {
    expect(identifyPost("https://example.com/thread/1")).toBeNull();
    expect(identifyPost(null)).toBeNull();
  });
});

describe("decodeEntities", () => {
  // Garaget's JSON-LD is generated from stored markup without unescaping, so
  // real titles genuinely arrive looking like this.
  it("unescapes the entities Garaget leaves in titles", () => {
    expect(decodeEntities('Turbon &quot;lägger av&quot; vid 3500rpm')).toBe(
      'Turbon "lägger av" vid 3500rpm',
    );
  });

  it("handles numeric and hex escapes", () => {
    expect(decodeEntities("&#8230; och &#xe5;ka")).toBe("… och åka");
  });

  it("clears the double-encoded case without looping", () => {
    expect(decodeEntities("&amp;quot;test&amp;quot;")).toBe('"test"');
  });

  it("leaves an unknown entity alone rather than eating it", () => {
    expect(decodeEntities("100 &fakeentity; kr")).toBe("100 &fakeentity; kr");
  });

  it("is applied to parsed titles and bodies", async () => {
    mockFetchHtml(
      boardHtml([{ ...TOPIC, headline: 'Volvo &quot;V70&quot; felkod', text: "A &amp; B" }]),
    );
    const { posts } = await fetchGaragetBoard({ boardId: 42 });
    expect(posts[0].title).toBe('Volvo "V70" felkod');
    expect(posts[0].body).toBe("A & B");
  });
});

describe("garagetReplyUrl", () => {
  it("points at the reply endpoint, which needs a signed-in profile", () => {
    expect(garagetReplyUrl("352437")).toBe("https://www.garaget.org/forum/post.php?tid=352437");
  });
});
