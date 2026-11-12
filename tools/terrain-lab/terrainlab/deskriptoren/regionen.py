"""Gemeinsamer Unterbau für Prominenz und Senkenfüllung: Zerlegung des Rasters in Regionen des steilsten Anstiegs bzw. Abstiegs.

Beide Aufgaben (echte Schlüsselsattel-Prominenz, Füllung geschlossener Senken) sind topologisch dasselbe Problem auf der Höhenfläche:
Man zerlegt das Raster in Becken (alle Zellen, die auf steilstem Weg im selben lokalen Extremum enden), bestimmt je Beckenpaar die Passhöhe
und löst den Rest auf dem kleinen Beckengraphen statt auf allen Zellen. Das ist vektorisiert in NumPy/SciPy, ohne Python-Schleife über
Zellen; nur über Becken (typisch 1 bis 3 Prozent der Zellen).

Nachbarschaft ist immer die 8er-Nachbarschaft (Hauptachsen und Diagonalen). Ungültige Zellen (NaN) haben keine Nachbarn.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import ndimage

# (dy, dx) der acht Nachbarn; die Reihenfolge legt auch die Auflösung von Gleichständen fest (kleinster Index gewinnt).
NACHBARN = ((-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1))
_DY = np.array([n[0] for n in NACHBARN])
_DX = np.array([n[1] for n in NACHBARN])
_ABSTAND = np.hypot(_DY, _DX)
_ACHTER = np.ones((3, 3), dtype=int)


def steilste_richtung(z: np.ndarray, maske: np.ndarray, aufwaerts: bool) -> np.ndarray:
    """Index (0..7 in ``NACHBARN``) des Nachbarn mit dem größten Gefälle (``aufwaerts=False``) bzw. Anstieg; -1, wenn kein
    gültiger Nachbar strikt tiefer (höher) liegt. Gefälle = Höhenunterschied / Zellabstand, damit Diagonalen fair gewertet werden."""
    h, b = z.shape
    zz = np.where(maske, z, np.nan)
    if aufwaerts:
        zz = -zz
    zp = np.pad(zz, 1, constant_values=np.nan)
    beste = np.zeros((h, b))
    richtung = np.full((h, b), -1, dtype=np.int8)
    with np.errstate(invalid="ignore"):
        for k, (dy, dx) in enumerate(NACHBARN):
            nb = zp[1 + dy : 1 + dy + h, 1 + dx : 1 + dx + b]
            gefaelle = (zz - nb) / _ABSTAND[k]
            besser = gefaelle > beste  # NaN vergleicht falsch: ungültige Nachbarn fallen heraus
            beste = np.where(besser, gefaelle, beste)
            richtung[besser] = k
    richtung[~maske] = -1
    return richtung


def ziel_aus_richtung(richtung: np.ndarray) -> np.ndarray:
    """Flacher Zielindex je Zelle (Länge h*b); -1 dort, wo ``richtung`` -1 ist."""
    h, b = richtung.shape
    idx = np.arange(h * b, dtype=np.intp).reshape(h, b)
    r = richtung.ravel()
    ziel = np.full(h * b, -1, dtype=np.intp)
    ok = r >= 0
    ziel[ok] = idx.ravel()[ok] + _DY[r[ok]] * b + _DX[r[ok]]
    return ziel


def wurzeln(ziel: np.ndarray) -> np.ndarray:
    """Folgt den Zeigern bis zum Ende (Zeigerspringen, ~log2(Pfadlänge) Durchläufe). Zellen ohne Ziel zeigen auf sich selbst."""
    p = np.where(ziel >= 0, ziel, np.arange(ziel.size, dtype=np.intp))
    while True:
        p2 = p[p]
        if np.array_equal(p2, p):
            return p
        p = p2


@dataclass
class Becken:
    """Zerlegung in Becken: ``region`` je Zelle (-1 ungültig), Anzahl und Vertreterzelle je Region (erste Zelle in Zeilenfolge)."""

    region: np.ndarray  # (h, b) int32
    anzahl: int
    vertreter: np.ndarray  # (anzahl,) flacher Index
    marke: np.ndarray  # (h, b) int32: Beckenkern (Plateau der Extremzellen), 0 sonst


def zerlege(z: np.ndarray, maske: np.ndarray, aufwaerts: bool) -> Becken:
    """Becken des steilsten Anstiegs (Gipfel) bzw. Abstiegs (Senken). Plateaus gleichen Wertes ohne besseren Nachbarn bilden einen
    gemeinsamen Beckenkern, damit flache Gipfel und Senkenböden nicht in Einzelzellen zerfallen."""
    richtung = steilste_richtung(z, maske, aufwaerts)
    ziel = ziel_aus_richtung(richtung)
    kern = maske & (richtung == -1)
    marke, anzahl = ndimage.label(kern, structure=_ACHTER)
    wurzel = wurzeln(ziel)
    region = marke.ravel()[wurzel].astype(np.int32) - 1
    region[~maske.ravel()] = -1
    kern_idx = np.flatnonzero(kern.ravel())
    labels = marke.ravel()[kern_idx]
    _, erste = np.unique(labels, return_index=True)
    return Becken(region.reshape(z.shape), int(anzahl), kern_idx[erste], marke.astype(np.int32))


@dataclass
class Passkanten:
    """Je benachbartem Regionspaar (u < v) die beste Passhöhe und die beiden Zellen, über die sie läuft (cu in u, cv in v)."""

    u: np.ndarray
    v: np.ndarray
    hoehe: np.ndarray
    zelle_u: np.ndarray
    zelle_v: np.ndarray


def passkanten(z: np.ndarray, region: np.ndarray, anzahl: int, hoechste: bool) -> Passkanten:
    """Passhöhe zwischen benachbarten Regionen. ``hoechste=True`` (Gipfel): die Verbindung maximiert den niedrigeren der beiden
    Randwerte (höchster Übergang). ``hoechste=False`` (Senken): sie minimiert den höheren Randwert (tiefster Überlauf)."""
    h, b = z.shape
    flach_idx = np.arange(h * b, dtype=np.intp).reshape(h, b)
    teile = []
    for dy, dx in ((0, 1), (1, 0), (1, 1), (1, -1)):
        ys1, ys2 = slice(0, h - dy), slice(dy, h)
        if dx >= 0:
            xs1, xs2 = slice(0, b - dx), slice(dx, b)
        else:
            xs1, xs2 = slice(-dx, b), slice(0, b + dx)
        r1, r2 = region[ys1, xs1], region[ys2, xs2]
        auswahl = (r1 >= 0) & (r2 >= 0) & (r1 != r2)
        if not auswahl.any():
            continue
        z1, z2 = z[ys1, xs1][auswahl], z[ys2, xs2][auswahl]
        c1, c2 = flach_idx[ys1, xs1][auswahl], flach_idx[ys2, xs2][auswahl]
        r1, r2 = r1[auswahl], r2[auswahl]
        w = np.minimum(z1, z2) if hoechste else np.maximum(z1, z2)
        tausch = r1 > r2
        teile.append((np.where(tausch, r2, r1), np.where(tausch, r1, r2), w, np.where(tausch, c2, c1), np.where(tausch, c1, c2)))
    if not teile:
        leer = np.empty(0)
        return Passkanten(leer.astype(np.int64), leer.astype(np.int64), leer, leer.astype(np.intp), leer.astype(np.intp))
    u, v, w, cu, cv = (np.concatenate(t) for t in zip(*teile))
    schluessel = u.astype(np.int64) * (anzahl + 1) + v
    ordnung = np.lexsort((w, schluessel))
    schluessel, u, v, w, cu, cv = schluessel[ordnung], u[ordnung], v[ordnung], w[ordnung], cu[ordnung], cv[ordnung]
    neu = np.ones(schluessel.size, dtype=bool)
    neu[1:] = schluessel[1:] != schluessel[:-1]
    if hoechste:  # je Gruppe der letzte (größte) Wert
        wahl = np.ones(schluessel.size, dtype=bool)
        wahl[:-1] = neu[1:]
    else:
        wahl = neu
    return Passkanten(u[wahl].astype(np.int64), v[wahl].astype(np.int64), w[wahl], cu[wahl], cv[wahl])


@dataclass
class Gipfelliste:
    """Alle lokalen Maxima (Plateaus) mit echter Prominenz. Index = Region des steilsten Anstiegs."""

    zelle: np.ndarray  # flacher Index der Vertreterzelle
    hoehe: np.ndarray
    prominenz: np.ndarray
    sattel_hoehe: np.ndarray  # Höhe des Schlüsselsattels; für die Hauptgipfel einer Zusammenhangskomponente die Mindesthöhe
    sattel_zelle: np.ndarray  # flacher Index der tieferen Zelle des Schlüsselsattels, -1 beim Hauptgipfel
    eltern: np.ndarray  # Region des höchsten Gipfels der Gegenseite beim Tod des Gipfels (Persistenz-Elter), -1 beim Hauptgipfel
    nachbar: np.ndarray  # Region unmittelbar jenseits des Schlüsselsattels (Nachbarbecken), -1 beim Hauptgipfel


def prominenz_berechnen(z: np.ndarray, maske: np.ndarray) -> Gipfelliste:
    """Topographische Prominenz aller lokalen Maxima über die Schlüsselsättel.

    Vorgehen (Persistenz der Überschreitungsmengen): Becken des steilsten Anstiegs bilden die Knoten, die höchsten Übergänge zwischen
    Nachbarbecken die Kanten. Kanten werden von hoch nach tief abgearbeitet und Komponenten vereinigt; trifft eine Kante zwei
    verschiedene Komponenten, stirbt der niedrigere Gipfel dort. Seine Prominenz ist Gipfelhöhe minus Höhe dieser Kante (= Schlüsselsattel).
    Der höchste Gipfel jeder zusammenhängenden Fläche bekommt Gipfelhöhe minus tiefsten Wert der Fläche (Konvention für den Hauptgipfel).
    """
    becken = zerlege(z, maske, aufwaerts=True)
    n = becken.anzahl
    zf = z.ravel()
    hoehe = zf[becken.vertreter].copy()
    if n == 0:
        leer = np.empty(0)
        return Gipfelliste(becken.vertreter, leer, leer, leer, leer.astype(np.intp), leer.astype(np.int64), leer.astype(np.int64))
    kanten = passkanten(z, becken.region, n, hoechste=True)
    # tiefste Höhe je Region (für Hauptgipfel)
    region = becken.region.ravel()
    gueltig = region >= 0
    tief = np.full(n, np.inf)
    np.minimum.at(tief, region[gueltig], zf[gueltig])

    reihenfolge = np.argsort(-kanten.hoehe, kind="stable")
    ku, kv, kw = kanten.u[reihenfolge].tolist(), kanten.v[reihenfolge].tolist(), kanten.hoehe[reihenfolge].tolist()
    # Sattelzelle = tiefere der beiden Zellen der Kante
    cu, cv = kanten.zelle_u[reihenfolge], kanten.zelle_v[reihenfolge]
    tiefere = np.where(zf[cu] <= zf[cv], cu, cv).tolist()

    h = hoehe.tolist()
    elter = list(range(n))  # Union-Find-Zeiger
    spitze = list(range(n))  # höchster Gipfel der Komponente (Region)
    kmin = tief.tolist()
    prom = [0.0] * n
    sattel_h = [0.0] * n
    sattel_c = [-1] * n
    eltern = [-1] * n
    nachbar = [-1] * n

    def finde(a: int) -> int:
        while elter[a] != a:
            elter[a] = elter[elter[a]]
            a = elter[a]
        return a

    for i in range(len(kw)):
        ra, rb = finde(ku[i]), finde(kv[i])
        if ra == rb:
            continue
        pa, pb = spitze[ra], spitze[rb]
        # höherer Gipfel gewinnt; bei Gleichstand der mit dem kleineren Index (deterministisch)
        if (h[pa], -pa) > (h[pb], -pb):
            tot, lebt, rtot, rlebt = pb, pa, rb, ra
        else:
            tot, lebt, rtot, rlebt = pa, pb, ra, rb
        w = kw[i]
        prom[tot] = h[tot] - w
        sattel_h[tot] = w
        sattel_c[tot] = tiefere[i]
        eltern[tot] = lebt
        nachbar[tot] = ku[i] if ra == rlebt else kv[i]
        elter[rtot] = rlebt
        kmin[rlebt] = min(kmin[rlebt], kmin[rtot])
    for r in range(n):
        if finde(r) == r:  # Wurzel: Hauptgipfel seiner Fläche
            p = spitze[r]
            prom[p] = h[p] - kmin[r]
            sattel_h[p] = kmin[r]
    return Gipfelliste(
        becken.vertreter,
        hoehe,
        np.array(prom),
        np.array(sattel_h),
        np.array(sattel_c, dtype=np.intp),
        np.array(eltern, dtype=np.int64),
        np.array(nachbar, dtype=np.int64),
    )
