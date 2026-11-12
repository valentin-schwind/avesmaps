"""Sichtbild S1: Sprachflächen über der Grundkarte z3 (gesamt) und als Ausschnitt in 12 px/E ohne Grundkarte. Aufruf: python -I s1-bild.py <arbeitsordner> (liest sprachen-s1.geojson, grundkarte-z3.jpg/.json; schreibt s1-gesamt.jpg, s1-svellt.png, s1-sicheln.png, s1-mhanadi.png)."""
import sys, json
from PIL import Image, ImageDraw
SP = sys.argv[1]
F = json.load(open(f"{SP}/sprachen-s1.geojson", encoding="utf-8"))["features"]
G = json.load(open(f"{SP}/grundkarte-z3.json"))
def ringe(geom):
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    for p in polys:
        yield p
def malen(bild, tr, alpha, linie):
    for f in F:
        c = tuple(int(f["properties"]["farbe"][i:i + 2], 16) for i in (1, 3, 5))
        ebene = Image.new("RGBA", bild.size, (0, 0, 0, 0)); d = ImageDraw.Draw(ebene)
        for p in ringe(f["geometry"]):
            d.polygon([tr(x, y) for x, y in p[0]], fill=c + (alpha,))
            for loch in p[1:]: d.polygon([tr(x, y) for x, y in loch], fill=(0, 0, 0, 0))
        for p in ringe(f["geometry"]):
            for r in p: d.line([tr(x, y) for x, y in r] + [tr(*r[0])], fill=c + (255,), width=linie)
        bild.alpha_composite(ebene)
b = Image.open(f"{SP}/{G['bild']}").convert("RGBA"); s = G["pxJeEinheit"]
malen(b, lambda x, y: ((x - G["xmin"]) * s, (G["ymax"] - y) * s), 90, 1)
b.convert("RGB").save(f"{SP}/s1-gesamt.jpg", quality=85)
for name, (x0, y0, x1, y1) in {"svellt": (430, 690, 560, 790), "sicheln": (500, 600, 600, 680), "mhanadi": (560, 380, 680, 470)}.items():
    s2 = 12; b = Image.new("RGBA", (int((x1 - x0) * s2), int((y1 - y0) * s2)), (245, 240, 228, 255))
    malen(b, lambda x, y: ((x - x0) * s2, (y1 - y) * s2), 110, 2)
    b.convert("RGB").save(f"{SP}/s1-{name}.png")
print("ok")
