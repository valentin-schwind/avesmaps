"""Synthetische Testflächen mit bekannten Eigenschaften (Ebene, schiefe Ebene, Kegel, Kamm, Senken, Spektralsynthese, Gitterartefakt).

Dienen den Tests der Deskriptoren und der Laufzeitmessung; sie sind keine Geländegeneratoren für die Karte. Alle Funktionen sind
deterministisch (Seed) und liefern ``Hoehenraster`` mit der angegebenen Zellgröße.
"""

from __future__ import annotations

import math

import numpy as np

from terrainlab.raster import Hoehenraster


def _gitter(form: tuple[int, int], dx: float) -> tuple[np.ndarray, np.ndarray]:
    """Koordinaten (x nach Osten, y nach Süden = Zeilenrichtung) in Metern, Ursprung in der Zelle (0, 0)."""
    y, x = np.mgrid[0 : form[0], 0 : form[1]]
    return x * dx, y * dx


def ebene(form: tuple[int, int], dx: float, hoehe: float = 100.0) -> Hoehenraster:
    return Hoehenraster(np.full(form, hoehe, dtype=np.float32), dx, {"synthetisch": "ebene"})


def schiefe_ebene(form: tuple[int, int], dx: float, neigung_grad: float, richtung_grad: float = 0.0, z0: float = 0.0) -> Hoehenraster:
    """Ebene mit genau ``neigung_grad`` Gefälle; ``richtung_grad`` 0 = Höhe steigt nach Osten (Spaltenrichtung), 90 = nach Süden."""
    x, y = _gitter(form, dx)
    t = math.tan(math.radians(neigung_grad))
    r = math.radians(richtung_grad)
    z = z0 + t * (x * math.cos(r) + y * math.sin(r))
    return Hoehenraster(z.astype(np.float32), dx, {"synthetisch": "schiefe_ebene", "neigung_grad": neigung_grad})


def kegel(form: tuple[int, int], dx: float, hoehe: float, radius_m: float, mitte: tuple[float, float] | None = None, boden: float = 0.0) -> Hoehenraster:
    """Gerader Kegel auf ebenem Boden (Hang = atan(hoehe / radius_m)); ``mitte`` in Zellen (Zeile, Spalte)."""
    x, y = _gitter(form, dx)
    cy, cx = mitte if mitte is not None else ((form[0] - 1) / 2, (form[1] - 1) / 2)
    r = np.hypot(x - cx * dx, y - cy * dx)
    z = boden + np.maximum(0.0, hoehe * (1.0 - r / radius_m))
    return Hoehenraster(z.astype(np.float32), dx, {"synthetisch": "kegel"})


def zwei_kegel(form: tuple[int, int], dx: float, spitzen: tuple[tuple[float, float, float], tuple[float, float, float]], hang: float, boden: float = 0.0) -> Hoehenraster:
    """Zwei Kegel gleicher Hangneigung ``hang`` (Höhe je Meter); ``spitzen`` = ((zeile, spalte, höhe), (zeile, spalte, höhe)).
    Sattel zwischen den Spitzen auf der Verbindungslinie: (h1 + h2 - hang * Abstand) / 2."""
    x, y = _gitter(form, dx)
    z = np.full(form, boden, dtype=np.float64)
    for zeile, spalte, h in spitzen:
        z = np.maximum(z, boden + h - hang * np.hypot(x - spalte * dx, y - zeile * dx))
    return Hoehenraster(z.astype(np.float32), dx, {"synthetisch": "zwei_kegel"})


