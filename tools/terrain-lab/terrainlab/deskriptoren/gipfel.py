"""Gruppe C: Gipfel und Kämme (lokale Maxima, echte Prominenz, Gipfelabstände, Kammnetz, Querprofile).

Prominenz folgt der klassischen Definition über den Schlüsselsattel (siehe ``regionen.prominenz_berechnen``), nicht einer Nachbarschafts-
Höhendifferenz. Der Hauptgipfel jeder zusammenhängenden gültigen Fläche erhält seine Höhe über dem tiefsten Wert dieser Fläche.
"""

from __future__ import annotations

import numpy as np
from scipy.spatial import cKDTree

from .kern import zahl
from .kontext import Kontext
from .netz import achsenabstand, netz_maske, netz_metriken, querprofil

G = "gipfel"


def _isolation(pos: np.ndarray, hoehe: np.ndarray) -> np.ndarray:
    """Abstand jedes Gipfels zum nächsten höheren Gipfel (NaN beim höchsten). Bei Gleichstand gilt der kleinere Index als höher."""
    m = len(hoehe)
    ergebnis = np.full(m, np.nan)
    if m < 2:
        return ergebnis
    rang = np.lexsort((np.arange(m), -hoehe))  # absteigend nach Höhe, dann Index
    platz = np.empty(m, dtype=np.int64)
    platz[rang] = np.arange(m)  # kleiner = höher
    baum = cKDTree(pos)
    offen = np.arange(m)
    for k in (8, 32, 128, 512):
        if offen.size == 0:
            break
        kk = min(k + 1, m)
        dist, idx = baum.query(pos[offen], k=kk)
        hoeher = platz[idx] < platz[offen][:, None]
        hat = hoeher.any(axis=1)
        erste = hoeher.argmax(axis=1)
        ergebnis[offen[hat]] = dist[np.arange(offen.size)[hat], erste[hat]]
        offen = offen[~hat]
        if kk == m:
            break
    for i in offen:  # Rest: lückenlos gegen alle höheren
        hoeher = platz < platz[i]
        if hoeher.any():
            ergebnis[i] = np.sqrt(((pos[hoeher] - pos[i]) ** 2).sum(axis=1)).min()
    return ergebnis


def berechne(ctx: Kontext) -> None:
    if ctx.n_gueltig == 0:
        ctx.sammler.uebersprungen("gipfel: keine gültigen Zellen")
        return
    _gipfel(ctx)
    _kaemme(ctx)


