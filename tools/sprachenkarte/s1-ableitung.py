"""S1 (WI-0261): je Sprache eine Fläche (rein ∪ Mischgebiete mit ihr), auf unser Land geschnitten, Mischränder geglättet,
Enklaven ab Mindestgröße. Kartenkoordinaten aventuria-v1. Aufruf: python -I s1-ableitung.py <arbeitsordner> [mindest_e2=0.5]; liest label.npy, klassen.json, passpunkte.json und wasser.geojson, schreibt sprachen-s1.geojson"""
import sys, json, numpy as np, cv2
sys.stdout.reconfigure(encoding="utf-8")
from shapely.geometry import Polygon, MultiPolygon, box, shape, mapping
from shapely.ops import unary_union
from shapely import affinity
from shapely.validation import make_valid

SP = sys.argv[1]
MINDEST = float(sys.argv[2]) if len(sys.argv) > 2 else 0.5
label = np.load(f"{SP}/label.npy")
K = json.load(open(f"{SP}/klassen.json"))
SPR = K["sprachen"]; N = len(SPR)
P = json.load(open(f"{SP}/passpunkte.json"))
src = np.array([[p["px"], p["py"]] for p in P]); dst = np.array([[p["x"], p["y"]] for p in P])
M, *_ = np.linalg.lstsq(np.c_[src, np.ones(len(src))], dst, rcond=None)
# Label in halber Auflösung, Pixelmitte
A = [2 * M[0, 0], 2 * M[1, 0], 2 * M[0, 1], 2 * M[1, 1], M[2, 0] + 0.5 * (M[0, 0] + M[1, 0]), M[2, 1] + 0.5 * (M[0, 1] + M[1, 1])]
E_JE_PX = float(np.sqrt(abs(A[0] * A[3] - A[1] * A[2])))

