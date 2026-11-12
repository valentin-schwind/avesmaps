"""Stufe 1 der Optimierung: Sensitivität nach Morris (elementare Effekte), WI-0250 Phase A4.

Je Parameter wird gemessen, wie stark ein Schritt von zwei Dritteln seines Bereichs (``Δ = ebenen / (2 (ebenen − 1))`` auf einem Gitter mit
``ebenen`` Stufen) ein Ergebnis ändert, an mehreren zufälligen Startpunkten (Trajektorien). Gemeldet werden für jede Ausgabe

- ``mu_stern`` mittlerer Betrag der elementaren Effekte (die Stärke: je Einheit des Bereichs, bei gleicher Skala vergleichbar),
- ``mu`` mittlerer vorzeichenbehafteter Effekt (die Richtung),
- ``sigma`` Streuung (Wechselwirkung oder Nichtlinearität),

für die drei Ausgaben **Abstand zur Referenz** (`d1`), **Formverlust** (`form`, 1 − Leitwert des Formerhalts) und **Rechenzeit** (`zeit`, Sekunden).
Jede Trajektorie rechnet mit einer festen Saat (reihum aus den Saaten des Profils): Innerhalb einer Trajektorie ist die Rechnung deterministisch, ein
wirkungsloser Parameter hat also einen elementaren Effekt von **exakt 0**; über die Trajektorien mittelt die Saat sich heraus.

**Bestätigung.** Ein Parameter kann nur in bestimmten Kombinationen wirken (die Bergform nur, wo die Kammschärfe über null liegt): Fallen alle Schritte der wenigen Trajektorien zufällig
in die unwirksame Kombination, bleibt sein Effekt exakt 0. Darum wird jeder Parameter mit Effekt 0 **an der Vorgabe des Typs** noch einmal an beiden Enden seines Bereichs gerechnet (erste Saat); wirkt er dort,
gilt er als „bedingt wirksam“ und wird mit dieser Wirkung (Betrag der größten Änderung je ganzen Bereich) eingeordnet. „Wirkungslos“ heißt: exakt null in jedem Schritt **und** an der Vorgabe.

Wirkungslose Parameter und schwache (beide Wirkungen unter ``schwelle`` des größten Werts) fallen aus dem Suchraum; höchstens ``max_aktiv`` bleiben. Der Raum der Suche ist damit kleiner, ohne dass jemand
geraten hat, was wirkt.
"""

from __future__ import annotations

import math
from typing import Any, Callable

import numpy as np

from .auswerter import Auswerter
from .raum import Raum, morris_trajektorien

AUSGABEN = ("d1", "form", "zeit")


def _ausgaben(werte: dict[str, Any] | None) -> tuple[float, float, float]:
    if werte is None:
        return (math.nan, math.nan, math.nan)
    d1 = (werte.get("d1") or {}).get("leitwert")
    form = (werte.get("d2") or {}).get("leitwert")
    zeit = (werte.get("d3") or {}).get("wall_ms")
    return (math.nan if d1 is None else float(d1), math.nan if form is None else 1.0 - float(form), math.nan if zeit is None else float(zeit) / 1000.0)


