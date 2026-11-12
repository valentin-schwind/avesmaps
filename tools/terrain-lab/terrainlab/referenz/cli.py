"""Befehle `python -m terrainlab referenz …` (WI-0250 A1).

    referenz liste                      Ausschnitte des Korpus mit Zustand
    referenz pruefen [id …]             Manifest gegen Rezepte, Dateien und Prüfsummen (Exit ≠ 0 bei Abweichung)
    referenz holen <id>                 einmaliger Bezug der Rohdaten (Netz), danach geht alles offline
    referenz aufbereiten <id>           Zielraster aus den lokalen Rohdaten erzeugen und gegen das Manifest vergleichen
    referenz vorschau <id>              Schummerungsbild neben die Raster legen (Sichtprüfung)
    referenz fenster …                  Zielfenster um einen Mittelpunkt auf dem 750-m-Raster berechnen (für neue Rezepte)

`--manifest` und `--daten` überschreiben Manifest und Datenwurzel (Tests, fremde Kopien). Ohne `--manifest-aktualisieren` ändern `holen`
und `aufbereiten` das Manifest nie; sie melden dann nur, was sie neu eintragen würden.
"""

from __future__ import annotations

import argparse
import functools
import json
import sys
from typing import Any

from . import manifest as mf
from . import pflege
from . import pruefen as pr
from . import rezept as rz
from .pruefsumme import sha256_datei


def _utf8(funktion):
    """Ausgabe in UTF-8: Windows-Konsolen und Pipes stehen sonst auf cp1252 und verstümmeln oder verschlucken Zeichen."""

    @functools.wraps(funktion)
    def umhuellt(args: argparse.Namespace) -> int:
        for strom in (sys.stdout, sys.stderr):
            try:
                strom.reconfigure(encoding="utf-8", errors="replace")
            except (AttributeError, ValueError):
                pass
        return funktion(args)

    return umhuellt


def _gemeinsam() -> argparse.ArgumentParser:
    eltern = argparse.ArgumentParser(add_help=False)
    eltern.add_argument("--manifest", help="Pfad zum Manifest (Standard: tools/terrain-lab/referenz/manifest.json)")
    eltern.add_argument("--daten", help="Datenwurzel (Standard: AVESMAPS_TERRAIN_LAB oder C:\\avesmaps3d-data\\terrain-lab)")
    return eltern


def _pfade(args: argparse.Namespace) -> mf.Pfade:
    return mf.Pfade.standard(args.manifest, args.daten)


def _ids(args: argparse.Namespace, manifest: dict[str, Any]) -> list[str]:
    if getattr(args, "alle", False):
        return [e["id"] for e in manifest["ausschnitte"]]
    return list(args.ids)


def _lade_rezept(pfade: mf.Pfade, kennung: str) -> tuple[rz.Rezept, bytes]:
    daten, roh = rz.lade_text(pfade.rezept_datei(kennung))
    return rz.parse(daten), roh


@_utf8
def befehl_liste(args: argparse.Namespace) -> int:
    pfade = _pfade(args)
    manifest = mf.lade(pfade.manifest)
    print(f"{'Kennung':32} {'Typ':14} {'Rolle':12} {'km²':>6}  Roh  Raster  Quelle")
    for e in manifest["ausschnitte"]:
        roh = bool(e.get("quelle", {}).get("dateien")) and all(
            pfade.absolut(d["pfad"]).is_file() for d in e["quelle"]["dateien"]
        )
        raster = bool(e.get("raster")) and all(pfade.absolut(r["pfad"]).is_file() for r in e["raster"].values())
        flaeche = e.get("abmessungen", {}).get("flaeche_km2", 0)
        print(
            f"{e['id']:32} {e['typ']:14} {e['rolle']:12} {flaeche:6.0f}  {'ja ' if roh else 'nein'}  {'ja ' if raster else 'nein'}    {e['quelle']['name']}"
        )
    return 0


@_utf8
def befehl_pruefen(args: argparse.Namespace) -> int:
    pfade = _pfade(args)
    manifest = mf.lade(pfade.manifest)
    befunde = pr.pruefe(
        manifest, pfade, args.ids or None, nur_manifest=args.nur_manifest, tief=args.tief, ohne_roh=args.ohne_roh
    )
    for b in befunde:
        print(b)
    fehler = sum(1 for b in befunde if b.stufe == pr.FEHLER)
    warnungen = sum(1 for b in befunde if b.stufe == pr.WARNUNG)
    umfang = "Manifest" if args.nur_manifest else "Manifest und Daten"
    print(f"Referenzkorpus ({umfang}): {len(manifest['ausschnitte'])} Ausschnitte, {fehler} Fehler, {warnungen} Warnungen")
    return 1 if fehler else 0


