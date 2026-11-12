"""Dimension 2: redaktioneller Formerhalt (WI-0250 Phase A4).

Was der Redakteur zeichnet, muss im Ergebnis stehen: gesetzte Gipfel, Nebengipfel, Kämme und Täler der Fixture (Gebirgsdatei) gegen das
erzeugte Raster. Die Definitionen sind die des Generators und seiner Tests, hier in Python nachgebaut und mit ihren Quellen benannt:

- **Gipfel exakt** (`apps/server/test/support/gebirge-form.ts`, `tore`): die Zelle am gesetzten Punkt trägt genau die Höhe (Toleranz 1 m);
  ohne Höhe gilt die Kammhöhe. Ein Nebengipfel ohne eigene Höhe hat keine feste Sollhöhe (der Generator setzt eine Vorgabe aus Kammhöhe und
  Talboden); er zählt nur bei Kopf und Kuppe.
- **Kopf** (`findeKopf`): eine strikte Gipfelzelle (höher als alle acht Nachbarn in der Fläche) mit mindestens 1 m Prominenz im Umkreis von
  0,5 E um den Punkt. Prominenz über den Schlüsselsattel (absteigende Flutung, Umkreis 8 E).
- **Kuppe** (P1, `analyse.py`): Höhe am Punkt minus Mittel eines Rings von 1,5 E (16 Richtungen).
- **Kammrelief quer** („Grat“, `messeGrat` im Rückennetz und P1): je Probe alle 0,25 E auf einer gezeichneten Kante, ohne 1,5 E an den Enden
  und ohne den Randauslauf von 1,5 E, die Höhe auf der Kante minus das Mittel der Höhen 1,5 E quer zu beiden Seiten (Seiten nahe einer
  anderen Kante zählen nicht). Als Anteil der Höchsthöhe der Fläche verglichen mit dem Mindestgrat `gratMin` des Typs.
- **Lage der Kammachse** (P1): Abstand des höchsten Punkts im Querprofil (±1,5 E) von der gezeichneten Kante. Die Lage ist auf eine Zelle genau
  (das Raster kennt nichts Feineres): Als Abweichung zählt, was **über eine Zellweite der groben Vorschau (0,25 E)** hinausgeht, auch bei feinerer Auflösung,
  damit dieselbe Form bei 1×, 2× und 4× gleich bewertet wird.
- **Täler**: Flüsse der Fixture fließen talwärts (kein Anstieg über 1 m in Fließrichtung, `flussAnstieg`) und liegen tiefer als ihre Umgebung
  (Höhe 1 E quer zu beiden Seiten im Mittel mehr als 1 m höher); gesetzte Mulden liegen tiefer als der Ring von 1,5 E.

Alles in Karteneinheiten E (1 E = 3000 m), das Raster georeferenziert über `herkunft.grenzen_e` und `zellweite_e` (Zelle (i, j) liegt bei
`min + i · Zellweite`, Zeile 0 = Nord). Gemessen wird nur innerhalb der Fläche (NaN = außerhalb).

Es entsteht kein Gesamtwert. Die **Komponenten** (Anteile 0 bis 1) und ihr Mittel `leitwert` dienen dem Vergleich von Kandidaten; **hart**
ist das **Formtor** (`pruefe_tor`): Gipfel müssen exakt stehen, und kein Formmaß darf unter einen festen Anteil des Wertes der unveränderten
Vorgabe des Typs fallen. So schneidet ein statistisch glaubwürdiges Gebirge, das die gezeichneten Strukturen ignoriert, nie gut ab.
"""

from __future__ import annotations

import hashlib
import heapq
import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Sequence

import numpy as np
from scipy import ndimage

from terrainlab.raster import Hoehenraster

METER_JE_E = 3000.0
QUER_E = 1.5
RAND_E = 1.5
PROBEN_SCHRITT_E = 0.25
KOPF_REICH_E = 0.5
KOPF_UMKREIS_E = 8.0
KOPF_PROMINENZ_MIN_M = 1.0
HOEHEN_TOLERANZ_M = 1.0
TAL_SEITE_E = 1.0
TAL_TIEFE_MIN_M = 1.0
KAMMLAGE_TOLERANZ_E = 0.5
KAMMLAGE_FREI_E = 0.25
MIN_PROBEN = 4
MIN_FLUSS_PROBEN = 3
TOR_FAKTOR = 0.8