def polys(mask):
    cs, hier = cv2.findContours(mask.astype(np.uint8), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    out = []
    if hier is None: return out
    for i, c in enumerate(cs):
        if hier[0][i][3] != -1 or len(c) < 3: continue
        hs = []; j = hier[0][i][2]
        while j != -1:
            if len(cs[j]) >= 3: hs.append(cs[j].reshape(-1, 2))
            j = hier[0][j][0]
        out.append(make_valid(Polygon(c.reshape(-1, 2), hs)))
    return out

def teile(g):
    if g.is_empty: return []
    if g.geom_type == "Polygon": return [g]
    return [t for t in getattr(g, "geoms", []) if t.geom_type == "Polygon" and not t.is_empty] + \
           [u for t in getattr(g, "geoms", []) if t.geom_type in ("MultiPolygon", "GeometryCollection") for u in teile(t)]

# Land = Kartenrahmen ohne Meer
wasser = unary_union([make_valid(shape(f["geometry"])) for f in json.load(open(f"{SP}/wasser.geojson"))["features"] if f["properties"]["typ"] == "meer"])  # nur Meer: Seen bleiben in der Fläche, die Zeichnung legt Wasser darüber
land = box(0, 0, 1024, 1024).difference(wasser)

R = 0.6  # Glättungsradius in Karteneinheiten (≈ 2 Meilen): runde Ecken der Mischgebiete, reine Grenzen kaum berührt
rein, ganz, feats, bericht = {}, {}, [], []
for k, (key, name, farbe) in enumerate(SPR):
    m_rein = label == k
    m = m_rein.copy()
    for v in np.unique(label[label >= 100]):
        if v == 255: continue
        a, b = divmod(int(v) - 100, N)
        if k in (a, b): m |= label == v
    m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
    g = affinity.affine_transform(unary_union(polys(m)), A)
    g = g.buffer(R, quad_segs=4).buffer(-2 * R, quad_segs=4).buffer(R, quad_segs=4)  # Schließen und Öffnen: Treppen und Haarspitzen weg
    g = make_valid(g.intersection(land)).simplify(0.15)
    behalten = [t for t in teile(g) if t.area >= MINDEST]
    weg = [t for t in teile(g) if t.area < MINDEST]
    g = make_valid(MultiPolygon(behalten)) if behalten else MultiPolygon()
    ganz[key] = g
    rein[key] = make_valid(affinity.affine_transform(unary_union(polys(m_rein)), A)).intersection(land)
    feats.append({"type": "Feature", "properties": {"sprache": key, "name": name, "farbe": "#%02x%02x%02x" % tuple(farbe),
                  "teilflaechen": len(behalten), "flaeche_e2": round(g.area, 1)}, "geometry": mapping(g)})
    bericht.append((key, len(behalten), round(g.area), len(weg), round(sum(t.area for t in weg), 2), g.is_valid))

# Säume an reinen Grenzen: Eine Sprache darf in die reine Fläche einer anderen nur dort ragen, wo die Karte beide mischt
keys = list(ganz)
misch = {}
for v in np.unique(label[label >= 100]):
    if v == 255: continue
    a, b = divmod(int(v) - 100, N)
    misch[(keys[a], keys[b])] = misch[(keys[b], keys[a])] = affinity.affine_transform(unary_union(polys(label == v)), A).buffer(2 * R)
for i, ki in enumerate(keys):
    fremd_rein = unary_union([rein[kj].difference(misch[(ki, kj)]) if (ki, kj) in misch else rein[kj] for kj in keys if kj != ki])
    g = make_valid(ganz[ki].difference(fremd_rein))
    behalten = [t for t in teile(g) if t.area >= MINDEST]
    ganz[ki] = make_valid(MultiPolygon(behalten)) if behalten else MultiPolygon()
    feats[i]["geometry"] = mapping(ganz[ki])
    feats[i]["properties"].update(teilflaechen=len(behalten), flaeche_e2=round(ganz[ki].area, 1))
    bericht[i] = (ki, len(behalten), round(ganz[ki].area)) + bericht[i][3:5] + (ganz[ki].is_valid,)

# Kleine Löcher (unter 2 E²), die keine andere Sprache füllt, sind Reste verworfener Pixelinseln: schließen
LOCH = 2.0
gefuellt = 0
for i, ki in enumerate(keys):
    andere = unary_union([ganz[kj] for kj in keys if kj != ki])
    neu = []
    for p in teile(ganz[ki]):
        bleiben = []
        for r in p.interiors:
            loch = Polygon(r)
            if loch.area < LOCH and andere.intersection(loch).area < 0.5 * loch.area: gefuellt += 1
            else: bleiben.append(r)
        neu.append(Polygon(p.exterior, bleiben))
    ganz[ki] = make_valid(MultiPolygon(neu)) if neu else MultiPolygon()
    feats[i]["geometry"] = mapping(ganz[ki])
    feats[i]["properties"].update(flaeche_e2=round(ganz[ki].area, 1))
print(f"Kleine Löcher geschlossen: {gefuellt}")

# Abdeckung nur innerhalb des Ausschnitts der Referenzkarte
h, w = label.shape
ausschnitt = affinity.affine_transform(box(0, 0, w, h), A).intersection(land)
land_a = ausschnitt.area
alle = unary_union(list(ganz.values())).intersection(ausschnitt)
print(f"Maßstab: 1 px (halbe Auflösung) = {E_JE_PX:.3f} E; Glättung R = {R} E; Enklaven ab {MINDEST} E²")
print(f"{'Sprache':12} {'Teile':>5} {'E²':>7} {'verworfen':>9} {'E² verw.':>8} gültig")
for z in bericht: print(f"{z[0]:12} {z[1]:5} {z[2]:7} {z[3]:9} {z[4]:8} {z[5]}")
print(f"Land im Kartenausschnitt {land_a:.0f} E², mit Sprache {alle.area / land_a:.1%}, ohne Sprache {(land_a - alle.area):.0f} E²")
# Überlappung zweier Sprachen = Mischgebiet; außerhalb der Mischgebiete der Karte sollte nichts überlappen
mischpaare, fremd = 0, 0.0
for i in range(N):
    for j in range(i + 1, N):
        u = ganz[keys[i]].intersection(ganz[keys[j]])
        if u.area < 0.5: continue
        mischpaare += 1
        # Anteil, der in einer der beiden reinen Flächen liegt, ist Glättungssaum statt Mischgebiet
        saum = u.intersection(rein[keys[i]].union(rein[keys[j]])).area
        fremd += saum
        print(f"  Misch {keys[i]}/{keys[j]}: {u.area:.0f} E², davon Saum über reinem Gebiet {saum:.1f} E²")
print(f"Mischpaare {mischpaare}; Saum über reinem Gebiet gesamt {fremd:.1f} E²")
json.dump({"type": "FeatureCollection", "features": feats}, open(f"{SP}/sprachen-s1.geojson", "w", encoding="utf-8"), ensure_ascii=False)
punkte = sum(len(r) for f in feats for p in (f["geometry"]["coordinates"] if f["geometry"]["type"] == "MultiPolygon" else [f["geometry"]["coordinates"]]) for r in p)
loecher = sum(len(p) - 1 for f in feats for p in (f["geometry"]["coordinates"] if f["geometry"]["type"] == "MultiPolygon" else [f["geometry"]["coordinates"]]))
print(f"Stützpunkte gesamt {punkte}, Löcher {loecher}")
