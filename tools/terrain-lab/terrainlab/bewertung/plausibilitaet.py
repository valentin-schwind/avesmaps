"""Dimension 1: geomorphologische Plausibilität (WI-0250 Phase A4).

Das erzeugte Raster wird mit den Deskriptoren (`terrainlab.deskriptoren`) gegen die realen Referenzausschnitte **desselben Typs im selben
Maßstab** verglichen (Zellweite 187,5 / 375 / 750 m). Die Rollen sind strikt getrennt: Die Suche sieht nur Ausschnitte der Rolle
`optimierung`, die Validierung nur `validierung`; ein Ausschnitt wechselt die Rolle nie.

**Kein Gesamtwert.** Jede Kennzahl (Einzelwert oder Verteilung) bekommt einen Abstand von 0 bis 1 zur Referenz:

- Einzelwert: symmetrische relative Abweichung `|a − b| / (|a| + |b| + Boden)` (0 gleich, 1 entgegengesetzt oder einer null; der Boden je
  Einheit ist der Rauschboden, `BODEN`);
- Verteilung: `W1 / (W1 + IQR_Referenz)` mit dem Wasserstein-Abstand `W1` in der Einheit der Metrik (0,5 heißt: um einen Interquartilsabstand
  der Referenz verschoben).

Die Abstände werden nach der **Art** der Kennzahl getrennt gemeldet (`absolut`, `relativ`, `verteilung`, `raeumlich`, wie im Katalog der
Deskriptoren) mit Median, 90. Perzentil, Maximum und den schlechtesten Einzelkennzahlen. Der **Leitwert** zum Ordnen von Kandidaten ist das
Mittel der Art-Mediane der in `leitwert_arten` genannten Arten (Vorgabe: relativ, verteilung, raeumlich), der Median über die Referenzfälle;
der schlechteste Referenzfall wird mitgemeldet (Ausreißer). Die Art `absolut` hängt vom Reliefumfang ab und bleibt außerhalb des Leitwerts.

Zwei Angleichungen machen den Vergleich fair, beide steht im Ergebnis:

- **Randband.** Das erzeugte Gebirge läuft an seinem Umriss auf 0 aus (es sitzt in einer Karte, die dort Land hat); `rand_m` Meter am Umriss
  bleiben ungewertet (Zellen werden NoData), die Referenz hat keinen solchen Rand.
- **Relief.** Mit `relief_angleichen` wird die Referenz senkrecht so gestreckt, dass ihr Relief der Kammhöhe des Gebirges gleicht
  (Faktor im Ergebnis). Formmaße vergleichen so Gebirge gleicher Höhe; Hänge in Grad werden nie auf 0 bis 1 normiert.

Nicht in der Wertung: Gruppe `frequenz` (NoData- und kantenempfindlich) und Maße, die nur Höhenlage und Flächengröße messen.
"""

from __future__ import annotations

import fnmatch
import hashlib
import json
import math
from dataclasses import dataclass, field, fields
from pathlib import Path
from typing import Any, Sequence

import numpy as np
from scipy import ndimage

from terrainlab import daten_wurzel
from terrainlab.deskriptoren import MassstabFehler, Metrikvektor, Parameter, berechne, vergleiche
from terrainlab.raster import Hoehenraster
from terrainlab.referenz import korpus

ARTEN = ("absolut", "relativ", "verteilung", "raeumlich")
STUFEN_M = {"30m": 30.0, "187_5m": 187.5, "375m": 375.0, "750m": 750.0}
#: Maße der Höhenlage und der Flächengröße: bei einem Formvergleich ohne Aussage.
HOEHENLAGE = ("hoehe", "hoehe_min", "hoehe_max", "hoehe_mittel", "hoehe_q??", "hoehe_flaeche", "hoehe_nodata_anteil")


