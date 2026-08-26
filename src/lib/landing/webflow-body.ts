/**
 * Rendering a fault-code page into Webflow rich text.
 *
 * The Astro cluster renders the same payload as components. Webflow cannot do
 * that, so the whole body arrives as one rich-text field instead. That is a
 * deliberate trade for the flagship batch: binding thirty fields would mean
 * thirty bindings of Designer work on the live site, and the point of the batch
 * is to measure whether the live domain indexes these pages at all, not to
 * build the final template twice.
 *
 * WHY THIS IS GENERATED AND NEVER HAND-EDITED
 *
 * The body is a function of the diagnostics data. Editing it in Webflow would
 * be overwritten on the next sync and, worse, would silently diverge from the
 * Astro version of the same page. The field's help text says so.
 *
 * Markup is kept to what Webflow's rich-text field renders reliably: headings,
 * paragraphs, lists, strong and links. No tables, because their support varies
 * by site and a table that degrades badly is worse than a list that does not.
 */

import { stripLongDashes } from "@/lib/ai/no-long-dash";
import type { FaultCodePage } from "./emit";

/** Escape for text nodes and attribute values. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const SITE = "https://wrenchlane.com";

function monthOf(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

/**
 * The signup link, carrying the same identity the Astro pages carry.
 *
 * Webflow has no build step to inject the click-time gclid forwarder, so these
 * links carry the page identity but not the click id. That is a real gap and
 * the reason the flagship batch is an indexation test rather than the
 * measurement surface: the Astro cluster is where attribution works properly.
 */
function signupHref(slug: string): string {
  return `https://app.wrenchlane.com/signup?lp=${encodeURIComponent(slug)}&wl_kind=fault_code&plan=free`;
}

/**
 * @param published Slugs that will actually exist on the target site.
 *
 * The Astro cluster has a page for every buildable code, so its internal links
 * always resolve. The Webflow batch is eight pages, so the same `related` list
 * would produce a page full of 404s. Links are emitted only for slugs in this
 * set; the rest stay as plain text, because the fact that a sibling code exists
 * is still worth knowing even when we are not hosting a page for it.
 *
 * This is the second time this exact bug has come up. The first was companion
 * codes linking to deliberately-excluded pages in the Astro build.
 */
