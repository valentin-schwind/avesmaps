"""Gruppe E: Frequenz und Skalen (radiales Leistungsspektrum, Wellenlängenbänder, Richtungs- und Gitterartefakte, Autokorrelation).

Das Spektrum entsteht aus der Höhe nach Abzug der besten Ebene und mit Hann-Fenster (gegen Randlecks). NoData wird nach dem Ebenenabzug
durch 0 ersetzt; bei größeren NoData-Anteilen sind die Spektralmaße daher nur grob verlässlich (``hoehe_nodata_anteil`` beachten).
Die Leistungsdichte ist ein Periodogramm in m^4 (Einheit der Höhe zum Quadrat je Wellenzahl-Quadrat), normiert so, dass ihr Integral
über die Wellenzahlebene die Höhenvarianz ergibt.
"""

from __future__ import annotations

import math

import numpy as np

from .kern import zahl
from .kontext import Kontext

G = "frequenz"
_SEKTOREN = 16


def _hann(n: int) -> np.ndarray:
    return 0.5 - 0.5 * np.cos(2.0 * np.pi * np.arange(n) / n)


def _ebene_abziehen(z: np.ndarray, maske: np.ndarray) -> np.ndarray:
    h, b = z.shape
    y, x = np.mgrid[0:h, 0:b]
    xs, ys, zs = x[maske].astype(np.float64), y[maske].astype(np.float64), z[maske]
    a = np.column_stack([np.ones_like(xs), xs, ys])
    koeff, *_ = np.linalg.lstsq(a, zs, rcond=None)
    ebene = koeff[0] + koeff[1] * x + koeff[2] * y
    return np.where(maske, z - ebene, 0.0)


def _moran(feld: np.ndarray) -> float:
    """Globales Moran-I (Nachbarschaft: 8er, binäre Gewichte) über die endlichen Zellen."""
    g = np.isfinite(feld)
    n = int(g.sum())
    if n < 9:
        return float("nan")
    mu = feld[g].mean()
    a = np.where(g, feld - mu, 0.0)
    nenner = float((a * a).sum())
    if nenner <= 0:
        return float("nan")
    h, b = feld.shape
    produkt, paare = 0.0, 0
    for dy, dx in ((0, 1), (1, 0), (1, 1), (1, -1)):
        if dx >= 0:
            s1, s2 = (slice(0, h - dy), slice(0, b - dx)), (slice(dy, h), slice(dx, b))
        else:
            s1, s2 = (slice(0, h - dy), slice(-dx, b)), (slice(dy, h), slice(0, b + dx))
        gp = g[s1] & g[s2]
        produkt += float((a[s1] * a[s2])[gp].sum())
        paare += int(gp.sum())
    return n * produkt / (paare * nenner) if paare else float("nan")


def berechne(ctx: Kontext) -> None:
    s = ctx.sammler
    par = ctx.parameter
    ny, nx = ctx.form
    if ctx.n_gueltig == 0:
        s.uebersprungen("frequenz: keine gültigen Zellen")
        return
    if min(ny, nx) < 32:
        s.uebersprungen("frequenz: Raster kleiner als 32 Zellen, Spektralmaße entfallen")
    else:
        with ctx.zeit("frequenz_spektrum"):
            _spektrum(ctx)

    with ctx.zeit("frequenz_orientierung"):
        p, q, *_ = ctx.ableitungen()
        g = np.isfinite(p) & np.isfinite(q)
        if g.sum() > 9:
            jxx, jyy, jxy = float((p[g] ** 2).sum()), float((q[g] ** 2).sum()), float((p[g] * q[g]).sum())
            if jxx + jyy > 0:
                s.skalar("frequenz_orientierung_kohaerenz", math.sqrt((jxx - jyy) ** 2 + 4 * jxy**2) / (jxx + jyy), "1", G, "raeumlich", "gering", "Kohärenz des Gradiententensors (0 isotrop, 1 alle Hänge zeigen in dieselbe Richtung)")
                s.skalar("frequenz_orientierung_richtung", math.degrees(0.5 * math.atan2(2 * jxy, jxx - jyy)) % 180.0, "°", G, "raeumlich", "gering", "Hauptrichtung des Gradienten (quer zu den Rücken), 0° = nach Osten, 90° = nach Süden, modulo 180°")
    with ctx.zeit("frequenz_moran"):
        i_hang = _moran(ctx.neigung_grad)
        s.skalar("frequenz_moran_hang", i_hang, "1", G, "raeumlich", "gering", "Moran-I der Hangneigung (8er-Nachbarschaft): räumliche Zusammenhängigkeit der Steilheit; nahe 1 = Steilheit in zusammenhängenden Flächen")
        s.skalar("frequenz_moran_plankruemmung", _moran(ctx.kruemmung[1]), "1", G, "raeumlich", "gering", "Moran-I der Plankrümmung (8er-Nachbarschaft)")


