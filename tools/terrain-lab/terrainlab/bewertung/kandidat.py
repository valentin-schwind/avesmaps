"""Die drei Dimensionen für ein Ergebnis des Adapters (WI-0250 Phase A4).

Ein Aufruf bewertet **ein** Raster (eine Saat, einen Maßstab) in drei getrennten Dimensionen:

1. `d1` Plausibilität gegen die Referenzausschnitte des Typs in einer Rolle (`bewertung/plausibilitaet.py`),
2. `d2` Formerhalt gegen die Gebirgsdatei (`bewertung/formerhalt.py`),
3. `d3` Effizienz aus der `meta.json` (`bewertung/effizienz.py`).

Ein Gesamtwert entsteht nicht. `fasse_saaten` bildet die Kennzahlen über mehrere Saaten desselben Kandidaten (Mittel, Streuung).
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

import numpy as np

from terrainlab.deskriptoren import MassstabFehler
from terrainlab.raster import lies

from .effizienz import effizienz
from .formerhalt import FormFehler, Geometrie, bewerte_form, mittel_komponenten
from .plausibilitaet import Einstellungen, ReferenzSatz, bewerte_plausibilitaet, stufe_fuer_zellgroesse


@dataclass
class Kontext:
    """Was zu einem Gebirge gehört: der Typ, die gezeichnete Form und die Maßstäbe der Bewertung."""

    typ: str
    gebirge: str
    geometrie: Geometrie
    #: Mindestgrat des Typs aus der unveränderten Vorgabe (Anteil der Höchsthöhe): fest, nicht der Wert eines Kandidaten.
    grat_min: float | None
    #: Relief, auf das die Referenz gestreckt wird (Kammhöhe des Gebirges).
    relief_ziel_m: float


class Bewerter:
    def __init__(self, einst: Einstellungen, satz: ReferenzSatz | None = None) -> None:
        self.einst = einst
        self.satz = satz or ReferenzSatz(einst)

    def bewerte(self, ctx: Kontext, rolle: str, meta: dict[str, Any], ordner: Path) -> dict[str, Any]:
        """Die drei Dimensionen eines Adapterlaufs. `rolle` wählt die Referenzausschnitte (`optimierung` oder `validierung`)."""
        datei = meta["raster"]["dateien"][0]
        raster = lies(Path(ordner) / datei["datei"], pruefen=False)
        ergebnis: dict[str, Any] = {"rolle": rolle, "d3": effizienz(meta)}
        try:
            stufe = stufe_fuer_zellgroesse(raster.zellgroesse_m)
            refs = self.satz.faelle(ctx.typ, rolle, stufe, ctx.relief_ziel_m)
            ergebnis["d1"] = _kompakt_d1(bewerte_plausibilitaet(raster, refs, self.einst))
        except (MassstabFehler, KeyError, FileNotFoundError) as fehler:
            ergebnis["d1"] = {"leitwert": None, "fehler": str(fehler)}
        try:
            ergebnis["d2"] = bewerte_form(raster, ctx.geometrie, ctx.grat_min)
        except FormFehler as fehler:
            ergebnis["d2"] = {"leitwert": None, "komponenten": {}, "fehler": str(fehler)}
        return ergebnis


def _kompakt_d1(d1: dict[str, Any]) -> dict[str, Any]:
    """Was in die Datenbank kommt: ohne die vollen Posten der Referenzfälle."""
    aus = {k: v for k, v in d1.items() if k != "faelle"}
    aus["faelle"] = [
        {"referenz": f["referenz"], "rolle": f["rolle"], "relief_faktor": f["relief_faktor"], "leitwert": f["leitwert"], "arten": {a: f["arten"][a] for a in f["arten"]},
         "schlechteste": f["schlechteste"], "gruppen_w1": f["gruppen_w1"]}
        for f in d1.get("faelle", [])
    ]
    return aus


def fasse_saaten(messungen: Sequence[dict[str, Any]]) -> dict[str, Any]:
    """Kennzahlen eines Kandidaten über mehrere Saaten: Mittel und Streuung der Leitwerte, Komponenten des Formerhalts (Gipfel exakt: in jeder Saat)."""

    def reihe(pfad: tuple[str, ...]) -> list[float]:
        werte = []
        for m in messungen:
            x: Any = m
            for p in pfad:
                x = x.get(p) if isinstance(x, dict) else None
            if x is not None:
                werte.append(float(x))
        return werte

    def stat(werte: list[float]) -> dict[str, Any]:
        return {"n": len(werte), "mittel": float(np.mean(werte)) if werte else None, "streuung": float(np.std(werte, ddof=1)) if len(werte) > 1 else 0.0 if werte else None,
                "min": float(min(werte)) if werte else None, "max": float(max(werte)) if werte else None}

    leit1 = reihe(("d1", "leitwert"))
    leit2 = reihe(("d2", "leitwert"))
    arten = {a: stat(reihe(("d1", "arten", a))) for a in ("absolut", "relativ", "verteilung", "raeumlich")}
    return {
        "saaten": len(messungen),
        "d1": stat(leit1),
        "d1_arten": arten,
        "form": stat(leit2),
        "komponenten": mittel_komponenten([m["d2"]["komponenten"] for m in messungen if m.get("d2", {}).get("komponenten")]),
        "wall_ms": stat(reihe(("d3", "wall_ms"))),
        "cpu_ms": stat(reihe(("d3", "cpu_ms"))),
        "rss_mib": stat(reihe(("d3", "rss_spitze_mib"))),
        "zellen": int(messungen[0]["d3"]["zellen"]) if messungen else 0,
        "fehlend_d1": len(messungen) - len(leit1),
    }
