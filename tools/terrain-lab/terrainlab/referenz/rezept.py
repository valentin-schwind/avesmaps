"""Aufbereitungsrezept eines Ausschnitts (`referenz/rezepte/<id>.json`).

Das Rezept ist die maschinenlesbare Anleitung, wie aus den Rohdaten die Zielraster entstehen: welche Quelle (URLs oder lokale Dateien), welches
Zielfenster in welchem metrischen Koordinatensystem, welche Stufen mit welchem Verfahren. Das Manifest verweist darauf und trägt eine
Prüfsumme des Rezepts; ändert sich ein Rezept, fällt das in `referenz pruefen` auf.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

FORMAT = "avesmaps-referenzrezept"
VERSION = 1
ARTEN = ("cog-fenster", "lokal")
VERFAHREN = ("warp-mittel", "block-mittel")
STANDARD_RAND_ZELLEN = 8
STANDARD_MINDESTANTEIL = 0.5


class RezeptFehler(ValueError):
    """Das Rezept ist unvollständig oder in sich widersprüchlich."""


@dataclass(frozen=True)
class Stufe:
    name: str
    zellgroesse_m: float
    verfahren: str
    aus: str | None = None
    faktor: int | None = None


@dataclass(frozen=True)
class Rezept:
    id: str
    art: str
    urls: tuple[str, ...]
    dateien: tuple[str, ...]
    rand_zellen: int
    metadaten: dict[str, Any]
    ziel_crs: str
    fenster: tuple[float, float, float, float]
    nodata_quelle: float | None
    mindestanteil_gueltig: float
    stufen: tuple[Stufe, ...]

    def stufe(self, name: str) -> Stufe:
        for s in self.stufen:
            if s.name == name:
                return s
        raise KeyError(name)

    def zellen(self, stufe: Stufe) -> tuple[int, int]:
        """(Breite, Höhe) der Stufe in Zellen."""
        x0, y0, x1, y1 = self.fenster
        return round((x1 - x0) / stufe.zellgroesse_m), round((y1 - y0) / stufe.zellgroesse_m)


def lade_text(pfad: Path | str) -> tuple[dict[str, Any], bytes]:
    roh = Path(pfad).read_bytes()
    return json.loads(roh.decode("utf-8")), roh


def parse(daten: dict[str, Any]) -> Rezept:
    """Baut ein `Rezept` und prüft es; wirft `RezeptFehler` mit einer Meldung je Fund."""
    fehler: list[str] = []
    if daten.get("format") != FORMAT or daten.get("version") != VERSION:
        raise RezeptFehler(f"unbekanntes Rezeptformat {daten.get('format')} v{daten.get('version')}")
    kennung = daten.get("id")
    quelle = daten.get("quelle") or {}
    ziel = daten.get("ziel") or {}
    nodata = daten.get("nodata") or {}
    if not isinstance(kennung, str) or not kennung:
        fehler.append("id fehlt")
    art = quelle.get("art")
    if art not in ARTEN:
        fehler.append(f"quelle.art muss {' | '.join(ARTEN)} sein")
    urls = tuple(quelle.get("urls") or ())
    dateien = tuple(quelle.get("dateien") or ())
    if art == "cog-fenster" and not urls:
        fehler.append("quelle.urls fehlt (art cog-fenster)")
    if art == "lokal" and not dateien:
        fehler.append("quelle.dateien fehlt (art lokal)")
    fenster = ziel.get("fenster")
    if not (isinstance(fenster, list) and len(fenster) == 4 and all(isinstance(v, (int, float)) for v in fenster)):
        fehler.append("ziel.fenster muss [xmin, ymin, xmax, ymax] sein")
        fenster = [0, 0, 1, 1]
    elif not (fenster[0] < fenster[2] and fenster[1] < fenster[3]):
        fehler.append("ziel.fenster hat keine positive Fläche")
    crs = ziel.get("crs")
    if not isinstance(crs, str) or not crs:
        fehler.append("ziel.crs fehlt")
    stufen_roh = daten.get("stufen") or []
    if not stufen_roh:
        fehler.append("stufen fehlt")
    stufen: list[Stufe] = []
    for s in stufen_roh:
        stufe = Stufe(
            name=str(s.get("name")),
            zellgroesse_m=float(s.get("zellgroesse_m", 0)),
            verfahren=str(s.get("verfahren")),
            aus=s.get("aus"),
            faktor=s.get("faktor"),
        )
        if stufe.verfahren not in VERFAHREN:
            fehler.append(f"Stufe {stufe.name}: verfahren muss {' | '.join(VERFAHREN)} sein")
        if not stufe.zellgroesse_m > 0:
            fehler.append(f"Stufe {stufe.name}: zellgroesse_m muss positiv sein")
        stufen.append(stufe)
    namen = [s.name for s in stufen]
    if len(set(namen)) != len(namen):
        fehler.append("Stufennamen doppelt")
    breite_m, hoehe_m = fenster[2] - fenster[0], fenster[3] - fenster[1]
    for stufe in stufen:
        if stufe.verfahren == "warp-mittel":
            for laenge, achse in ((breite_m, "Breite"), (hoehe_m, "Höhe")):
                zellen = laenge / stufe.zellgroesse_m if stufe.zellgroesse_m else 0
                if abs(zellen - round(zellen)) > 1e-9:
                    fehler.append(f"Stufe {stufe.name}: {achse} des Fensters ist kein Vielfaches der Zellgröße")
        else:
            eltern = next((s for s in stufen if s.name == stufe.aus), None)
            if eltern is None:
                fehler.append(f"Stufe {stufe.name}: aus verweist auf unbekannte Stufe {stufe.aus}")
            elif not isinstance(stufe.faktor, int) or stufe.faktor < 1:
                fehler.append(f"Stufe {stufe.name}: faktor muss eine positive ganze Zahl sein")
            else:
                if abs(eltern.zellgroesse_m * stufe.faktor - stufe.zellgroesse_m) > 1e-9:
                    fehler.append(f"Stufe {stufe.name}: zellgroesse_m passt nicht zu {stufe.aus} × faktor")
                for laenge, achse in ((breite_m, "Breite"), (hoehe_m, "Höhe")):
                    zellen = laenge / eltern.zellgroesse_m
                    if abs(zellen - round(zellen)) > 1e-9 or round(zellen) % stufe.faktor != 0:
                        fehler.append(f"Stufe {stufe.name}: {achse} der Elternstufe nicht durch faktor teilbar")
    anteil = nodata.get("mindestanteil_gueltig", STANDARD_MINDESTANTEIL)
    if not isinstance(anteil, (int, float)) or not 0 < anteil <= 1:
        fehler.append("nodata.mindestanteil_gueltig muss in (0, 1] liegen")
    if fehler:
        raise RezeptFehler(f"Rezept {kennung}: " + "; ".join(fehler))
    quelle_nodata = nodata.get("quelle")
    return Rezept(
        id=str(kennung),
        art=art,
        urls=urls,
        dateien=dateien,
        rand_zellen=int(quelle.get("rand_zellen", STANDARD_RAND_ZELLEN)),
        metadaten=dict(quelle.get("metadaten") or {}),
        ziel_crs=str(crs),
        fenster=(float(fenster[0]), float(fenster[1]), float(fenster[2]), float(fenster[3])),
        nodata_quelle=None if quelle_nodata is None else float(quelle_nodata),
        mindestanteil_gueltig=float(anteil),
        stufen=tuple(stufen),
    )


def lade(pfad: Path | str) -> Rezept:
    daten, _ = lade_text(pfad)
    return parse(daten)


def zahl(wert: float) -> str:
    """Zahl ohne überflüssige Nachkommastellen für die Textdarstellung der Schritte."""
    return f"{wert:g}" if abs(wert) < 1e6 else f"{wert:.0f}"


def schritte(rezept: Rezept) -> list[str]:
    """Die Aufbereitungsschritte als lesbare Liste (GDAL-Entsprechungen); steht so im Manifest und wird dort gegengeprüft."""
    x0, y0, x1, y1 = rezept.fenster
    fenster = f"{zahl(x0)} {zahl(y0)} {zahl(x1)} {zahl(y1)}"
    quelle = "<Quelle>" if rezept.art == "lokal" else " ".join(rezept.urls)
    nodata_quelle = "aus der Datei" if rezept.nodata_quelle is None else zahl(rezept.nodata_quelle)
    liste = [
        (
            f"Bezug (referenz holen): GDAL gdal_translate -srcwin <Pixelfenster der Quelle> auf {quelle}; das Pixelfenster ist das "
            f"Zielfenster ({rezept.ziel_crs}) in das CRS der Quelle übertragen plus {rezept.rand_zellen} Quellzellen Rand. "
            "Ausgabe quelle.tif (Float32, DEFLATE, PREDICTOR=3, gekachelt), keine Neuberechnung der Werte."
            if rezept.art == "cog-fenster"
            else "Bezug (referenz holen): lokal abgelegte Quelldateien werden nur erfasst (SHA-256), nichts heruntergeladen."
        ),
        f"NoData der Quelle: {nodata_quelle}; im Ergebnis immer NaN.",
    ]
    for stufe in rezept.stufen:
        if stufe.verfahren == "warp-mittel":
            liste.append(
                f"{stufe.name}: gdalwarp -t_srs {rezept.ziel_crs} -te {fenster} -tr {zahl(stufe.zellgroesse_m)} "
                f"{zahl(stufe.zellgroesse_m)} -r average -srcnodata {nodata_quelle} -dstnodata nan -ot Float32 quelle.tif {stufe.name}"
                " (Flächenmittel; Reprojektion, falls das Quell-CRS nicht das Ziel-CRS ist)."
            )
        else:
            liste.append(
                f"{stufe.name}: {stufe.faktor}×{stufe.faktor}-Blockmittel der Stufe {stufe.aus} (Mittel der gültigen Zellen, NaN bei "
                f"weniger als {rezept.mindestanteil_gueltig:g} gültigem Anteil)."
            )
    liste.append("Schreiben: terrainlab.raster (Float32 little-endian, JSON-Kopf, SHA-256 der Rasterdatei).")
    return liste
