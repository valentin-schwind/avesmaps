"""Passpunkte: liest passpunkte-roh.txt (Zeilen teil|ortsname|x|y, von Hand an den teil-*.jpg abgelesen), rastet sie auf die Ortsmarken aus punkte.json ein und holt die Ortskoordinaten vom lokalen Server. Aufruf: python -I passpunkte.py <arbeitsordner>"""
import os, sys, json, urllib.request, urllib.parse, unicodedata
SP = sys.argv[1]; W, H = 5385, 7610  # Arbeitsordner
API = os.environ.get("AVESMAPS_API", "http://127.0.0.1:3000")  # lokaler Server (Suche)
T = {"nw": (0, 0, 2892), "no": (2492, 0, 5385), "mw": (0, 2336, 2892), "mo": (2492, 2336, 5385), "sw": (0, 4873, 2892), "so": (2492, 4873, 5385)}
dots = json.load(open(f"{SP}/punkte.json"))
GROESSE = {"metropole": 0, "grossstadt": 1, "stadt": 2, "kleinstadt": 3, "dorf": 4}
def norm(s): return unicodedata.normalize("NFC", s).casefold().replace("’", "'")
out = []
for line in open(f"{SP}/passpunkte-roh.txt", encoding="utf-8"):
    teil, name, x, y = line.strip().split("|")
    x0, y0, x1 = T[teil]; s = (x1 - x0) / 1400
    px, py = x0 + int(x) * s, y0 + int(y) * s
    d = min(dots, key=lambda p: (p[0] - px) ** 2 + (p[1] - py) ** 2)
    dd = ((d[0] - px) ** 2 + (d[1] - py) ** 2) ** 0.5
    if dd < 25: px, py = d[0], d[1]
    q = urllib.parse.quote(name)
    hits = json.load(urllib.request.urlopen(f"{API}/api/search?q={q}"))["hits"]
    orte = [h for h in hits if h["kind"] == "ort" and norm(h["name"]) == norm(name)]
    if not orte:
        print("FEHLT", name, [h["name"] for h in hits if h["kind"] == "ort"][:5]); continue
    o = min(orte, key=lambda h: GROESSE.get(h.get("subtype"), 9))
    out.append({"name": name, "px": round(px, 1), "py": round(py, 1), "x": o["x"], "y": o["y"], "typ": o.get("subtype"), "gerastet": dd < 25})
json.dump(out, open(f"{SP}/passpunkte.json", "w"), ensure_ascii=False, indent=0)
print(len(out), "Passpunkte;", sum(not p["gerastet"] for p in out), "ohne Ortsmarke:", [p["name"] for p in out if not p["gerastet"]])
