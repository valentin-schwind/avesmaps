"""Gruppe A: Höhenverteilung (Histogramm, Quantile, relative Reliefhöhe, hypsometrisches Integral, hoch/tief liegende Anteile)."""

from __future__ import annotations

import numpy as np

from .kern import zahl
from .kontext import Kontext

G = "hoehe"
BAENDER = 10


def berechne(ctx: Kontext) -> None:
    s = ctx.sammler
    s.skalar("hoehe_nodata_anteil", 1.0 - ctx.n_gueltig / ctx.z.size, "1", G, "relativ", "gering", "Anteil ungültiger Zellen (NoData/NaN); Spektral- und Fenstermaße sind bei großen Anteilen nur grob verlässlich")
    s.skalar("hoehe_flaeche", ctx.flaeche_km2, "km²", G, "absolut", "gering", "Fläche der gültigen Zellen")
    if ctx.n_gueltig == 0:
        s.uebersprungen("hoehe: keine gültigen Zellen")
        return
    with ctx.zeit("hoehe"):
        v = ctx.werte
        zmin, zmax, spanne = ctx.zmin, ctx.zmax, ctx.relief
        s.skalar("hoehe_min", zmin, "m", G, "absolut", "gering", "niedrigste gültige Höhe")
        s.skalar("hoehe_max", zmax, "m", G, "absolut", "gering", "höchste gültige Höhe")
        s.skalar("hoehe_mittel", v.mean(), "m", G, "absolut", "gering", "mittlere Höhe")
        s.skalar("hoehe_std", v.std(), "m", G, "absolut", "gering", "Standardabweichung der Höhe")
        s.skalar("hoehe_relief", spanne, "m", G, "absolut", "gering", "Reliefspanne des Ausschnitts (Maximum minus Minimum)")
        q = np.quantile(v, [0.05, 0.25, 0.5, 0.75, 0.95])
        for name, wert in zip(("q05", "q25", "q50", "q75", "q95"), q):
            s.skalar(f"hoehe_{name}", wert, "m", G, "verteilung", "gering", f"Höhenquantil {name[1:]} %")
        s.verteilung("hoehe", v, "m", G, "absolut", "Höhenverteilung in Metern")

        if spanne > 0:
            rel = (v - zmin) / spanne
            s.skalar("hoehe_hypsometrisches_integral", rel.mean(), "1", G, "relativ", "gering", "(Mittel - Minimum) / Spanne; 0,5 = gleichmäßig, klein = Gipfel auf großer Fläche tief")
            qr = np.quantile(rel, [0.25, 0.5, 0.75])
            for name, wert in zip(("q25", "q50", "q75"), qr):
                s.skalar(f"hoehe_rel_{name}", wert, "1", G, "relativ", "gering", f"Quantil {name[1:]} % der auf 0..1 normierten Höhe")
            s.skalar("hoehe_anteil_hoch", float((rel > 0.75).mean()), "1", G, "relativ", "gering", "Anteil der Zellen im obersten Viertel der Spanne")
            s.skalar("hoehe_anteil_tief", float((rel < 0.25).mean()), "1", G, "relativ", "gering", "Anteil der Zellen im untersten Viertel der Spanne")
            s.skalar("hoehe_schiefe", float(((v - v.mean()) ** 3).mean() / max(v.std(), 1e-12) ** 3), "1", G, "relativ", "gering", "Schiefe der Höhenverteilung")
            hist, _ = np.histogram(rel, bins=BAENDER, range=(0.0, 1.0))
            for i, n in enumerate(hist):
                s.skalar(f"hoehe_anteil_band_b{i}", n / rel.size, "1", G, "relativ", "gering", f"Anteil im Höhenband {i * 10}–{(i + 1) * 10} % der Spanne (Histogramm)")
            s.verteilung("hoehe_rel", rel, "1", G, "relativ", "auf 0..1 normierte Höhe")
        else:
            s.uebersprungen("hoehe: Reliefspanne 0, relative Maße entfallen")

        for r_m, r in ctx.radien(ctx.parameter.fenster_radien_m, "hoehe_ueber_grund"):
            f = ctx.fenster(r)
            ueber = ctx.z - f.minimum  # Höhe über dem tiefsten Punkt im Fenster
            n = f"r{zahl(r_m)}m"
            gv = ueber[np.isfinite(ueber)]
            if gv.size == 0:
                continue
            s.skalar(f"hoehe_ueber_grund_mittel_{n}", gv.mean(), "m", G, "absolut", "mittel", f"mittlere Höhe über dem tiefsten Punkt im Fenster ±{zahl(r_m)} m")
            s.skalar(f"hoehe_ueber_grund_max_{n}", gv.max(), "m", G, "absolut", "mittel", f"größte Höhe über dem tiefsten Punkt im Fenster ±{zahl(r_m)} m")
            s.verteilung(f"hoehe_ueber_grund_{n}", gv, "m", G, "absolut", f"relative Reliefhöhe: Höhe über dem Fenstertiefpunkt ±{zahl(r_m)} m")
