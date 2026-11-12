"""Pareto-Ordnung (WI-0250 Phase A4): Kandidaten haben mehrere Ziele, keinen Gesamtwert.

Alle Ziele werden **minimiert** (Abstand, Formverlust, Zeit). Ein Punkt ``a`` dominiert ``b``, wenn er in keinem Ziel schlechter und in
mindestens einem besser ist. Fehlende Werte (NaN) sind das schlechteste Ergebnis und dominieren nie.
"""

from __future__ import annotations

import math
from typing import Sequence


def _schluessel(x: float) -> float:
    return math.inf if x is None or not math.isfinite(x) else float(x)


def dominiert(a: Sequence[float], b: Sequence[float], toleranz: Sequence[float] | None = None) -> bool:
    """``a`` dominiert ``b`` (alle Ziele minimiert). Mit ``toleranz`` je Ziel gilt ein Unterschied darunter als gleich (Messrauschen)."""
    if len(a) != len(b):
        raise ValueError("Zielvektoren verschieden lang")
    tol = list(toleranz) if toleranz is not None else [0.0] * len(a)
    besser = False
    for x, y, t in zip(a, b, tol):
        x, y = _schluessel(x), _schluessel(y)
        if x > y + t:
            return False
        if x < y - t:
            besser = True
    return besser


def pareto_raenge(punkte: Sequence[Sequence[float]], toleranz: Sequence[float] | None = None) -> list[int]:
    """Nicht-dominierte Sortierung: Rang 0 ist die Front, Rang 1 die Front ohne Rang 0, usw. (Reihenfolge der Eingabe bleibt)."""
    n = len(punkte)
    rang = [-1] * n
    offen = set(range(n))
    stufe = 0
    while offen:
        front = [i for i in offen if not any(dominiert(punkte[j], punkte[i], toleranz) for j in offen if j != i)]
        if not front:  # kann bei Toleranzen nicht sein; Sicherung gegen eine Endlosschleife
            front = list(offen)
        for i in front:
            rang[i] = stufe
        offen -= set(front)
        stufe += 1
    return rang


def front(punkte: Sequence[Sequence[float]], toleranz: Sequence[float] | None = None) -> list[int]:
    """Indizes der nicht dominierten Punkte."""
    return [i for i, r in enumerate(pareto_raenge(punkte, toleranz)) if r == 0]