@dataclass(frozen=True)
class Einstellungen:
    gruppen: tuple[str, ...] | None = None
    ohne_teuer: bool = False
    parameter: dict[str, Any] = field(default_factory=dict)
    rand_m: float = 1500.0
    ausschluss_gruppen: tuple[str, ...] = ("frequenz",)
    ausschluss_namen: tuple[str, ...] = HOEHENLAGE
    leitwert_arten: tuple[str, ...] = ("relativ", "verteilung", "raeumlich")
    relief_angleichen: bool = True
    min_zellen: int = 300

    def als_dict(self) -> dict[str, Any]:
        return {f.name: (list(getattr(self, f.name)) if isinstance(getattr(self, f.name), tuple) else getattr(self, f.name)) for f in fields(self)}

    @classmethod
    def aus_dict(cls, d: dict[str, Any] | None) -> "Einstellungen":
        d = d or {}
        bekannt = {f.name for f in fields(cls)}
        unbekannt = set(d) - bekannt
        if unbekannt:
            raise ValueError(f"Unbekannte Einstellungen der Plausibilität: {sorted(unbekannt)}")
        return cls(**{k: (tuple(v) if isinstance(v, list) else v) for k, v in d.items()})

    def deskriptor_parameter(self) -> Parameter:
        return Parameter.aus_dict(self.parameter)

    def ausgeschlossen(self, name: str, gruppe: str) -> bool:
        return gruppe in self.ausschluss_gruppen or any(fnmatch.fnmatchcase(name, m) for m in self.ausschluss_namen)


def stufe_fuer_zellgroesse(zellgroesse_m: float) -> str:
    """Name der Referenzstufe (`187_5m`, `375m`, `750m`, `30m`) zur Zellweite; sonst `MassstabFehler`."""
    for name, m in STUFEN_M.items():
        if math.isclose(zellgroesse_m, m, rel_tol=1e-3):
            return name
    raise MassstabFehler(f"Zellweite {zellgroesse_m:g} m hat keine Referenzstufe ({', '.join(STUFEN_M)}): das Gebirge ist für diesen Maßstab zu groß")


# --- Vorbereitung -------------------------------------------------------------------------------------------------------


def beschneide_rand(raster: Hoehenraster, rand_m: float) -> Hoehenraster:
    """Zellen näher als `rand_m` am Umriss (am Rand der Fläche oder an NoData) werden NoData."""
    k = int(round(rand_m / raster.zellgroesse_m))
    if k <= 0:
        return raster
    gueltig = ndimage.binary_erosion(np.isfinite(raster.hoehen), structure=np.ones((3, 3), bool), iterations=k, border_value=0)
    return Hoehenraster(np.where(gueltig, raster.hoehen, np.nan).astype(np.float32), raster.zellgroesse_m, raster.herkunft)


def strecke_relief(raster: Hoehenraster, relief_ziel_m: float) -> tuple[Hoehenraster, float]:
    """Die Höhen so strecken, dass das Relief (Maximum minus Minimum) `relief_ziel_m` beträgt; gibt auch den Faktor zurück."""
    h = raster.hoehen
    relief = float(np.nanmax(h) - np.nanmin(h))
    if not relief > 0 or not relief_ziel_m > 0:
        return raster, 1.0
    faktor = relief_ziel_m / relief
    return Hoehenraster(((h - np.nanmin(h)) * faktor).astype(np.float32), raster.zellgroesse_m, raster.herkunft), faktor


# --- Abstände -------------------------------------------------------------------------------------------------------------


#: Rauschboden je Einheit: Unterschiede darunter sind Rundung, kein Befund (0,02 % gegen 0 % steiler als 45° ist kein Maximalabstand).
BODEN = {"1": 0.01, "°": 0.5, "m": 1.0, "1/m": 1e-4, "km²": 0.01, "m²": 1e4, "1/km²": 1e-3, "km/km²": 1e-2, "log10 km²": 0.05}


def sra(a: float, b: float, boden: float = 0.0) -> float:
    """Symmetrische relative Abweichung `|a − b| / (|a| + |b| + boden)`, 0 bis 1; `boden` ist der Rauschboden der Einheit."""
    if not (math.isfinite(a) and math.isfinite(b)):
        return 1.0
    nenner = abs(a) + abs(b) + boden
    return 0.0 if nenner == 0 else abs(a - b) / nenner


def verteilungsabstand(w1: float, iqr: float) -> float:
    if not math.isfinite(w1):
        return 1.0
    if not iqr > 0:
        return 0.0 if w1 == 0 else 1.0
    return w1 / (w1 + iqr)


def _zusammenfassen(werte: Sequence[float]) -> dict[str, Any]:
    if not len(werte):
        return {"n": 0, "median": None, "p90": None, "max": None}
    a = np.asarray(werte, dtype=np.float64)
    return {"n": int(a.size), "median": float(np.median(a)), "p90": float(np.quantile(a, 0.9)), "max": float(a.max())}


