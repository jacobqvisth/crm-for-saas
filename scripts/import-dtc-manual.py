#!/usr/bin/env python3
"""Import the LEMON/CHARM per-vehicle manual DTC data into the CRM Supabase.

Source: ~/lemon-gl350/gl350.db  (built from the lemon-manuals per-vehicle bundle)
Target: dtc_manual_vehicles / dtc_manual_codes / dtc_manual_figures
Figures are copied into public/dtc-figures/ so the app can serve them directly.
"""
import json, os, re, shutil, sqlite3, sys, urllib.request

SRC = os.path.expanduser("~/lemon-gl350/gl350.db")
ENV = "/Users/jacobqvisth/crm-for-saas/.env.local"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBIMG = os.path.join(ROOT, "public", "dtc-figures")

VEHICLE = dict(
    slug="mercedes-gl350-bluetec-2011-642820",
    make="Mercedes Benz",
    model="GL 350 BLUETEC (164.825)",
    year=2011,
    engine="V6-3.0L DSL Turbo (642.820)",
    source="LEMON / CHARM manual bundle",
)


def env(key):
    for line in open(ENV):
        m = re.match(r"\s*(?:export\s+)?%s\s*=\s*[\"']?([^\"'\n]+)" % key, line)
        if m:
            return m.group(1).strip()
    sys.exit("missing " + key)


URL = env("NEXT_PUBLIC_SUPABASE_URL").rstrip("/")
KEY = env("SUPABASE_SERVICE_ROLE_KEY")


def rest(method, path, body=None, prefer=None):
    req = urllib.request.Request(URL + "/rest/v1/" + path, method=method)
    req.add_header("apikey", KEY)
    req.add_header("Authorization", "Bearer " + KEY)
    req.add_header("Content-Type", "application/json")
    if prefer:
        req.add_header("Prefer", prefer)
    data = json.dumps(body).encode() if body is not None else None
    with urllib.request.urlopen(req, data, timeout=180) as r:
        raw = r.read()
        return json.loads(raw) if raw else []


# --- turn the flat manual text into ordered, renderable blocks ----------------
MARKERS = [
    "Possible cause for the entry of this event code",
    "Possible cause and remedy",
    "Possible causes:",
    "Possible cause:",
    "Affected functions:",
    "Possible measures",
    "Test prerequisites",
    "Test prerequisite",
    "Test sequence",
    "Specified value",
    "End of test",
    "WARNING",
    "Question",
    "Note",
]
MARK_RE = re.compile("(" + "|".join(re.escape(m) for m in MARKERS) + r"|Test [\d.]+:)")


def sectionize(body):
    body = re.split(r"scientia non olet", body or "")[0]
    body = re.sub(r"^(Part \d+\s*)+", "", body).strip()
    body = re.sub(r"-{6,}", " ", body)
    parts = MARK_RE.split(body)
    out = []
    lead = (parts[0] or "").strip()
    if lead:
        out.append({"heading": None, "text": " ".join(lead.split())})
    i = 1
    while i < len(parts):
        head = (parts[i] or "").strip().rstrip(":")
        text = (parts[i + 1] if i + 1 < len(parts) else "").strip()
        text = re.sub(r"^\s*[-:]\s*", "", text)
        text = " ".join(text.split())
        if head or text:
            out.append({"heading": head or None, "text": text})
        i += 2
    return out


def main():
    con = sqlite3.connect(SRC)
    print("source:", SRC)

    rest("DELETE", "dtc_manual_vehicles?slug=eq." + VEHICLE["slug"])
    pc = con.execute("SELECT count(*) FROM pages").fetchone()[0]
    cc = con.execute("SELECT count(DISTINCT code) FROM codes").fetchone()[0]
    veh = rest(
        "POST",
        "dtc_manual_vehicles",
        [dict(VEHICLE, page_count=pc, code_count=cc)],
        prefer="return=representation",
    )[0]
    vid = veh["id"]
    print("vehicle row:", vid)

    rows = list(
        con.execute(
            """SELECT c.code, c.chart, p.title, p.body, p.url, p.page_id
               FROM codes c JOIN pages p ON p.page_id = c.page_id
               ORDER BY c.code, p.page_id"""
        )
    )
    payload = []
    for code, chart, title, body, url, pid in rows:
        clean = re.split(r"scientia non olet", body or "")[0].strip()
        clean = re.sub(r"^(Part \d+\s*)+", "", clean).strip()
        summary = re.split(r"Possible cause|Affected functions|Test \d", clean)[0].strip()
        payload.append(
            dict(
                vehicle_id=vid,
                code=code,
                chart=chart,
                part=(title or None),
                summary=summary[:400],
                sections=sectionize(body or ""),
                body=clean,
                source_url=url,
                page_id=pid,
            )
        )

    inserted = []
    for i in range(0, len(payload), 40):
        inserted += rest(
            "POST", "dtc_manual_codes", payload[i : i + 40], prefer="return=representation"
        )
        print("  codes %d/%d" % (len(inserted), len(payload)), end="\r")
    print("\ncodes inserted:", len(inserted))

    by_page = {}
    for r in inserted:
        by_page.setdefault(r["page_id"], r["id"])

    os.makedirs(PUBIMG, exist_ok=True)
    figs, copied = [], set()
    for pid, ordn, src, local, cap in con.execute(
        """SELECT i.page_id, i.ord, i.src, i.local, i.caption FROM images i
           JOIN codes c ON c.page_id = i.page_id ORDER BY i.page_id, i.ord"""
    ):
        cid = by_page.get(pid)
        if not cid or not os.path.exists(local):
            continue
        fn = os.path.basename(local)
        if fn not in copied:
            shutil.copyfile(local, os.path.join(PUBIMG, fn))
            copied.add(fn)
        cap = (cap or "").strip()
        low = cap.lower()
        if low.startswith(("continue with button", "continue to test", "end of test")):
            cap = ""
        figs.append(dict(code_id=cid, ord=ordn, filename=fn, caption=cap or None))

    for i in range(0, len(figs), 200):
        rest("POST", "dtc_manual_figures", figs[i : i + 200])
    print("figures inserted:", len(figs))
    print("images copied   :", len(copied), "->", PUBIMG)


if __name__ == "__main__":
    main()
