// Shared vocabulary for the configurator prospect crawl.
//
// Two jobs. Deciding whether a link on a company's own site leads to a configurator,
// and deciding which platform is running behind it. Both are vocabulary problems in a
// dozen languages, so they live here rather than being retyped in each phase.

// Hosts that appear on every reference page and are never the customer being referenced.
// Without this the harvest is 80% LinkedIn, Google Fonts and cookie-consent vendors.
// Software review and directory sites deserve a special mention: they are linked from
// almost every vendor's pages ("see our G2 rating") and they are never the customer.
// Without them the top of the harvest was Capterra, G2, GetApp, SourceForge and Gartner.
// The consultancies, analysts and content farms a vendor cites in a statistics-led
// "case" page. Cadesign form's cases page is an article quoting Bain, McKinsey and Help
// Scout, and all three arrived as customers on the first run.
export const JUNK_HOST =
  /(^|\.)(mckinsey|bain|bcg|deloitte|pwc|kpmg|ey|accenture|forrester|idc|statista|hbr|harvard|helpscout|templatelab|experiencematters|cioreview|forbes|techcrunch|businesswire|prnewswire|globenewswire|wired|economist|ft|bloomberg|reuters|hubspotusercontent[a-z0-9-]*|hs-analytics|capterra|g2|getapp|softwareadvice|sourceforge|slashdot|gartner|trustradius|saasworthy|goodfirms|producthunt|crozdesk|financesonline|cookiedatabase|cookiepedia|nen|iso|tuv|tuev|dekra|bureauveritas|iabeurope|linkedin|facebook|fb|twitter|x|instagram|youtube|youtu|vimeo|tiktok|pinterest|xing|reddit|whatsapp|telegram|medium|github|gitlab|google|googleapis|gstatic|googletagmanager|doubleclick|g\.page|goo\.gl|bit\.ly|hubspot|hubspotusercontent|hs-sites|hsforms|wistia|wixstatic|wix|squarespace|cloudfront|akamaized|akamai|cdn|jsdelivr|unpkg|cloudflare|amazonaws|azureedge|typekit|fonts|adobe|w3|schema|sentry|hotjar|mailchimp|campaign-archive|eventbrite|calendly|zoom|teams|slack|apple|microsoft|windows|android|play\.google|itunes|app-store|cookiebot|onetrust|usercentrics|iubenda|trustpilot|glassdoor|indeed|crunchbase|wikipedia|wikimedia|vercel|netlify|webflow|wordpress|wp|shopify|magento|prestashop|woocommerce|salesforce|zendesk|intercom|drift|gravatar|paypal|stripe|visa|mastercard|klarna|swish|bing|yahoo|baidu|yandex|vk|weibo|line|kakao|spotify|soundcloud|flickr|behance|dribbble|figma|notion|airtable|typeform|surveymonkey|jotform|docusign|dropbox|box|onedrive|drive|sharepoint|atlassian|jira|confluence|trello|asana|monday|clickup|zapier|make|ifttt|twilio|sendgrid|mailgun|postmark|brevo|sendinblue|activecampaign|marketo|pardot|eloqua|braze|customer|segment|mixpanel|amplitude|posthog|matomo|plausible|fathom|clarity|newrelic|datadog|pingdom|statuspage|uptimerobot)\./i;

// A country code that is a real TLD tells you where a company sits without a lookup, and
// is right far more often than any geo-IP guess on a CDN-fronted site.
export const TLD_COUNTRY = {
  se: ["Sweden", "SE"], no: ["Norway", "NO"], dk: ["Denmark", "DK"], fi: ["Finland", "FI"],
  is: ["Iceland", "IS"], de: ["Germany", "DE"], at: ["Austria", "AT"], ch: ["Switzerland", "CH"],
  nl: ["Netherlands", "NL"], be: ["Belgium", "BE"], lu: ["Luxembourg", "LU"], fr: ["France", "FR"],
  it: ["Italy", "IT"], es: ["Spain", "ES"], pt: ["Portugal", "PT"], uk: ["United Kingdom", "GB"],
  ie: ["Ireland", "IE"], pl: ["Poland", "PL"], cz: ["Czechia", "CZ"], sk: ["Slovakia", "SK"],
  hu: ["Hungary", "HU"], ro: ["Romania", "RO"], bg: ["Bulgaria", "BG"], hr: ["Croatia", "HR"],
  si: ["Slovenia", "SI"], rs: ["Serbia", "RS"], gr: ["Greece", "GR"], ee: ["Estonia", "EE"],
  lv: ["Latvia", "LV"], lt: ["Lithuania", "LT"], tr: ["Turkey", "TR"], ua: ["Ukraine", "UA"],
};

