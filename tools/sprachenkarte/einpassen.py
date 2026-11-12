"""Prüfrechnung der Einpassung: affine Abbildung Pixel -> Karte aus passpunkte.json, Rest je Punkt, Kreuzvalidierung gegen Thin-Plate-Spline. Nur Ausgabe, schreibt nichts. Aufruf: python -I einpassen.py <arbeitsordner>"""
import sys, json, numpy as np
from scipy.interpolate import RBFInterpolator
SP = sys.argv[1]
P = json.load(open(f"{SP}/passpunkte.json"))
src = np.array([[p["px"], p["py"]] for p in P]); dst = np.array([[p["x"], p["y"]] for p in P]); names = [p["name"] for p in P]
def affin(s, d):
    A = np.c_[s, np.ones(len(s))]; M, *_ = np.linalg.lstsq(A, d, rcond=None); return lambda q: np.c_[q, np.ones(len(q))] @ M, M
f, M = affin(src, dst); r = np.linalg.norm(f(src) - dst, axis=1)
print("Affin: Maßstab", np.round(np.linalg.svd(M[:2])[1], 5), "Rest mittel %.2f median %.2f max %.2f" % (r.mean(), np.median(r), r.max()))
for i in np.argsort(-r)[:12]: print("  ", names[i], round(r[i], 2), (f(src[i:i+1]) - dst[i]).round(2).tolist())
# Kreuzvalidierung: TPS mit Glättung, jeweils einen Punkt weglassen
for glatt in [0, 1e2, 1e3, 1e4]:
    loo = []
    for i in range(len(src)):
        m = np.ones(len(src), bool); m[i] = False
        g, _ = affin(src[m], dst[m])
        rbf = RBFInterpolator(src[m], dst[m] - g(src[m]), kernel="thin_plate_spline", smoothing=glatt)
        loo.append(np.linalg.norm(g(src[i:i+1]) + rbf(src[i:i+1]) - dst[i]))
    loo = np.array(loo); print("TPS glatt=%g: LOO mittel %.2f median %.2f max %.2f (%s)" % (glatt, loo.mean(), np.median(loo), loo.max(), names[int(loo.argmax())]))
