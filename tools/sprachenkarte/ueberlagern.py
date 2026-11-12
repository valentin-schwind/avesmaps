"""Sprachflächen über unsere Grundkarte (lokale Rasterkacheln) legen, zur Sichtprüfung der Einpassung. Aufruf: python -I ueberlagern.py <arbeitsordner> <name> <z> <xmin> <xmax> <ymin> <ymax> [breite] (liest sprachen-karte.geojson, schreibt ueber-<name>.jpg)."""
import os, sys, json, io, urllib.request, numpy as np
from PIL import Image, ImageDraw, ImageFont
API = os.environ.get("AVESMAPS_API", "http://127.0.0.1:3000")  # lokaler Server (Rasterkacheln)
SP = sys.argv[1]; name = sys.argv[2]; z = int(sys.argv[3]); xmin, xmax, ymin, ymax = map(float, sys.argv[4:8])
breite = int(sys.argv[8]) if len(sys.argv) > 8 else 0
REV = json.load(urllib.request.urlopen(f"{API}/tiles/raster/modern/current.json"))["revision"]
T = 512; S = T * 2 ** z / 1024  # px je Karteneinheit
def px(x, y): return (x * S, (1024 - y) * S)
X0, Y0 = px(xmin, ymax); X1, Y1 = px(xmax, ymin)
tx0, ty0, tx1, ty1 = int(X0 // T), int(Y0 // T), int(X1 // T), int(Y1 // T)
grund = Image.new("RGB", ((tx1 - tx0 + 1) * T, (ty1 - ty0 + 1) * T), (240, 236, 228))
for tx in range(tx0, tx1 + 1):
    for ty in range(ty0, ty1 + 1):
        try:
            b = urllib.request.urlopen(f"{API}/tiles/raster/modern/{REV}/{z}/{tx}/{ty}.webp").read()
            grund.paste(Image.open(io.BytesIO(b)).convert("RGB"), ((tx - tx0) * T, (ty - ty0) * T))
        except Exception: pass
ox, oy = tx0 * T, ty0 * T
K = json.load(open(f"{SP}/klassen.json")); FARBE = {s: tuple(c) for s, _, c in K["sprachen"]}
fc = json.load(open(f"{SP}/sprachen-karte.geojson", encoding="utf-8"))
W, H = grund.size; farbe = np.zeros((H, W, 3), np.uint8); alpha = np.zeros((H, W), np.float32)
kanten = Image.new("L", (W, H), 0); dk = ImageDraw.Draw(kanten)
yy, xx = np.mgrid[0:H, 0:W]; streifen = ((xx + yy) // max(4, int(S * 0.9))) % 2 == 0
def ringe(geom):
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    for p in polys: yield p
for f in fc["features"]:
    pr = f["properties"]; m = Image.new("L", (W, H), 0); d = ImageDraw.Draw(m)
    for p in ringe(f["geometry"]):
        pts = [[(px(x, y)[0] - ox, px(x, y)[1] - oy) for x, y in r] for r in p]
        d.polygon(pts[0], fill=255)
        for h in pts[1:]: d.polygon(h, fill=0)
        for r in pts: dk.line(r + [r[0]], fill=255, width=1)
    m = np.asarray(m) > 0
    if pr["art"] == "rein": farbe[m] = FARBE[pr["sprachen"][0]]; alpha[m] = 0.62
    elif pr["art"] == "misch":
        a, b = FARBE[pr["sprachen"][0]], FARBE[pr["sprachen"][1]]
        farbe[m & streifen] = a; farbe[m & ~streifen] = b; alpha[m] = 0.62
g = np.asarray(grund).astype(np.float32)
out = g * (1 - alpha[..., None]) + farbe.astype(np.float32) * alpha[..., None]
k = np.asarray(kanten) > 0; out[k] = out[k] * 0.45
bild = Image.fromarray(out.clip(0, 255).astype(np.uint8))
# Passpunkte: unsere Orte (weiß) und die eingepasste Ortsmarke der Sprachenkarte (rot)
P = json.load(open(f"{SP}/passpunkte.json"))
src = np.array([[p["px"], p["py"]] for p in P]); dst = np.array([[p["x"], p["y"]] for p in P])
M, *_ = np.linalg.lstsq(np.c_[src, np.ones(len(src))], dst, rcond=None); fit = np.c_[src, np.ones(len(src))] @ M
d = ImageDraw.Draw(bild)
try: font = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 15)
except Exception: font = None
for p, (fx, fy) in zip(P, fit):
    if not (xmin <= p["x"] <= xmax and ymin <= p["y"] <= ymax): continue
    a = (px(p["x"], p["y"])[0] - ox, px(p["x"], p["y"])[1] - oy); b = (px(fx, fy)[0] - ox, px(fx, fy)[1] - oy)
    d.line([a, b], fill=(200, 0, 0), width=2); d.ellipse([b[0] - 3, b[1] - 3, b[0] + 3, b[1] + 3], fill=(200, 0, 0))
    d.ellipse([a[0] - 4, a[1] - 4, a[0] + 4, a[1] + 4], fill=(255, 255, 255), outline=(0, 0, 0))
    d.text((a[0] + 6, a[1] - 9), p["name"], fill=(0, 0, 0), font=font, stroke_width=2, stroke_fill=(255, 255, 255))
bild = bild.crop((int(X0 - ox), int(Y0 - oy), int(X1 - ox), int(Y1 - oy)))
if breite and bild.width > breite: bild = bild.resize((breite, int(bild.height * breite / bild.width)), Image.LANCZOS)
bild.save(f"{SP}/ueber-{name}.jpg", quality=88); print(name, bild.size)