def morris(aus: Auswerter, typ: str, raum: Raum, aktiv: list[str], einstellungen: dict[str, Any], saaten: list[int | None], melde: Callable[[str], None] = lambda t: None) -> dict[str, Any]:
    """Elementare Effekte aller ``aktiv`` genannten Parameter (Auflösung 1×, Rolle Optimierung, Fixture mit gezeichneten Kämmen)."""
    r, ebenen = int(einstellungen["trajektorien"]), int(einstellungen["ebenen"])
    spuren = morris_trajektorien(len(aktiv), r, ebenen, int(einstellungen.get("seed", 1)))
    effekte: dict[str, dict[str, list[float]]] = {n: {a: [] for a in AUSGABEN} for n in aktiv}
    ungueltig = 0
    for t, spur in enumerate(spuren):
        saat = saaten[t % len(saaten)]
        zuvor: tuple[float, float, float] | None = None
        for punkt, i, schritt in spur:
            kand = raum.kandidat(punkt, aktiv)
            y = _ausgaben(aus.messe(typ, kand, 1, saat, herkunft="morris"))
            if i >= 0 and zuvor is not None:
                for k, a in enumerate(AUSGABEN):
                    if math.isfinite(y[k]) and math.isfinite(zuvor[k]):
                        effekte[aktiv[i]][a].append((y[k] - zuvor[k]) / schritt)
                    else:
                        ungueltig += 1
            zuvor = y
        melde(f"  Trajektorie {t + 1}/{r} (Saat {aus.profil.saat_name(saat)}) fertig")
    tabelle: dict[str, Any] = {}
    basis_y = _ausgaben(aus.messe(typ, {}, 1, saaten[0], herkunft="morris-bestaetigung"))
    for n in aktiv:
        zeile: dict[str, Any] = {"n": len(effekte[n]["d1"])}
        for a in AUSGABEN:
            ee = np.asarray(effekte[n][a], dtype=np.float64)
            zeile[a] = {"mu_stern": float(np.abs(ee).mean()) if ee.size else None, "mu": float(ee.mean()) if ee.size else None,
                        "sigma": float(ee.std(ddof=1)) if ee.size > 1 else (0.0 if ee.size else None)}
        zeile["exakt_null"] = bool(effekte[n]["d1"]) and all(abs(x) < 1e-12 for a in ("d1", "form") for x in effekte[n][a])
        zeile["bestaetigung"] = None
        if zeile["exakt_null"]:
            # An der Vorgabe beide Enden des Bereichs: Wirkt der Parameter dort, ist er nur bedingt wirksam (Wechselwirkung), nicht wirkungslos.
            delta = {"d1": 0.0, "form": 0.0}
            for u in (0.0, 1.0):
                kand = raum.kandidat({n: u}, [n])
                y = basis_y if not kand else _ausgaben(aus.messe(typ, kand, 1, saaten[0], herkunft="morris-bestaetigung"))
                for k, a in enumerate(("d1", "form")):
                    if math.isfinite(y[k]) and math.isfinite(basis_y[k]):
                        delta[a] = max(delta[a], abs(y[k] - basis_y[k]))
            zeile["bestaetigung"] = {**delta, "wirkt": bool(max(delta.values()) > 1e-12)}
        tabelle[n] = zeile
    return {"trajektorien": r, "ebenen": ebenen, "parameter": tabelle, "ungueltige_effekte": ungueltig, "saaten": [aus.profil.saat_name(s) for s in saaten], "aktiv_vorher": list(aktiv)}


def waehle_aktiv(ergebnis: dict[str, Any], schwelle: float, max_aktiv: int) -> dict[str, Any]:
    """Ordnet die Parameter nach ihrer Wirkung und trifft die Auswahl für die Suche. Ergänzt ``ergebnis`` um ``klasse`` je Parameter und ``aktiv``."""
    tab = ergebnis["parameter"]
    maxima = {a: max((max(p[a]["mu_stern"] or 0.0, (p.get("bestaetigung") or {}).get(a, 0.0)) for p in tab.values()), default=0.0) for a in ("d1", "form")}
    for n, p in tab.items():
        bestaetigt = p.get("bestaetigung") or {}
        p["bedingt"] = bool(p["exakt_null"] and bestaetigt.get("wirkt"))
        anteil = [max(p[a]["mu_stern"] or 0.0, bestaetigt.get(a, 0.0)) / maxima[a] if maxima[a] > 0 else 0.0 for a in ("d1", "form")]
        p["wirkung"] = float(max(anteil))
        if p["n"] == 0:
            p["klasse"] = "ohne Messung"
        elif p["exakt_null"] and not p["bedingt"]:
            p["klasse"] = "wirkungslos"
        elif p["wirkung"] < schwelle:
            p["klasse"] = "schwach"
        elif p["wirkung"] < 0.3:
            p["klasse"] = "wirkt"
        else:
            p["klasse"] = "stark"
    kandidaten = [n for n, p in tab.items() if p["klasse"] in ("wirkt", "stark")]
    kandidaten.sort(key=lambda n: -tab[n]["wirkung"])
    aktiv = kandidaten[:max_aktiv]
    for n, p in tab.items():
        p["im_suchraum"] = n in aktiv
    ergebnis["aktiv"] = aktiv
    ergebnis["schwelle"] = schwelle
    ergebnis["max_aktiv"] = max_aktiv
    return ergebnis