// Multi-part public suffixes that would otherwise make "co.uk" look like the registrable
// domain and collapse every British company into one row.
const MULTI_SUFFIX = /\.(co|com|org|net|ac|gov|edu|ltd|plc|me|sch)\.(uk|nz|au|za|jp|kr|in|br|il|tr|pl|hu|id|th|my|sg|ua|ru)$/i;

export function registrable(host) {
  const h = String(host || "").toLowerCase().replace(/^www\./, "");
  const parts = h.split(".");
  if (parts.length <= 2) return h;
  const last2 = parts.slice(-2).join(".");
  if (MULTI_SUFFIX.test(`.${last2}`) || /^(co|com|org|net|ac|gov|edu)\.[a-z]{2}$/.test(last2)) {
    return parts.slice(-3).join(".");
  }
  return last2;
}

export function countryFromHost(host) {
  const tld = registrable(host).split(".").pop();
  return TLD_COUNTRY[tld] ?? [null, null];
}

// Words a company uses on its own site for "here is the thing where you build your
// product". Ordered from unambiguous to merely suggestive; scoreConfiguratorLink uses
// the position, so a /konfigurator hit outranks a /design hit.
export const CONFIG_WORDS = [
  // Unambiguous, any language.
  /konfigurator/i, /configurator/i, /configurateur/i, /configuratore/i, /configurador/i,
  /konfigur(er|ator|ering|ace|ator)/i, /kokoonpano/i, /konfigurace/i, /konfiguracja/i,
  /configureer/i, /configureren/i, /samenstellen/i, /samenstel/i,
  // Strong, but also used for unrelated pages now and then.
  /build[-_]?(your|a)[-_]?own/i, /design[-_]?(your|a)[-_]?own/i, /create[-_]?your[-_]?own/i,
  /byo\b/i, /custom(ise|ize)r?\b/i, /personaliz(e|za|ar)/i, /personnalis/i,
  /bygg[-_]?din/i, /skr[aä]ddarsy/i, /designa[-_]?din/i, /tilpass/i, /indret/i,
  /product[-_]?builder/i, /produkt[-_]?builder/i, /online[-_]?planner/i, /raumplaner/i,
  /room[-_]?planner/i, /planungstool/i, /planner\b/i, /planer\b/i, /plannertool/i,
  /3d[-_]?(tool|viewer|studio|planner|experience)/i, /visualiser|visualizer/i,
  /quote[-_]?builder/i, /offert(verktyg|generator)/i, /angebotskonfigurator/i,
];

