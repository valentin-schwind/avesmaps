"""Befehle ``python -m terrainlab lauf perf|qualitaet|vergleiche|stand|profile`` (WI-0250 Phase B)."""

from __future__ import annotations

import argparse
import copy
import sys
import time
from dataclasses import replace
from pathlib import Path
from typing import Any

from terrainlab import daten_wurzel

from .adapter import Adapter, AdapterFehler
from .cache import Zwischenspeicher
from .konfig import Konfig, KonfigFehler, PROFIL_ORDNER, lade_konfig, pruefe_schnappschuesse
from .perf import laufe_perf, mindest_ram_mib
from .perf import tabelle as perf_tabelle
from .qualitaet import laufe_qualitaet
from .qualitaet import tabelle as qualitaet_tabelle
from .sperre import Gesperrt, Sperre, Vorpruefung, pruefe_ressourcen
from .umgebung import git, laeufe_wurzel, loese_commit, repo_wurzel
from .vergleich import schreibe as schreibe_vergleich
from .vergleich import tabelle as vergleich_tabelle
from .vergleich import vergleiche_ergebnisse


def registriere(unterbefehle: "argparse._SubParsersAction") -> None:
    lauf = unterbefehle.add_parser(
        "lauf",
        help="Generatoradapter, Performance- und Qualitätsbenchmark, Commit-Vergleich",
        description="Läufe des Terrain-Labs: der Adapter rechnet die Gebirge mit dem Generator an einem festgelegten Stand, Python misst und vergleicht.",
    )
    lauf.set_defaults(ausfuehren=lambda args: lauf.print_help() or 2)
    teil = lauf.add_subparsers(dest="lauf_befehl", metavar="{perf,qualitaet,vergleiche,stand,profile}")

    def gemeinsam(p: argparse.ArgumentParser, mit_commit: bool = True) -> None:
        if mit_commit:
            p.add_argument("--commit", help="Commit, an dem gerechnet wird (eigene Arbeitskopie unter <Labor>/staende); ohne: dieser Arbeitsbaum, wenn sauber")
        p.add_argument("--ausgabe", metavar="ORDNER", help="Ausgabeordner (Vorgabe: <Labor>/laeufe/<art>/<zeit>-<konfig>-<commit>)")
        p.add_argument("--nur", metavar="NAME[,NAME]", help="nur Fälle, deren Name einen dieser Texte enthält")
        p.add_argument("--schnappschuss", metavar="ORDNER", help="Schnappschuss der Eingaben für alle Endgelände-Fälle")
        p.add_argument("--schmutzig-erlauben", action="store_true", help="auch einen unsauberen Arbeitsbaum messen (nur Entwicklung; nicht reproduzierbar)")
        p.add_argument("--ohne-sperre", action="store_true", help="die Sperre „nur ein schwerer Lauf“ nicht nehmen")
        p.add_argument("--ohne-pruefung", action="store_true", help="freien Arbeitsspeicher und Platz nicht prüfen")
        p.add_argument("--trocken", action="store_true", help="nur anzeigen, was gerechnet würde")

    perf = teil.add_parser("perf", help="Performance-Benchmark", description="Mehrere frische Prozesse je Fall, kalt und warm, Median und Streuung, Phasen.")
    perf.add_argument("konfig", help="Konfigurationsdatei oder eingebautes Profil (schnell, voll)")
    gemeinsam(perf)
    perf.add_argument("--wiederholungen", type=int, help="Prozesse je Fall (überschreibt die Konfiguration)")
    perf.add_argument("--warm", type=int, help="warme Läufe je Prozess (überschreibt die Konfiguration)")
    perf.add_argument("--arbeiter", type=int, help="TERRAIN_EROSION_WORKERS (0 bis 8)")
    perf.set_defaults(ausfuehren=befehl_perf)

    q = teil.add_parser("qualitaet", help="Qualitätsbenchmark (Deskriptoren)", description="Raster rechnen (oder aus dem Zwischenspeicher), Metrikvektor je Fall.")
    q.add_argument("konfig", help="Konfigurationsdatei oder eingebautes Profil (qualitaet)")
    gemeinsam(q)
    q.add_argument("--cache-neu", action="store_true", help="den Zwischenspeicher übergehen und neu rechnen")
    q.set_defaults(ausfuehren=befehl_qualitaet)

    v = teil.add_parser("vergleiche", help="zwei Commits vergleichen", description="Qualitätsbenchmark an zwei Commits, dann Verbesserung/Regression je Kennzahl.")
    v.add_argument("commit_a", help="Basis")
    v.add_argument("commit_b", help="Gegenstand")
    v.add_argument("konfig", help="Konfigurationsdatei oder eingebautes Profil (qualitaet)")
    gemeinsam(v, mit_commit=False)
    v.add_argument("--cache-neu", action="store_true")
    v.add_argument("--toleranz", type=float, default=0.01, help="relative Toleranz, unter der zwei Werte als gleich gelten (Vorgabe 0,01)")
    v.set_defaults(ausfuehren=befehl_vergleiche)

    s = teil.add_parser("stand", help="die Arbeitskopie zu einem Commit anlegen")
    s.add_argument("commit")
    s.set_defaults(ausfuehren=befehl_stand)

    pr = teil.add_parser("profile", help="eingebaute Profile auflisten")
    pr.set_defaults(ausfuehren=befehl_profile)