@_utf8
def befehl_holen(args: argparse.Namespace) -> int:
    from . import quellen

    pfade = _pfade(args)
    manifest = mf.lade(pfade.manifest)
    geaendert = False
    for kennung in _ids(args, manifest):
        eintrag = mf.finde(manifest, kennung)
        rezept, roh = _lade_rezept(pfade, kennung)
        bekannt = eintrag.get("quelle", {}).get("dateien") or []
        vorhanden = bool(bekannt) and all(
            pfade.absolut(d["pfad"]).is_file() and sha256_datei(pfade.absolut(d["pfad"])) == d["sha256"] for d in bekannt
        )
        if vorhanden and not args.erneut:
            print(f"{kennung}: Rohdaten sind schon da und stimmen mit dem Manifest überein (--erneut holt neu)")
            continue
        print(f"{kennung}: hole {rezept.art} …", file=sys.stderr)
        ergebnis = quellen.holen(rezept, pfade)
        neu = ergebnis["dateien"][0]
        alt = bekannt[0] if bekannt else None
        if alt and neu.get("sha256_inhalt") and alt.get("sha256_inhalt") and neu["sha256_inhalt"] != alt["sha256_inhalt"]:
            print(f"{kennung}: ACHTUNG, der Inhalt der Quelle hat sich seit dem Eintrag im Manifest geändert", file=sys.stderr)
            if not args.manifest_aktualisieren:
                return 1
        for d in ergebnis["dateien"]:
            print(f"{kennung}: {d['pfad']}  {d['bytes'] / 1e6:.1f} MB  sha256 {d['sha256']}")
        if args.manifest_aktualisieren:
            pflege.nach_holen(eintrag, rezept, roh, ergebnis)
            geaendert = True
    if geaendert:
        mf.speichere(pfade.manifest, manifest)
        print(f"Manifest aktualisiert: {pfade.manifest}")
    return 0


@_utf8
def befehl_aufbereiten(args: argparse.Namespace) -> int:
    from . import aufbereiten as auf

    pfade = _pfade(args)
    manifest = mf.lade(pfade.manifest)
    geaendert = False
    abweichung = False
    for kennung in _ids(args, manifest):
        eintrag = mf.finde(manifest, kennung)
        rezept, roh = _lade_rezept(pfade, kennung)
        dateien = eintrag.get("quelle", {}).get("dateien") or []
        if not dateien:
            print(f"{kennung}: im Manifest stehen keine Quelldateien (erst: referenz holen {kennung})", file=sys.stderr)
            return 1
        pfade_roh = [pfade.absolut(d["pfad"]) for d in dateien]
        for pfad, d in zip(pfade_roh, dateien):
            if not pfad.is_file():
                print(f"{kennung}: Rohdatei fehlt: {pfad} (referenz holen {kennung})", file=sys.stderr)
                return 1
            if sha256_datei(pfad) != d["sha256"]:
                print(f"{kennung}: Prüfsumme der Rohdatei stimmt nicht: {pfad}", file=sys.stderr)
                return 1
        print(f"{kennung}: bereite auf …", file=sys.stderr)
        raster = auf.aufbereiten(rezept, pfade, pfade_roh, [d["sha256"] for d in dateien])
        alt = eintrag.get("raster") or {}
        for name, neu in raster.items():
            vorher = alt.get(name, {}).get("sha256")
            if vorher is None:
                zustand = "neu"
            elif vorher == neu["sha256"]:
                zustand = "reproduziert (Prüfsumme gleich dem Manifest)"
            else:
                zustand = "WEICHT vom Manifest ab"
                abweichung = True
            print(f"{kennung}: {name}  sha256 {neu['sha256']}  {zustand}")
        if args.manifest_aktualisieren:
            pflege.nach_aufbereiten(eintrag, rezept, roh, raster)
            geaendert = True
    if geaendert:
        mf.speichere(pfade.manifest, manifest)
        print(f"Manifest aktualisiert: {pfade.manifest}")
        return 0
    return 1 if abweichung else 0


