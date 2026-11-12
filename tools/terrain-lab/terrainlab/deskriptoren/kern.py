"""Datentypen der Gelände-Deskriptoren (WI-0250 Phase A2): Parameter, Metrik, Verteilung, Reihe und Metrikvektor.

Ein Metrikvektor ist bewusst kein undurchsichtiger Gesamtwert, sondern eine Liste benannter Einzelwerte (Name, Wert, Einheit, Gruppe) plus
die zugehörigen Verteilungen (als Quantilfunktion) und Reihen (z. B. radiales Spektrum). Jede Metrik trägt ihre Art:

- ``absolut``     physikalischer Wert in Metern, Grad usw.; hängt vom Reliefumfang des Ausschnitts ab.
- ``relativ``     auf den eigenen Wertebereich oder eine Länge normiert (Anteile, Verhältnisse, Exponenten); vergleicht Ausschnitte
                  unterschiedlicher Höhe.
- ``verteilung``  Kennwert einer Zellverteilung (Mittel, Quantil, Anteil über Schwelle); die Verteilung selbst steht in ``verteilungen``.
- ``raeumlich``   hängt von der räumlichen Anordnung ab (Gipfelabstände, Netzdichte, Spektrum, Autokorrelation), nicht nur von der
                  Häufigkeit der Werte.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field, fields
from pathlib import Path
from typing import Any

import numpy as np

FORMAT = "avesmaps-deskriptoren"
VERSION = 1

GRUPPEN = ("hoehe", "hang", "gipfel", "hydrologie", "frequenz")
GRUPPEN_TITEL = {
    "hoehe": "A Höhenverteilung",
    "hang": "B Hang und Relief",
    "gipfel": "C Gipfel und Kämme",
    "hydrologie": "D Hydrologie",
    "frequenz": "E Frequenz und Skalen",
}
ARTEN = ("absolut", "relativ", "verteilung", "raeumlich")
KOSTEN = ("gering", "mittel", "hoch")


@dataclass(frozen=True)
class Parameter:
    """Alle Längen in Metern; sie gelten für jede Zellgröße gleich. Zwei Metrikvektoren sind nur vergleichbar, wenn ihre Parameter gleich sind."""

    # Quadratische Fenster (Halbkante in Metern) für Relief, relative Höhe und Variation.
    fenster_radien_m: tuple[float, ...] = (250.0, 1000.0, 4000.0)
    # Fenster für das Vektor-Rauheitsmaß (VRM).
    rauheit_radien_m: tuple[float, ...] = (100.0, 500.0)
    # Vergröberungsfaktoren für die Hangneigung auf mehreren Skalen (Blockmittel).
    skalenfaktoren: tuple[int, ...] = (1, 2, 4, 8)
    # Prominenzstufen für Gipfeldichten und die Mindestprominenz „bedeutsamer“ Gipfel.
    prominenz_stufen_m: tuple[float, ...] = (50.0, 100.0, 250.0, 500.0, 1000.0)
    min_prominenz_m: float = 100.0
    # Mindest-Einzugsfläche, ab der eine Zelle zum Kamm- bzw. Gerinnenetz zählt (mindestens ``min_netz_zellen`` Zellen).
    netz_schwellen_m2: tuple[float, ...] = (100_000.0, 1_000_000.0)
    min_netz_zellen: int = 9
    # Einzugsgebiete, die kleiner sind, zählen nicht als eigenes Gebiet.
    einzugsgebiet_min_m2: float = 1_000_000.0
    # Geschlossene Senken flacher als dieser Wert gelten als Rundungsrauschen.
    senken_min_tiefe_m: float = 0.01
    # Abstände vom Kamm bzw. Gerinne für die Querprofile; Höhen über dem Gerinne für die Talbreite.
    quer_abstaende_m: tuple[float, ...] = (100.0, 250.0, 500.0, 1000.0, 2000.0)
    tal_hoehen_m: tuple[float, ...] = (25.0, 100.0, 250.0)
    # Eine Kammzelle muss quer zum Kamm mindestens so stark konvex sein (1/m, auf leicht geglättetem Gelände).
    kamm_kruemmung_min: float = 1e-4
    kamm_glaettung_zellen: float = 1.0
    # Wellenlängen-Bänder des Spektrums und Abstände (Lags) der Autokorrelation.
    wellenlaengen_m: tuple[float, ...] = (500.0, 2000.0, 8000.0)
    lags_m: tuple[float, ...] = (150.0, 500.0, 1500.0)
    # Eine Spektralzelle zählt als Spitze, wenn sie mehr als dieses Vielfache des Ringmittels (aus dem Median) hat.
    spitzen_schwelle: float = 20.0
    # Stützstellen der Quantilfunktion jeder Verteilung (Wasserstein-Abstand wird daraus bestimmt).
    verteilung_stuetzstellen: int = 512

    def als_dict(self) -> dict[str, Any]:
        return {f.name: (list(getattr(self, f.name)) if isinstance(getattr(self, f.name), tuple) else getattr(self, f.name)) for f in fields(self)}

    @classmethod
    def aus_dict(cls, d: dict[str, Any]) -> "Parameter":
        bekannt = {f.name for f in fields(cls)}
        return cls(**{k: (tuple(v) if isinstance(v, list) else v) for k, v in d.items() if k in bekannt})


def zahl(x: float) -> str:
    """Zahl für Metriknamen: 250 -> ``250``, 0.1 -> ``0.1``."""
    return f"{float(x):g}"


_FAMILIEN = (
    (re.compile(r"_(r|d|h|p|l)\d+(?:\.\d+)?m(?=_|$)"), r"_\1{N}m"),
    (re.compile(r"_a\d+(?:\.\d+)?km2(?=_|$)"), "_a{A}km2"),
    (re.compile(r"_f\d+(?=_|$)"), "_f{F}"),
    (re.compile(r"_b\d+(?=_|$)"), "_b{I}"),
)


def familie(name: str) -> str:
    """Name ohne Parameterwerte: ``hang_reliefenergie_mittel_r250m`` -> ``hang_reliefenergie_mittel_r{N}m``."""
    for muster, ersatz in _FAMILIEN:
        name = muster.sub(ersatz, name)
    return name


def _zahl_json(x: float) -> float | None:
    x = float(x)
    return x if math.isfinite(x) else None


def _aus_json(x: Any) -> float:
    return math.nan if x is None else float(x)


@dataclass(frozen=True)
class Metrik:
    name: str
    wert: float
    einheit: str
    gruppe: str
    art: str
    kosten: str
    beschreibung: str = ""

    @property
    def familie(self) -> str:
        return familie(self.name)

    def als_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "wert": _zahl_json(self.wert),
            "einheit": self.einheit,
            "gruppe": self.gruppe,
            "art": self.art,
            "kosten": self.kosten,
            "beschreibung": self.beschreibung,
        }


@dataclass(frozen=True)
class Verteilung:
    """Eindimensionale Zellverteilung als Quantilfunktion an den Stützstellen u = (i + 0.5) / n."""

    name: str
    einheit: str
    gruppe: str
    art: str
    anzahl: int
    quantile: np.ndarray
    beschreibung: str = ""

    def als_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "einheit": self.einheit,
            "gruppe": self.gruppe,
            "art": self.art,
            "anzahl": int(self.anzahl),
            "quantile": [_zahl_json(q) for q in self.quantile],
            "beschreibung": self.beschreibung,
        }


@dataclass(frozen=True)
class Reihe:
    """Eine Kurve y(x), z. B. das radiale Leistungsspektrum oder ein Querprofil."""

    name: str
    gruppe: str
    x: np.ndarray
    y: np.ndarray
    x_einheit: str
    y_einheit: str
    beschreibung: str = ""

    def als_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "gruppe": self.gruppe,
            "x": [_zahl_json(v) for v in self.x],
            "y": [_zahl_json(v) for v in self.y],
            "x_einheit": self.x_einheit,
            "y_einheit": self.y_einheit,
            "beschreibung": self.beschreibung,
        }


@dataclass
class Metrikvektor:
    metriken: list[Metrik] = field(default_factory=list)
    verteilungen: dict[str, Verteilung] = field(default_factory=dict)
    reihen: dict[str, Reihe] = field(default_factory=dict)
    kopf: dict[str, Any] = field(default_factory=dict)

    def __getitem__(self, name: str) -> float:
        for m in self.metriken:
            if m.name == name:
                return m.wert
        raise KeyError(name)

    def get(self, name: str, standard: float = math.nan) -> float:
        try:
            return self[name]
        except KeyError:
            return standard

    def namen(self) -> list[str]:
        return [m.name for m in self.metriken]

    def je_gruppe(self, gruppe: str) -> list[Metrik]:
        return [m for m in self.metriken if m.gruppe == gruppe]

    @property
    def zellgroesse_m(self) -> float:
        return float(self.kopf["zellgroesse_m"])

    @property
    def parameter(self) -> Parameter:
        return Parameter.aus_dict(self.kopf.get("parameter", {}))

    def als_dict(self) -> dict[str, Any]:
        return {
            "format": FORMAT,
            "version": VERSION,
            "kopf": self.kopf,
            "metriken": [m.als_dict() for m in self.metriken],
            "verteilungen": {k: v.als_dict() for k, v in self.verteilungen.items()},
            "reihen": {k: v.als_dict() for k, v in self.reihen.items()},
        }

    @classmethod
    def aus_dict(cls, d: dict[str, Any]) -> "Metrikvektor":
        if d.get("format") != FORMAT or d.get("version") != VERSION:
            raise ValueError(f"unbekanntes Deskriptorformat: {d.get('format')} v{d.get('version')}")
        metriken = [
            Metrik(m["name"], _aus_json(m["wert"]), m["einheit"], m["gruppe"], m["art"], m["kosten"], m.get("beschreibung", ""))
            for m in d["metriken"]
        ]
        verteilungen = {
            k: Verteilung(
                v["name"], v["einheit"], v["gruppe"], v["art"], int(v["anzahl"]),
                np.array([_aus_json(q) for q in v["quantile"]], dtype=np.float64), v.get("beschreibung", ""),
            )
            for k, v in d["verteilungen"].items()
        }
        reihen = {
            k: Reihe(
                v["name"], v["gruppe"], np.array([_aus_json(a) for a in v["x"]]), np.array([_aus_json(a) for a in v["y"]]),
                v["x_einheit"], v["y_einheit"], v.get("beschreibung", ""),
            )
            for k, v in d["reihen"].items()
        }
        return cls(metriken, verteilungen, reihen, d.get("kopf", {}))

    def schreibe(self, pfad: Path | str) -> Path:
        pfad = Path(pfad)
        pfad.parent.mkdir(parents=True, exist_ok=True)
        pfad.write_text(json.dumps(self.als_dict(), ensure_ascii=False, indent=1), encoding="utf-8")
        return pfad

    @classmethod
    def lies(cls, pfad: Path | str) -> "Metrikvektor":
        return cls.aus_dict(json.loads(Path(pfad).read_text(encoding="utf-8")))

    def tabelle(self, gruppen: tuple[str, ...] | None = None) -> str:
        """Lesbare Textübersicht: eine Zeile je Metrik, nach Gruppen geordnet."""
        zeilen: list[str] = []
        for gruppe in gruppen or GRUPPEN:
            ms = self.je_gruppe(gruppe)
            if not ms:
                continue
            zeilen.append(f"== {GRUPPEN_TITEL[gruppe]} ({len(ms)} Metriken) ==")
            breite = max(len(m.name) for m in ms)
            for m in ms:
                wert = "nan" if not math.isfinite(m.wert) else f"{m.wert:.6g}"
                zeilen.append(f"  {m.name:<{breite}}  {wert:>14} {m.einheit:<8} {m.art:<10} Kosten {m.kosten}")
        return "\n".join(zeilen)


class Sammler:
    """Baut einen Metrikvektor auf und prüft, dass Namen eindeutig sind und Art und Kosten zulässig."""

    def __init__(self, parameter: Parameter) -> None:
        self.parameter = parameter
        self.vektor = Metrikvektor()
        self._namen: set[str] = set()
        self.hinweise: list[str] = []

    def skalar(self, name: str, wert: float, einheit: str, gruppe: str, art: str, kosten: str, beschreibung: str = "") -> None:
        if name in self._namen:
            raise ValueError(f"Metrik doppelt: {name}")
        if gruppe not in GRUPPEN or art not in ARTEN or kosten not in KOSTEN:
            raise ValueError(f"ungültige Angabe bei {name}: {gruppe}/{art}/{kosten}")
        self._namen.add(name)
        self.vektor.metriken.append(Metrik(name, float(wert), einheit, gruppe, art, kosten, beschreibung))

    def verteilung(self, name: str, werte: np.ndarray, einheit: str, gruppe: str, art: str, beschreibung: str = "") -> None:
        """Legt die Quantilfunktion der endlichen Werte ab; ohne endliche Werte entfällt die Verteilung (mit Hinweis)."""
        v = np.asarray(werte, dtype=np.float64).ravel()
        v = v[np.isfinite(v)]
        if v.size == 0:
            self.hinweise.append(f"Verteilung {name}: keine gültigen Werte")
            return
        n = self.parameter.verteilung_stuetzstellen
        u = (np.arange(n) + 0.5) / n
        self.vektor.verteilungen[name] = Verteilung(name, einheit, gruppe, art, int(v.size), np.quantile(v, u), beschreibung)

    def reihe(self, name: str, gruppe: str, x: np.ndarray, y: np.ndarray, x_einheit: str, y_einheit: str, beschreibung: str = "") -> None:
        self.vektor.reihen[name] = Reihe(name, gruppe, np.asarray(x, dtype=np.float64), np.asarray(y, dtype=np.float64), x_einheit, y_einheit, beschreibung)

    def uebersprungen(self, text: str) -> None:
        self.hinweise.append(text)
