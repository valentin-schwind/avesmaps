"""Strategievergleich je Typ (WI-0250 Phase A4): Welcher Weg des Generators kommt der Referenz am nächsten, ohne die gezeichnete Form zu verlieren?

Der Generator erlaubt heute vier Strategien (``STRATEGIEN``): das Rückennetz mit den **gezeichneten Kämmen** der Fixture oder **ohne Kammnetz** (die V12-Kette
ohne Kämme und Nebengipfel: Das Modell erzeugt die Form selbst) und je das Grundmuster **rauschen** oder **zellen**. Je Strategie rechnet eine kleine Sobol-Suche (bei 1×,
mit der Vorgabe des Typs als Bezug) über die Parameter, die in dieser Strategie wirken: ohne Kammnetz nur die zehn V12-Regler, mit Kämmen auch die Typwerte des
Rückennetzes; das Muster steht fest.

Die beiden Strategien mit gezeichneten Kämmen nehmen zusätzlich **alle Kandidaten der Hauptsuche** mit ihrem Muster auf (bei der ersten Saat, aus der Datenbank): Die Hauptsuche
verstellt das Muster mit, ihre Ergebnisse gehören zum Vergleich, sonst widerspräche er ihr. Die Strategien ohne Kammnetz rechnen nur die kleine Suche (sie verfehlen das Formtor ohnehin).

Die Formmaße werden **immer gegen die gezeichnete Form** gemessen. Eine Strategie ohne Kammnetz kann statistisch glaubwürdig aussehen und verfehlt dann das
Formtor; das Ergebnis nennt das ausdrücklich (``tor_erreichbar`` falsch) und empfiehlt sie nie.

``empfehlung``: die Strategie mit dem kleinsten Abstand unter denen, die das Formtor erreichen. ``erreichbar``: ob dieser Abstand höchstens ``erreichbar_faktor`` mal
die **Referenzstreuung** beträgt (Abstand der Optimierungs- zu den Validierungsausschnitten desselben Typs, also zweier echter Gebirge). Sonst steht dort „mit dem Modell
nicht erreichbar“ samt der Kennzahlen, die es verhindern.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable, Sequence

from .auswerter import Auswerter
from .ranking import Bewertet, bewerte, ordne
from .raum import Raum
from .suche import sobol_kandidaten

STRATEGIEN: tuple[dict[str, str], ...] = (
    {"name": "kaemme-rauschen", "variante": "gezeichnet", "muster": "rauschen", "beschreibung": "gezeichnete Kämme (Rückennetz), Grundmuster rauschen"},
    {"name": "kaemme-zellen", "variante": "gezeichnet", "muster": "zellen", "beschreibung": "gezeichnete Kämme (Rückennetz), Grundmuster zellen"},
    {"name": "ohne-kamm-rauschen", "variante": "ohne-kamm", "muster": "rauschen", "beschreibung": "ohne Kammnetz (V12-Kette), Grundmuster rauschen"},
    {"name": "ohne-kamm-zellen", "variante": "ohne-kamm", "muster": "zellen", "beschreibung": "ohne Kammnetz (V12-Kette), Grundmuster zellen"},
)


def erzeuge_ohne_kamm(fixture: Path | str, ziel: Path | str) -> Path:
    """Schreibt die Gebirgsdatei ohne Kämme, Nebengipfel und Mulden (Gipfel, Flüsse, Seen und Regler bleiben): die Eingabe, die das Modell selbst formen lässt."""
    j = json.loads(Path(fixture).read_text(encoding="utf-8"))
    eingabe = j["input"]
    for schluessel in ("kaemme", "nebengipfel", "mulden"):
        eingabe.pop(schluessel, None)
    j.pop("kaemmeLang", None)
    j["name"] = f"{j.get('name', 'gebirge')} (ohne Kammnetz)"
    ziel = Path(ziel)
    ziel.parent.mkdir(parents=True, exist_ok=True)
    ziel.write_text(json.dumps(j, ensure_ascii=False), encoding="utf-8")
    return ziel


def vergleiche_strategien(
    aus: Auswerter, typ: str, raum: Raum, aktiv: Sequence[str], saaten: Sequence[int | None], basis: dict[str, Any], tor_faktor: float, einstellungen: dict[str, Any], seed: int,
    streuung: float | None, haupt: Sequence[dict[str, Any]] = (), melde: Callable[[str], None] = lambda t: None,
) -> dict[str, Any]:
    """Je Strategie eine kleine Suche; ``basis`` ist die Vorgabe des Typs mit gezeichneten Kämmen (der Bezug des Formtors)."""
    n = int(einstellungen["kandidaten"])
    ergebnisse: dict[str, Any] = {}
    for st in STRATEGIEN:
        namen = [a for a in aktiv if a != "muster" and (st["variante"] == "gezeichnet" or raum[a].gruppe == "v12")]
        fest = {"muster": st["muster"]}
        kandidaten = [raum.kandidat({}, [], fest)] + sobol_kandidaten(raum, namen, n, seed, fest)
        eigene = len(kandidaten)
        if st["variante"] == "gezeichnet":
            kandidaten += [k for k in haupt if k.get("muster", raum["muster"].basis) == st["muster"]]
        bewertet: list[Bewertet] = []
        seen: set[str] = set()
        for k in kandidaten:
            s = Raum.schluessel(k, st["variante"])
            if s in seen:
                continue
            seen.add(s)
            bewertet.append(bewerte(aus, typ, k, saaten, basis, tor_faktor, variante=st["variante"], herkunft=f"strategie:{st['name']}"))
        geordnet = ordne(bewertet)
        zulaessig = [b for b in geordnet if b.tor_ok and b.d1 is not None]
        beste_alle = min((b for b in bewertet if b.d1 is not None), key=lambda b: b.d1, default=None)  # type: ignore[arg-type,return-value]
        beste = zulaessig[0] if zulaessig else None
        ergebnisse[st["name"]] = {
            **st,
            "parameter_aktiv": namen,
            "kandidaten": len(bewertet),
            "davon_eigene_suche": min(eigene, len(bewertet)),
            "tor_erreichbar": bool(zulaessig),
            "zulaessig": len(zulaessig),
            "beste_zulaessig": None if beste is None else beste.als_dict(),
            "beste_ohne_tor": None if beste_alle is None else beste_alle.als_dict(),
            "form_verlust_beste_ohne_tor": None if beste_alle is None else beste_alle.form_verlust,
        }
        melde(f"  Strategie {st['name']}: {len(bewertet)} Kandidaten, Formtor erreicht von {len(zulaessig)}; bester zulässiger Abstand "
              f"{'-' if beste is None else f'{beste.d1:.4f}'}, ohne Tor {'-' if beste_alle is None else f'{beste_alle.d1:.4f}'}")
    kandidatenliste = [(name, e["beste_zulaessig"]["d1"]) for name, e in ergebnisse.items() if e["beste_zulaessig"] is not None]
    empfehlung = min(kandidatenliste, key=lambda t: t[1]) if kandidatenliste else None
    faktor = float(einstellungen["erreichbar_faktor"])
    erreichbar = None
    if empfehlung is not None and streuung:
        erreichbar = bool(empfehlung[1] <= faktor * streuung)
    return {
        "strategien": ergebnisse,
        "empfehlung": None if empfehlung is None else {"name": empfehlung[0], "abstand": empfehlung[1]},
        "referenzstreuung": streuung,
        "erreichbar_faktor": faktor,
        "erreichbar": erreichbar,
        "urteil": _urteil(empfehlung, streuung, faktor, erreichbar),
        "saaten": [aus.profil.saat_name(s) for s in saaten],
    }


def _de(x: float | None, stellen: int = 3) -> str:
    return "-" if x is None else f"{x:.{stellen}f}".replace(".", ",")


def _urteil(empfehlung: tuple[str, float] | None, streuung: float | None, faktor: float, erreichbar: bool | None) -> str:
    if empfehlung is None:
        return "keine Strategie hält das Formtor: mit dem Modell nicht erreichbar"
    name, abstand = empfehlung
    if erreichbar is None:
        return f"empfohlene Strategie: {name} (Abstand {_de(abstand)}; keine Referenzstreuung zum Vergleich)"
    if erreichbar:
        return f"empfohlene Strategie: {name} (Abstand {_de(abstand)}, höchstens {faktor:g}-mal die Referenzstreuung {_de(streuung)})"
    return (f"mit dem Modell nicht erreichbar: die beste zulässige Strategie ({name}) liegt bei {_de(abstand)}, das ist mehr als das {faktor:g}-Fache "
            f"der Referenzstreuung {_de(streuung)} zweier echter Gebirge")