class FormFehler(ValueError):
    """Das Raster oder die Gebirgsdatei lässt sich nicht für den Formvergleich nutzen."""


@dataclass(frozen=True)
class Punkt:
    x: float
    y: float
    h: float | None


@dataclass
class Geometrie:
    """Was die Gebirgsdatei (Fixture) zeichnet, in Karteneinheiten."""

    name: str
    kammhoehe: float
    gipfel: list[Punkt]
    nebengipfel: list[Punkt]
    kaemme: list[list[tuple[float, float]]]
    flusse: list[dict[str, Any]]
    mulden: list[Punkt]
    quelle: str = ""
    sha256: str = ""
    raenge: list[str] = field(default_factory=list)

    def zaehlung(self) -> dict[str, int]:
        return {"gipfel": len(self.gipfel), "nebengipfel": len(self.nebengipfel), "kaemme": len(self.kaemme), "fluesse": len(self.flusse), "mulden": len(self.mulden)}


def _punkte(liste: Sequence[dict[str, Any]] | None) -> list[Punkt]:
    return [Punkt(float(p["x"]), float(p["y"]), None if p.get("h") in (None, 0) else float(p["h"])) for p in (liste or [])]


def lade_geometrie(pfad: Path | str) -> Geometrie:
    """Liest eine Gebirgsdatei (Form der Fixtures unter `apps/server/test/fixtures/rueckennetz/`: `input` mit `peaks`, `nebengipfel`, `kaemme`, `fluesse`)."""
    pfad = Path(pfad)
    roh = pfad.read_bytes()
    j = json.loads(roh.decode("utf-8"))
    eingabe = j.get("input")
    if not isinstance(eingabe, dict) or "regler" not in eingabe:
        raise FormFehler(f"{pfad}: kein Gebirge (input.regler erwartet)")
    kammhoehe = float(eingabe["regler"].get("maximalhoehe") or 1500.0)
    kaemme = [[(float(a), float(b)) for a, b in k["punkte"]] for k in eingabe.get("kaemme") or []]
    return Geometrie(
        name=str(j.get("name") or pfad.stem),
        kammhoehe=kammhoehe,
        gipfel=_punkte(eingabe.get("peaks")),
        nebengipfel=_punkte(eingabe.get("nebengipfel")),
        kaemme=kaemme,
        raenge=[str(k.get("rang", "")) for k in eingabe.get("kaemme") or []],
        flusse=[
            {"n": f.get("n", ""), "dir": f.get("dir"), "p": [(float(a), float(b)) for a, b in f["p"]]}
            for f in eingabe.get("fluesse") or []
            if len(f.get("p") or []) >= 2
        ],
        mulden=_punkte(eingabe.get("mulden")),
        quelle=str(pfad),
        sha256=hashlib.sha256(roh).hexdigest(),
    )