// Runtime fingerprints. A company page that loads one of these scripts IS running that
// platform, which is far stronger evidence than the vendor's own marketing page saying
// so -- vendors leave churned logos up for years.
export const PLATFORM_SIGNATURES = [
  ["Roomle", /roomle\.(com|cloud)|roomle-configurator|@roomle\//i],
  ["Expivi", /expivi\.(com|io)|expivi-/i],
  ["Threekit", /threekit\.(com|io)|threekit-player/i],
  ["Zakeke", /zakeke\.com|zakeke-/i],
  ["Cylindo", /cylindo\.(com|net)|cylindo-/i],
  ["Combeenation", /combeenation\.(com|io)|cbn-configurator/i],
  ["Emersya", /emersya\.com|emersya-/i],
  ["Sayduck", /sayduck\.(com|io)/i],
  ["VividWorks", /vividworks\.com|vividstore/i],
  ["Kickflip", /gokickflip\.com|mycustomizer\.com|kickflip-/i],
  ["3D Cloud", /3dcloud\.(com|io)|marxent/i],
  ["DriveWorks", /driveworks(live|cloud)?\.(net|com|co\.uk)/i],
  ["Tacton", /tacton(cpq)?\.com|tactoncpq/i],
  ["Configit", /configit\.com|configit-/i],
  ["Elfsquad", /elfsquad\.(io|com)/i],
  ["Configura", /configura\.com|cetdesigner/i],
  ["pCon", /pcon-(solutions|catalog|planner)\.com|easterngraphics/i],
  ["Threedium", /threedium\.(co\.uk|com)/i],
  ["Hapticmedia", /hapticmedia\.(com|fr)/i],
  ["Simplio3D", /simplio3d\.com/i],
  ["iONE360", /ione360\.com/i],
  ["Zoovu", /zoovu\.com|smartassistant/i],
  ["camos", /camos\.de|camos-/i],
  ["encoway", /encoway\.(de|com)|ec-cpq/i],
  ["Perspectix", /perspectix\.com|px5/i],
  ["CADENAS", /cadenas\.de|partcommunity|webpartcatalog/i],
  ["Orgadata", /orgadata\.(com|de)|logikal/i],
  ["Cyncly", /cyncly\.com|compusoft\.|2020spaces/i],
  ["Trinckle", /trinckle\.com|paramate/i],
  ["Vention", /vention\.io/i],
  ["Sofon", /sofon\.com|sofonguidedselling/i],
  ["Quootz", /quootz\.nl|merkato/i],
  ["Salesforce CPQ", /steelbrick|salesforce.*cpq/i],
  ["SAP", /sap\.com.*configur|vc-configurator/i],
  ["Three.js (custom build)", /three(\.min)?\.js|threejs/i],
  ["Babylon.js (custom build)", /babylon(\.max|\.min)?\.js|babylonjs/i],
  ["Unity WebGL (custom build)", /unityloader|unitywebgl|build\/UnityLoader/i],
  ["model-viewer (custom build)", /model-viewer(\.min)?\.js|<model-viewer/i],
];

// Where a configurator link scores on a 0-100 scale. Position in CONFIG_WORDS carries
// the confidence: an explicit /konfigurator path is worth more than /planner, which a
// site might use for an event calendar.
export function scoreConfiguratorLink(url, text = "") {
  let best = 0;
  const hay = `${url} ${text}`;
  for (let i = 0; i < CONFIG_WORDS.length; i++) {
    if (CONFIG_WORDS[i].test(hay)) {
      const score = Math.max(30, 100 - i * 3);
      if (score > best) best = score;
    }
  }
  // A hit in the URL path is worth more than one in link text alone: navigation labels
  // like "Design" are everywhere and mean nothing on their own.
  if (best && !CONFIG_WORDS.some((re) => re.test(url))) best = Math.round(best * 0.6);
  return best;
}

// International dialling prefix to country. Longest prefix wins, so +351 (Portugal) is
// not read as +35 and +358 (Finland) is not read as +35 either.
const PHONE_COUNTRY = [
  ["+358", "Finland", "FI"], ["+353", "Ireland", "IE"], ["+351", "Portugal", "PT"],
  ["+352", "Luxembourg", "LU"], ["+356", "Malta", "MT"], ["+359", "Bulgaria", "BG"],
  ["+370", "Lithuania", "LT"], ["+371", "Latvia", "LV"], ["+372", "Estonia", "EE"],
  ["+385", "Croatia", "HR"], ["+386", "Slovenia", "SI"], ["+420", "Czechia", "CZ"],
  ["+421", "Slovakia", "SK"], ["+43", "Austria", "AT"], ["+45", "Denmark", "DK"],
  ["+46", "Sweden", "SE"], ["+47", "Norway", "NO"], ["+48", "Poland", "PL"],
  ["+40", "Romania", "RO"], ["+41", "Switzerland", "CH"], ["+49", "Germany", "DE"],
  ["+30", "Greece", "GR"], ["+31", "Netherlands", "NL"], ["+32", "Belgium", "BE"],
  ["+33", "France", "FR"], ["+34", "Spain", "ES"], ["+36", "Hungary", "HU"],
  ["+39", "Italy", "IT"], ["+380", "Ukraine", "UA"], ["+90", "Turkey", "TR"],
  ["+44", "United Kingdom", "GB"], ["+1", "United States", "US"],
].sort((a, b) => b[0].length - a[0].length);

// A legal form is a country statement that survives translation and rebranding. "AB" is
// Swedish, "Oy" Finnish, "B.V." Dutch, "S.p.A." Italian. GmbH and AG are shared between
// Germany, Austria and Switzerland, so they are only used when nothing better exists and
// they resolve to Germany, which is where most of them are.
const LEGAL_FORM = [
  [/\b(AB|Aktiebolag)\b/, "Sweden", "SE"], [/\b(Oy|Oyj)\b/, "Finland", "FI"],
  [/\b(A\/S|ApS)\b/, "Denmark", "DK"], [/\bAS\b(?!\s*\d)/, "Norway", "NO"],
  [/\b(B\.?V\.?|N\.?V\.?)\b/, "Netherlands", "NL"], [/\bS\.?p\.?A\.?\b|\bS\.?r\.?l\.?\b/i, "Italy", "IT"],
  [/\b(SARL|S\.A\.S|SAS|SASU)\b/, "France", "FR"], [/\bS\.?L\.?U?\.?\b|\bS\.?A\.?U\.?\b/, "Spain", "ES"],
  [/\b(Ltd|Limited|PLC)\b/, "United Kingdom", "GB"], [/\bLda\b/, "Portugal", "PT"],
  [/\b(Sp\. z o\.o\.|S\.A\.)\b/, "Poland", "PL"], [/\bs\.r\.o\.\b/i, "Czechia", "CZ"],
  [/\b(GmbH|AG|KG|OHG|e\.K\.|SE)\b/, "Germany", "DE"],
];

const COUNTRY_WORD = [
  [/\b(Deutschland|Germany)\b/i, "Germany", "DE"], [/\b(Sverige|Sweden)\b/i, "Sweden", "SE"],
  [/\b(Norge|Norway)\b/i, "Norway", "NO"], [/\b(Danmark|Denmark)\b/i, "Denmark", "DK"],
  [/\b(Suomi|Finland)\b/i, "Finland", "FI"], [/\b(Nederland|Netherlands|Holland)\b/i, "Netherlands", "NL"],
  [/\b(Belgi[eë]|Belgium|Belgique)\b/i, "Belgium", "BE"], [/\b(Österreich|Austria)\b/i, "Austria", "AT"],
  [/\b(Schweiz|Switzerland|Suisse|Svizzera)\b/i, "Switzerland", "CH"], [/\b(France|Frankreich)\b/i, "France", "FR"],
  [/\b(Italia|Italy|Italien)\b/i, "Italy", "IT"], [/\b(España|Spain|Espagne)\b/i, "Spain", "ES"],
  [/\b(Portugal)\b/i, "Portugal", "PT"], [/\b(Polska|Poland)\b/i, "Poland", "PL"],
  [/\b(Česk|Czech)\w*\b/i, "Czechia", "CZ"], [/\b(United Kingdom|England|Scotland|Wales)\b/i, "United Kingdom", "GB"],
  [/\b(Ireland|Éire)\b/i, "Ireland", "IE"], [/\b(Slovenija|Slovenia)\b/i, "Slovenia", "SI"],
  [/\b(Hrvatska|Croatia)\b/i, "Croatia", "HR"], [/\b(Magyarország|Hungary)\b/i, "Hungary", "HU"],
  [/\b(România|Romania)\b/i, "Romania", "RO"], [/\b(Türkiye|Turkey)\b/i, "Turkey", "TR"],
  [/\b(Eesti|Estonia)\b/i, "Estonia", "EE"], [/\b(Latvija|Latvia)\b/i, "Latvia", "LV"],
  [/\b(Lietuva|Lithuania)\b/i, "Lithuania", "LT"], [/\b(Ελλάδα|Greece)\b/i, "Greece", "GR"],
];

/**
 * Where is this company, on the evidence available? Returns [country, code, how].
 *
 * Ordered by how hard each signal is to fake or get wrong. A ccTLD is a registration
 * fact. A phone number's country code is a physical fact about a line. A legal form is
 * a registry fact. A country name in the footer is the weakest, because a site lists
 * every country it ships to.
 */
export function inferCountry({ domain, phone, html }) {
  const [tldCountry, tldCode] = countryFromHost(domain ?? "");
  if (tldCountry) return [tldCountry, tldCode, "ccTLD"];

  if (phone) {
    const p = String(phone).replace(/[^\d+]/g, "");
    for (const [pre, country, code] of PHONE_COUNTRY) if (p.startsWith(pre)) return [country, code, "phone prefix"];
  }

  if (html) {
    // The imprint block, where a European company is legally required to state who and
    // where it is. Read the last 6000 characters of visible text: that is the footer.
    const text = String(html).slice(-40000);
    for (const [re, country, code] of LEGAL_FORM) if (re.test(text)) return [country, code, "legal form"];
    for (const [re, country, code] of COUNTRY_WORD) if (re.test(text)) return [country, code, "country named in footer"];
  }
  return [null, null, null];
}

export function detectPlatforms(html) {
  const out = [];
  for (const [name, re] of PLATFORM_SIGNATURES) if (re.test(html)) out.push(name);
  return out;
}
