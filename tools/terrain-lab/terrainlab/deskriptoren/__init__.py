"""Gelände-Deskriptoren (WI-0250 Phase A2): wiederverwendbare Qualitätsmetriken für Höhenraster.

Einstieg: ``berechne(raster)`` liefert einen ``Metrikvektor`` (benannte Einzelwerte mit Einheit, Gruppe, Art und Kosten, dazu Verteilungen
als Quantilfunktion und Reihen wie das radiale Spektrum). ``vergleiche(a, b)`` bestimmt je Verteilung den Wasserstein-Abstand und je
Einzelwert die Abweichung; beide Raster müssen dieselbe Zellgröße und dieselben Parameter haben.

Gruppen: ``hoehe`` (A), ``hang`` (B), ``gipfel`` (C), ``hydrologie`` (D), ``frequenz`` (E). Dokumentation: ``docs/deskriptoren.md``.
Die Autorenimplementation von Argudo et al. (2025) ist C++ und diente als Quelle der Definitionen, nicht des Codes; siehe die Dokumentation.
"""

from __future__ import annotations

import time

from terrainlab.raster import Hoehenraster

from . import frequenz, gipfel, hang, hoehe, hydrologie
from .kern import GRUPPEN, Metrik, Metrikvektor, Parameter, Reihe, Sammler, Verteilung, familie
from .kontext import Kontext
from .vergleich import MassstabFehler, Vergleich, vergleiche, vergleiche_raster, wasserstein_exakt, wasserstein_quantile

__all__ = [
    "GRUPPEN",
    "MassstabFehler",
    "Metrik",
    "Metrikvektor",
    "Parameter",
    "Reihe",
    "Verteilung",
    "Vergleich",
    "berechne",
    "familie",
    "vergleiche",
    "vergleiche_raster",
    "wasserstein_exakt",
    "wasserstein_quantile",
]

_MODULE = {"hoehe": hoehe, "hang": hang, "gipfel": gipfel, "hydrologie": hydrologie, "frequenz": frequenz}


def berechne(raster: Hoehenraster, parameter: Parameter | None = None, gruppen: tuple[str, ...] | None = None, teuer: bool = True) -> Metrikvektor:
    """Berechnet den Metrikvektor eines Höhenrasters.

    ``gruppen`` wählt Gruppen (Standard: alle). ``teuer=False`` lässt die Metriken der Kostenklasse „hoch“ weg (Distanztransformationen: Kamm- und Talquerprofile, Talbreite).
    Die Reihenfolge der Gruppen ist fest, damit das Ergebnis reproduzierbar ist.
    """
    parameter = parameter or Parameter()
    auswahl = tuple(g for g in GRUPPEN if gruppen is None or g in gruppen)
    unbekannt = set(gruppen or ()) - set(GRUPPEN)
    if unbekannt:
        raise ValueError(f"unbekannte Gruppen: {sorted(unbekannt)}")
    sammler = Sammler(parameter)
    ctx = Kontext(raster, parameter, sammler, teuer)
    t0 = time.perf_counter()
    for gruppe in auswahl:
        _MODULE[gruppe].berechne(ctx)
    vektor = sammler.vektor
    vektor.kopf = {
        "zellgroesse_m": ctx.dx,
        "form": list(ctx.form),
        "gueltige_zellen": ctx.n_gueltig,
        "flaeche_km2": ctx.flaeche_km2,
        "gruppen": list(auswahl),
        "teuer": bool(teuer),
        "parameter": parameter.als_dict(),
        "herkunft": raster.herkunft,
        "hinweise": sammler.hinweise,
        "laufzeit_s": {k: round(v, 4) for k, v in ctx.zeiten.items()},
        "laufzeit_gesamt_s": round(time.perf_counter() - t0, 4),
    }
    return vektor
