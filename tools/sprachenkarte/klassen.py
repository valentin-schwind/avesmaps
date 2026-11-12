"""Pixel -> Klasse, Schraffur -> Paar. Aufruf: python -I klassen.py <arbeitsordner> [fenster=25] (liest karte.png, schreibt label.npy, klassen.json, vorschau.png)."""
import sys, numpy as np, cv2, json
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
SP = sys.argv[1]
SPRACHEN = [
    ("thorwalsch", "Thorwalsch / Gjalskisch / Fjarningsch", (27, 170, 212)),
    ("nujuka", "Nujuka (Nivesisch)", (38, 129, 112)),
    ("isdira", "Isdira (Elfisch)", (120, 159, 42)),
    ("orkisch", "Ologhaijan / Oloarkh (Orkisch)", (96, 76, 52)),
    ("goblinisch", "Goblinisch", (194, 119, 28)),
    ("rogolan", "Rogolan (Zwergisch)", (127, 119, 116)),
    ("garethi", "Garethi", (255, 185, 1)),
    ("tulamidya", "Tulamidya", (218, 90, 19)),
    ("ferkina", "Ferkina / Zhulchammaqra", (160, 56, 19)),
    ("rssahh", "Rssahh (Echsisch)", (196, 3, 4)),
    ("tahaya", "Tahaya (Waldmenschen und Utulus)", (120, 55, 61)),
]
N = len(SPRACHEN)
SONST = [("leer", (220, 212, 196)), ("meer", (252, 244, 236)), ("saum", (252, 252, 244)), ("tinte", (30, 15, 6))]
img = cv2.cvtColor(cv2.imread(f"{SP}/karte.png"), cv2.COLOR_BGR2RGB)
img = cv2.resize(img, (img.shape[1] // 2, img.shape[0] // 2), interpolation=cv2.INTER_AREA)
H, W = img.shape[:2]
pal = np.array([c for _, _, c in SPRACHEN] + [c for _, c in SONST], np.float32)
lab = cv2.cvtColor(img, cv2.COLOR_RGB2LAB).astype(np.float32)
pal_lab = cv2.cvtColor(pal.reshape(1, -1, 3).astype(np.uint8), cv2.COLOR_RGB2LAB).reshape(-1, 3).astype(np.float32)
best = np.zeros((H, W), np.uint8); bd = np.full((H, W), 1e9, np.float32)
for k, p in enumerate(pal_lab):
    d = ((lab - p) ** 2).sum(-1)
    m = d < bd; best[m] = k; bd[m] = d[m]
LEER, MEER, SAUM, TINTE = N, N + 1, N + 2, N + 3
LEG = (slice(38, 656), slice(57, 617))  # Legende (Halbauflösung)
tinte = (best == TINTE) | (img.max(-1) < 70)
# Meer = vom Bildrand aus über meerartige Pixel erreichbar (Creme, Schatten, Leuchtsaum; „leer“ ist gelblicher: R-B 24 statt 16)
ii = img.astype(int)
meerartig = (ii.min(-1) >= 175) & ((ii[..., 0] - ii[..., 2]) <= 20)
meerartig[LEG] = True
n_f, lab_f = cv2.connectedComponents(meerartig.astype(np.uint8), connectivity=4)
rand = np.unique(np.r_[lab_f[0], lab_f[-1], lab_f[:, 0], lab_f[:, -1]])
meer = np.isin(lab_f, rand[rand > 0])
# Schrift im Meer: kleine Nicht-Meer-Inseln ganz von Meer umgeben fallen unten über die Mindestgröße weg
land = (~meer).astype(np.uint8); land[LEG] = 0
n_l, lab_l, st_l, _ = cv2.connectedComponentsWithStats(land, 8)
# Schrift im Meer: Bestandteile, die fast nur aus Tinte und Hof bestehen, fallen weg
farbig = (~tinte) & (bd < 30 ** 2) & (best < N + 1)
n_farbig = np.bincount(lab_l.ravel(), weights=farbig.ravel(), minlength=n_l)
gross = np.zeros(n_l, bool); gross[1:] = (st_l[1:, cv2.CC_STAT_AREA] >= 60) & (n_farbig[1:] >= 0.35 * st_l[1:, cv2.CC_STAT_AREA])
land = (gross[lab_l] & (land == 1)).astype(np.uint8)
# unsicher: Tinte samt Saum, Weiß und Hellcreme im Land (Höfe, Ortsmarken, Seen), Fremdfarben
naheTinte = cv2.dilate(tinte.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
unsicher = naheTinte | (bd > 30 ** 2) | (best == MEER) | (best == SAUM) | (best == TINTE)
sicher = ((~unsicher) & (land == 1)).astype(np.uint8)
_, idx = cv2.distanceTransformWithLabels(1 - sicher, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
ys, xs = np.nonzero(sicher); quelle = np.zeros(idx.max() + 1, np.uint8); quelle[idx[ys, xs]] = best[ys, xs]
best = quelle[idx]
# Anteile je Sprache im Fenster (ca. 2,5 Streifenperioden)
F = int(sys.argv[2]) if len(sys.argv) > 2 else 25
top1 = np.zeros((H, W), np.uint8); top2 = np.zeros((H, W), np.uint8)
f1 = np.zeros((H, W), np.float32); f2 = np.zeros((H, W), np.float32)
for k in range(N + 1):
    f = cv2.boxFilter((best == k).astype(np.float32), -1, (F, F))
    m1 = f > f1
    top2[m1] = top1[m1]; f2[m1] = f1[m1]; top1[m1] = k; f1[m1] = f[m1]
    m2 = (~m1) & (f > f2); top2[m2] = k; f2[m2] = f[m2]
gemischt = (f2 >= 0.22) & (top1 < N) & (top2 < N)
# Paar-ID: N*N-Raum, ungeordnet
a = np.minimum(top1, top2).astype(np.uint16); b = np.maximum(top1, top2).astype(np.uint16)
label = np.where(gemischt, 100 + a * N + b, np.where(best < N, best, np.where(best == LEER, 99, 255))).astype(np.uint16)
label[land == 0] = 255
# Schmale Mischsäume an reinen Grenzen entfernen: Öffnung je Paar
k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (F + 6, F + 6))
for pid in np.unique(label[label >= 100]):
    if pid == 255: continue
    m = (label == pid).astype(np.uint8)
    keep = cv2.morphologyEx(m, cv2.MORPH_OPEN, k)
    weg = (m == 1) & (keep == 0)
    label[weg] = np.where(f1[weg] > 0, top1[weg], 255)  # an die überwiegende Sprache zurück
np.save(f"{SP}/label.npy", label)
json.dump({"sprachen": [[s, n, c] for s, n, c in SPRACHEN], "groesse": [W, H], "fenster": F}, open(f"{SP}/klassen.json", "w"), ensure_ascii=False)
# Vorschau: reine Farben, Mischungen gestreift neu gemalt, leer grau
vor = np.full((H, W, 3), 245, np.uint8)
farben = np.array([c for _, _, c in SPRACHEN], np.uint8)
for v in np.unique(label):
    m = label == v
    if v < N: vor[m] = farben[v]
    elif v == 99: vor[m] = (200, 200, 200)
    elif 100 <= v < 255:
        aa, bb = divmod(int(v) - 100, N)
        yy, xx = np.nonzero(m); s = ((xx + yy) // 6) % 2 == 0
        vor[yy[s], xx[s]] = farben[aa]; vor[yy[~s], xx[~s]] = farben[bb]
cv2.imwrite(f"{SP}/vorschau.png", cv2.cvtColor(cv2.resize(vor, (W // 2, H // 2), interpolation=cv2.INTER_NEAREST), cv2.COLOR_RGB2BGR))
u, c = np.unique(label, return_counts=True)
for v, n in zip(u, c):
    if n < 2000: continue
    name = SPRACHEN[v][0] if v < N else ("leer" if v == 99 else "meer" if v == 255 else "+".join(SPRACHEN[i][0] for i in divmod(int(v) - 100, N)))
    print(v, name, n)