def _melde(text: str) -> None:
    print(text, file=sys.stderr, flush=True)


def _stdout_utf8() -> None:
    for strom in (sys.stdout, sys.stderr):
        if hasattr(strom, "reconfigure"):
            strom.reconfigure(encoding="utf-8", errors="replace")


def _konfig(args: argparse.Namespace) -> Konfig:
    konfig = lade_konfig(args.konfig).waehle(args.nur.split(",") if getattr(args, "nur", None) else None)
    if getattr(args, "schnappschuss", None):
        faelle = []
        for f in konfig.faelle:
            if f.stufe == "endgelaende-lokal":
                auftrag = copy.deepcopy(f.auftrag)
                auftrag.setdefault("endgelaende", {})["schnappschuss"] = str(Path(args.schnappschuss).resolve())
                f = replace(f, auftrag=auftrag)
            faelle.append(f)
        konfig.faelle = faelle
    return konfig


def _ausgabe(args: argparse.Namespace, art: str, konfig: Konfig, commit: str | None) -> Path:
    if args.ausgabe:
        return Path(args.ausgabe)
    stand = loese_commit(commit)[:12] if commit else git(["rev-parse", "--short=12", "HEAD"])
    return laeufe_wurzel() / art / f"{time.strftime('%Y%m%d-%H%M%S')}-{konfig.name}-{stand}"


def _trocken(konfig: Konfig, adapter: Adapter, commit: str | None) -> int:
    print(f"{konfig.name}: {len(konfig.faelle)} Fälle")
    for f in konfig.faelle:
        info = adapter.fingerprint(f.auftrag, commit)
        print(f"  {f.name:<34} {f.stufe:<18} Prozesse {f.wiederholungen} warm {f.warm} Phasen {f.phasen}  Auftrag {info.auftrag_fingerprint[:12]}  Commit {info.commit[:12]}{'' if info.baum_sauber else ' UNSAUBER'}")
    return 0


def _fehler(fehler: Exception) -> int:
    """Meldung und Ausgang: 2 Eingabe, 5 gesperrt, 6 Vorprüfung, sonst der Ausgang des Adapters oder 1."""
    print(f"Fehler: {fehler}", file=sys.stderr)
    if isinstance(fehler, AdapterFehler):
        return fehler.code
    return {KonfigFehler: 2, ValueError: 2, Gesperrt: 5, Vorpruefung: 6}.get(type(fehler), 1)


def _schwer(args: argparse.Namespace, was: str, konfig: Konfig, lauf: Any) -> int:
    """Sperre und Vorprüfung um einen Lauf."""
    try:
        pruefe_schnappschuesse(konfig, daten_wurzel())
        if not args.ohne_pruefung:
            gemessen = pruefe_ressourcen(repo_wurzel(), mindest_ram_mib(konfig))
            _melde(f"Vorprüfung: {gemessen['ram_frei_mib']} MiB RAM frei, {gemessen['platz_frei_gib']} GiB Platz")
        if args.ohne_sperre:
            return lauf()
        with Sperre(laeufe_wurzel() / ".lauf.sperre", was):
            return lauf()
    except (KonfigFehler, Gesperrt, Vorpruefung, AdapterFehler, ValueError, RuntimeError) as fehler:
        return _fehler(fehler)


