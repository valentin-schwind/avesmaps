"""Gemeinsamer Rechenkontext: teilt teure Zwischenergebnisse (Gradient, Fenstermaße, Fließnetze, Prominenz) zwischen den Metrikgruppen.

Alle Zwischenergebnisse werden erst bei Bedarf berechnet und genau einmal. NoData ist NaN; Ableitungen sind dort NaN, wo ihre 3x3-Umgebung
nicht vollständig gültig ist (also auch am Rasterrand). Fenstermaße über Quadrate (Halbkante ``r`` Zellen) werden aus den gültigen Zellen
des Fensters gebildet, wenn mindestens die Hälfte des Fensters gültig ist.
"""

from __future__ import annotations

import time
from contextlib import contextmanager
from dataclasses import dataclass
from functools import cached_property
from typing import Iterator

import numpy as np
from scipy import ndimage

from terrainlab.raster import Hoehenraster

from .fliess import Fliessnetz, fliessnetz
from .kern import Parameter, Sammler, zahl
from .regionen import Gipfelliste, prominenz_berechnen

MIN_ABDECKUNG = 0.5
# Flacher als dies (|Gradient|, entspricht 0,006 Grad) sind Krümmungsrichtungen nicht definiert.
MIN_GRADIENT = 1e-4


@dataclass
class Fenstermasse:
    maximum: np.ndarray
    minimum: np.ndarray
    mittel: np.ndarray
    std: np.ndarray


