"""Ortsmarken finden: weiße Scheibe mit dunklem Ring. Aufruf: python -I punkte.py <arbeitsordner> (liest karte.png, schreibt punkte.json und die sechs Teilbilder teil-*.jpg mit Nummern)."""
import sys, json, numpy as np, cv2
SP = sys.argv[1]
img = cv2.cvtColor(cv2.imread(f"{SP}/karte.png"), cv2.COLOR_BGR2RGB).astype(int)
weiss = ((img.min(-1) >= 240) & (np.ptp(img, -1) <= 14)).astype(np.uint8)
dunkel = (img.max(-1) <= 90).astype(np.uint8)
n, lab, st, cen = cv2.connectedComponentsWithStats(weiss, 8)
out = []
for i in range(1, n):
    x, y, w, h, a = st[i]
    if not (25 <= a <= 600 and 0.6 <= w / h <= 1.6): continue
    if a / (w * h) < 0.6: continue
    r = max(w, h) / 2 + 4; cx, cy = cen[i]
    yy, xx = np.ogrid[-int(r) - 3:int(r) + 4, -int(r) - 3:int(r) + 4]
    ring = (np.hypot(xx, yy) >= r - 2.5) & (np.hypot(xx, yy) <= r + 2)
    y0, x0 = int(cy) - int(r) - 3, int(cx) - int(r) - 3
    if y0 < 0 or x0 < 0: continue
    win = dunkel[y0:y0 + ring.shape[0], x0:x0 + ring.shape[1]]
    if win.shape != ring.shape: continue
    if win[ring].mean() < 0.55: continue
    out.append([round(float(cx), 1), round(float(cy), 1), int(a)])
json.dump(out, open(f"{SP}/punkte.json", "w"))
print(len(out))
# Viertel mit Nummern
base = cv2.imread(f"{SP}/karte.png")
for i, (x, y, a) in enumerate(out):
    cv2.circle(base, (int(x), int(y)), 16, (0, 0, 255), 4)
    cv2.putText(base, str(i), (int(x) + 14, int(y) - 14), cv2.FONT_HERSHEY_SIMPLEX, 1.6, (255, 0, 255), 5)
H, W = base.shape[:2]
teile = {"nw": (0, 0, W // 2 + 200, H // 3 + 200), "no": (W // 2 - 200, 0, W, H // 3 + 200),
         "mw": (0, H // 3 - 200, W // 2 + 200, 2 * H // 3 + 200), "mo": (W // 2 - 200, H // 3 - 200, W, 2 * H // 3 + 200),
         "sw": (0, 2 * H // 3 - 200, W // 2 + 200, H), "so": (W // 2 - 200, 2 * H // 3 - 200, W, H)}
for k, (x0, y0, x1, y1) in teile.items():
    c = base[y0:y1, x0:x1]; s = 1400 / c.shape[1]
    cv2.imwrite(f"{SP}/teil-{k}.jpg", cv2.resize(c, None, fx=s, fy=s, interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, 85])
