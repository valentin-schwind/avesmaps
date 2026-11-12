"""Der Parameterraum eines Gebirgstyps (WI-0250 Phase A4): Parameter, Grenzen und Ausgangswerte kommen aus den Verträgen des Generators.

Gelesen wird die Ausgabe des Adapterbefehls ``scripts/dev/terrain-lab/grenzen.ts`` (``Adapter.grenzen``); hier steht keine Zahl abgeschrieben.
Drei Gruppen von Parametern, so wie „19 (Test)“ sie überlagert (``HoehenmodellTestWerte.presets.typen.<typ>``):

- ``v12.<wert>``  die zehn Regler der V12 (Hypsometrie, Plateau, Rauschen, …), ``GEBIRGS_WERT_GRENZEN``,
- ``netz.<id>``   die fünfzehn Typwerte des Rückennetzes (``form.breite``, ``band.ziel``, ``gratMin``, …), ``RUECKENNETZ_TYPWERTE``,
- ``muster``      das Grundmuster, diskret (``rauschen`` oder ``zellen``).

Ein Wert mit ``schritt`` 1 ist ganzzahlig (so prüft ``mitTest``), alle anderen sind stetig und werden auf das Raster ihres Schritts gelegt.
Für Suchverfahren wird jeder Parameter auf ``[0, 1]`` abgebildet (``einheit``/``wert``). **Ein Kandidat besteht nur aus Abweichungen von der
Vorgabe des Typs** (``kandidat``): Wer nichts ändert, ist die Vorgabe selbst und teilt ihre Rechnung und ihren Zwischenspeicher.
"""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass, field
from typing import Any, Iterable, Sequence

import numpy as np

STETIG, GANZ, WAHL = "stetig", "ganz", "wahl"


@dataclass(frozen=True)
class Parameter:
    name: str
    gruppe: str  # "v12" | "netz" | "muster"
    art: str  # STETIG | GANZ | WAHL
    basis: Any
    min: float = 0.0
    max: float = 1.0
    schritt: float = 0.0
    stufen: tuple[str, ...] = ()
    #: Kennung im Vertrag des Generators (``erosion``, ``form.breite``, ``muster``): so heißt der Wert in der Überlagerung.
    kennung: str = ""

    def wert(self, u: float) -> Any:
        """Wert zur Einheitskoordinate ``u`` in ``[0, 1]``."""
        u = min(1.0, max(0.0, float(u)))
        if self.art == WAHL:
            return self.stufen[min(int(u * len(self.stufen)), len(self.stufen) - 1)]
        roh = self.min + u * (self.max - self.min)
        if self.art == GANZ:
            return int(min(self.max, max(self.min, round(roh))))
        if self.schritt > 0:
            roh = self.min + round((roh - self.min) / self.schritt) * self.schritt
        return round(min(self.max, max(self.min, roh)), 10)

    def einheit(self, wert: Any) -> float:
        """Einheitskoordinate eines Werts (Mitte der Stufe bei einer Wahl)."""
        if self.art == WAHL:
            return (self.stufen.index(wert) + 0.5) / len(self.stufen)
        spanne = self.max - self.min
        return 0.0 if spanne == 0 else min(1.0, max(0.0, (float(wert) - self.min) / spanne))

    def gleich(self, a: Any, b: Any) -> bool:
        if self.art == WAHL:
            return a == b
        return math.isclose(float(a), float(b), rel_tol=0, abs_tol=1e-9)

    def als_dict(self) -> dict[str, Any]:
        return {"name": self.name, "gruppe": self.gruppe, "art": self.art, "basis": self.basis, "min": self.min, "max": self.max, "schritt": self.schritt,
                "stufen": list(self.stufen), "kennung": self.kennung}


