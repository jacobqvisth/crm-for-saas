// Regression test for the contact-extraction window.
//
//   node scripts/schools/lib_scrape.test.mjs
//
// Self-contained (no network, no fixture file) so it can run anywhere.
//
// The bug it guards: the context window used to be measured in raw HTML characters.
// On a theme that inlines a ~600-character style attribute on every element (Avada
// on beut.se), a 260-character raw window never escaped one style="" and the name
// and job title sat far outside it. 1382 of 4112 scraped people came back with
// neither. Windows are now measured in visible text, so page weight cannot hide a
// name that is visually right next to the address.

import assert from "node:assert";
import { extractPeople, textBefore } from "./lib_scrape.mjs";

const FAT_STYLE =
  'style="' +
  Array.from({ length: 18 }, (_, i) => `--awb-typography${i}-font-weight:var(--h${i}_typography-font-weight)`).join(";") +
  '"';

// A staff card shaped like the real one: name, role, then the mailto, with each
// element carrying a large inline style attribute.
const html = `
<div ${FAT_STYLE}>
  <div ${FAT_STYLE}><h3 ${FAT_STYLE}>Marcus Hallonbacka</h3></div>
  <div ${FAT_STYLE}>Programansvarig personbilsteknik</div>
  <div ${FAT_STYLE}><a ${FAT_STYLE} href="mailto:marcus.hallonbacka@beut.se">marcus.hallonbacka@beut.se</a></div>
</div>`;

let failures = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok   ${label}`); }
  catch (e) { failures++; console.error(`  FAIL ${label}\n       ${e.message}`); }
}

console.log("extraction window");

check("finds the name past a wall of inline CSS", () => {
  const [p] = extractPeople(html, "https://beut.se/gymnasium-uppsala/");
  assert.equal(p.email, "marcus.hallonbacka@beut.se");
  assert.equal(p.name, "Marcus Hallonbacka");
});

check("finds the job title past the same wall", () => {
  const [p] = extractPeople(html, "https://beut.se/gymnasium-uppsala/");
  assert.equal(p.title, "programansvarig");
});

check("textBefore returns visible text, not attribute soup", () => {
  const idx = html.indexOf("mailto:");
  const got = textBefore(html, idx, 300);
  assert.ok(!got.includes("--awb-typography"), `leaked CSS: ${got.slice(0, 80)}`);
  assert.ok(got.includes("Programansvarig"), `missed the role: ${got.slice(-80)}`);
});

check("a name the address contradicts is dropped", () => {
  // Staff lists run people in sequence; a window can reach the previous person.
  // Only a name the email local part corroborates may survive.
  const wrong = `<p>Anne-Maj Videnord</p><a href="mailto:petra.smith@uppsala.se">Mejl</a>`;
  const [p] = extractPeople(wrong, "https://uppsala.se/");
  assert.equal(p.name, null);
});

check("a corroborated name survives", () => {
  const right = `<p>Petra Smith</p><a href="mailto:petra.smith@uppsala.se">Mejl</a>`;
  const [p] = extractPeople(right, "https://uppsala.se/");
  assert.equal(p.name, "Petra Smith");
});

console.log(failures === 0 ? "\nall passed" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