def vergleiche_vektoren(referenz: Metrikvektor, erzeugt: Metrikvektor, einst: Einstellungen, ausreisser: int = 6) -> dict[str, Any]:
    """Abstand eines erzeugten Metrikvektors zur Referenz, getrennt nach Art; `MassstabFehler` bei ungleichem Maßstab."""
    v = vergleiche(referenz, erzeugt)
    posten: list[dict[str, Any]] = []
    for name, s in v.skalare.items():
        if einst.ausgeschlossen(name, s.gruppe) or s.art not in ARTEN or not math.isfinite(s.a):
            continue
        posten.append({"name": name, "art": s.art, "gruppe": s.gruppe, "form": "einzelwert", "einheit": s.einheit, "abstand": sra(s.a, s.b, BODEN.get(s.einheit, 0.0)), "referenz": s.a, "erzeugt": s.b})
    for name, d in v.verteilungen.items():
        if einst.ausgeschlossen(name, d.gruppe):
            continue
        art = referenz.verteilungen[name].art
        if art not in ARTEN:
            continue
        posten.append({"name": name, "art": art, "gruppe": d.gruppe, "form": "verteilung", "einheit": d.einheit, "abstand": verteilungsabstand(d.w1, d.skala),
                       "referenz": float(np.median(referenz.verteilungen[name].quantile)), "erzeugt": float(np.median(erzeugt.verteilungen[name].quantile))})
    arten = {art: _zusammenfassen([p["abstand"] for p in posten if p["art"] == art]) for art in ARTEN}
    medians = [arten[a]["median"] for a in einst.leitwert_arten if arten[a]["median"] is not None]
    schlechteste = sorted(posten, key=lambda p: -p["abstand"])[:ausreisser]
    reihen = {n: r.abstand for n, r in v.reihen.items() if not einst.ausgeschlossen(n, r.gruppe) and math.isfinite(r.abstand)}
    return {
        "leitwert": float(np.mean(medians)) if medians else None,
        "arten": arten,
        "schlechteste": [{k: (None if isinstance(x, float) and not math.isfinite(x) else x) for k, x in p.items()} for p in schlechteste],
        "gruppen_w1": {g: float(x) for g, x in v.gruppenabstand().items() if g not in einst.ausschluss_gruppen},
        "reihen_abstand": reihen,
        "posten": len(posten),
    }


# --- Referenzsatz -------------------------------------------------------------------------------------------------------


@dataclass
class ReferenzFall:
    id: str
    typ: str
    rolle: str
    stufe: str
    relief_faktor: float
    vektor: Metrikvektor


