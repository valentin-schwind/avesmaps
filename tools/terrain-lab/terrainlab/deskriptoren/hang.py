"""Gruppe B: Hang und Relief (Neigungsverteilung, Krümmung, Reliefenergie, Rauheit, Variation auf mehreren Skalen).

Neigungen werden physikalisch aus Metern gerechnet (arctan des Gradienten, Grad); es gibt keine Normierung auf 0..1.
"""

from __future__ import annotations

import numpy as np

from .kern import zahl
from .kontext import Kontext

G = "hang"


def _blockmittel(z: np.ndarray, f: int) -> np.ndarray:
    h, b = (z.shape[0] // f) * f, (z.shape[1] // f) * f
    block = z[:h, :b].reshape(h // f, f, b // f, f)
    return block.mean(axis=(1, 3))  # NaN, sobald ein Block eine ungültige Zelle hat


def _regression_exponent(x: list[float], y: list[float]) -> float:
    x_a, y_a = np.log(np.array(x)), np.log(np.array(y))
    if x_a.size < 2 or not np.isfinite(y_a).all():
        return float("nan")
    return float(np.polyfit(x_a, y_a, 1)[0])


def berechne(ctx: Kontext) -> None:
    s = ctx.sammler
    par = ctx.parameter
    if ctx.n_gueltig == 0:
        s.uebersprungen("hang: keine gültigen Zellen")
        return

    # ---- Neigung ----
    with ctx.zeit("hang_neigung"):
        grad = ctx.neigung_grad
        gv = grad[np.isfinite(grad)]
        if gv.size == 0:
            s.uebersprungen("hang: Raster zu klein für Ableitungen")
            return
        s.skalar("hang_neigung_mittel", gv.mean(), "°", G, "verteilung", "gering", "mittlere Hangneigung")
        s.skalar("hang_neigung_median", np.median(gv), "°", G, "verteilung", "gering", "Median der Hangneigung")
        s.skalar("hang_neigung_p90", np.quantile(gv, 0.90), "°", G, "verteilung", "gering", "90. Perzentil der Hangneigung")
        s.skalar("hang_neigung_p99", np.quantile(gv, 0.99), "°", G, "verteilung", "gering", "99. Perzentil der Hangneigung")
        s.skalar("hang_neigung_max", gv.max(), "°", G, "verteilung", "gering", "steilste Hangneigung")
        s.skalar("hang_neigung_std", gv.std(), "°", G, "verteilung", "gering", "Standardabweichung der Hangneigung")
        s.skalar("hang_anteil_flach_lt5", float((gv < 5).mean()), "1", G, "verteilung", "gering", "Anteil der Zellen flacher als 5°")
        for grenze in (30, 45, 60):
            s.skalar(f"hang_anteil_gt{grenze}", float((gv > grenze).mean()), "1", G, "verteilung", "gering", f"Anteil der Zellen steiler als {grenze}°")
        s.verteilung("hang_neigung", gv, "°", G, "verteilung", "Hangneigung in Grad (aus Metern, Horn-Gradient)")

        # Neigung auf gröberen Skalen: Blockmittel der Höhe, Gradient mit vergrößerter Zellkante
        skalen, mittel = [], []
        for faktor in par.skalenfaktoren:
            if faktor < 1 or min(ctx.form) // faktor < 5:
                s.uebersprungen(f"hang_neigung_mittel_f{faktor}: Raster zu klein")
                continue
            z = ctx.z if faktor == 1 else _blockmittel(ctx.z, faktor)
            p, q, *_ = ctx.ableitungen(z, ctx.dx * faktor)
            g = np.hypot(p, q)
            g = g[np.isfinite(g)]
            if g.size == 0:
                continue
            skalen.append(ctx.dx * faktor)
            mittel.append(float(g.mean()))
            if faktor > 1:
                s.skalar(f"hang_neigung_mittel_f{faktor}", np.degrees(np.arctan(g)).mean(), "°", G, "verteilung", "gering", f"mittlere Hangneigung bei {faktor}-facher Zellkante (Blockmittel)")
        if len(skalen) >= 2 and all(m > 0 for m in mittel):
            s.skalar("hang_skalenexponent", _regression_exponent(skalen, mittel), "1", G, "relativ", "gering", "Exponent der mittleren Neigung über der Zellkante (0 = Ebene, negativ = rau: Hänge werden bei Vergröberung flacher)")

    # ---- Krümmung ----
    with ctx.zeit("hang_kruemmung"):
        profil, plan = ctx.kruemmung
        for name, feld, text in (("profil", profil, "Profilkrümmung (in Fallrichtung)"), ("plan", plan, "Plankrümmung (entlang der Höhenlinie)")):
            v = feld[np.isfinite(feld)]
            if v.size == 0:
                s.uebersprungen(f"hang_kruemmung_{name}: kein Gradient über der Mindestneigung")
                continue
            s.skalar(f"hang_kruemmung_{name}_mittel", v.mean(), "1/m", G, "verteilung", "gering", f"mittlere {text}; positiv konvex, negativ konkav")
            s.skalar(f"hang_kruemmung_{name}_abs_mittel", np.abs(v).mean(), "1/m", G, "verteilung", "gering", f"mittlerer Betrag der {text}")
            s.skalar(f"hang_kruemmung_{name}_p05", np.quantile(v, 0.05), "1/m", G, "verteilung", "gering", f"5. Perzentil der {text}")
            s.skalar(f"hang_kruemmung_{name}_p95", np.quantile(v, 0.95), "1/m", G, "verteilung", "gering", f"95. Perzentil der {text}")
            s.skalar(f"hang_kruemmung_{name}_anteil_konvex", float((v > 0).mean()), "1", G, "verteilung", "gering", f"Anteil konvexer Zellen ({text})")
            s.verteilung(f"hang_kruemmung_{name}", v, "1/m", G, "verteilung", text)

    # ---- Reliefenergie und Variation ----
    with ctx.zeit("hang_relief"):
        radien = ctx.radien(par.fenster_radien_m, "hang_reliefenergie")
        std_r, std_w = [], []
        for r_m, r in radien:
            f = ctx.fenster(r)
            n = f"r{zahl(r_m)}m"
            energie = f.maximum - f.minimum
            ev = energie[np.isfinite(energie)]
            if ev.size == 0:
                continue
            s.skalar(f"hang_reliefenergie_mittel_{n}", ev.mean(), "m", G, "verteilung", "mittel", f"mittlere Reliefenergie (Maximum minus Minimum) im Fenster ±{zahl(r_m)} m")
            s.skalar(f"hang_reliefenergie_p95_{n}", np.quantile(ev, 0.95), "m", G, "verteilung", "mittel", f"95. Perzentil der Reliefenergie im Fenster ±{zahl(r_m)} m")
            s.skalar(f"hang_reliefenergie_max_{n}", ev.max(), "m", G, "verteilung", "mittel", f"größte Reliefenergie im Fenster ±{zahl(r_m)} m")
            s.skalar(f"hang_reliefverhaeltnis_mittel_{n}", ev.mean() / (2 * r * ctx.dx), "1", G, "relativ", "mittel", f"mittlere Reliefenergie geteilt durch die Fensterkante (±{zahl(r_m)} m)")
            s.verteilung(f"hang_reliefenergie_{n}", ev, "m", G, "verteilung", f"Reliefenergie im Fenster ±{zahl(r_m)} m")
            sv = f.std[np.isfinite(f.std)]
            if sv.size and sv.mean() > 0:
                s.skalar(f"hang_variation_std_{n}", sv.mean(), "m", G, "verteilung", "mittel", f"mittlere lokale Standardabweichung der Höhe im Fenster ±{zahl(r_m)} m")
                std_r.append(r * ctx.dx)
                std_w.append(float(sv.mean()))
        if len(std_r) >= 2:
            s.skalar("hang_variation_exponent", _regression_exponent(std_r, std_w), "1", G, "relativ", "mittel", "Exponent der lokalen Höhenstreuung über dem Fensterradius (Hurst-ähnlich; ~1 glatt, ~0 schwach strukturiert)")

    # ---- Rauheit ----
    with ctx.zeit("hang_rauheit"):
        a, b, c, d, e, f, g, h, i = ctx.nachbarn(ctx.z)
        abstand = np.sqrt(sum((nb - e) ** 2 for nb in (a, b, c, d, f, g, h, i)))
        tri = abstand[np.isfinite(abstand)]
        if tri.size:
            s.skalar("hang_tri_mittel", tri.mean(), "m", G, "verteilung", "gering", "Geländerauheitsindex (Riley 1999): Wurzel der Summe der Quadrate der Höhenunterschiede zu den 8 Nachbarn, Mittel")
            s.skalar("hang_tri_p95", np.quantile(tri, 0.95), "m", G, "verteilung", "gering", "95. Perzentil des Geländerauheitsindex")
            s.verteilung("hang_tri", tri, "m", G, "verteilung", "Geländerauheitsindex nach Riley")
        p, q, *_ = ctx.ableitungen()
        with np.errstate(invalid="ignore"):
            norm = np.sqrt(1.0 + p * p + q * q)
            nx, ny, nz = -p / norm, -q / norm, 1.0 / norm
        for r_m, r in ctx.radien(par.rauheit_radien_m, "hang_vrm"):
            mx, my, mz = ctx.fenster_mittel(nx, r), ctx.fenster_mittel(ny, r), ctx.fenster_mittel(nz, r)
            with np.errstate(invalid="ignore"):
                vrm = 1.0 - np.sqrt(mx * mx + my * my + mz * mz)
            v = vrm[np.isfinite(vrm)]
            if v.size == 0:
                continue
            n = f"r{zahl(r_m)}m"
            s.skalar(f"hang_vrm_mittel_{n}", v.mean(), "1", G, "verteilung", "mittel", f"Vektor-Rauheitsmaß (Sappington 2007) im Fenster ±{zahl(r_m)} m: 0 glatt, größer rauer")
            s.verteilung(f"hang_vrm_{n}", v, "1", G, "verteilung", f"Vektor-Rauheitsmaß im Fenster ±{zahl(r_m)} m")