@_utf8
def befehl_vorschau(args: argparse.Namespace) -> int:
    from .vorschau import schreibe_vorschau

    pfade = _pfade(args)
    manifest = mf.lade(pfade.manifest)
    for kennung in _ids(args, manifest):
        eintrag = mf.finde(manifest, kennung)
        raster = (eintrag.get("raster") or {}).get(args.stufe)
        if raster is None:
            print(f"{kennung}: Stufe {args.stufe} nicht aufbereitet", file=sys.stderr)
            return 1
        ziel = pfade.ref_ordner(kennung) / f"vorschau-{args.stufe}.png"
        schreibe_vorschau(pfade.absolut(raster["pfad"]).with_suffix(".json"), ziel, args.ueberhoehung)
        print(f"{kennung}: {ziel}")
    return 0


@_utf8
def befehl_fenster(args: argparse.Namespace) -> int:
    from . import quellen

    crs = args.crs
    if crs == "utm-nad83":
        crs = quellen.utm_crs(args.mitte[0], args.mitte[1], "nad83")
    elif crs == "utm-wgs84":
        crs = quellen.utm_crs(args.mitte[0], args.mitte[1], "wgs84")
    fenster = quellen.fenster_um_mitte(crs, args.mitte[0], args.mitte[1], args.breite_km * 1000.0, args.hoehe_km * 1000.0, args.raster_m)
    print(json.dumps({"crs": crs, "fenster": fenster}))
    return 0


def registriere(unterbefehle: Any) -> None:
    eltern = _gemeinsam()
    parser = unterbefehle.add_parser("referenz", help="Referenzkorpus realer Geländemodelle (WI-0250 A1)")
    sub = parser.add_subparsers(dest="referenz_befehl", required=True)

    p = sub.add_parser("liste", parents=[eltern], help="Ausschnitte mit Zustand auflisten")
    p.set_defaults(ausfuehren=befehl_liste)

    p = sub.add_parser("pruefen", parents=[eltern], help="Manifest gegen Rezepte, Dateien und Prüfsummen prüfen")
    p.add_argument("ids", nargs="*", help="nur diese Ausschnitte (Standard: alle)")
    p.add_argument("--nur-manifest", action="store_true", help="ohne Datenzugriff: Schema, Rezeptbezug, Maße")
    p.add_argument("--tief", action="store_true", help="auch die Rohrasterköpfe über GDAL prüfen")
    p.add_argument("--ohne-roh", action="store_true", help="Rohdateien nicht prüfen (nur aufbereitete Raster vorhanden)")
    p.set_defaults(ausfuehren=befehl_pruefen)

    for name, hilfe, funktion in (
        ("holen", "Rohdaten einmalig beziehen (Netz) oder lokal abgelegte Quelldateien erfassen", befehl_holen),
        ("aufbereiten", "Zielraster aus den lokalen Rohdaten erzeugen", befehl_aufbereiten),
        ("vorschau", "Schummerungsbild einer Stufe schreiben", befehl_vorschau),
    ):
        p = sub.add_parser(name, parents=[eltern], help=hilfe)
        p.add_argument("ids", nargs="*", help="Kennungen der Ausschnitte")
        p.add_argument("--alle", action="store_true", help="alle Ausschnitte des Manifests")
        if name != "vorschau":
            p.add_argument("--manifest-aktualisieren", action="store_true", help="Prüfsummen und Angaben ins Manifest schreiben")
        if name == "holen":
            p.add_argument("--erneut", action="store_true", help="auch dann neu holen, wenn die Rohdaten stimmen")
        if name == "vorschau":
            p.add_argument("--stufe", default="187_5m", help="Stufe (Standard 187_5m)")
            p.add_argument("--ueberhoehung", type=float, default=2.0, help="Überhöhung der Schummerung (Standard 2)")
        p.set_defaults(ausfuehren=funktion)

    p = sub.add_parser("fenster", parents=[eltern], help="Zielfenster um einen Mittelpunkt berechnen (für neue Rezepte)")
    p.add_argument("--crs", required=True, help="metrisches Ziel-CRS (EPSG:xxxx) oder utm-nad83 / utm-wgs84")
    p.add_argument("--mitte", required=True, nargs=2, type=float, metavar=("LAENGE", "BREITE"), help="Mittelpunkt in Grad")
    p.add_argument("--breite-km", type=float, required=True)
    p.add_argument("--hoehe-km", type=float, required=True)
    p.add_argument("--raster-m", type=float, default=750.0, help="Kanten auf Vielfache davon legen (Standard 750 m)")
    p.set_defaults(ausfuehren=befehl_fenster)