@dataclass
class Raum:
    """Alle verstellbaren Parameter eines Typs, mit ihren Ausgangswerten."""

    typ: str
    parameter: list[Parameter] = field(default_factory=list)

    def __post_init__(self) -> None:
        self._index = {p.name: p for p in self.parameter}
        if len(self._index) != len(self.parameter):
            raise ValueError("Parameternamen doppelt")

    @property
    def namen(self) -> list[str]:
        return [p.name for p in self.parameter]

    def __getitem__(self, name: str) -> Parameter:
        return self._index[name]

    def __len__(self) -> int:
        return len(self.parameter)

    @classmethod
    def aus_grenzen(cls, grenzen: dict[str, Any], typ: str, ausschluss: Iterable[str] = ()) -> "Raum":
        """Der Raum eines Typs aus der Ausgabe von ``grenzen.ts``; ``ausschluss`` nimmt Parameter ganz heraus (Namen mit ``*`` als Muster)."""
        if typ not in grenzen["typen"]:
            raise KeyError(f"Typ {typ} gibt es im Stand nicht (vorhanden: {grenzen['typen']})")
        basis = grenzen["basis"][typ]
        werte = basis.get("werte")
        if werte is None:
            raise ValueError(f"Typ {typ}: die Fassung führt keine Presets")
        parameter: list[Parameter] = []
        for kennung in grenzen["v12"]["werte"]:
            g = grenzen["v12"]["grenzen"][kennung]
            parameter.append(Parameter(f"v12.{kennung}", "v12", GANZ if g["schritt"] == 1 else STETIG, werte[kennung], g["min"], g["max"], g["schritt"], kennung=kennung))
        for t in grenzen["rueckennetz"]:
            parameter.append(Parameter(f"netz.{t['id']}", "netz", GANZ if t["schritt"] == 1 else STETIG, basis["rueckennetz"][t["id"]], t["min"], t["max"], t["schritt"], kennung=t["id"]))
        parameter.append(Parameter("muster", "muster", WAHL, basis["muster"], stufen=tuple(grenzen["muster"]), kennung="muster"))
        import fnmatch

        raus = list(ausschluss)
        parameter = [p for p in parameter if not any(fnmatch.fnmatchcase(p.name, m) for m in raus)]
        return cls(typ, parameter)

    # --- Kandidaten ------------------------------------------------------------------------------------------------------

    def kandidat(self, einheiten: dict[str, float] | Sequence[float], aktiv: Sequence[str] | None = None, fest: dict[str, Any] | None = None) -> dict[str, Any]:
        """Der Kandidat zu Einheitskoordinaten: nur die **Abweichungen** von der Vorgabe. ``aktiv`` benennt die Parameter, die ``einheiten`` der Reihe nach setzt
        (Standard: alle); ``fest`` setzt weitere Parameter auf feste Werte (zum Beispiel ein erzwungenes Muster)."""
        namen = list(aktiv) if aktiv is not None else self.namen
        if not isinstance(einheiten, dict):
            if len(einheiten) != len(namen):
                raise ValueError(f"{len(einheiten)} Koordinaten für {len(namen)} Parameter")
            einheiten = dict(zip(namen, einheiten))
        aus: dict[str, Any] = {}
        for name, wert in (fest or {}).items():
            aus[name] = wert
        for name, u in einheiten.items():
            if name in aus:
                continue
            aus[name] = self[name].wert(u)
        return {n: w for n, w in aus.items() if not self[n].gleich(w, self[n].basis)}

    def vorgabe_einheiten(self, namen: Sequence[str] | None = None) -> list[float]:
        return [self[n].einheit(self[n].basis) for n in (namen or self.namen)]

    def einheiten_von(self, kandidat: dict[str, Any], namen: Sequence[str]) -> list[float]:
        return [self[n].einheit(kandidat.get(n, self[n].basis)) for n in namen]

    def pruefe(self, kandidat: dict[str, Any]) -> None:
        for name, wert in kandidat.items():
            p = self[name]
            if p.art == WAHL:
                if wert not in p.stufen:
                    raise ValueError(f"{name}: {wert!r} ist keine der Stufen {p.stufen}")
            elif not (p.min - 1e-9 <= float(wert) <= p.max + 1e-9):
                raise ValueError(f"{name}: {wert} liegt außerhalb {p.min}…{p.max}")
            elif p.art == GANZ and float(wert) != int(wert):
                raise ValueError(f"{name}: nur ganze Zahlen")

    def ueberlagerung(self, kandidat: dict[str, Any]) -> dict[str, Any] | None:
        """Die Überlagerung „19 (Test)“ (``rezept.ueberlagerung``) zu den Abweichungen eines Kandidaten; ``None`` für die Vorgabe selbst."""
        self.pruefe(kandidat)
        preset: dict[str, Any] = {}
        for name, wert in sorted(kandidat.items()):
            p = self[name]
            if p.gruppe == "v12":
                preset.setdefault("werte", {})[p.kennung] = wert
            elif p.gruppe == "netz":
                preset.setdefault("rueckennetz", {})[p.kennung] = wert
            else:
                preset["muster"] = wert
        return {"presets": {"typen": {self.typ: preset}}} if preset else None

    @staticmethod
    def schluessel(kandidat: dict[str, Any], variante: str = "") -> str:
        """Kennung eines Kandidaten: Hash über seine Abweichungen (und die Gebirgsvariante)."""
        text = json.dumps({"v": variante, "k": {k: kandidat[k] for k in sorted(kandidat)}}, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
        return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


# --- Verfahren zur Stichprobe -----------------------------------------------------------------------------------------------


def sobol(dimension: int, anzahl: int, seed: int) -> np.ndarray:
    """Quasizufällige Sobol-Folge (verwürfelt, mit festem Seed) im Einheitswürfel, ``anzahl`` Punkte; bei Zweierpotenzen ausgewogen."""
    from scipy.stats import qmc

    if dimension < 1:
        return np.zeros((anzahl, 0))
    s = qmc.Sobol(d=dimension, scramble=True, seed=seed)
    m = int(math.ceil(math.log2(max(anzahl, 1))))
    punkte = s.random_base2(m)  # die ersten Punkte einer Zweierpotenz-Folge: auch bei krummer Zahl gut verteilt
    return np.asarray(punkte[:anzahl], dtype=np.float64)


def morris_trajektorien(dimension: int, anzahl: int, stufen: int, seed: int) -> list[list[tuple[np.ndarray, int, float]]]:
    """Elementare-Effekte-Trajektorien nach Morris: je Trajektorie ``dimension + 1`` Punkte auf einem Gitter mit ``stufen`` Ebenen, Schritt
    ``Δ = stufen / (2 (stufen − 1))``. Rückgabe je Trajektorie: Liste von ``(Punkt, geänderter Parameter, vorzeichenbehafteter Schritt)``; der
    erste Eintrag ist der Startpunkt (Parameter −1, Schritt 0)."""
    if stufen < 2 or stufen % 2:
        raise ValueError("Morris braucht eine gerade Zahl von Ebenen (ab 2)")
    rng = np.random.default_rng(seed)
    delta = stufen / (2.0 * (stufen - 1))
    gitter = np.arange(stufen) / (stufen - 1)
    ergebnis = []
    for _ in range(anzahl):
        punkt = rng.choice(gitter, size=dimension) if dimension else np.zeros(0)
        spur = [(punkt.copy(), -1, 0.0)]
        for i in rng.permutation(dimension):
            hoch, runter = punkt[i] + delta <= 1 + 1e-9, punkt[i] - delta >= -1e-9
            schritt = delta if hoch and (not runter or rng.random() < 0.5) else -delta
            punkt = punkt.copy()
            punkt[i] = min(1.0, max(0.0, punkt[i] + schritt))
            spur.append((punkt, int(i), float(schritt)))
        ergebnis.append(spur)
    return ergebnis