class Feld:
    """Ein Höhenraster mit Karteneinheiten: Zelle (Zeile, Spalte) liegt bei x = min_x + Spalte · Zellweite, y = min_y + (Höhe − 1 − Zeile) · Zellweite."""

    def __init__(self, raster: Hoehenraster) -> None:
        herkunft = raster.herkunft or {}
        grenzen, zelle, fenster = herkunft.get("grenzen_e"), herkunft.get("zellweite_e"), herkunft.get("fenster_e")
        self.h = raster.hoehen.astype(np.float64)
        self.hh, self.w = self.h.shape
        self.gueltig = np.isfinite(self.h)
        if isinstance(grenzen, dict) and zelle:
            self.cell = float(zelle)
            self.min_x, self.min_y = float(grenzen["min_x"]), float(grenzen["min_y"])
        elif isinstance(fenster, dict):
            # Endgelände: Fenster im Gitter der ganzen Karte (1024 E), Zelle (i, j) hat ihre Mitte bei (gx0 + i + ½) · Zellweite, y vom Norden gezählt.
            self.cell = 1024.0 / float(fenster["gitter"])
            self.min_x = (float(fenster["gx0"]) + 0.5) * self.cell
            self.min_y = 1024.0 - (float(fenster["gy0_nord"]) + self.hh - 1 + 0.5) * self.cell
        else:
            raise FormFehler("Das Raster trägt keine Georeferenz (herkunft.grenzen_e und zellweite_e, oder fenster_e); es stammt nicht aus dem Adapter")
        self.zellgroesse_m = float(raster.zellgroesse_m)

    def indizes(self, x: Any, y: Any) -> tuple[np.ndarray, np.ndarray]:
        """Zeile und Spalte der nächsten Zelle (wie `zelleAn` des Generators; Rundung .5 nach oben wie `Math.round`)."""
        i = np.floor((np.asarray(x, dtype=np.float64) - self.min_x) / self.cell + 0.5).astype(np.int64)
        j = np.floor((np.asarray(y, dtype=np.float64) - self.min_y) / self.cell + 0.5).astype(np.int64)
        return (self.hh - 1) - j, i

    def lies(self, x: Any, y: Any) -> np.ndarray:
        """Höhe der nächsten Zelle; NaN außerhalb des Rasters oder der Fläche."""
        zeile, spalte = self.indizes(x, y)
        drin = (zeile >= 0) & (zeile < self.hh) & (spalte >= 0) & (spalte < self.w)
        aus = np.full(np.shape(zeile), np.nan)
        z, s = np.clip(zeile, 0, self.hh - 1), np.clip(spalte, 0, self.w - 1)
        aus[drin] = self.h[z, s][drin]  # NaN bleibt NaN
        return aus

    def zelle(self, x: float, y: float) -> tuple[int, int] | None:
        zeile, spalte = self.indizes(x, y)
        z, s = int(zeile), int(spalte)
        if 0 <= z < self.hh and 0 <= s < self.w and self.gueltig[z, s]:
            return z, s
        return None

    def bilinear(self, x: Any, y: Any) -> np.ndarray:
        """Bilineare Höhe; NaN, wo eine der vier Nachbarzellen ungültig ist."""
        spalte = (np.asarray(x, dtype=np.float64) - self.min_x) / self.cell
        zeile = (self.hh - 1) - (np.asarray(y, dtype=np.float64) - self.min_y) / self.cell
        return ndimage.map_coordinates(self.h, [np.atleast_1d(zeile), np.atleast_1d(spalte)], order=1, mode="nearest")


# --- Kopf und Prominenz ----------------------------------------------------------------------------------------------------


def _ist_gipfelzelle(f: Feld, j: int, i: int) -> bool:
    v = f.h[j, i]
    j0, j1, i0, i1 = max(0, j - 1), min(f.hh, j + 2), max(0, i - 1), min(f.w, i + 2)
    block, ok = f.h[j0:j1, i0:i1], f.gueltig[j0:j1, i0:i1].copy()
    ok[j - j0, i - i0] = False
    return not bool(np.any(block[ok] >= v))


def prominenz(f: Feld, j0: int, i0: int, umkreis_zellen: float | None = None) -> float:
    """Prominenz einer Zelle (m) über den Schlüsselsattel: absteigende Flutung bis zu einer gleich hohen oder höheren Zelle; ohne eine solche
    (höchster Punkt der Fläche, oder Umkreis erreicht) zählt die tiefste erreichte Höhe."""
    spitze = f.h[j0, i0]
    besucht = np.zeros(f.h.shape, dtype=bool)
    besucht[j0, i0] = True
    haufen = [(-float(spitze), j0, i0)]
    pegel = float(spitze)
    r2 = None if umkreis_zellen is None else umkreis_zellen * umkreis_zellen
    h, ok, hh, w = f.h, f.gueltig, f.hh, f.w
    while haufen:
        hn, j, i = heapq.heappop(haufen)
        wert = -hn
        if wert >= spitze and (j, i) != (j0, i0):
            return float(spitze) - pegel
        pegel = min(pegel, wert)
        for dj in (-1, 0, 1):
            for di in (-1, 0, 1):
                jj, ii = j + dj, i + di
                if (dj == 0 and di == 0) or jj < 0 or ii < 0 or jj >= hh or ii >= w or besucht[jj, ii] or not ok[jj, ii]:
                    continue
                if r2 is not None and (jj - j0) ** 2 + (ii - i0) ** 2 > r2:
                    continue
                besucht[jj, ii] = True
                heapq.heappush(haufen, (-float(h[jj, ii]), jj, ii))
    return float(spitze) - pegel


