"""Stufe 3 der Optimierung: Validierung der Besten bei 2× und 4× (WI-0250 Phase A4).

Die Suche sieht nur die Referenzausschnitte der Rolle ``optimierung``. Die **Validierung** rechnet die besten Kandidaten (in der Reihenfolge der Suche) in
größerer Auflösung neu und misst sie gegen die Ausschnitte der Rolle ``validierung`` (anderes echtes Gebirge desselben Typs), dazu gegen die der Optimierung,
und stellt jeweils die **Vorgabe des Typs im selben Maßstab** daneben. Sie **ordnet nicht um**: Ein Kandidat gilt als *bestätigt*, wenn

1. sein Abstand zur Validierungsreferenz im Mittel um mindestens ``gewinn_min`` (relativ) unter dem der Vorgabe liegt, an **jeder** validierten Auflösung,
2. er an jeder validierten Auflösung das Formtor hält (gegen die Vorgabe derselben Auflösung).

Der **Vorschlag** ist der erste bestätigte Kandidat in der Reihenfolge der Suche. Bestätigt keiner, bleibt die Vorgabe. So entscheiden die Validierungsdaten über
Annahme oder Ablehnung, nie über die Rangfolge der Suche.
"""

from __future__ import annotations

from typing import Any, Callable, Sequence

from .auswerter import Auswerter
from .ranking import Bewertet, bewerte, vorgabe_zusammenfassung


def validiere(
    aus: Auswerter, typ: str, beste: Sequence[Bewertet], saaten: Sequence[int | None], einstellungen: dict[str, Any], tor_faktor: float,
    melde: Callable[[str], None] = lambda t: None,
) -> dict[str, Any]:
    """Prüft die ``beste``n Kandidaten (Reihenfolge der Suche) an den Auflösungen der Validierung und gibt Urteile und Vorschlag zurück."""
    aufloesungen = sorted(set(int(a) for a in einstellungen["aufloesungen"]))
    gewinn_min = float(einstellungen["gewinn_min"])
    saaten_2x = list(saaten[: int(einstellungen["saaten"])])
    saaten_4x = list(saaten[:1])
    vier_x_fuer = int(einstellungen.get("vier_x_fuer", 1))
    ergebnis: dict[str, Any] = {"aufloesungen": aufloesungen, "gewinn_min": gewinn_min, "kandidaten": [], "vorschlag": None, "vorgabe": {}}
    for a in aufloesungen:
        s = saaten_4x if a == 4 else saaten_2x
        ergebnis["vorgabe"][str(a)] = {
            "saaten": [aus.profil.saat_name(x) for x in s],
            "optimierung": _kurz(vorgabe_zusammenfassung(aus, typ, s, a, "optimierung")),
            "validierung": _kurz(vorgabe_zusammenfassung(aus, typ, s, a, "validierung")),
        }
    bestaetigt: dict[str, Any] | None = None
    for platz, b in enumerate(beste):
        eintrag: dict[str, Any] = {"platz": platz + 1, "kandidat": b.kandidat, "schluessel": b.schluessel, "suche": b.als_dict(), "aufloesungen": {}}
        bestanden = True
        for a in aufloesungen:
            if a == 4 and platz >= vier_x_fuer:
                continue
            s = saaten_4x if a == 4 else saaten_2x
            basis_opt = vorgabe_zusammenfassung(aus, typ, s, a, "optimierung")
            basis_val = vorgabe_zusammenfassung(aus, typ, s, a, "validierung")
            opt = bewerte(aus, typ, b.kandidat, s, basis_opt, tor_faktor, aufloesung=a, rolle="optimierung", herkunft="validierung")
            val = bewerte(aus, typ, b.kandidat, s, basis_val, tor_faktor, aufloesung=a, rolle="validierung", herkunft="validierung")
            vor_val = basis_val["d1"]["mittel"]
            gewinn = None if (val.d1 is None or not vor_val) else (vor_val - val.d1) / vor_val
            ok = bool(val.tor_ok and opt.tor_ok and gewinn is not None and gewinn >= gewinn_min)
            bestanden = bestanden and ok
            eintrag["aufloesungen"][str(a)] = {
                "optimierung": opt.als_dict(), "validierung": val.als_dict(), "gewinn_validierung": gewinn, "tor_ok": bool(val.tor_ok and opt.tor_ok),
                "verstoesse": sorted(set(opt.verstoesse + val.verstoesse)), "bestaetigt": ok,
            }
            melde(f"  Platz {platz + 1} bei {a}×: Abstand zur Validierung {val.d1} gegen Vorgabe {vor_val} (Gewinn {gewinn}), Formtor {'ja' if val.tor_ok and opt.tor_ok else 'NEIN'}")
        eintrag["bestaetigt"] = bool(bestanden and eintrag["aufloesungen"])
        ergebnis["kandidaten"].append(eintrag)
        if eintrag["bestaetigt"] and bestaetigt is None:
            bestaetigt = eintrag
    if bestaetigt is not None:
        ergebnis["vorschlag"] = {"platz": bestaetigt["platz"], "kandidat": bestaetigt["kandidat"], "schluessel": bestaetigt["schluessel"]}
    return ergebnis


def _kurz(f: dict[str, Any]) -> dict[str, Any]:
    return {k: f[k] for k in ("saaten", "d1", "d1_arten", "form", "komponenten", "wall_ms", "rss_mib", "zellen")}