class ReferenzSatz:
    """Die Referenzausschnitte eines Typs je Rolle und Stufe, mit ihren Metrikvektoren (im Speicher und auf der Platte zwischengespeichert)."""

    def __init__(self, einst: Einstellungen, manifest: Path | str | None = None, daten: Path | str | None = None, cache: Path | str | None = None) -> None:
        self.einst = einst
        self.manifest = manifest
        self.daten = daten
        self.cache = Path(cache) if cache else daten_wurzel() / "cache" / "referenz-metrik"
        self._speicher: dict[tuple[str, str, int], ReferenzFall] = {}

    def ausschnitte(self, typ: str, rolle: str) -> list[dict[str, Any]]:
        return korpus.ausschnitte(typ=typ, rolle=rolle, manifest=self.manifest)

    def _schluessel(self, eintrag: dict[str, Any], stufe: str, relief_ziel_m: float | None) -> str:
        from terrainlab.lauf.cache import deskriptoren_quellhash, kanonisch

        sha = ((eintrag.get("raster") or {}).get(stufe) or {}).get("sha256", "")
        text = kanonisch({"id": eintrag["id"], "stufe": stufe, "sha": sha, "einst": self.einst.als_dict(), "relief": None if relief_ziel_m is None else round(relief_ziel_m, 1),
                          "quellen": deskriptoren_quellhash()})
        return hashlib.sha256(text.encode("utf-8")).hexdigest()[:24]

    def fall(self, eintrag: dict[str, Any], stufe: str, relief_ziel_m: float | None) -> ReferenzFall:
        relief = relief_ziel_m if self.einst.relief_angleichen else None
        schluessel = (eintrag["id"], stufe, 0 if relief is None else int(round(relief)))
        if schluessel in self._speicher:
            return self._speicher[schluessel]
        roh = korpus.lade_raster(eintrag["id"], stufe, manifest=self.manifest, daten=self.daten)
        faktor = 1.0
        if relief is not None:
            roh, faktor = strecke_relief(roh, relief)
        pfad = self.cache / f"{self._schluessel(eintrag, stufe, relief)}.json"
        if pfad.exists():
            vektor = Metrikvektor.lies(pfad)
        else:
            vektor = berechne(roh, self.einst.deskriptor_parameter(), self.einst.gruppen, not self.einst.ohne_teuer)
            vektor.schreibe(pfad)
        fall = ReferenzFall(eintrag["id"], eintrag["typ"], eintrag["rolle"], stufe, faktor, vektor)
        self._speicher[schluessel] = fall
        return fall

    def faelle(self, typ: str, rolle: str, stufe: str, relief_ziel_m: float | None = None) -> list[ReferenzFall]:
        liste = self.ausschnitte(typ, rolle)
        if not liste:
            raise KeyError(f"Kein Referenzausschnitt für Typ {typ} in der Rolle {rolle}")
        return [self.fall(e, stufe, relief_ziel_m) for e in liste]

    def streuung(self, typ: str, stufe: str, relief_ziel_m: float | None = None) -> dict[str, Any] | None:
        """Abstand der Optimierungs- zu den Validierungsausschnitten desselben Typs: so weit liegen zwei echte Gebirge desselben Typs auseinander."""
        opt, val = self.faelle(typ, "optimierung", stufe, relief_ziel_m), self.faelle(typ, "validierung", stufe, relief_ziel_m)
        if not opt or not val:
            return None
        ergebnisse = [vergleiche_vektoren(a.vektor, b.vektor, self.einst) for a in opt for b in val]
        leit = [e["leitwert"] for e in ergebnisse if e["leitwert"] is not None]
        return {
            "leitwert": float(np.median(leit)) if leit else None,
            "arten": {art: (float(np.median([e["arten"][art]["median"] for e in ergebnisse if e["arten"][art]["median"] is not None]))
                            if any(e["arten"][art]["median"] is not None for e in ergebnisse) else None) for art in ARTEN},
            "paare": [{"optimierung": a.id, "validierung": b.id} for a in opt for b in val],
        }


def bewerte_plausibilitaet(raster: Hoehenraster, referenzen: Sequence[ReferenzFall], einst: Einstellungen) -> dict[str, Any]:
    """Dimension 1 für ein erzeugtes Raster gegen die Referenzfälle (alle derselben Stufe); Median über die Fälle, Ausreißer mitgemeldet."""
    if not referenzen:
        raise ValueError("Keine Referenzfälle")
    stufe = stufe_fuer_zellgroesse(raster.zellgroesse_m)
    if any(r.stufe != stufe for r in referenzen):
        raise MassstabFehler(f"Referenz in Stufe {referenzen[0].stufe}, erzeugt in {stufe}")
    gewertet = beschneide_rand(raster, einst.rand_m)
    gueltig = int(np.isfinite(gewertet.hoehen).sum())
    if gueltig < einst.min_zellen:
        return {"leitwert": None, "fehler": f"nur {gueltig} gültige Zellen nach dem Randband (mindestens {einst.min_zellen})", "gueltige_zellen": gueltig}
    vektor = berechne(gewertet, einst.deskriptor_parameter(), einst.gruppen, not einst.ohne_teuer)
    faelle = []
    for r in referenzen:
        e = vergleiche_vektoren(r.vektor, vektor, einst)
        e.update(referenz=r.id, rolle=r.rolle, relief_faktor=r.relief_faktor)
        faelle.append(e)
    leit = [f["leitwert"] for f in faelle if f["leitwert"] is not None]
    schlechtester = max((f for f in faelle if f["leitwert"] is not None), key=lambda f: f["leitwert"], default=None)
    arten = {}
    for art in ARTEN:
        m = [f["arten"][art]["median"] for f in faelle if f["arten"][art]["median"] is not None]
        arten[art] = float(np.median(m)) if m else None
    return {
        "leitwert": float(np.median(leit)) if leit else None,
        "arten": arten,
        "schlechtester_fall": None if schlechtester is None else {"referenz": schlechtester["referenz"], "leitwert": schlechtester["leitwert"]},
        "faelle": faelle,
        "gueltige_zellen": gueltig,
        "stufe": stufe,
        "relief_m": float(np.nanmax(gewertet.hoehen) - np.nanmin(gewertet.hoehen)),
        "hinweise": vektor.kopf.get("hinweise", [])[:6],
    }