def _spektrum(ctx: Kontext) -> None:
    s = ctx.sammler
    par = ctx.parameter
    ny, nx = ctx.form
    dx = ctx.dx
    zd = _ebene_abziehen(ctx.z, ctx.maske)
    fenster = np.outer(_hann(ny), _hann(nx))
    s2 = float((fenster**2).sum())
    f = np.fft.rfft2(fenster * zd)
    roh = f.real**2 + f.imag**2  # |F|^2
    psd = roh * dx * dx / s2
    ky = np.fft.fftfreq(ny, dx)[:, None]
    kx = np.fft.rfftfreq(nx, dx)[None, :]
    k = np.hypot(kx, ky)
    gew = np.full(psd.shape, 2.0)
    gew[:, 0] = 1.0
    if nx % 2 == 0:
        gew[:, -1] = 1.0
    nicht_dc = k > 0
    gesamt = float((gew * psd)[nicht_dc].sum())
    if not (float(((fenster * zd) ** 2).sum()) / s2 > 1e-10 and gesamt > 0):  # Streuung unter 10 µm: Rundungsrauschen
        s.uebersprungen("frequenz: keine Höhenvarianz nach Ebenenabzug, Spektralmaße entfallen")
        return

    # --- radiales Spektrum ---
    k0 = 1.0 / (min(ny, nx) * dx)
    knyq = 1.0 / (2.0 * dx)
    bins = max(4, int(math.ceil(math.log10(knyq / k0) * 10)))
    kanten = np.logspace(math.log10(k0 * 0.999), math.log10(knyq * 1.001), bins + 1)
    idx = np.digitize(k, kanten) - 1
    ok = nicht_dc & (idx >= 0) & (idx < bins)
    zaehl = np.bincount(idx[ok], minlength=bins)
    gsum = np.bincount(idx[ok], weights=gew[ok], minlength=bins)
    psum = np.bincount(idx[ok], weights=(gew * psd)[ok], minlength=bins)
    with np.errstate(invalid="ignore", divide="ignore"):
        mittel = np.where(zaehl >= 4, psum / gsum, np.nan)
    mitte = np.sqrt(kanten[:-1] * kanten[1:])
    s.reihe("frequenz_spektrum_radial", G, mitte, np.log10(mittel), "1/m", "log10 m^4", "radial gemittelte Leistungsdichte über der Wellenzahl (Zyklen je Meter)")

    # Steigung im Bereich 8 Zellen ... 1/4 der Rasterkante
    lo, hi = 4.0 / (min(ny, nx) * dx), 1.0 / (8.0 * dx)
    sel = np.isfinite(mittel) & (mitte >= lo) & (mitte <= hi) & (zaehl >= 6)
    if sel.sum() >= 4:
        steigung = np.polyfit(np.log10(mitte[sel]), np.log10(mittel[sel]), 1)[0]
        s.skalar("frequenz_spektrum_beta", -steigung, "1", G, "relativ", "mittel", "Spektralexponent β der Leistungsdichte ~ k^-β zwischen 8 Zellen und einem Viertel der Rasterkante (Gebirge ≈ 2–3; größer = glatter)")
    else:
        s.uebersprungen("frequenz_spektrum_beta: zu wenige Wellenzahlbänder")

    # --- Wellenlängenbänder ---
    laengen = sorted(par.wellenlaengen_m)
    kgrenzen = [1.0 / l for l in reversed(laengen)]  # aufsteigend in k
    band = np.digitize(k, kgrenzen)  # 0: Wellenlänge >= größte Grenze ... len: < kleinste Grenze
    summen = np.bincount(band[nicht_dc], weights=(gew * psd)[nicht_dc], minlength=len(laengen) + 1)
    n_b = len(laengen)
    for i in range(n_b + 1):
        if i == n_b:
            name, text = f"frequenz_anteil_lt_l{zahl(laengen[0])}m", f"Wellenlänge < {zahl(laengen[0])} m"
        elif i == 0:
            name, text = f"frequenz_anteil_ge_l{zahl(laengen[-1])}m", f"Wellenlänge ≥ {zahl(laengen[-1])} m"
        else:
            lo_l, hi_l = laengen[n_b - i - 1], laengen[n_b - i]
            name, text = f"frequenz_anteil_l{zahl(lo_l)}m_l{zahl(hi_l)}m", f"Wellenlänge {zahl(lo_l)} bis {zahl(hi_l)} m"
        s.skalar(name, summen[i] / gesamt, "1", G, "relativ", "mittel", f"Anteil der Höhenvarianz bei {text}")

    # --- Richtung und Artefakte (nur Ringe mit genug Zellen im Bereich der Steigung) ---
    ring_ok = ok & (zaehl[np.clip(idx, 0, bins - 1)] >= 24) & (k >= lo) & (k <= knyq)
    if ring_ok.sum() < 200:
        s.uebersprungen("frequenz: zu wenige Spektralzellen für Richtungs- und Spitzenmaße")
    else:
        ids = idx[ring_ok]
        w = gew[ring_ok]
        p_ring = psd[ring_ok]
        ring_mittel = np.bincount(ids, weights=w * p_ring, minlength=bins) / np.maximum(np.bincount(ids, weights=w, minlength=bins), 1e-300)
        verh = p_ring / ring_mittel[ids]
        theta = np.mod(np.arctan2(np.broadcast_to(ky, psd.shape), np.broadcast_to(kx, psd.shape))[ring_ok], math.pi)
        sektor = np.minimum((theta / (math.pi / _SEKTOREN)).astype(int), _SEKTOREN - 1)
        s_j = np.bincount(sektor, weights=w * verh, minlength=_SEKTOREN) / np.maximum(np.bincount(sektor, weights=w, minlength=_SEKTOREN), 1e-300)
        s.skalar("frequenz_anisotropie", float(s_j.std()), "1", G, "raeumlich", "mittel", "Streuung der auf den Ringmittelwert normierten Leistung über 16 Richtungssektoren (≈0,05 isotrop; größer = Vorzugsrichtung)")
        s.skalar("frequenz_hauptrichtung", math.degrees((s_j.argmax() + 0.5) * math.pi / _SEKTOREN), "°", G, "raeumlich", "mittel", "Richtung der größten Spektralleistung (Wellenvektor), 0° = Ost-West-Variation, 90° = Nord-Süd-Variation")
        ix_r = np.broadcast_to(np.arange(psd.shape[1])[None, :], psd.shape)[ring_ok]  # Frequenzindizes in Zellen je Rasterkante
        iy_r = np.broadcast_to(np.rint(np.fft.fftfreq(ny) * ny).astype(int)[:, None], psd.shape)[ring_ok]
        achse = (ix_r == 0) | (iy_r == 0)  # genau auf den Rasterachsen: dort bündeln sich Zeilen-/Spaltenartefakte
        diag = np.abs(ix_r) == np.abs(iy_r)  # genau auf den Diagonalen (D8-Vorzugsrichtungen)
        if diag.any():
            s.skalar("frequenz_diagonalenverhaeltnis", float((w * verh)[diag].sum() / w[diag].sum()), "1", G, "raeumlich", "mittel", "wie Achsenverhältnis, aber genau auf den Rasterdiagonalen (gleicher Frequenzindex in beiden Richtungen; D8-Vorzugsrichtungen)")
        if achse.any():
            s.skalar("frequenz_achsenverhaeltnis", float((w * verh)[achse].sum() / w[achse].sum()), "1", G, "raeumlich", "mittel", "mittlere auf den Ringmittelwert normierte Leistung genau auf den Rasterachsen (Frequenzindex 0 in einer Richtung; ≈1 isotrop, deutlich >1 = Zeilen-/Spaltenstreifen oder Gitterartefakt)")
        # Spitzen: Leistung weit über dem Ringmedian (Median einer Exponentialverteilung = ln 2 · Mittel)
        ordnung = np.lexsort((p_ring, ids))
        ids_s, p_s = ids[ordnung], p_ring[ordnung]
        beginn = np.searchsorted(ids_s, np.arange(bins), side="left")
        ende = np.searchsorted(ids_s, np.arange(bins), side="right")
        median = np.full(bins, np.nan)
        voll = ende > beginn
        median[voll] = p_s[beginn[voll] + (ende[voll] - beginn[voll]) // 2]
        norm = p_ring / (median[ids] / math.log(2.0))
        spitze = norm > par.spitzen_schwelle
        s.skalar("frequenz_spitzen_anzahl", float((spitze).sum()), "1", G, "raeumlich", "mittel", f"Spektralzellen, deren Leistung das {par.spitzen_schwelle:g}-fache des Ringmittels (aus dem Median) übersteigt; ≈0 bei Rauschen, >0 bei periodischen Mustern")
        s.skalar("frequenz_spitzen_anteil", float((w * p_ring)[spitze].sum() / (w * p_ring).sum()), "1", G, "raeumlich", "mittel", "Anteil der Leistung (im untersuchten Wellenzahlbereich) in solchen Spitzen")
        s.skalar("frequenz_spitzen_max", float(np.nanmax(norm)), "1", G, "raeumlich", "mittel", "größtes Verhältnis einer Spektralzelle zum Ringmittel (Rauschen ≈ 10–14)")

    # --- Autokorrelation ---
    acf2 = np.fft.irfft2(roh, s=(ny, nx))
    if acf2[0, 0] > 0:
        acf2 = acf2 / acf2[0, 0]
        ly = np.minimum(np.arange(ny), ny - np.arange(ny))
        lx = np.minimum(np.arange(nx), nx - np.arange(nx))
        rb = np.rint(np.hypot(ly[:, None], lx[None, :])).astype(np.int64)
        rmax = min(ny, nx) // 4
        sel2 = rb <= rmax
        cnt = np.bincount(rb[sel2], minlength=rmax + 1)
        acf_r = np.bincount(rb[sel2], weights=acf2[sel2], minlength=rmax + 1) / np.maximum(cnt, 1)
        lag = np.arange(rmax + 1) * dx
        s.reihe("frequenz_autokorrelation_radial", G, lag, acf_r, "m", "1", "radial gemittelte Autokorrelation der (ebenenbereinigten, gefensterten) Höhe über dem Abstand")
        unter = np.flatnonzero(acf_r <= 1.0 / math.e)
        if unter.size:
            i = int(unter[0])
            x0, x1, y0, y1 = lag[i - 1], lag[i], acf_r[i - 1], acf_r[i]
            laenge = x0 + (y0 - 1.0 / math.e) / (y0 - y1) * (x1 - x0)
            s.skalar("frequenz_autokorrelation_laenge", laenge, "m", G, "raeumlich", "mittel", "Korrelationslänge: Abstand, bei dem die Autokorrelation der Höhe auf 1/e fällt")
        else:
            s.uebersprungen("frequenz_autokorrelation_laenge: 1/e innerhalb eines Viertels der Rasterkante nicht erreicht")
        for l in par.lags_m:
            wert = float(np.interp(l, lag, acf_r)) if l <= lag[-1] else float("nan")
            s.skalar(f"frequenz_autokorrelation_l{zahl(l)}m", wert, "1", G, "raeumlich", "mittel", f"Autokorrelation der Höhe im Abstand {zahl(l)} m")
