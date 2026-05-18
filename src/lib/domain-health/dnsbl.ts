// Domain blocklist (DNSBL) checks for a sending domain.
//
// Important gotcha that caught us during the initial wrenchlane.com
// snapshot (2026-05-18): DNSBLs intentionally return canned "query
// refused" addresses when you query them through Cloudflare 1.1.1.1 or
// Google 8.8.8.8 — because those resolvers proxy huge query volume and
// the blocklists rate-limit anonymous traffic. The refusal codes look
// identical to a real listing if you only check "did the lookup
// resolve". Specifically:
//
//   * Spamhaus DBL responds with `127.255.255.254` for "query through
//     unauthorized public resolver". A real listing is `127.0.1.2..6`
//     or `127.0.1.102` (abused-legit). See
//     https://www.spamhaus.org/dnsbl-usage/
//   * URIBL responds with `127.0.0.1` for rate-limited / refused queries
//     from public DNS. Real listings live in a different /8: black is
//     `127.0.0.2`, grey `127.0.0.4`, red `127.0.0.8`.
//
// We query through Quad9 (9.9.9.9), which has a direct relationship
// with most major DNSBLs and is documented as supported. We also encode
// the well-known refusal codes so a refusal classifies as `unknown`
// (not `listed`), keeping the alert layer honest.

import { Resolver } from "node:dns/promises";

const RESOLVER_SERVERS = ["9.9.9.9", "149.112.112.112"];

export type BlocklistResult = {
  list: string;
  // 'clean'  — domain not on the list
  // 'listed' — confirmed listing with a known meaning code
  // 'refused' — resolver returned a "query refused / rate-limited" placeholder
  // 'error'   — unexpected DNS error during the lookup
  state: "clean" | "listed" | "refused" | "error";
  raw: string | null;
  note?: string;
};

type BlocklistConfig = {
  zone: string;
  // Map response octet pattern → human meaning. If a returned IP isn't
  // in this map AND isn't in REFUSAL_CODES, we treat it as listed
  // (unknown code) rather than silently dropping it.
  meanings: Record<string, string>;
  // Codes the operator of this BL uses for "go away" rather than a real
  // listing. Treated as `refused`, never `listed`.
  refusalCodes?: string[];
};

const BLOCKLISTS: BlocklistConfig[] = [
  {
    zone: "dbl.spamhaus.org",
    meanings: {
      "127.0.1.2": "spam domain",
      "127.0.1.4": "phishing domain",
      "127.0.1.5": "malware domain",
      "127.0.1.6": "botnet C&C domain",
      "127.0.1.102": "abused legitimate spam",
      "127.0.1.103": "abused legitimate redirector",
      "127.0.1.104": "abused legitimate phishing",
      "127.0.1.105": "abused legitimate malware",
      "127.0.1.106": "abused legitimate botnet C&C",
    },
    refusalCodes: [
      "127.255.255.252", // typing error in DNSBL name
      "127.255.255.254", // anonymous query through public resolver
      "127.255.255.255", // IP queried (DBL is domain-only)
    ],
  },
  {
    zone: "multi.surbl.org",
    meanings: {
      "127.0.0.16": "phishing",
      "127.0.0.64": "malware",
      "127.0.0.128": "abuse",
    },
  },
  {
    zone: "multi.uribl.com",
    meanings: {
      "127.0.0.2": "black list",
      "127.0.0.4": "grey list (likely)",
      "127.0.0.8": "red list (newly seen)",
    },
    refusalCodes: [
      "127.0.0.1", // public resolver refusal
    ],
  },
];

function newResolver(): Resolver {
  const r = new Resolver();
  r.setServers(RESOLVER_SERVERS);
  return r;
}

async function queryOne(domain: string, list: BlocklistConfig): Promise<BlocklistResult> {
  const resolver = newResolver();
  const name = `${domain}.${list.zone}`;
  try {
    const addrs = await resolver.resolve4(name);
    if (!addrs.length) return { list: list.zone, state: "clean", raw: null };
    const raw = addrs.join(",");
    // Any address counts; classify by the first one.
    const first = addrs[0];

    if (list.refusalCodes?.includes(first)) {
      return {
        list: list.zone,
        state: "refused",
        raw,
        note: `resolver refusal code (${first}) — query through Quad9 may need rate-limit/paid feed for authoritative answer`,
      };
    }
    const meaning = list.meanings[first];
    return {
      list: list.zone,
      state: "listed",
      raw,
      note: meaning ?? `unknown listing code: ${first}`,
    };
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === "ENOTFOUND" || code === "ENODATA") {
      return { list: list.zone, state: "clean", raw: null };
    }
    return {
      list: list.zone,
      state: "error",
      raw: null,
      note: `${code ?? "unknown"}: ${(err as Error).message ?? "lookup failed"}`,
    };
  }
}

export async function checkBlocklists(domain: string): Promise<BlocklistResult[]> {
  return Promise.all(BLOCKLISTS.map((bl) => queryOne(domain, bl)));
}

// Exported for unit tests that want to assert refusal-code handling
// without round-tripping through real DNS.
export const __test = { BLOCKLISTS };
