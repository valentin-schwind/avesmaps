"""Vergleich zweier Metrikvektoren (z. B. reales Referenzgelände gegen generiertes Gelände).

Bausteine für den späteren Vergleich real/generiert:

- Je Verteilung der Wasserstein-1-Abstand (Erdbewegungsabstand) in der Einheit der Metrik, dazu normiert auf die Streuung der Referenz
  (Interquartilsabstand von ``a``), damit Metriken verschiedener Einheit vergleichbar werden.
- Je Einzelwert die absolute und die relative Abweichung.
- Je Reihe (Spektrum, Querprofile, Autokorrelation) der mittlere absolute Abstand auf dem gemeinsamen x-Bereich.

Der Maßstab muss gleich sein: gleiche Zellgröße und gleiche Parameter (Fenster, Schwellen). Sonst ist der Vergleich bedeutungslos und
``MassstabFehler`` wird ausgelöst. Verschiedene Rasterkantenlängen sind zulässig, weil die Verteilungen größenunabhängig sind.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from terrainlab.raster import Hoehenraster

from .kern import GRUPPEN, GRUPPEN_TITEL, Metrikvektor, Parameter


class MassstabFehler(ValueError):
    """Zellgröße oder Parameter der beiden Metrikvektoren stimmen nicht überein."""


def wasserstein_quantile(qa: np.ndarray, qb: np.ndarray) -> float:
    """Wasserstein-1 aus zwei Quantilfunktionen an denselben Stützstellen u = (i + 0.5) / n: Mittel der absoluten Unterschiede."""
    qa, qb = np.asarray(qa, dtype=np.float64), np.asarray(qb, dtype=np.float64)
    if qa.shape != qb.shape:
        raise ValueError("Quantilfunktionen müssen gleich viele Stützstellen haben")
    return float(np.abs(qa - qb).mean())


def wasserstein_exakt(x: np.ndarray, y: np.ndarray) -> float:
    """Exakter Wasserstein-1-Abstand zweier empirischer Verteilungen beliebiger Stichprobengröße (NaN/inf werden ignoriert)."""
    x = np.sort(np.asarray(x, dtype=np.float64).ravel())
    y = np.sort(np.asarray(y, dtype=np.float64).ravel())
    x, y = x[np.isfinite(x)], y[np.isfinite(y)]
    n, m = x.size, y.size
    if n == 0 or m == 0:
        return float("nan")
    u = np.unique(np.concatenate([np.arange(1, n + 1) / n, np.arange(1, m + 1) / m]))
    u0 = np.concatenate([[0.0], u[:-1]])
    mitte = (u0 + u) / 2.0
    qx = x[np.minimum((mitte * n).astype(np.int64), n - 1)]
    qy = y[np.minimum((mitte * m).astype(np.int64), m - 1)]
    return float((np.abs(qx - qy) * (u - u0)).sum())


@dataclass
class VerteilungsAbstand:
    name: str
    gruppe: str
    einheit: str
    w1: float
    skala: float  # Interquartilsabstand der Referenz
    w1_norm: float  # w1 / skala; NaN, wenn die Referenz keine Streuung hat und w1 > 0


@dataclass
class SkalarAbweichung:
    name: str
    gruppe: str
    einheit: str
    art: str
    a: float
    b: float
    differenz: float  # b - a
    relativ: float  # (b - a) / |a|; NaN bei a == 0 und b != 0


@dataclass
class ReihenAbstand:
    name: str
    gruppe: str
    y_einheit: str
    abstand: float  # mittlerer absoluter Unterschied auf dem gemeinsamen x-Bereich
    punkte: int


@dataclass
class Vergleich:
    verteilungen: dict[str, VerteilungsAbstand] = field(default_factory=dict)
    skalare: dict[str, SkalarAbweichung] = field(default_factory=dict)
    reihen: dict[str, ReihenAbstand] = field(default_factory=dict)
    nur_in_a: list[str] = field(default_factory=list)
    nur_in_b: list[str] = field(default_factory=list)
    kopf: dict[str, Any] = field(default_factory=dict)

    def gruppenabstand(self) -> dict[str, float]:
        """Mittleres normiertes Wasserstein-Maß je Gruppe (nur endliche Werte); ein grober Wegweiser, kein Gesamtwert."""
        ergebnis: dict[str, float] = {}
        for g in GRUPPEN:
            werte = [v.w1_norm for v in self.verteilungen.values() if v.gruppe == g and math.isfinite(v.w1_norm)]
            if werte:
                ergebnis[g] = float(np.mean(werte))
        return ergebnis

    def als_dict(self) -> dict[str, Any]:
        def zahl(x: float) -> float | None:
            return x if math.isfinite(x) else None

        return {
            "kopf": self.kopf,
            "gruppenabstand": self.gruppenabstand(),
            "verteilungen": {k: {**v.__dict__, "w1": zahl(v.w1), "skala": zahl(v.skala), "w1_norm": zahl(v.w1_norm)} for k, v in self.verteilungen.items()},
            "skalare": {k: {**v.__dict__, "a": zahl(v.a), "b": zahl(v.b), "differenz": zahl(v.differenz), "relativ": zahl(v.relativ)} for k, v in self.skalare.items()},
            "reihen": {k: {**v.__dict__, "abstand": zahl(v.abstand)} for k, v in self.reihen.items()},
            "nur_in_a": self.nur_in_a,
            "nur_in_b": self.nur_in_b,
        }

    def tabelle(self, top: int = 12) -> str:
        zeilen = ["== Abstand je Gruppe (mittleres normiertes Wasserstein-Maß) =="]
        for g, w in self.gruppenabstand().items():
            zeilen.append(f"  {GRUPPEN_TITEL[g]:<28} {w:8.3f}")
        zeilen.append(f"== Verteilungen mit dem größten normierten Abstand (Top {top}) ==")
        endlich = [v for v in self.verteilungen.values() if math.isfinite(v.w1_norm)]
        for v in sorted(endlich, key=lambda t: -t.w1_norm)[:top]:
            zeilen.append(f"  {v.name:<40} W1 {v.w1:12.5g} {v.einheit:<8} normiert {v.w1_norm:8.3f}")
        return "\n".join(zeilen)


def _gleicher_massstab(a: Metrikvektor, b: Metrikvektor) -> None:
    za, zb = a.zellgroesse_m, b.zellgroesse_m
    if not math.isclose(za, zb, rel_tol=1e-6):
        raise MassstabFehler(f"Zellgrößen verschieden ({za:g} m gegen {zb:g} m): Raster zuerst auf denselben Maßstab bringen")
    pa, pb = a.kopf.get("parameter", {}), b.kopf.get("parameter", {})
    if Parameter.aus_dict(pa) != Parameter.aus_dict(pb):
        raise MassstabFehler("Parameter der Metrikvektoren verschieden (Fenster, Schwellen oder Stützstellen); Vektoren mit denselben Parametern berechnen")


def _reihe_abstand(xa: np.ndarray, ya: np.ndarray, xb: np.ndarray, yb: np.ndarray, log_x: bool) -> tuple[float, int]:
    ga, gb = np.isfinite(xa) & np.isfinite(ya), np.isfinite(xb) & np.isfinite(yb)
    if log_x:
        ga &= xa > 0
        gb &= xb > 0
    if ga.sum() < 2 or gb.sum() < 2:
        return float("nan"), 0
    xa, ya, xb, yb = xa[ga], ya[ga], xb[gb], yb[gb]
    lo, hi = max(xa.min(), xb.min()), min(xa.max(), xb.max())
    sel = (xa >= lo) & (xa <= hi)
    if sel.sum() < 2:
        return float("nan"), 0
    if log_x:
        yb_i = np.interp(np.log10(xa[sel]), np.log10(xb), yb)
    else:
        yb_i = np.interp(xa[sel], xb, yb)
    return float(np.abs(ya[sel] - yb_i).mean()), int(sel.sum())


def vergleiche(a: Metrikvektor, b: Metrikvektor) -> Vergleich:
    """Vergleicht ``b`` gegen die Referenz ``a`` (Normierung auf die Streuung von ``a``)."""
    _gleicher_massstab(a, b)
    erg = Vergleich(kopf={"zellgroesse_m": a.zellgroesse_m, "form_a": a.kopf.get("form"), "form_b": b.kopf.get("form")})
    for name, va in a.verteilungen.items():
        vb = b.verteilungen.get(name)
        if vb is None:
            erg.nur_in_a.append(name)
            continue
        w1 = wasserstein_quantile(va.quantile, vb.quantile)
        iqr = float(np.quantile(va.quantile, 0.75) - np.quantile(va.quantile, 0.25))
        if iqr > 0:
            norm = w1 / iqr
        else:
            norm = 0.0 if w1 == 0 else float("nan")
        erg.verteilungen[name] = VerteilungsAbstand(name, va.gruppe, va.einheit, w1, iqr, norm)
    erg.nur_in_b += [n for n in b.verteilungen if n not in a.verteilungen]
    vb_skalar = {m.name: m for m in b.metriken}
    for m in a.metriken:
        mb = vb_skalar.get(m.name)
        if mb is None:
            erg.nur_in_a.append(m.name)
            continue
        diff = mb.wert - m.wert
        if m.wert == 0:
            rel = 0.0 if mb.wert == 0 else float("nan")
        else:
            rel = diff / abs(m.wert)
        erg.skalare[m.name] = SkalarAbweichung(m.name, m.gruppe, m.einheit, m.art, m.wert, mb.wert, diff, rel)
    namen_a = {m.name for m in a.metriken}
    erg.nur_in_b += [m.name for m in b.metriken if m.name not in namen_a]
    for name, ra in a.reihen.items():
        rb = b.reihen.get(name)
        if rb is None:
            erg.nur_in_a.append(name)
            continue
        abstand, punkte = _reihe_abstand(ra.x, ra.y, rb.x, rb.y, log_x=name.startswith("frequenz_spektrum"))
        erg.reihen[name] = ReihenAbstand(name, ra.gruppe, ra.y_einheit, abstand, punkte)
    erg.nur_in_b += [n for n in b.reihen if n not in a.reihen]
    return erg


def vergleiche_raster(a: Hoehenraster, b: Hoehenraster, parameter: Parameter | None = None, gruppen: tuple[str, ...] | None = None, teuer: bool = True) -> Vergleich:
    """Berechnet beide Metrikvektoren (gleiche Parameter) und vergleicht sie; prüft vorher die Zellgröße."""
    from . import berechne

    if not math.isclose(a.zellgroesse_m, b.zellgroesse_m, rel_tol=1e-6):
        raise MassstabFehler(f"Zellgrößen verschieden ({a.zellgroesse_m:g} m gegen {b.zellgroesse_m:g} m)")
    return vergleiche(berechne(a, parameter, gruppen, teuer), berechne(b, parameter, gruppen, teuer))