def befehl_perf(args: argparse.Namespace) -> int:
    _stdout_utf8()
    try:
        konfig = _konfig(args)
    except KonfigFehler as fehler:
        return _fehler(fehler)
    if args.wiederholungen or args.warm is not None:
        konfig.faelle = [
            replace(f, **({"wiederholungen": args.wiederholungen} if args.wiederholungen else {}), **({"warm": args.warm} if args.warm is not None else {}))
            for f in konfig.faelle
        ]
    if args.arbeiter is not None:
        konfig.arbeiter = args.arbeiter
    adapter = Adapter()
    if args.trocken:
        return _trocken(konfig, adapter, args.commit)
    ausgabe = _ausgabe(args, "perf", konfig, args.commit)

    def lauf() -> int:
        ergebnis = laufe_perf(konfig, adapter, ausgabe, commit=args.commit, schmutzig_erlauben=args.schmutzig_erlauben, melde=_melde)
        print(perf_tabelle(ergebnis))
        print(f"\nErgebnis: {ausgabe / 'ergebnis.json'}")
        return 0

    return _schwer(args, f"perf {konfig.name}", konfig, lauf)


def befehl_qualitaet(args: argparse.Namespace) -> int:
    _stdout_utf8()
    try:
        konfig = _konfig(args)
    except KonfigFehler as fehler:
        return _fehler(fehler)
    adapter = Adapter()
    if args.trocken:
        return _trocken(konfig, adapter, args.commit)
    ausgabe = _ausgabe(args, "qualitaet", konfig, args.commit)

    def lauf() -> int:
        ergebnis = laufe_qualitaet(konfig, adapter, ausgabe, commit=args.commit, cache=Zwischenspeicher(), cache_neu=args.cache_neu,
                                   schmutzig_erlauben=args.schmutzig_erlauben, melde=_melde)
        print(qualitaet_tabelle(ergebnis))
        print(f"\nErgebnis: {ausgabe / 'ergebnis.json'}")
        return 0

    return _schwer(args, f"qualitaet {konfig.name}", konfig, lauf)


def befehl_vergleiche(args: argparse.Namespace) -> int:
    _stdout_utf8()
    try:
        konfig = _konfig(args)
        a, b = loese_commit(args.commit_a), loese_commit(args.commit_b)
    except (KonfigFehler, ValueError) as fehler:
        return _fehler(fehler)
    adapter = Adapter()
    if args.trocken:
        for c in (a, b):
            print(f"== {c[:12]} ==")
            _trocken(konfig, adapter, c)
        return 0
    ausgabe = Path(args.ausgabe) if args.ausgabe else laeufe_wurzel() / "vergleich" / f"{time.strftime('%Y%m%d-%H%M%S')}-{konfig.name}-{a[:12]}-{b[:12]}"

    def lauf() -> int:
        cache = Zwischenspeicher()
        ergebnisse = {}
        for kennung, commit in (("a", a), ("b", b)):
            _melde(f"== Commit {kennung.upper()} {commit[:12]} ==")
            ergebnisse[kennung] = laufe_qualitaet(konfig, adapter, ausgabe / kennung, commit=commit, cache=cache, cache_neu=args.cache_neu,
                                                  schmutzig_erlauben=False, melde=_melde)
        v = vergleiche_ergebnisse(ergebnisse["a"], ausgabe / "a", ergebnisse["b"], ausgabe / "b", konfig.ziele, args.toleranz)
        schreibe_vergleich(v, ausgabe / "vergleich.json")
        print(vergleich_tabelle(v))
        print(f"\nErgebnis: {ausgabe / 'vergleich.json'}")
        return 0

    return _schwer(args, f"vergleiche {konfig.name}", konfig, lauf)


def befehl_stand(args: argparse.Namespace) -> int:
    _stdout_utf8()
    try:
        print(Adapter().stand_vorbereiten(args.commit))
        return 0
    except (AdapterFehler, ValueError) as fehler:
        return _fehler(fehler)


def befehl_profile(args: argparse.Namespace) -> int:
    _stdout_utf8()
    for p in sorted(PROFIL_ORDNER.glob("*.json")):
        k = lade_konfig(p)
        print(f"{p.stem:<12} {len(k.faelle):>3} Fälle  {k.beschreibung}")
    return 0
