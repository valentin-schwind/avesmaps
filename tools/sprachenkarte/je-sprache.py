"""Modell A, erste Fassung: je Sprache eine Fläche (rein + Mischgebiete mit ihr), überlappend; dazu das saubere Kartenbild grundkarte-z3.jpg/.json, das s1-bild.py braucht. Aufruf: python -I je-sprache.py <arbeitsordner> (braucht den lokalen Server für die Rasterkacheln)."""
import os, sys, json, io, urllib.request, numpy as np, cv2
from shapely.geometry import Polygon, mapping
from shapely.ops import unary_union
from shapely import affinity
from PIL import Image
SP = sys.argv[1]  # Arbeitsordner
API = os.environ.get("AVESMAPS_API", "http://127.0.0.1:3000")  # lokaler Server (Suche, Rasterkacheln)
label = np.load(f"{SP}/label.npy"); K = json.load(open(f"{SP}/klassen.json")); SPR = K["sprachen"]; N = len(SPR)
P = json.load(open(f"{SP}/passpunkte.json"))
src = np.array([[p["px"], p["py"]] for p in P]); dst = np.array([[p["x"], p["y"]] for p in P])
M, *_ = np.linalg.lstsq(np.c_[src, np.ones(len(src))], dst, rcond=None)
A = [2 * M[0, 0], 2 * M[1, 0], 2 * M[0, 1], 2 * M[1, 1], M[2, 0] + 0.5 * (M[0, 0] + M[1, 0]), M[2, 1] + 0.5 * (M[0, 1] + M[1, 1])]
def polys(mask):
    cs, hier = cv2.findContours(mask.astype(np.uint8), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    out = []
    if hier is None: return out
    for i, c in enumerate(cs):
        if hier[0][i][3] != -1 or cv2.contourArea(c) < 120: continue
        hs = []; j = hier[0][i][2]
        while j != -1:
            if cv2.contourArea(cs[j]) >= 120: hs.append(cv2.approxPolyDP(cs[j], 1.2, True).reshape(-1, 2))
            j = hier[0][j][0]
        a = cv2.approxPolyDP(c, 1.2, True).reshape(-1, 2)
        if len(a) >= 3: out.append(Polygon(a, [h for h in hs if len(h) >= 3]).buffer(0))
    return out
feats = []
for k, (key, name, farbe) in enumerate(SPR):
    m = label == k
    for v in np.unique(label[label >= 100]):
        if v == 255: continue
        a, b = divmod(int(v) - 100, N)
        if k in (a, b): m |= label == v
    m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
    g = affinity.affine_transform(unary_union(polys(m)), A).buffer(0.4).buffer(-0.4).simplify(0.2)
    teile = list(g.geoms) if g.geom_type == "MultiPolygon" else [g]
    feats.append({"type": "Feature", "properties": {"sprache": key, "name": name, "farbe": "#%02x%02x%02x" % tuple(farbe), "teilflaechen": len(teile), "flaeche_e2": round(g.area, 1)},
                  "geometry": mapping(g)})
    print(key, len(teile), round(g.area))
json.dump({"type": "FeatureCollection", "features": feats}, open(f"{SP}/sprachen-je-sprache.geojson", "w", encoding="utf-8"), ensure_ascii=False)
# sauberes Kartenbild (z3) mit Umrechnung
REV = json.load(urllib.request.urlopen(f"{API}/tiles/raster/modern/current.json"))["revision"]
z, T = 3, 512; S = T * 2 ** z / 1024; xmin, xmax, ymin, ymax = 230, 830, 60, 960
X0, Y0, X1, Y1 = xmin * S, (1024 - ymax) * S, xmax * S, (1024 - ymin) * S
tx0, ty0, tx1, ty1 = int(X0 // T), int(Y0 // T), int(X1 // T), int(Y1 // T)
g = Image.new("RGB", ((tx1 - tx0 + 1) * T, (ty1 - ty0 + 1) * T))
for tx in range(tx0, tx1 + 1):
    for ty in range(ty0, ty1 + 1):
        g.paste(Image.open(io.BytesIO(urllib.request.urlopen(f"{API}/tiles/raster/modern/{REV}/{z}/{tx}/{ty}.webp").read())).convert("RGB"), ((tx - tx0) * T, (ty - ty0) * T))
g = g.crop((int(X0 - tx0 * T), int(Y0 - ty0 * T), int(X1 - tx0 * T), int(Y1 - ty0 * T)))
g.save(f"{SP}/grundkarte-z3.jpg", quality=84)
json.dump({"bild": "grundkarte-z3.jpg", "breite": g.width, "hoehe": g.height, "pxJeEinheit": S, "xmin": xmin, "ymax": ymax,
           "formel": "px = (x - xmin) * pxJeEinheit; py = (ymax - y) * pxJeEinheit"}, open(f"{SP}/grundkarte-z3.json", "w"))
print("Bild", g.size)
