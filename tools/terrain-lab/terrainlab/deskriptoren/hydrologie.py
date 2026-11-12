"""Gruppe D: Hydrologie (geschlossene Senken, D8-Einzugsgebiete, Gerinnenetz, Entwässerungsdichte, Talbreite und Einschnitt).

Das Fließnetz läuft über geschlossene Senken hinweg (``fliess.py``), damit Einzugsflächen vollständig sind. Geschlossene Senken selbst (Anteil,
Tiefe, Fläche) werden getrennt gemessen: ihre Tiefe ist Füllhöhe minus Zellhöhe. Das ist das Karst-Merkmal.
"""

from __future__ import annotations

import numpy as np
from scipy import ndimage

from .kern import zahl
from .kontext import Kontext
from .netz import achsenabstand, netz_maske, netz_metriken, querprofil

G = "hydrologie"
_ACHTER = np.ones((3, 3), dtype=int)


def berechne(ctx: Kontext) -> None:
    s = ctx.sammler
    par = ctx.parameter
    if ctx.n_gueltig == 0:
        s.uebersprungen("hydrologie: keine gültigen Zellen")
        return
    fn = ctx.abwaerts
    n = ctx.n_gueltig
    flaeche = ctx.flaeche_km2
    zelle_km2 = ctx.dx * ctx.dx / 1e6

    # ---- geschlossene Senken ----
    with ctx.zeit("hydro_senken"):
        tiefe = fn.senkentiefe
        flach = np.isfinite(ctx.z)
        senke = flach & (tiefe > par.senken_min_tiefe_m)
        s.skalar("hydro_senken_anteil", float(senke.sum()) / n, "1", G, "verteilung", "mittel", f"Anteil der Zellen in geschlossenen Senken (Füllhöhe über der Zelle um mehr als {par.senken_min_tiefe_m:g} m)")
        s.skalar("hydro_senken_fuelltiefe_mittel", float(tiefe[flach].sum()) / n, "m", G, "absolut", "mittel", "mittlere Füllhöhe über alle gültigen Zellen (Senkenvolumen je Fläche)")
        marke, k = ndimage.label(senke, structure=_ACHTER)
        s.skalar("hydro_senken_anzahl", k, "1", G, "absolut", "mittel", "Zahl getrennter geschlossener Senken")
        s.skalar("hydro_senken_dichte", k / flaeche, "1/km²", G, "raeumlich", "mittel", "geschlossene Senken je Fläche")
        if k:
            flaechen = np.bincount(marke.ravel(), minlength=k + 1)[1:] * ctx.dx * ctx.dx
            tiefe_max = ndimage.maximum(tiefe, marke, index=np.arange(1, k + 1))
            tv = tiefe[senke]
            s.skalar("hydro_senken_tiefe_mittel", tv.mean(), "m", G, "verteilung", "mittel", "mittlere Tiefe der Zellen in Senken")
            s.skalar("hydro_senken_tiefe_max", tv.max(), "m", G, "verteilung", "mittel", "größte Senkentiefe")
            s.skalar("hydro_senken_tiefe_je_senke_median", float(np.median(tiefe_max)), "m", G, "verteilung", "mittel", "Median der größten Tiefe je Senke")
            s.skalar("hydro_senken_flaeche_median", float(np.median(flaechen)), "m²", G, "verteilung", "mittel", "Median der Senkenfläche")
            s.verteilung("hydro_senken_tiefe", tv, "m", G, "verteilung", "Tiefe der Zellen in geschlossenen Senken")
            s.verteilung("hydro_senken_flaeche", flaechen, "m²", G, "verteilung", "Fläche der einzelnen Senken")
        else:
            s.skalar("hydro_senken_tiefe_mittel", 0.0, "m", G, "verteilung", "mittel", "mittlere Tiefe der Zellen in Senken")
            s.skalar("hydro_senken_tiefe_max", 0.0, "m", G, "verteilung", "mittel", "größte Senkentiefe")

    # ---- Einzugsgebiete ----
    with ctx.zeit("hydro_einzugsgebiete"):
        akk = fn.akkumulation
        auslass = fn.gueltig & (fn.ziel < 0)
        mindest = max(1.0, par.einzugsgebiet_min_m2 / (ctx.dx * ctx.dx))
        gross = auslass & (akk >= mindest)
        s.skalar("hydro_einzugsgebiete_anzahl", int(gross.sum()), "1", G, "absolut", "mittel", f"Zahl der Auslässe mit Einzugsfläche ≥ {par.einzugsgebiet_min_m2 / 1e6:g} km² (Gebiete, die den Rand oder NoData erreichen)")
        s.skalar("hydro_einzugsgebiet_groesstes_anteil", float(akk[auslass].max()) / n, "1", G, "relativ", "mittel", "Anteil des größten Einzugsgebiets an allen gültigen Zellen")
        if gross.any():
            s.verteilung("hydro_einzugsgebiet_flaeche", akk[gross] * zelle_km2, "km²", G, "verteilung", "Flächen der Einzugsgebiete mit Auslass")
        flaeche_alle = akk[fn.gueltig] * zelle_km2
        s.skalar("hydro_einzugsflaeche_p99", np.quantile(flaeche_alle, 0.99), "km²", G, "verteilung", "mittel", "99. Perzentil der Einzugsfläche aller Zellen")
        s.verteilung("hydro_einzugsflaeche_log10", np.log10(flaeche_alle), "log10 km²", G, "verteilung", "Zehnerlogarithmus der Einzugsfläche aller Zellen")

    # ---- Gerinnenetz ----
    with ctx.zeit("hydro_netz"):
        netz_metriken(ctx, fn, "gerinne", "Gerinne", G, "mittel")

    # ---- Tal ----
    if not ctx.teuer:
        return
    grob = par.netz_schwellen_m2[-1]
    kanal_flach = netz_maske(ctx, fn, grob)
    kanal = kanal_flach.reshape(ctx.form)
    with ctx.zeit("hydro_tal"):
        if not kanal.any():
            s.uebersprungen("hydrologie: kein Gerinne über der gröbsten Schwelle, Talmaße entfallen")
            return
        neigung = ctx.neigung_grad[kanal]
        neigung = neigung[np.isfinite(neigung)]
        if neigung.size:
            s.skalar("gerinne_neigung_median", float(np.median(neigung)), "°", G, "verteilung", "hoch", f"Median der Geländeneigung auf Gerinnezellen (Einzugsfläche ≥ {grob / 1e6:g} km²)")
        a = achsenabstand(ctx, kanal)
        assert a is not None
        hand = ctx.z - a.z_achse
        hv = hand[np.isfinite(hand)]
        s.skalar("tal_hand_median", float(np.median(hv)), "m", G, "verteilung", "hoch", "Median der Höhe über dem nächsten Gerinne (Height Above Nearest Drainage, euklidisch)")
        s.skalar("tal_hand_p90", float(np.quantile(hv, 0.9)), "m", G, "verteilung", "hoch", "90. Perzentil der Höhe über dem nächsten Gerinne")
        s.verteilung("tal_hand", hv, "m", G, "verteilung", "Höhe über dem nächsten Gerinne")
        ab = a.abstand_m[ctx.maske]
        s.skalar("tal_abstand_median", float(np.median(ab)), "m", G, "raeumlich", "hoch", "Median des Abstands zum nächsten Gerinne")
        s.verteilung("tal_abstand", ab, "m", G, "raeumlich", "Abstand zum nächsten Gerinne")
        laenge = float(fn.schritt[kanal_flach].sum()) * ctx.dx
        if laenge > 0:
            for h in par.tal_hoehen_m:
                breite = float((hv <= h).sum()) * ctx.dx * ctx.dx / laenge
                s.skalar(f"tal_breite_h{zahl(h)}m", breite, "m", G, "raeumlich", "hoch", f"Talbreite: Fläche der Zellen höchstens {zahl(h)} m über dem nächsten Gerinne geteilt durch die Gerinnelänge")
        x, y = querprofil(ctx, a, par.quer_abstaende_m, -1)
        for d, v in zip(par.quer_abstaende_m, y):
            s.skalar(f"tal_profil_d{zahl(d)}m", v, "m", G, "absolut", "hoch", f"Einschnitt: mittlerer Anstieg vom Gerinne zu Zellen im Abstand {zahl(d)} m (±20 %) – Talquerprofil")
        s.reihe("tal_querprofil", G, x, y, "m", "m", "mittlerer Höhenanstieg gegenüber dem nächsten Gerinne über dem Abstand")