def kamm(form: tuple[int, int], dx: float, hoehe: float, flanke_neigung_grad: float, laengs_neigung_grad: float = 0.5) -> Hoehenraster:
    """Gerader Dachkamm entlang der Zeilenrichtung (Nord–Süd) in der Mitte der Spalten: z = hoehe - m |x - x0| + t * y.
    Die Kammachse steigt mit ``laengs_neigung_grad`` nach Süden (Zeilenrichtung)."""
    x, y = _gitter(form, dx)
    x0 = (form[1] // 2) * dx
    m = math.tan(math.radians(flanke_neigung_grad))
    t = math.tan(math.radians(laengs_neigung_grad))
    z = hoehe - m * np.abs(x - x0) + t * y
    return Hoehenraster(z.astype(np.float32), dx, {"synthetisch": "kamm", "flanke_grad": flanke_neigung_grad})


def plateau_mit_senken(form: tuple[int, int], dx: float, hoehe: float, senken: list[tuple[int, int, int, int, float]]) -> Hoehenraster:
    """Ebene auf ``hoehe`` mit rechteckigen Senken ``(zeile, spalte, höhe_zellen, breite_zellen, tiefe_m)``; die Ränder laufen nirgends ab,
    das Wasser steht bis zur Plateauhöhe."""
    z = np.full(form, hoehe, dtype=np.float64)
    for zeile, spalte, hz, bz, tiefe in senken:
        z[zeile : zeile + hz, spalte : spalte + bz] -= tiefe
    return Hoehenraster(z.astype(np.float32), dx, {"synthetisch": "plateau_mit_senken"})


def fbm(form: tuple[int, int], dx: float, beta: float = 2.6, relief_m: float = 1500.0, seed: int = 0, zentrum_m: float = 1000.0) -> Hoehenraster:
    """Isotrope Spektralsynthese: Leistungsdichte ~ k^-beta (beta ≈ 2 bis 3 wie bei Gebirgen), auf ``relief_m`` Spannweite skaliert."""
    rng = np.random.default_rng(seed)
    h, b = form
    ky = np.fft.fftfreq(h)[:, None]
    kx = np.fft.rfftfreq(b)[None, :]
    k = np.hypot(kx, ky)
    k[0, 0] = 1.0
    amplitude = k ** (-beta / 2.0)
    amplitude[0, 0] = 0.0
    spektrum = amplitude * (rng.normal(size=(h, b // 2 + 1)) + 1j * rng.normal(size=(h, b // 2 + 1)))
    z = np.fft.irfft2(spektrum, s=(h, b))
    z = (z - z.min()) / (z.max() - z.min()) * relief_m + zentrum_m
    return Hoehenraster(z.astype(np.float32), dx, {"synthetisch": "fbm", "beta": beta, "seed": seed})


def gitterartefakt(basis: Hoehenraster, periode_zellen: float, amplitude_m: float, achse: str = "x") -> Hoehenraster:
    """Überlagert eine Sinuswelle entlang einer Rasterachse (``x`` = Spalten, ``y`` = Zeilen) mit der Periode ``periode_zellen``
    (Terrassierungs- bzw. Rasterstreifen-Artefakt): im Spektrum eine einzelne Spitze auf der Achse."""
    h, b = basis.form
    y, x = np.mgrid[0:h, 0:b]
    lauf = x if achse == "x" else y
    z = basis.hoehen.astype(np.float64) + amplitude_m * np.sin(2 * np.pi * lauf / periode_zellen)
    return Hoehenraster(z.astype(np.float32), basis.zellgroesse_m, {"synthetisch": "gitterartefakt"})


def streifenartefakt(basis: Hoehenraster, amplitude_m: float, achse: str = "x", seed: int = 0) -> Hoehenraster:
    """Zufälliger Höhenversatz je Spalte (``achse="x"``) bzw. je Zeile (``"y"``), wie Abtaststreifen von Sensoren oder kachelweise
    Ausrichtungsfehler: im Spektrum Leistung entlang der gesamten Rasterachse."""
    h, b = basis.form
    rng = np.random.default_rng(seed)
    if achse == "x":
        versatz = rng.normal(0.0, amplitude_m, size=(1, b))
    else:
        versatz = rng.normal(0.0, amplitude_m, size=(h, 1))
    return Hoehenraster((basis.hoehen.astype(np.float64) + versatz).astype(np.float32), basis.zellgroesse_m, {"synthetisch": "streifen"})
