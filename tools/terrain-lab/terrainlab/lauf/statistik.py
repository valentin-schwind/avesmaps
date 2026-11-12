"""Kennzahlen mehrerer Wiederholungen: Median und Streuung (WI-0250 Phase B)."""

from __future__ import annotations

import math
from typing import Any, Iterable

import numpy as np


def fasse(werte: Iterable[float], stellen: int = 1) -> dict[str, Any]:
    """Median, Spannweite und relative Streuung.

    ``streuung_prozent`` ist die mediane absolute Abweichung vom Median, bezogen auf den Median (robust gegen einen Ausreißer);
    ``spanne_prozent`` ist (Maximum − Minimum) / Median. Bei einem einzelnen Wert sind beide 0. Leere Eingabe: ``n`` 0, sonst None.
    """
    xs = np.asarray([w for w in werte if w is not None and math.isfinite(w)], dtype=np.float64)
    if xs.size == 0:
        return {"n": 0, "median": None, "min": None, "max": None, "mittel": None, "stdev": None, "streuung_prozent": None, "spanne_prozent": None}
    med = float(np.median(xs))
    mad = float(np.median(np.abs(xs - med)))
    rel = (lambda x: round(100.0 * x / med, 2)) if med != 0 else (lambda x: 0.0)
    return {
        "n": int(xs.size),
        "median": round(med, stellen),
        "min": round(float(xs.min()), stellen),
        "max": round(float(xs.max()), stellen),
        "mittel": round(float(xs.mean()), stellen),
        "stdev": round(float(xs.std(ddof=1)), stellen) if xs.size > 1 else 0.0,
        "streuung_prozent": rel(mad),
        "spanne_prozent": rel(float(xs.max() - xs.min())),
    }


def median(werte: Iterable[float]) -> float | None:
    return fasse(werte, 6)["median"]