export function renderWebflowBody(
  page: FaultCodePage,
  published: ReadonlySet<string>,
): string {
  const out: string[] = [];
  const documented = Boolean(page.name);

  if (!documented) {
    out.push(
      `<p><strong>${esc(page.code)} is a standardised code, but it is not one of the codes with a single agreed description.</strong> Rather than guess at a meaning, this page gives what its structure genuinely tells you and what we see when it turns up in real work.</p>`,
    );
  }

  /* ---- what the code says on its own -------------------------------- */
  out.push(`<h2>What the code tells you on its own</h2>`);
  const structure: string[] = [
    `<li><strong>System.</strong> ${esc(page.systemLabel)}. ${esc(page.systemHint)}</li>`,
    `<li><strong>Functional group.</strong> ${esc(page.familyLabel)}</li>`,
  ];
  if (page.subsystemLabel) {
    structure.push(
      `<li><strong>Subsystem.</strong> ${esc(page.subsystemLabel)}</li>`,
    );
  }
  if (page.failureModes.length > 0) {
    const modes = page.failureModes
      .map((mode) => `${mode.ftb}${mode.label ? ` (${mode.label})` : ""}`)
      .join(", ");
    structure.push(
      `<li><strong>Failure type byte, when the tool sends one.</strong> ${esc(modes)}. Scan tools report the same fault as ${esc(page.code)} and as ${esc(page.code)}xx, where xx is a sub-type. They are one fault, and whether the sub-type appears depends on the tool and the protocol rather than on the car.</li>`,
    );
  }
  out.push(`<ul role="list">${structure.join("")}</ul>`);

  /* ---- the evidence -------------------------------------------------- */
  const { evidence } = page;
  if (evidence.sessions > 0) {
    out.push(`<h2>What we see when ${esc(page.code)} turns up</h2>`);
    const first = monthOf(evidence.firstSeen);
    const last = monthOf(evidence.lastSeen);
    const window =
      first && last && first !== last ? `${first} to ${last}` : (last ?? "");
    out.push(
      `<p>Measured across the diagnostics run through Wrenchlane by independent workshops, not taken from a reference table.${window ? ` Sightings span ${esc(window)}.` : ""}</p>`,
    );
    const facts = [
      `<li><strong>${evidence.sessions}</strong> diagnostics carried this code.</li>`,
      `<li><strong>${evidence.workshops}</strong> separate workshops met it, so this is not one shop seeing the same fault repeatedly.</li>`,
      `<li><strong>${Math.round(evidence.codeOnlyShare * 100)}%</strong> of the time it arrived with no symptom description at all, meaning the technician had nothing but the code to work from.</li>`,
    ];
    if (evidence.topMake) {
      facts.push(
        `<li>Most often on <strong>${esc(evidence.topMake)}</strong>, which is where we have seen it most rather than a claim about the fleet at large.</li>`,
      );
    }
    out.push(`<ul role="list">${facts.join("")}</ul>`);
  }

  /* ---- companions ---------------------------------------------------- */
  if (page.companions.length > 0) {
    out.push(`<h2>What ${esc(page.code)} usually turns up with</h2>`);
    out.push(
      `<p>The multiplier is how much more often the two appear together than chance would predict, so a high number means the pair is telling you something a single code is not. Codes rarely arrive alone, and reading the set is usually faster than chasing the first one on the list.</p>`,
    );
    const items = page.companions.map((companion) => {
      const label =
        companion.scope === "manufacturer"
          ? "manufacturer-specific, meaning depends on the marque"
          : (companion.name ?? "not individually documented");
      return `<li><strong>${esc(companion.code)}</strong>, ${esc(label)}. Seen together ${companion.together} time${companion.together === 1 ? "" : "s"}, ${companion.lift}x more often than chance.</li>`;
    });
    out.push(`<ul role="list">${items.join("")}</ul>`);
  }

  /* ---- the honest limit ---------------------------------------------- */
  out.push(`<h2>What this page does not tell you</h2>`);
  out.push(
    `<p>A code names a symptom the car noticed, not the part that failed. ${esc(page.code)} on one vehicle and the same code on another can have different causes, and the counts above describe what independent workshops brought to us rather than how common the fault is across all cars. Getting from the code to the cause needs the vehicle: its make, model, engine and what it is actually doing.</p>`,
  );

  /* ---- CTA ------------------------------------------------------------ */
  out.push(
    `<p><a href="${esc(signupHref(page.slug))}">Run ${esc(page.code)} against the car in front of you</a>. Enter the code and the symptoms and get ranked probable causes for that specific vehicle, with the checks in the order worth doing them. Free account, no card.</p>`,
  );

  /* ---- related -------------------------------------------------------- */
  if (page.related.length > 0) {
    out.push(`<h2>Other ${esc(page.familyLabel.toLowerCase())} codes</h2>`);
    const links = page.related.slice(0, 6).map((related) => {
      const slug = related.code.toLowerCase();
      const label = esc(related.name ?? "not individually documented");
      return published.has(slug)
        ? `<li><a href="${SITE}/en/fault-code/${esc(slug)}">${esc(related.code)}</a>, ${label}</li>`
        : `<li>${esc(related.code)}, ${label}</li>`;
    });
    out.push(`<ul role="list">${links.join("")}</ul>`);
  }

  // The no-long-dash rule applies to generated text, and this is generated text.
  return stripLongDashes(out.join("\n"));
}

/** One CMS item payload, keyed by the collection's field slugs. */
export function webflowItemFor(
  page: FaultCodePage,
  measuredOn: string,
  published: ReadonlySet<string>,
) {
  return {
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
    "measured-on": measuredOn,
    tier: page.tier,
    diagnostics: page.evidence.sessions,
  };
}
