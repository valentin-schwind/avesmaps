"""label.npy -> GeoJSON mit allen Klassen (rein, Mischpaar, ohne Angabe) in Kartenkoordinaten (aventuria-v1, 0..1024) und in Render-LngLat. Aufruf: python -I vektor.py <arbeitsordner> (schreibt sprachen-karte.geojson, sprachen-lnglat.geojson)."""
import sys, json, math, numpy as np, cv2
from shapely.geometry import Polygon, MultiPolygon, mapping
from shapely.ops import unary_union
from shapely import affinity
SP = sys.argv[1]
label = np.load(f"{SP}/label.npy"); K = json.load(open(f"{SP}/klassen.json"))
SPR = K["sprachen"]; N = len(SPR)
P = json.load(open(f"{SP}/passpunkte.json"))
src = np.array([[p["px"], p["py"]] for p in P]); dst = np.array([[p["x"], p["y"]] for p in P])
M, *_ = np.linalg.lstsq(np.c_[src, np.ones(len(src))], dst, rcond=None)  # Vollauflösung px → Karte
# Halbauflösung: px_voll = 2*px_halb + 0.5
A = [2 * M[0, 0], 2 * M[1, 0], 2 * M[0, 1], 2 * M[1, 1], M[2, 0] + 0.5 * (M[0, 0] + M[1, 0]), M[2, 1] + 0.5 * (M[0, 1] + M[1, 1])]
def eigenschaften(v):
    if v < N: return {"art": "rein", "sprachen": [SPR[v][0]]}
    if v == 99: return {"art": "ohne", "sprachen": []}
    a, b = divmod(int(v) - 100, N); return {"art": "misch", "sprachen": [SPR[a][0], SPR[b][0]]}
feats = []; stat = {}
for v in np.unique(label):
    if v == 255: continue
    m = (label == v).astype(np.uint8)
    cs, hier = cv2.findContours(m, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    if hier is None: continue
    polys = []
    for i, c in enumerate(cs):
        if hier[0][i][3] != -1: continue
        if cv2.contourArea(c) < 120: continue
        aussen = cv2.approxPolyDP(c, 1.2, True).reshape(-1, 2)
        if len(aussen) < 3: continue
        loecher = []
        j = hier[0][i][2]
        while j != -1:
            if cv2.contourArea(cs[j]) >= 120:
                h = cv2.approxPolyDP(cs[j], 1.2, True).reshape(-1, 2)
                if len(h) >= 3: loecher.append(h)
            j = hier[0][j][0]
        p = Polygon(aussen, loecher).buffer(0)
        if not p.is_empty: polys.append(p)
    if not polys: continue
    g = affinity.affine_transform(unary_union(polys), A)
    g = g.simplify(0.15)
    e = eigenschaften(v); stat[" + ".join(e["sprachen"]) or "ohne"] = round(g.area, 1)
    feats.append({"type": "Feature", "properties": e, "geometry": mapping(g)})
fc = {"type": "FeatureCollection", "features": feats}
json.dump(fc, open(f"{SP}/sprachen-karte.geojson", "w", encoding="utf-8"), ensure_ascii=False)
# Render-LngLat (render-projection.ts: Domäne 0..1024 auf das Web-Mercator-Quadrat)
def ll(x, y):
    X = x / 1024 * 2 - 1; Y = y / 1024 * 2 - 1
    return [round(X * 180, 6), round(math.degrees(2 * math.atan(math.exp(Y * math.pi)) - math.pi / 2), 6)]
def umrechnen(c):
    if isinstance(c[0], (int, float)): return ll(*c)
    return [umrechnen(x) for x in c]
fc2 = {"type": "FeatureCollection", "features": [{**f, "geometry": {"type": f["geometry"]["type"], "coordinates": umrechnen(f["geometry"]["coordinates"])}} for f in feats]}
json.dump(fc2, open(f"{SP}/sprachen-lnglat.geojson", "w", encoding="utf-8"), ensure_ascii=False)
import os
print(len(feats), "Features;", sum(len(f["geometry"]["coordinates"]) if f["geometry"]["type"] == "MultiPolygon" else 1 for f in feats), "Polygone;",
      os.path.getsize(f"{SP}/sprachen-karte.geojson") // 1024, "KB")
for k, a in sorted(stat.items(), key=lambda x: -x[1])[:30]: print(f"  {k}: {a} E²")
