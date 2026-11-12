"""JSON schreiben, wie Prettier es mit der Repository-Konfiguration (4 Leerzeichen, 120 Spalten) stabil lässt.

Objekte stehen immer mehrzeilig, Listen aus Zahlen oder Zeichenketten in einer Zeile, wenn sie passen. So bleibt eine vom Werkzeug
geschriebene Datei (Manifest, Rezepte) ohne Nachformatieren prüffest für `npm run format:check`.
"""

from __future__ import annotations

import json
import re
from typing import Any

EINZUG = 4
BREITE = 120


def _skalar(wert: Any) -> str:
    text = json.dumps(wert, ensure_ascii=False)
    if isinstance(wert, float):
        text = re.sub(r"e\+?(-?)0*(\d)", r"e\1\2", text)  # Prettier: 3.4e38 statt 3.4e+38, 9e-5 statt 9e-05
    return text


def _ist_skalar(wert: Any) -> bool:
    return not isinstance(wert, (dict, list))


def formatiere(wert: Any, ebene: int = 0, spalte: int = 0) -> str:
    """`spalte` ist die Spalte, in der der Wert beginnt (hinter dem Schlüssel), damit „passt in die Zeile“ stimmt."""
    if isinstance(wert, dict):
        if not wert:
            return "{}"
        innen = " " * (EINZUG * (ebene + 1))
        zeilen = []
        for schluessel, inhalt in wert.items():
            kopf = f"{innen}{_skalar(str(schluessel))}: "
            zeilen.append(kopf + formatiere(inhalt, ebene + 1, len(kopf)))
        return "{\n" + ",\n".join(zeilen) + "\n" + " " * (EINZUG * ebene) + "}"
    if isinstance(wert, list):
        if not wert:
            return "[]"
        if all(_ist_skalar(x) for x in wert):
            einzeilig = "[" + ", ".join(_skalar(x) for x in wert) + "]"
            if spalte + len(einzeilig) + 1 <= BREITE:  # +1 für ein folgendes Komma
                return einzeilig
            if all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in wert):
                # Zahlenlisten füllt Prettier Zeile für Zeile auf.
                innen = " " * (EINZUG * (ebene + 1))
                zeilen, aktuell = [], innen
                for x in wert:
                    teil = _skalar(x) + ","
                    if len(aktuell) + len(teil) + (1 if aktuell != innen else 0) > BREITE and aktuell != innen:
                        zeilen.append(aktuell)
                        aktuell = innen
                    aktuell += (" " if aktuell != innen else "") + teil
                zeilen.append(aktuell)
                zeilen[-1] = zeilen[-1].rstrip(",")
                return "[\n" + "\n".join(zeilen) + "\n" + " " * (EINZUG * ebene) + "]"
        innen = " " * (EINZUG * (ebene + 1))
        zeilen = [innen + formatiere(x, ebene + 1, len(innen)) for x in wert]
        return "[\n" + ",\n".join(zeilen) + "\n" + " " * (EINZUG * ebene) + "]"
    return _skalar(wert)


def zu_text(wert: Any) -> str:
    return formatiere(wert) + "\n"