def finde_kopf(f: Feld, j0: int, i0: int, reich_e: float = KOPF_REICH_E) -> dict[str, float] | None:
    """Der Kopf eines gesetzten Punkts: die eigene Zelle, wenn sie eine Gipfelzelle mit messbarer Prominenz ist, sonst die Gipfelzelle mit der
    größten Prominenz im Umkreis `reich_e`; `None`, wenn der Punkt auf einer Schulter oder Flanke steht."""
    reich = reich_e / f.cell
    umkreis = KOPF_UMKREIS_E / f.cell
    beste: dict[str, float] | None = None
    r = int(math.ceil(reich))
    kandidaten = [(j0, i0)] + [
        (j, i)
        for j in range(max(0, j0 - r), min(f.hh, j0 + r + 1))
        for i in range(max(0, i0 - r), min(f.w, i0 + r + 1))
        if (j, i) != (j0, i0) and math.hypot(j - j0, i - i0) <= reich
    ]
    for j, i in kandidaten:
        if not f.gueltig[j, i] or not _ist_gipfelzelle(f, j, i):
            continue
        p = prominenz(f, j, i, umkreis)
        if p >= KOPF_PROMINENZ_MIN_M and (beste is None or p > beste["prominenz"]):
            beste = {"prominenz": p, "hoehe": float(f.h[j, i]), "eigene_zelle": float((j, i) == (j0, i0))}
        if (j, i) == (j0, i0) and beste is not None:
            return beste  # die eigene Zelle zählt zuerst (wie findeKopf)
    return beste


# --- Gipfel, Nebengipfel, Mulden -------------------------------------------------------------------------------------------

_RING = [(1.5 * math.cos(w * math.pi / 8), 1.5 * math.sin(w * math.pi / 8)) for w in range(16)]


def kuppe(f: Feld, x: float, y: float) -> float | None:
    """Höhe am Punkt minus Mittel des Rings von 1,5 E (16 Richtungen); `None`, wenn weniger als die Hälfte des Rings in der Fläche liegt."""
    xs = np.array([x] + [x + dx for dx, _ in _RING])
    ys = np.array([y] + [y + dy for _, dy in _RING])
    w = f.bilinear(xs, ys)
    ring = w[1:][np.isfinite(w[1:])]
    if not np.isfinite(w[0]) or ring.size < 8:
        return None
    return float(w[0] - ring.mean())


def _fluss_zellen(f: Feld, fluesse: Sequence[dict[str, Any]]) -> set[tuple[int, int]]:
    zellen: set[tuple[int, int]] = set()
    for fluss in fluesse:
        p = fluss["p"]
        for (ax, ay), (bx, by) in zip(p[:-1], p[1:]):
            n = max(1, int(math.ceil(math.hypot(bx - ax, by - ay) / (f.cell * 0.05))))
            t = np.arange(n + 1) / n
            zeile, spalte = f.indizes(ax + (bx - ax) * t, ay + (by - ay) * t)
            for z, s in zip(zeile.tolist(), spalte.tolist()):
                if 0 <= z < f.hh and 0 <= s < f.w and f.gueltig[z, s]:
                    zellen.add((z, s))
    return zellen