def _gipfel(ctx: Kontext) -> None:
    s = ctx.sammler
    par = ctx.parameter
    gl = ctx.gipfel
    flaeche = ctx.flaeche_km2
    spanne = ctx.relief
    with ctx.zeit("gipfel_auswertung"):
        s.skalar("gipfel_lokale_maxima_dichte", len(gl.zelle) / flaeche, "1/km²", G, "raeumlich", "mittel", "lokale Maxima (Plateaus zählen einfach) je Fläche; hoch = Rauschen oder feines Relief")
        for p in par.prominenz_stufen_m:
            s.skalar(f"gipfel_dichte_p{zahl(p)}m", float((gl.prominenz >= p).sum()) / flaeche, "1/km²", G, "raeumlich", "mittel", f"Gipfel mit Prominenz ≥ {zahl(p)} m je Fläche")
        sig = gl.prominenz >= par.min_prominenz_m
        m = int(sig.sum())
        s.skalar("gipfel_anzahl", m, "1", G, "absolut", "mittel", f"Gipfel mit Prominenz ≥ {zahl(par.min_prominenz_m)} m (bedeutsame Gipfel)")
        if m == 0:
            s.uebersprungen(f"gipfel: keine Gipfel mit Prominenz ≥ {zahl(par.min_prominenz_m)} m")
            return
        prom = gl.prominenz[sig]
        s.skalar("gipfel_prominenz_mittel", prom.mean(), "m", G, "verteilung", "mittel", "mittlere Prominenz der bedeutsamen Gipfel")
        s.skalar("gipfel_prominenz_median", np.median(prom), "m", G, "verteilung", "mittel", "Median der Prominenz der bedeutsamen Gipfel")
        s.skalar("gipfel_prominenz_p90", np.quantile(prom, 0.9), "m", G, "verteilung", "mittel", "90. Perzentil der Prominenz der bedeutsamen Gipfel")
        s.skalar("gipfel_prominenz_max", prom.max(), "m", G, "verteilung", "mittel", "größte Prominenz (Hauptgipfel: Höhe über dem Rastertiefpunkt)")
        s.verteilung("gipfel_prominenz", prom, "m", G, "verteilung", "Prominenz der bedeutsamen Gipfel")
        if spanne > 0:
            s.skalar("gipfel_prominenz_rel_mittel", (prom / spanne).mean(), "1", G, "relativ", "mittel", "mittlere Prominenz der bedeutsamen Gipfel geteilt durch die Reliefspanne")
            s.skalar("gipfel_hoehe_rel_mittel", ((gl.hoehe[sig] - ctx.zmin) / spanne).mean(), "1", G, "relativ", "mittel", "mittlere auf 0..1 normierte Höhe der bedeutsamen Gipfel")

        # Gipfelabstände
        b = ctx.form[1]
        zellen = gl.zelle[sig]
        pos = np.column_stack([(zellen % b) * ctx.dx, (zellen // b) * ctx.dx]).astype(np.float64)
        hoehe = gl.hoehe[sig]
        if m >= 2:
            baum = cKDTree(pos)
            nn = baum.query(pos, k=2)[0][:, 1]
            s.skalar("gipfel_abstand_nn_median", np.median(nn), "m", G, "raeumlich", "mittel", "Median des Abstands zum nächsten bedeutsamen Gipfel")
            s.skalar("gipfel_abstand_nn_mittel", nn.mean(), "m", G, "raeumlich", "mittel", "mittlerer Abstand zum nächsten bedeutsamen Gipfel")
            erwartet = 0.5 / np.sqrt(m / (flaeche * 1e6))
            s.skalar("gipfel_nni", nn.mean() / erwartet, "1", G, "raeumlich", "mittel", "Nächster-Nachbar-Index (1 zufällig, <1 gehäuft, >1 gleichmäßig verteilt; Randeffekt nicht korrigiert)")
            s.verteilung("gipfel_abstand_nn", nn, "m", G, "raeumlich", "Abstand zum nächsten bedeutsamen Gipfel")
            iso = _isolation(pos, hoehe)
            iv = iso[np.isfinite(iso)]
            if iv.size:
                s.skalar("gipfel_isolation_median", np.median(iv), "m", G, "raeumlich", "mittel", "Median der Isolation (Abstand zum nächsten höheren bedeutsamen Gipfel)")
                s.skalar("gipfel_isolation_p90", np.quantile(iv, 0.9), "m", G, "raeumlich", "mittel", "90. Perzentil der Isolation")
                s.verteilung("gipfel_isolation", iv, "m", G, "raeumlich", "Isolation der bedeutsamen Gipfel")

        # Verzweigung des Gipfelbaums: Elter = bedeutsamer Gipfel jenseits des Schlüsselsattels; unbedeutende Becken werden übersprungen
        eff = gl.nachbar.copy()
        for _ in range(len(sig)):
            offen = (eff >= 0)
            offen[offen] = ~sig[eff[offen]]
            if not offen.any():
                break
            eff[offen] = gl.nachbar[eff[offen]]
        hat_eltern = sig & (eff >= 0)
        kinder = np.bincount(eff[hat_eltern], minlength=len(sig))[sig]
        s.skalar("gipfel_baum_kinder_max", int(kinder.max()), "1", G, "raeumlich", "mittel", "größte Zahl direkter Kindgipfel eines Gipfels im Gipfelbaum (Verzweigung der Gratsysteme)")
        if (kinder > 0).any():
            s.skalar("gipfel_baum_kinder_mittel", float(kinder[kinder > 0].mean()), "1", G, "raeumlich", "mittel", "mittlere Zahl der Kindgipfel der Gipfel mit mindestens einem Kind")
        s.skalar("gipfel_baum_blattanteil", float((kinder == 0).mean()), "1", G, "raeumlich", "mittel", "Anteil der bedeutsamen Gipfel ohne Kindgipfel")


def _kaemme(ctx: Kontext) -> None:
    s = ctx.sammler
    par = ctx.parameter
    fn = ctx.aufwaerts
    with ctx.zeit("kamm_netz"):
        netz_metriken(ctx, fn, "kamm", "Kamm", G, "mittel")
    if not ctx.teuer:
        return
    # Kammachse für Querprofile: grobes Netz und quer konvex
    lam_min, _ = ctx.hesse_glatt
    grob = par.netz_schwellen_m2[-1]
    achse = (netz_maske(ctx, fn, grob).reshape(ctx.form)) & (lam_min < -par.kamm_kruemmung_min)
    with ctx.zeit("kamm_profil"):
        s.skalar("kamm_achse_anteil", float(achse.sum()) / ctx.n_gueltig, "1", G, "raeumlich", "hoch", "Anteil der Kammachsenzellen (Netz der gröbsten Schwelle, quer konvex) an den gültigen Zellen")
        a = achsenabstand(ctx, achse)
        if a is None:
            s.uebersprungen("kamm_profil: keine Kammachse gefunden")
            return
        x, y = querprofil(ctx, a, par.quer_abstaende_m, +1)
        for d, v in zip(par.quer_abstaende_m, y):
            s.skalar(f"kamm_profil_d{zahl(d)}m", v, "m", G, "absolut", "hoch", f"mittlerer Höhenabfall von der Kammachse zu Zellen im Abstand {zahl(d)} m (±20 %) – Querprofil")
        s.reihe("kamm_querprofil", G, x, y, "m", "m", "mittlerer Höhenabfall gegenüber der nächsten Kammzelle über dem Abstand")
        for r_m, r in ctx.radien(par.fenster_radien_m, "kamm_tpi"):
            f = ctx.fenster(r)
            tpi = (ctx.z - f.mittel)[achse]
            tpi = tpi[np.isfinite(tpi)]
            if tpi.size:
                s.skalar(f"kamm_tpi_r{zahl(r_m)}m", tpi.mean(), "m", G, "absolut", "hoch", f"mittlere Höhe der Kammzellen über dem Fenstermittel ±{zahl(r_m)} m (Topographic Position Index)")
