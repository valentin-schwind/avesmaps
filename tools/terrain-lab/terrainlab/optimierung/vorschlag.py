"""Die Vorschlagsdatei (WI-0250 Phase A4): Typ → Werte, Commit, Begründung. **Nie eine Fassungsdatei.**

Der Optimierer schreibt weder ``config/terrain/aventuria/19.json`` noch sonst etwas, das der Generator liest. Ergebnis ist eine versionierte Exportdatei
(``avesmaps-terrainlab-vorschlag``), die ein Mensch prüft. Die ``ueberlagerung`` darin hat die Form von „19 (Test)“ (``HoehenmodellTestWerte.presets``): Wer sie dort
einträgt, probiert den Vorschlag auf der Stage aus, ohne eine Fassung zu ändern.

Ein Vorschlag gilt für den **Generator-Stand** seines Commits. Ändert sich der Generator (WI-0249), ist er neu zu messen.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

FORMAT_VORSCHLAG = "avesmaps-terrainlab-vorschlag"
VERSION = 1
NACH_WI_0249 = (
    "Kalibrierungen der Wirkung von `erosion`, `form.erosion`, `form.erhalt`, `plateau` und der Talbodenableitung (`hypsometrie`, `band.ziel`, `gratMin`) gelten nur für diesen Generator-Stand; "
    "WI-0249 P2 ändert Einbettung, Erosion und Formerhalt, danach ist neu zu messen.",
    "Der Formerhalt (Köpfe der Nebengipfel, Kamm) verbessert sich mit WI-0249 P2 selbst; das Formtor und seine Vorgabewerte sind danach neu zu setzen.",
    "Typwerte, die ein V12-Preset übersteuert (`form.schaerfe`, `form.rauschen`, `form.koernung`, `form.erosion`), sind erst sinnvoll zu kalibrieren, wenn feststeht, welche Seite gilt (Entscheidung offen, P4-Befund 8.3).",
)
#: Hinweise zu bekannten Grenzen je Typ (aus den Befunden des Referenzkorpus und der Deskriptoren).
TYP_HINWEISE = {
    "karst": "Dolinen liegen unter der Zellgröße von 187,5 m (Referenzkorpus, Befund A1): Karst ist bei Avesmaps-Maßstab vor allem Hochfläche mit Senkenanteil; Senkenmaße ohne Wirkung auf das Modell.",
}


def sammle_werte(raum: Any, kandidat: dict[str, Any]) -> dict[str, Any]:
    """Die Abweichungen eines Kandidaten nach Gruppen und Kennungen des Generators (``v12``, ``netz``, ``muster``) mit der Vorgabe daneben."""
    aus: dict[str, Any] = {"v12": {}, "netz": {}}
    vorher: dict[str, Any] = {"v12": {}, "netz": {}}
    for name, wert in sorted(kandidat.items()):
        p = raum[name]
        if p.gruppe == "muster":
            aus["muster"], vorher["muster"] = wert, p.basis
        else:
            aus[p.gruppe][p.kennung], vorher[p.gruppe][p.kennung] = wert, p.basis
    return {"werte": aus, "vorgabe": vorher}


def schreibe_vorschlag(pfad: Path, kopf: dict[str, Any], typen: dict[str, Any]) -> Path:
    datei = {
        "format": FORMAT_VORSCHLAG,
        "version": VERSION,
        "erzeugt": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime()),
        **kopf,
        "hinweis": ("Vorschlag zur Prüfung durch einen Menschen, keine Fassung und keine Entscheidung. `ueberlagerung` hat die Form der Werte von „19 (Test)“ "
                    "(presets.typen.<typ>); der Optimierer schreibt nie config/terrain/aventuria/19.json."),
        "nach_wi_0249": list(NACH_WI_0249),
        "typen": typen,
    }
    pfad.parent.mkdir(parents=True, exist_ok=True)
    pfad.write_text(json.dumps(datei, ensure_ascii=False, indent=1), encoding="utf-8")
    return pfad