def messe_gipfel(f: Feld, g: Geometrie) -> dict[str, Any]:
    """Gesetzte Gipfel und Nebengipfel in der Fläche: Höhe, Kopf und Kuppe."""
    gipfel_zellen: set[tuple[int, int]] = set()
    gipfel: list[dict[str, Any]] = []
    for p in g.gipfel:
        z = f.zelle(p.x, p.y)
        if z is None:
            continue
        gipfel_zellen.add(z)
        ziel = p.h if p.h and p.h > 0 else g.kammhoehe
        kopf = finde_kopf(f, *z)
        gipfel.append(
            {"x": p.x, "y": p.y, "ziel_m": ziel, "hoehe_m": float(f.h[z]), "exakt": abs(float(f.h[z]) - ziel) <= HOEHEN_TOLERANZ_M,
             "kopf": kopf is not None, "kopf_prominenz_m": kopf["prominenz"] if kopf else None, "kuppe_m": kuppe(f, p.x, p.y)}
        )
    lauf = _fluss_zellen(f, g.flusse)
    letzte: dict[tuple[int, int], int] = {}
    for n, p in enumerate(g.nebengipfel):
        z = f.zelle(p.x, p.y)
        if z is not None:
            letzte[z] = n
    neben: list[dict[str, Any]] = []
    for n, p in enumerate(g.nebengipfel):
        z = f.zelle(p.x, p.y)
        # Wie die Tore des Generators: außerhalb der Fläche, auf einem Flusslauf, auf einer Gipfelzelle oder überschrieben von einem späteren zählt nicht.
        if z is None or z in lauf or z in gipfel_zellen or letzte.get(z) != n:
            continue
        ziel = p.h if p.h and p.h > 0 else None
        kopf = finde_kopf(f, *z)
        neben.append(
            {"x": p.x, "y": p.y, "ziel_m": ziel, "hoehe_m": float(f.h[z]), "exakt": None if ziel is None else abs(float(f.h[z]) - ziel) <= HOEHEN_TOLERANZ_M,
             "kopf": kopf is not None, "kopf_prominenz_m": kopf["prominenz"] if kopf else None, "kuppe_m": kuppe(f, p.x, p.y)}
        )
    mulden: list[dict[str, Any]] = []
    for p in g.mulden:
        if f.zelle(p.x, p.y) is None:
            continue
        k = kuppe(f, p.x, p.y)
        if k is not None:
            mulden.append({"x": p.x, "y": p.y, "tiefe_m": -k, "tief": -k >= TAL_TIEFE_MIN_M})
    return {"gipfel": gipfel, "nebengipfel": neben, "mulden": mulden}


# --- Kammrelief und Lage der Kammachse --------------------------------------------------------------------------------------