class Kontext:
    def __init__(self, raster: Hoehenraster, parameter: Parameter, sammler: Sammler, teuer: bool = True) -> None:
        z = raster.hoehen.astype(np.float64)
        self.maske = np.isfinite(z)
        z[~self.maske] = np.nan
        self.z = z
        self.dx = float(raster.zellgroesse_m)
        self.parameter = parameter
        self.sammler = sammler
        self.teuer = teuer
        self.zeiten: dict[str, float] = {}
        self._fenster: dict[int, Fenstermasse] = {}

    # ---------- Grundgrößen ----------
    @property
    def form(self) -> tuple[int, int]:
        return self.z.shape  # type: ignore[return-value]

    @cached_property
    def n_gueltig(self) -> int:
        return int(self.maske.sum())

    @cached_property
    def flaeche_km2(self) -> float:
        return self.n_gueltig * self.dx * self.dx / 1e6

    @cached_property
    def werte(self) -> np.ndarray:
        return self.z[self.maske]

    @cached_property
    def zmin(self) -> float:
        return float(self.werte.min()) if self.n_gueltig else float("nan")

    @cached_property
    def zmax(self) -> float:
        return float(self.werte.max()) if self.n_gueltig else float("nan")

    @property
    def relief(self) -> float:
        return self.zmax - self.zmin

    @contextmanager
    def zeit(self, name: str) -> Iterator[None]:
        t0 = time.perf_counter()
        try:
            yield
        finally:
            self.zeiten[name] = self.zeiten.get(name, 0.0) + (time.perf_counter() - t0)

    def netz_zellen(self, schwelle_m2: float) -> int:
        """Mindest-Einzugsfläche in Zellen für eine Schwelle in m²."""
        return max(self.parameter.min_netz_zellen, int(np.ceil(schwelle_m2 / (self.dx * self.dx))))

    def radien(self, liste_m: tuple[float, ...], beschreibung: str) -> list[tuple[float, int]]:
        """Fensterradien (Meter, Zellen); zu kleine fallen auf mindestens eine Zelle, doppelte und nicht passende entfallen mit Hinweis."""
        ergebnis: list[tuple[float, int]] = []
        gesehen: set[int] = set()
        for r_m in liste_m:
            r = max(1, int(round(r_m / self.dx)))
            if 2 * r + 1 > min(self.form):
                self.sammler.uebersprungen(f"{beschreibung} r{zahl(r_m)}m: Fenster ({2 * r + 1} Zellen) größer als das Raster")
                continue
            if r in gesehen:
                self.sammler.uebersprungen(f"{beschreibung} r{zahl(r_m)}m: gleiche Zellzahl wie ein kleinerer Radius")
                continue
            gesehen.add(r)
            ergebnis.append((r_m, r))
        return ergebnis

    # ---------- Fenster ----------
    def fenster(self, r: int) -> Fenstermasse:
        if r in self._fenster:
            return self._fenster[r]
        groesse = 2 * r + 1
        m = self.maske
        z0 = np.where(m, self.z - self.zmin, 0.0)
        mf = m.astype(np.float64)
        abdeckung = ndimage.uniform_filter(mf, size=groesse, mode="constant", cval=0.0)
        ok = m & (abdeckung >= MIN_ABDECKUNG)
        mx = ndimage.maximum_filter(np.where(m, self.z, -np.inf), size=groesse, mode="constant", cval=-np.inf)
        mn = ndimage.minimum_filter(np.where(m, self.z, np.inf), size=groesse, mode="constant", cval=np.inf)
        s1 = ndimage.uniform_filter(z0, size=groesse, mode="constant", cval=0.0)
        s2 = ndimage.uniform_filter(z0 * z0, size=groesse, mode="constant", cval=0.0)
        with np.errstate(invalid="ignore", divide="ignore"):
            mittel0 = s1 / abdeckung
            var = np.maximum(s2 / abdeckung - mittel0 * mittel0, 0.0)
        res = Fenstermasse(
            np.where(ok, mx, np.nan),
            np.where(ok, mn, np.nan),
            np.where(ok, mittel0 + self.zmin, np.nan),
            np.where(ok, np.sqrt(var), np.nan),
        )
        self._fenster[r] = res
        return res

    def fenster_mittel(self, feld: np.ndarray, r: int) -> np.ndarray:
        """Mittel eines Feldes (NaN = ungültig) im quadratischen Fenster, NaN-bewusst; NaN, wo weniger als die Hälfte des Fensters gültig ist."""
        groesse = 2 * r + 1
        g = np.isfinite(feld)
        s = ndimage.uniform_filter(np.where(g, feld, 0.0), size=groesse, mode="constant", cval=0.0)
        c = ndimage.uniform_filter(g.astype(np.float64), size=groesse, mode="constant", cval=0.0)
        with np.errstate(invalid="ignore", divide="ignore"):
            return np.where(g & (c >= MIN_ABDECKUNG), s / c, np.nan)

    # ---------- Ableitungen (3x3) ----------
    def nachbarn(self, feld: np.ndarray) -> tuple[np.ndarray, ...]:
        p = np.pad(feld, 1, constant_values=np.nan)
        h, b = feld.shape
        a, bb, c = p[0:h, 0:b], p[0:h, 1 : b + 1], p[0:h, 2 : b + 2]
        d, e, f = p[1 : h + 1, 0:b], p[1 : h + 1, 1 : b + 1], p[1 : h + 1, 2 : b + 2]
        g, hh, i = p[2 : h + 2, 0:b], p[2 : h + 2, 1 : b + 1], p[2 : h + 2, 2 : b + 2]
        return a, bb, c, d, e, f, g, hh, i

    def ableitungen(self, feld: np.ndarray | None = None, dx: float | None = None) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        """(p, q, r, t, s) = (zx, zy, zxx, zyy, zxy) mit x nach Osten und y nach Süden; p, q nach Horn (gewichtete 3x3-Differenz),
        zweite Ableitungen nach Evans/Young. Einheit: m/m bzw. 1/m."""
        z = self.z if feld is None else feld
        d = self.dx if dx is None else dx
        a, b, c, dd, e, f, g, h, i = self.nachbarn(z)
        p = ((c + 2 * f + i) - (a + 2 * dd + g)) / (8 * d)
        q = ((g + 2 * h + i) - (a + 2 * b + c)) / (8 * d)
        r = (dd - 2 * e + f) / (d * d)
        t = (b - 2 * e + h) / (d * d)
        s = (a - c - g + i) / (4 * d * d)
        return p, q, r, t, s

    @cached_property
    def _horn(self) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        return self.ableitungen()

    @cached_property
    def gradient(self) -> np.ndarray:
        """Betrag des Gradienten (dimensionslos, = tan der Neigung)."""
        p, q, *_ = self._horn
        return np.hypot(p, q)

    @cached_property
    def neigung_grad(self) -> np.ndarray:
        return np.degrees(np.arctan(self.gradient))

    @cached_property
    def kruemmung(self) -> tuple[np.ndarray, np.ndarray]:
        """(Profilkrümmung, Plankrümmung) in 1/m; positiv = konvex (Kuppe, Rücken), negativ = konkav (Mulde, Tal).
        Profil: in Fallrichtung; Plan: entlang der Höhenlinie. Nur wo der Gradient mindestens ``MIN_GRADIENT`` beträgt."""
        p, q, r, t, s = self._horn
        g2 = p * p + q * q
        ok = g2 >= MIN_GRADIENT**2
        with np.errstate(invalid="ignore", divide="ignore"):
            profil = -(p * p * r + 2 * p * q * s + q * q * t) / (g2 * (1.0 + g2) ** 1.5)
            plan = -(q * q * r - 2 * p * q * s + p * p * t) / g2**1.5
        return np.where(ok, profil, np.nan), np.where(ok, plan, np.nan)

    @cached_property
    def hesse_glatt(self) -> tuple[np.ndarray, np.ndarray]:
        """Kleinster und größter Eigenwert der Hesse-Matrix auf leicht geglättetem Gelände (1/m). Der kleinste (negativste) zeigt quer zum
        Kamm, der größte quer zum Gerinne."""
        sigma = self.parameter.kamm_glaettung_zellen
        if sigma > 0:
            m = self.maske.astype(np.float64)
            s = ndimage.gaussian_filter(np.where(self.maske, self.z - self.zmin, 0.0), sigma, mode="constant")
            c = ndimage.gaussian_filter(m, sigma, mode="constant")
            with np.errstate(invalid="ignore", divide="ignore"):
                glatt = np.where(self.maske & (c > 0.5), s / c + self.zmin, np.nan)
        else:
            glatt = self.z
        _, _, r, t, s2 = self.ableitungen(glatt)
        mitte = (r + t) / 2.0
        halb = np.sqrt(((r - t) / 2.0) ** 2 + s2 * s2)
        return mitte - halb, mitte + halb

    # ---------- teure gemeinsame Ergebnisse ----------
    @cached_property
    def abwaerts(self) -> Fliessnetz:
        with self.zeit("fliessnetz_abwaerts"):
            return fliessnetz(self.z, self.maske, konditioniert=True)

    @cached_property
    def aufwaerts(self) -> Fliessnetz:
        with self.zeit("fliessnetz_aufwaerts"):
            return fliessnetz(-self.z, self.maske, konditioniert=True)

    @cached_property
    def gipfel(self) -> Gipfelliste:
        with self.zeit("prominenz"):
            return prominenz_berechnen(self.z, self.maske)
