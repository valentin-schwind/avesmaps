"""Befehle ``python -m terrainlab optimierung profile|grenzen|starten|fortsetzen|stoppen|stand|vorschlag|nachmessen`` (WI-0250 Phase A4)."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import replace
from pathlib import Path
from typing import Any

from terrainlab import daten_wurzel
from terrainlab.lauf.adapter import Adapter, AdapterFehler
from terrainlab.lauf.sperre import Gesperrt, Sperre, Vorpruefung, pruefe_ressourcen
from terrainlab.lauf.umgebung import laeufe_wurzel, loese_commit, repo_wurzel

from .lauf import EXIT_GESTOPPT, STUFEN, Lauf, optimierung_wurzel
from .profil import PROFIL_ORDNER, Profil, ProfilFehler, lade_profil
from .raum import Raum
from .speicher import Speicher


def registriere(unterbefehle: "argparse._SubParsersAction") -> None:
    p = unterbefehle.add_parser(
        "optimierung",
        help="Parameter der Gebirgstypen suchen: Sensitivität, Suche, Validierung, Strategievergleich",
        description="Gestufte, fortsetzbare Optimierung der Typwerte. Ergebnis ist eine Vorschlagsdatei, nie eine Fassung.",
    )
    p.set_defaults(ausfuehren=lambda args: p.print_help() or 2)
    teil = p.add_subparsers(dest="opt_befehl", metavar="{profile,grenzen,starten,fortsetzen,stoppen,stand,vorschlag,nachmessen}")

    pr = teil.add_parser("profile", help="Profile unter tools/terrain-lab/konfig auflisten")
    pr.set_defaults(ausfuehren=befehl_profile)

    g = teil.add_parser("grenzen", help="Parameterraum eines Typs aus den Verträgen des Generators ausgeben")
    g.add_argument("typ", nargs="?", help="Typ (ohne Angabe: alle Typen mit Zahl der Parameter)")
    g.add_argument("--commit", default="HEAD", help="Generator-Stand (Vorgabe HEAD)")
    g.add_argument("--fassung", type=int, default=19)
    g.add_argument("--json", action="store_true", help="die Rohausgabe des Adapters (grenzen.ts)")
    g.set_defaults(ausfuehren=befehl_grenzen)

    s = teil.add_parser("starten", help="einen neuen Lauf starten")
    s.add_argument("profil", help="Profilname (konfig/<name>.json) oder Datei")
    s.add_argument("--commit", help="Generator-Stand statt des Profils")
    s.add_argument("--ausgabe", metavar="ORDNER", help="Laufordner (Vorgabe <Labor>/optimierung/<zeit>-<profil>-<commit>)")
    s.add_argument("--nur-stufen", help=f"nur diese Stufen: {', '.join(STUFEN)}")
    s.add_argument("--zeit-s", type=int, help="Zeitgrenze dieses Aufrufs in Sekunden (überschreibt das Profil)")
    s.add_argument("--versuche", type=int, help="Höchstzahl neuer Rechnungen dieses Aufrufs")
    s.add_argument("--trocken", action="store_true", help="nur anzeigen, was geplant ist")
    s.add_argument("--ohne-sperre", action="store_true", help="die Sperre „nur ein schwerer Lauf“ nicht nehmen")
    s.set_defaults(ausfuehren=befehl_starten)

    f = teil.add_parser("fortsetzen", help="einen unterbrochenen Lauf fortsetzen")
    f.add_argument("lauf", help="Laufordner")
    f.add_argument("--zeit-s", type=int)
    f.add_argument("--versuche", type=int)
    f.add_argument("--ohne-sperre", action="store_true")
    f.set_defaults(ausfuehren=befehl_fortsetzen)

    st = teil.add_parser("stoppen", help="den Lauf sauber anhalten (legt die Datei STOP im Laufordner an)")
    st.add_argument("lauf")
    st.set_defaults(ausfuehren=befehl_stoppen)

    z = teil.add_parser("stand", help="Stand eines Laufs: Stufen, Messungen, Grenzen")
    z.add_argument("lauf", nargs="?", help="Laufordner (ohne Angabe: alle unter <Labor>/optimierung)")
    z.set_defaults(ausfuehren=befehl_stand)

    v = teil.add_parser("vorschlag", help="die Vorschläge eines Laufs ausgeben")
    v.add_argument("lauf")
    v.set_defaults(ausfuehren=befehl_vorschlag)

    n = teil.add_parser("nachmessen", help="eine Vorschlagsdatei an einem anderen Generator-Stand noch einmal messen (ohne neue Suche)")
    n.add_argument("vorschlag", help="Vorschlagsdatei oder Laufordner mit vorschlag-*.json")
    n.add_argument("--commit", required=True, help="der Generator-Stand, an dem nachgemessen wird (zum Beispiel origin/master)")
    n.add_argument("--ausgabe", metavar="ORDNER", help="Ordner der Nachmessung (Vorgabe <Labor>/optimierung/<zeit>-nachmessung-<commit>); ein vorhandener wird fortgesetzt")
    n.add_argument("--zeit-s", type=int, help="Zeitgrenze dieses Aufrufs in Sekunden (Vorgabe 3000)")
    n.add_argument("--versuche", type=int, help="Höchstzahl neuer Rechnungen dieses Aufrufs (Vorgabe 600)")
    n.add_argument("--ohne-sperre", action="store_true", help="die Sperre „nur ein schwerer Lauf“ nicht nehmen")
    n.set_defaults(ausfuehren=befehl_nachmessen)


def _melde(text: str) -> None:
    print(text, file=sys.stderr, flush=True)


def _utf8() -> None:
    for strom in (sys.stdout, sys.stderr):
        if hasattr(strom, "reconfigure"):
            strom.reconfigure(encoding="utf-8", errors="replace")


def befehl_profile(args: argparse.Namespace) -> int:
    _utf8()
    for datei in sorted(PROFIL_ORDNER.glob("*.json")):
        try:
            p = lade_profil(datei)
        except ProfilFehler as fehler:
            print(f"{datei.stem:<14} FEHLER {fehler}")
            continue
        print(f"{p.name:<14} {', '.join(t.typ + ':' + t.gebirge for t in p.typen):<44} {p.beschreibung}")
    return 0


def befehl_grenzen(args: argparse.Namespace) -> int:
    _utf8()
    try:
        commit = loese_commit(args.commit)
        grenzen = Adapter().grenzen(commit, args.fassung)
    except (AdapterFehler, ValueError) as fehler:
        print(f"Fehler: {fehler}", file=sys.stderr)
        return 2
    if args.json:
        print(json.dumps(grenzen, ensure_ascii=False, indent=1))
        return 0
    print(f"Generator-Stand {grenzen['stand']['commit'][:12]}, Fassung {grenzen['fassung']} (Presets in der Fassung: {'ja' if grenzen['fassung_hat_presets'] else 'nein'})")
    typen = [args.typ] if args.typ else grenzen["typen"]
    for typ in typen:
        raum = Raum.aus_grenzen(grenzen, typ)
        if args.typ:
            print(f"\n{typ}: {len(raum)} Parameter")
            print(f"  {'Parameter':<26} {'Art':<8} {'Vorgabe':>10} {'min':>8} {'max':>8} {'Schritt':>8}")
            for p in raum.parameter:
                if p.art == "wahl":
                    print(f"  {p.name:<26} {p.art:<8} {p.basis!s:>10}  Stufen: {', '.join(p.stufen)}")
                else:
                    print(f"  {p.name:<26} {p.art:<8} {p.basis:>10.4g} {p.min:>8.4g} {p.max:>8.4g} {p.schritt:>8.4g}")
        else:
            print(f"  {typ:<16} {len(raum)} Parameter")
    return 0


def _grenzen_aus(args: argparse.Namespace, profil: Profil) -> Profil:
    g = dict(profil.grenzen)
    if getattr(args, "zeit_s", None) is not None:
        g["zeit_s"] = args.zeit_s
    if getattr(args, "versuche", None) is not None:
        g["versuche"] = args.versuche
    return replace(profil, grenzen=g)


def _plan(profil: Profil) -> str:
    s, su, va, st = profil.sensitivitaet, profil.suche, profil.validierung, profil.strategien
    zeilen = [f"Profil {profil.name}: {', '.join(f'{t.typ} ({t.gebirge})' for t in profil.typen)}; Stand {profil.commit}, Fassung {profil.fassung}, Saaten {profil.saaten}"]
    zeilen.append(f"  Je Typ: Sensitivität (Parameter + 1) × {s['trajektorien']} Rechnungen bei 1×; Suche {su['kandidaten']} Kandidaten (Halving, Faktor {su['eta']}, bis {su['saaten']} Saaten); "
                  f"Verfeinerung {su['verfeinerung']['runden']} × {su['verfeinerung']['nachkommen']}")
    zeilen.append(f"  Validierung: die besten {va['beste']} bei {va['aufloesungen']} (4× nur für {va['vier_x_fuer']}); Strategien: "
                  f"{'4 × ' + str(st['kandidaten']) + ' Kandidaten' if st['aktiv'] else 'aus'}; Endgelände: {'ja' if profil.endgelaende['aktiv'] else 'nein'}")
    zeilen.append(f"  Grenzen: {profil.grenzen}")
    return "\n".join(zeilen)


def _fuehre(lauf: Lauf, args: argparse.Namespace, nur: tuple[str, ...] | None = None) -> int:
    def innen() -> int:
        try:
            return lauf.laufe(nur)
        finally:
            lauf.schliesse()

    try:
        if getattr(args, "ohne_sperre", False):
            return innen()
        with Sperre(laeufe_wurzel() / ".lauf.sperre", f"optimierung {lauf.profil.name}"):
            return innen()
    except Gesperrt as fehler:
        print(f"Fehler: {fehler}", file=sys.stderr)
        return 5
    except Vorpruefung as fehler:
        print(f"Fehler: {fehler}", file=sys.stderr)
        return 6
    except (AdapterFehler, ValueError, FileNotFoundError, RuntimeError, KeyError) as fehler:
        print(f"Fehler: {fehler}", file=sys.stderr)
        return getattr(fehler, "code", 1) if isinstance(fehler, AdapterFehler) else 1


def befehl_starten(args: argparse.Namespace) -> int:
    _utf8()
    try:
        profil = lade_profil(args.profil)
        if args.commit:
            profil = replace(profil, commit=args.commit)
        profil = _grenzen_aus(args, profil)
        nur = tuple(args.nur_stufen.split(",")) if args.nur_stufen else None
        if nur and not set(nur) <= set(STUFEN):
            raise ProfilFehler(f"--nur-stufen: unbekannte Stufe in {nur}")
    except ProfilFehler as fehler:
        print(f"Fehler: {fehler}", file=sys.stderr)
        return 2
    print(_plan(profil))
    if args.trocken:
        return 0
    try:
        pruefe_ressourcen(repo_wurzel(), float(profil.grenzen.get("ram_min_mib") or 0))
        lauf = Lauf.neu(profil, Adapter(), ordner=args.ausgabe, melde=_melde)
    except (Vorpruefung, FileExistsError, ValueError) as fehler:
        print(f"Fehler: {fehler}", file=sys.stderr)
        return 6 if isinstance(fehler, Vorpruefung) else 2
    print(f"Laufordner: {lauf.ordner}", file=sys.stderr)
    return _fuehre(lauf, args, nur)


def befehl_fortsetzen(args: argparse.Namespace) -> int:
    _utf8()
    try:
        lauf = Lauf.oeffne(args.lauf, Adapter(), melde=_melde)
        lauf.profil = _grenzen_aus(args, lauf.profil)
    except (FileNotFoundError, ValueError, ProfilFehler) as fehler:
        print(f"Fehler: {fehler}", file=sys.stderr)
        return 2
    print(f"Fortsetzen: {lauf.ordner}", file=sys.stderr)
    return _fuehre(lauf, args)


def befehl_stoppen(args: argparse.Namespace) -> int:
    _utf8()
    ordner = Path(args.lauf)
    if not (ordner / "lauf.sqlite").exists():
        print(f"Fehler: {ordner} enthält keinen Lauf", file=sys.stderr)
        return 2
    (ordner / "STOP").write_text("STOP\n", encoding="utf-8")
    print(f"STOP angelegt: {ordner / 'STOP'} (der Lauf hält vor der nächsten neuen Rechnung an; fortsetzen löscht die Datei)")
    return 0


def _zeige_stand(ordner: Path) -> None:
    db = Speicher(ordner / "lauf.sqlite")
    try:
        stand = ordner / "stand.json"
        verbraucht = json.loads(stand.read_text(encoding="utf-8")).get("verbraucht") if stand.exists() else None
        print(f"{ordner.name}: Status {db.meta('status')}  Commit {str(db.meta('commit'))[:12]}  Messungen {db.zaehle_messungen('ok')} (Fehler {db.zaehle_messungen('fehler')})  "
              f"{'STOP angelegt  ' if (ordner / 'STOP').exists() else ''}{'' if not verbraucht else f'zuletzt verbraucht {verbraucht}'}")
        for p in db.phasen():
            print(f"    {p['typ']:<16} {p['name']:<14} {p['status']:<9} {p['aktualisiert']}")
    finally:
        db.schliesse()


def befehl_stand(args: argparse.Namespace) -> int:
    _utf8()
    if args.lauf:
        ordner = Path(args.lauf)
        if not (ordner / "lauf.sqlite").exists():
            print(f"Fehler: {ordner} enthält keinen Lauf", file=sys.stderr)
            return 2
        _zeige_stand(ordner)
        return 0
    wurzel = optimierung_wurzel()
    for ordner in sorted(p.parent for p in wurzel.glob("*/lauf.sqlite")):
        _zeige_stand(ordner)
    return 0


def befehl_vorschlag(args: argparse.Namespace) -> int:
    _utf8()
    dateien = sorted(Path(args.lauf).glob("vorschlag-*.json"))
    if not dateien:
        print("Noch kein Vorschlag (der Lauf ist nicht fertig).", file=sys.stderr)
        return 1
    daten: dict[str, Any] = json.loads(dateien[-1].read_text(encoding="utf-8"))
    print(f"{dateien[-1]}  Commit {daten['commit'][:12]}  Profil {daten['profil']}")
    for typ, e in daten["typen"].items():
        print(f"\n{typ} ({e['gebirge']}): {e['status']}")
        print(f"  {e['begruendung']}")
        for gruppe in ("v12", "netz"):
            for k, w in (e.get("werte") or {}).get(gruppe, {}).items():
                print(f"    {gruppe}.{k}: {e['vorgabe'][gruppe][k]} → {w}")
        if (e.get("werte") or {}).get("muster"):
            print(f"    muster: {e['vorgabe']['muster']} → {e['werte']['muster']}")
        if e.get("strategie"):
            print(f"  Strategie: {e['strategie']['urteil']}")
    return 0


def befehl_nachmessen(args: argparse.Namespace) -> int:
    _utf8()
    from .auswerter import Gestoppt
    from .nachmessung import nachmessen, tabelle

    pfad = Path(args.vorschlag)
    if pfad.is_dir():
        dateien = sorted(pfad.glob("vorschlag-*.json"))
        if not dateien:
            print(f"Fehler: {pfad} enthält keine Vorschlagsdatei (vorschlag-*.json)", file=sys.stderr)
            return 2
        pfad = dateien[-1]
    if not pfad.exists():
        print(f"Fehler: {pfad} gibt es nicht", file=sys.stderr)
        return 2
    grenzen = {"zeit_s": args.zeit_s if args.zeit_s is not None else 3000, "versuche": args.versuche if args.versuche is not None else 600, "cpu_s": None, "ram_min_mib": 600, "ram_warten_s": 120}

    def innen() -> int:
        try:
            erg = nachmessen(pfad, args.commit, Adapter(), ordner=Path(args.ausgabe) if args.ausgabe else None, grenzen=grenzen, melde=_melde)
        except Gestoppt as g:
            print(f"Gestoppt ({g.art}): {g.grund}. Fortsetzen mit demselben --ausgabe.", file=sys.stderr)
            return EXIT_GESTOPPT
        print(tabelle(erg))
        return 0

    try:
        pruefe_ressourcen(repo_wurzel(), float(grenzen["ram_min_mib"]))
        if args.ohne_sperre:
            return innen()
        with Sperre(laeufe_wurzel() / ".lauf.sperre", "optimierung nachmessen"):
            return innen()
    except Gesperrt as fehler:
        print(f"Fehler: {fehler}", file=sys.stderr)
        return 5
    except Vorpruefung as fehler:
        print(f"Fehler: {fehler}", file=sys.stderr)
        return 6
    except (AdapterFehler, ValueError, FileNotFoundError, RuntimeError, KeyError) as fehler:
        print(f"Fehler: {fehler}", file=sys.stderr)
        return getattr(fehler, "code", 1) if isinstance(fehler, AdapterFehler) else 1