def _abstand_zu_kanten(px: np.ndarray, py: np.ndarray, kanten: Sequence[Sequence[tuple[float, float]]]) -> np.ndarray:
    best = np.full(px.shape, np.inf)
    for punkte in kanten:
        for (ax, ay), (bx, by) in zip(punkte[:-1], punkte[1:]):
            l2 = (bx - ax) ** 2 + (by - ay) ** 2
            t = np.clip(((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / l2, 0, 1) if l2 > 0 else np.zeros(px.shape)
            best = np.minimum(best, np.hypot(px - ax - t * (bx - ax), py - ay - t * (by - ay)))
    return best


def _proben_entlang(kaemme: Sequence[Sequence[tuple[float, float]]], ohne_ende_e: float) -> list[tuple[int, float, float, float, float]]:
    proben: list[tuple[int, float, float, float, float]] = []
    for nr, punkte in enumerate(kaemme):
        gesamt = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(punkte[:-1], punkte[1:]))
        lauf = 0.0
        for (ax, ay), (bx, by) in zip(punkte[:-1], punkte[1:]):
            l = math.hypot(bx - ax, by - ay)
            if not l > 0:
                continue
            nx, ny = -(by - ay) / l, (bx - ax) / l
            u = 0.0
            while u < l:
                t = lauf + u
                if t >= ohne_ende_e and gesamt - t >= ohne_ende_e:
                    proben.append((nr, ax + (bx - ax) * u / l, ay + (by - ay) * u / l, nx, ny))
                u += PROBEN_SCHRITT_E
            lauf += l
    return proben


def messe_kamm(f: Feld, g: Geometrie, grat_min: float | None = None) -> dict[str, Any]:
    """Kammrelief quer (Grat) und Lage der Kammachse entlang der gezeichneten Kanten."""
    ergebnis: dict[str, Any] = {"zelle_e": f.cell, "kanten": len(g.kaemme), "proben": 0, "rand_proben": 0, "grat_median_m": None, "grat_mittel_m": None, "grat_anteil": None,
                                "grat_erhalt": None, "kammlage_median_e": None, "kammlage_p90_e": None, "je_kante": []}
    proben = _proben_entlang(g.kaemme, QUER_E)
    if not proben:
        return ergebnis
    nr = np.array([p[0] for p in proben])
    x, y = np.array([p[1] for p in proben]), np.array([p[2] for p in proben])
    nx, ny = np.array([p[3] for p in proben]), np.array([p[4] for p in proben])
    am_rand = np.zeros(x.shape, dtype=bool)
    for a in range(16):
        for rr in (0.5, 1.0, 1.5):
            if rr > RAND_E:
                continue
            am_rand |= ~np.isfinite(f.lies(x + rr * math.cos(a * math.pi / 8), y + rr * math.sin(a * math.pi / 8)))
    mitte = f.lies(x, y)
    seiten = []
    for v in (1.0, -1.0):
        sx, sy = x + v * nx * QUER_E, y + v * ny * QUER_E
        andere = np.full(x.shape, np.inf)  # Abstand zu allen ANDEREN Kanten je Probe
        for k, punkte in enumerate(g.kaemme):
            m = nr != k
            if m.any():
                andere[m] = np.minimum(andere[m], _abstand_zu_kanten(sx[m], sy[m], [punkte]))
        hoehe = f.lies(sx, sy)
        hoehe[andere < QUER_E] = np.nan
        seiten.append(hoehe)
    gut = ~am_rand & np.isfinite(mitte) & np.isfinite(seiten[0]) & np.isfinite(seiten[1])
    ergebnis["proben"] = int(gut.sum())
    ergebnis["rand_proben"] = int(am_rand.sum())
    if gut.sum() == 0:
        return ergebnis
    grat = (mitte - 0.5 * (seiten[0] + seiten[1]))[gut]
    hoechste = float(np.nanmax(f.h)) if f.gueltig.any() else 0.0
    bezug = hoechste if hoechste > 0 else 1.0
    ergebnis["grat_median_m"] = float(np.median(grat))
    ergebnis["grat_mittel_m"] = float(grat.mean())
    ergebnis["grat_anteil"] = float(np.median(grat) / bezug)
    if grat_min is not None and grat_min > 0 and gut.sum() >= MIN_PROBEN:
        ergebnis["grat_erhalt"] = float(min(1.0, max(0.0, np.median(grat) / bezug / grat_min)))
    for k in sorted({int(a) for a in nr[gut]}):
        m = gut & (nr == k)
        ergebnis["je_kante"].append({"kante": k, "proben": int(m.sum()), "grat_median_m": float(np.median((mitte - 0.5 * (seiten[0] + seiten[1]))[m]))})
    # Lage der Kammachse: Abstand des höchsten Punkts im Querprofil von der Kante.
    s = np.linspace(-QUER_E, QUER_E, 25)
    abstaende = []
    for idx in np.nonzero(gut)[0]:
        profil = f.bilinear(x[idx] + s * nx[idx], y[idx] + s * ny[idx])
        if np.isfinite(profil).sum() >= 13:
            abstaende.append(abs(float(s[int(np.nanargmax(profil))])))
    if abstaende:
        ergebnis["kammlage_median_e"] = float(np.median(abstaende))
        ergebnis["kammlage_p90_e"] = float(np.quantile(abstaende, 0.9))
    return ergebnis


# --- Täler -------------------------------------------------------------------------------------------------------------------


def fluss_anstieg(f: Feld, fluss: dict[str, Any]) -> float:
    """Größter Anstieg (m) entlang des Flusslaufs in Fließrichtung, im Abstand einer Zelle abgetastet (wie `flussAnstieg` des Generators)."""
    proben: list[float] = []
    p = fluss["p"]
    for (ax, ay), (bx, by) in zip(p[:-1], p[1:]):
        l = math.hypot(bx - ax, by - ay)
        if not l > 0:
            continue
        u = np.arange(0.0, l, f.cell)
        h = f.lies(ax + (bx - ax) * u / l, ay + (by - ay) * u / l)
        proben += [float(v) for v in h if math.isfinite(v)]
    if len(proben) < 2:
        return 0.0
    rueckwaerts = fluss.get("dir") == "reverse" or (fluss.get("dir") != "forward" and proben[0] < proben[-1])
    lauf = proben[::-1] if rueckwaerts else proben
    return float(max(0.0, max(b - a for a, b in zip(lauf[:-1], lauf[1:]))))


def messe_taeler(f: Feld, g: Geometrie) -> dict[str, Any]:
    """Flüsse: fließen sie talwärts, und liegen sie tiefer als ihre Umgebung?"""
    jeder: list[dict[str, Any]] = []
    for fluss in g.flusse:
        zeilen, spalten = f.indizes([a for a, _ in fluss["p"]], [b for _, b in fluss["p"]])
        drin = (zeilen >= 0) & (zeilen < f.hh) & (spalten >= 0) & (spalten < f.w)
        if not drin.any() or not any(f.gueltig[z, s] for z, s, d in zip(zeilen, spalten, drin) if d):
            continue
        proben = _proben_entlang([fluss["p"]], 0.0)
        tiefen = []
        if proben:
            x, y = np.array([p[1] for p in proben]), np.array([p[2] for p in proben])
            nx, ny = np.array([p[3] for p in proben]), np.array([p[4] for p in proben])
            mitte = f.lies(x, y)
            links = f.lies(x + nx * TAL_SEITE_E, y + ny * TAL_SEITE_E)
            rechts = f.lies(x - nx * TAL_SEITE_E, y - ny * TAL_SEITE_E)
            ok = np.isfinite(mitte) & np.isfinite(links) & np.isfinite(rechts)
            tiefen = (0.5 * (links + rechts) - mitte)[ok].tolist()
        anstieg = fluss_anstieg(f, fluss)
        jeder.append({"name": fluss.get("n", ""), "anstieg_m": anstieg, "faellt": anstieg <= HOEHEN_TOLERANZ_M, "proben": len(tiefen),
                      "tiefe_median_m": float(np.median(tiefen)) if len(tiefen) >= MIN_FLUSS_PROBEN else None})
    mit_tiefe = [e for e in jeder if e["tiefe_median_m"] is not None]
    return {
        "fluesse": jeder,
        "faellt_anteil": (sum(e["faellt"] for e in jeder) / len(jeder)) if jeder else None,
        "tal_anteil": (sum(e["tiefe_median_m"] >= TAL_TIEFE_MIN_M for e in mit_tiefe) / len(mit_tiefe)) if mit_tiefe else None,
        "anstieg_max_m": max((e["anstieg_m"] for e in jeder), default=None),
    }


# --- Zusammenfassung ----------------------------------------------------------------------------------------------------------

#: Komponenten des Formerhalts (Anteile 0 bis 1, größer ist besser). Der Leitwert ist ihr Mittel, nicht mehr.
KOMPONENTEN = ("gipfel_exakt", "gipfel_kopf", "neben_exakt", "neben_kopf", "grat", "kammlage", "fluss_faellt", "tal_tief", "mulde_tief")


def _anteil(liste: Sequence[dict[str, Any]], schluessel: str) -> float | None:
    """Anteil der Einträge, bei denen `schluessel` wahr ist (Einträge ohne Angabe zählen nicht mit)."""
    mit = [e for e in liste if e.get(schluessel) is not None]
    return float(sum(1 for e in mit if e[schluessel]) / len(mit)) if mit else None


def komponenten(gipfel: dict[str, Any], kamm: dict[str, Any], taeler: dict[str, Any]) -> dict[str, float | None]:
    lage = kamm.get("kammlage_median_e")
    if lage is not None:
        lage = max(0.0, lage - max(float(kamm.get("zelle_e", 0.0)), KAMMLAGE_FREI_E))  # bis eine grobe Zelle Abweichung ist die Auflösung der Vorschau, kein Fehler
    return {
        "gipfel_exakt": _anteil(gipfel["gipfel"], "exakt"),
        "gipfel_kopf": _anteil(gipfel["gipfel"], "kopf"),
        "neben_exakt": _anteil(gipfel["nebengipfel"], "exakt"),
        "neben_kopf": _anteil(gipfel["nebengipfel"], "kopf"),
        "grat": kamm.get("grat_erhalt"),
        "kammlage": None if lage is None else float(max(0.0, 1.0 - lage / KAMMLAGE_TOLERANZ_E)),
        "fluss_faellt": taeler.get("faellt_anteil"),
        "tal_tief": taeler.get("tal_anteil"),
        "mulde_tief": _anteil(gipfel["mulden"], "tief"),
    }


def bewerte_form(raster: Hoehenraster, geometrie: Geometrie, grat_min: float | None = None) -> dict[str, Any]:
    """Alle Formmaße eines Rasters gegen die Gebirgsdatei. `grat_min` ist der Mindestgrat des Typs (Anteil der Höchsthöhe), nach dem der
    Grat bewertet wird (fest, nicht der Wert eines Kandidaten)."""
    f = Feld(raster)
    g = messe_gipfel(f, geometrie)
    k = messe_kamm(f, geometrie, grat_min)
    t = messe_taeler(f, geometrie)
    comp = komponenten(g, k, t)
    werte = [v for v in comp.values() if v is not None]
    return {
        "zaehlung": geometrie.zaehlung(),
        "gipfel": g["gipfel"], "nebengipfel": g["nebengipfel"], "mulden": g["mulden"],
        "kamm": k, "taeler": t,
        "komponenten": comp,
        "leitwert": float(np.mean(werte)) if werte else None,
        "neben_kuppe_median_m": _median([e["kuppe_m"] for e in g["nebengipfel"] if e["kuppe_m"] is not None]),
        "neben_prominenz_median_m": _median([e["kopf_prominenz_m"] for e in g["nebengipfel"] if e["kopf_prominenz_m"] is not None]),
        "zellgroesse_m": f.zellgroesse_m,
    }


def _median(werte: Sequence[float]) -> float | None:
    return float(np.median(werte)) if len(werte) else None


# --- Formtor ------------------------------------------------------------------------------------------------------------------


def mittel_komponenten(liste: Sequence[dict[str, float | None]]) -> dict[str, float | None]:
    """Komponenten mehrerer Saaten: Mittel; Gipfel exakt zählt nur, wenn es in JEDER Saat stimmt (Minimum)."""
    aus: dict[str, float | None] = {}
    for name in KOMPONENTEN:
        w = [c[name] for c in liste if c.get(name) is not None]
        aus[name] = None if not w else (float(min(w)) if name == "gipfel_exakt" else float(np.mean(w)))
    return aus


def _de(x: float) -> str:
    return f"{x:.2f}".replace(".", ",")


def pruefe_tor(werte: dict[str, float | None], basis: dict[str, float | None], faktor: float = TOR_FAKTOR) -> tuple[bool, list[str]]:
    """Das Formtor (Mindestbedingung): Gipfel stehen exakt, und keine Komponente fällt unter `faktor` mal die der unveränderten Vorgabe.
    Fehlt eine Komponente (nichts zu messen), zählt sie nicht. Gibt (bestanden, Verstöße) zurück."""
    verstoesse: list[str] = []
    for name in KOMPONENTEN:
        w, b = werte.get(name), basis.get(name)
        if w is None:
            if b is not None:
                verstoesse.append(f"{name}: nicht messbar (Vorgabe {_de(b)})")
            continue
        if name == "gipfel_exakt":
            if w < 1.0 - 1e-9:
                verstoesse.append(f"gipfel_exakt: {_de(w)} statt 1")
        elif b is not None and w < faktor * b - 1e-9:
            verstoesse.append(f"{name}: {_de(w)} unter {faktor:.0%} der Vorgabe {_de(b)}")
    return not verstoesse, verstoesse
