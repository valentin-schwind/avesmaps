"""Legendenfarben (Mittel der elf Farbfelder) und häufigste Farben des Kartenbilds. Aufruf: python -I farben.py <karte.png> (Vollauflösung)"""
import sys, numpy as np
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
a = np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(int)
ys = [65, 100, 134, 170, 206, 240, 275, 312, 348, 382, 417]
for k, yc in enumerate(ys):
    y = int(400 + yc / 0.6); x = int(120 + 97 / 0.6)
    box = a[y - 6:y + 6, x - 30:x + 30].reshape(-1, 3)
    print(k, np.median(box, axis=0).astype(int).tolist(), box.std(axis=0).round(1).tolist())
# häufigste Farben auf 8er-Raster
q = (a // 8) * 8 + 4
flat = q.reshape(-1, 3); keys = flat[:, 0] * 65536 + flat[:, 1] * 256 + flat[:, 2]
u, c = np.unique(keys, return_counts=True); o = np.argsort(-c)[:40]
for i in o: print([u[i] // 65536, (u[i] // 256) % 256, u[i] % 256], round(c[i] / keys.size * 100, 2))
